"""Read persisted Dataverse Data Health values; cache aggregates only, never score Accounts."""
import asyncio
import logging
from datetime import timedelta
from xml.etree import ElementTree as ET

from . import maintenance_observations as observations
from .account_sector_summary import SectorCountClient
from .maintenance_dynamics import AggregateLimitExceeded, MaintenanceQueryError, RequestBudget, nonnegative_count, utc_timestamp

logger = logging.getLogger(__name__)
# Verified against Account AttributeMetadata / PicklistAttributeMetadata on 2026-10-06.
SCORE_FIELD = "cr73c_datahealthscore"
HEALTH_FIELD = "cr73c_datahealth"
CATEGORIES = (("excellent", "Excellent", 732660003), ("good", "Good", 732660002),
              ("needs_enrichment", "Needs Enrichment", 732660001), ("poor", "Poor", 732660000))
SOURCE = "dataverse_data_health_aggregate"
MAX_REQUESTS = 256
TIMEOUT_SECONDS = 120
COUNTERS = ("total_accounts", "scored_accounts", "score_sum", "poor_count", "needs_enrichment_count", "good_count", "excellent_count")


class DataHealthClient(SectorCountClient):
    async def health_counts(self, start, end):
        fetch = ET.Element("fetch", {"aggregate": "true"})
        entity = ET.SubElement(fetch, "entity", {"name": "account"})
        for attributes in (
            {"name": HEALTH_FIELD, "alias": "health", "groupby": "true"},
            {"name": "accountid", "alias": "total_accounts", "aggregate": "count"},
            {"name": SCORE_FIELD, "alias": "scored_accounts", "aggregate": "countcolumn"},
            {"name": SCORE_FIELD, "alias": "score_sum", "aggregate": "sum"},
        ):
            ET.SubElement(entity, "attribute", attributes)
        conditions = ET.SubElement(entity, "filter", {"type": "and"})
        for operator, boundary in (("ge", start), ("lt", end)):
            ET.SubElement(conditions, "condition", {"attribute": "createdon", "operator": operator, "value": utc_timestamp(boundary)})
        async with self._query_slots:
            data = await self._get(f"{self.base_url}/accounts", params={"fetchXml": ET.tostring(fetch, encoding="unicode")})
        if data.get("@odata.nextLink") or data.get("@Microsoft.Dynamics.CRM.totalrecordcountlimitexceeded"):
            raise AggregateLimitExceeded("aggregate_limit_exceeded")
        rows = data.get("value")
        if not isinstance(rows, list):
            raise MaintenanceQueryError("invalid_data_health_aggregate")
        result = dict.fromkeys(COUNTERS, 0)
        choices = {choice: category + "_count" for category, _label, choice in CATEGORIES}
        for row in rows:
            if not isinstance(row, dict):
                raise MaintenanceQueryError("invalid_data_health_aggregate")
            total = nonnegative_count(row.get("total_accounts"))
            scored = nonnegative_count(row.get("scored_accounts"))
            if scored and row.get("score_sum") is None:
                raise MaintenanceQueryError("invalid_data_health_aggregate")
            score_sum = nonnegative_count(row.get("score_sum", 0) or 0)
            if scored > total or score_sum > scored * 100 or (scored == 0 and score_sum != 0):
                raise MaintenanceQueryError("invalid_data_health_aggregate")
            result["total_accounts"] += total
            result["scored_accounts"] += scored
            result["score_sum"] += score_sum
            choice = row.get("health")
            if type(choice) is int and choice in choices:
                result[choices[choice]] += total
        return result


async def count_health_interval(client, start, end, budget):
    budget.consume()
    try:
        return await client.health_counts(start, end)
    except AggregateLimitExceeded:
        if end - start <= timedelta(microseconds=1):
            raise MaintenanceQueryError("aggregate_interval_unsplittable") from None
        middle = start + (end - start) / 2
        tasks = [asyncio.create_task(count_health_interval(client, start, middle, budget)),
                 asyncio.create_task(count_health_interval(client, middle, end, budget))]
        try:
            left, right = await asyncio.gather(*tasks)
        except BaseException:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            raise
        return {key: left[key] + right[key] for key in COUNTERS}


async def collect_data_health(now, budget):
    async with DataHealthClient() as client:
        budget.consume()
        start = await client.first_created_on()  # One indexed timestamp, never a population scan.
        if start is None:
            result = dict.fromkeys(COUNTERS, 0)
        else:
            if start > now:
                raise MaintenanceQueryError("invalid_data_health_aggregate")
            result = await count_health_interval(client, start, now + timedelta(microseconds=1), budget)
    classified = sum(result[category + "_count"] for category, _label, _choice in CATEGORIES)
    return {**result, "average_score": result["score_sum"] / result["scored_accounts"] if result["scored_accounts"] else None,
            "unscored_accounts": result["total_accounts"] - result["scored_accounts"],
            "classified_accounts": classified, "unclassified_accounts": result["total_accounts"] - classified}


def read_snapshot(connection):
    row = connection.execute("SELECT * FROM maintenance_data_health_snapshot WHERE id = 1").fetchone()
    return dict(row) if row else None


def save_snapshot(connection, result, now):
    columns = (*COUNTERS, "average_score", "unscored_accounts", "classified_accounts", "unclassified_accounts")
    connection.execute(f"""INSERT INTO maintenance_data_health_snapshot
        (id, {', '.join(columns)}, fetched_at, source) VALUES (1, {', '.join('?' for _ in columns)}, ?, ?)
        ON CONFLICT (id) DO UPDATE SET {', '.join(key + ' = EXCLUDED.' + key for key in columns)},
        fetched_at = EXCLUDED.fetched_at, source = EXCLUDED.source""", tuple(result[key] for key in columns) + (now, SOURCE))


async def refresh_data_health(*, now=None, cadence_seconds=1800, force=False):
    now = observations.aware_timestamp(now or observations.utc_now())
    budget = RequestBudget(MAX_REQUESTS)
    try:
        async with observations._refresh_lock("data_health") as acquired:
            if not acquired:
                return {"status": "busy"}
            snapshot = await observations._run_db(read_snapshot)
            state = await observations._run_db(observations._ensure_state, "data_health", now)
            if not force and snapshot and state["status"] == "idle" and now - snapshot["fetched_at"] < timedelta(seconds=cadence_seconds):
                return {**state, "skipped": True}
            await observations._run_db(observations._begin, "data_health", now)
            try:
                result = await asyncio.wait_for(collect_data_health(now, budget), timeout=TIMEOUT_SECONDS)
                completed = max(now, observations.utc_now())
                await observations._run_db(save_snapshot, result, completed)
                return await observations._run_db(observations._finish, "data_health", completed, "idle", budget.used, result["total_accounts"])
            except asyncio.CancelledError:
                await asyncio.shield(observations._failure("data_health", now, MaintenanceQueryError("refresh_interrupted"), budget.used))
                raise
            except Exception as exc:
                return await observations._failure("data_health", observations.utc_now(), exc, budget.used)
    except Exception:
        logger.warning("Maintenance Data Health persistence unavailable; snapshot preserved")
        return {"status": "error", "error": "database_unavailable", "coverage_complete": False}


def home_data_health(snapshot, state, now, cadence_seconds=1800):
    stale = snapshot is None or (now - snapshot["fetched_at"]).total_seconds() >= cadence_seconds * 2 or state.get("status") == "error"
    classified = snapshot["classified_accounts"] if snapshot else None
    def percentage(count):
        return round(count * 100 / classified, 1) if classified else None
    distribution = [{"category": category, "label": label,
                     "count": snapshot[category + "_count"] if snapshot else None,
                     "percentage": percentage(snapshot[category + "_count"]) if snapshot else None}
                    for category, label, _choice in CATEGORIES]
    healthy = snapshot["good_count"] + snapshot["excellent_count"] if snapshot else None
    needs = snapshot["poor_count"] + snapshot["needs_enrichment_count"] if snapshot else None
    return {"metrics": {
        "average_data_health": {"value": snapshot["average_score"] if snapshot else None,
            "scored_accounts": snapshot["scored_accounts"] if snapshot else None,
            "unscored_accounts": snapshot["unscored_accounts"] if snapshot else None},
        "healthy_accounts": {"count": healthy, "percentage": percentage(healthy) if snapshot else None},
        "needs_enrichment": {"count": needs, "percentage": percentage(needs) if snapshot else None},
    }, "data_health_distribution": distribution,
       "data_health": {key: snapshot.get(key) if snapshot else None for key in
                       ("scored_accounts", "classified_accounts", "unscored_accounts", "unclassified_accounts", "total_accounts", "fetched_at", "source")},
       "freshness": {"is_stale": stale, "snapshot_age_seconds": max(0, (now - snapshot["fetched_at"]).total_seconds()) if snapshot else None,
                     "last_successful_refresh_at": state.get("last_succeeded_at"), "last_attempted_refresh_at": state.get("last_started_at"),
                     "refresh_incomplete": state.get("status") != "idle"}}
