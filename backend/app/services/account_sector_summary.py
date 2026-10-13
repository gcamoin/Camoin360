"""Bounded server-side sector aggregation; never enumerate the Account population."""
import asyncio
from datetime import datetime, timedelta, timezone
from xml.etree import ElementTree as ET

from .maintenance_dynamics import (
    AggregateLimitExceeded, MaintenanceDynamicsClient, MaintenanceQueryError,
    RequestBudget, nonnegative_count, utc_timestamp,
)

MAX_REQUESTS = 256
REFRESH_TIMEOUT_SECONDS = 120


class SectorCountClient(MaintenanceDynamicsClient):
    def __init__(self):
        self._query_slots = asyncio.Semaphore(4)

    async def first_created_on(self):
        data = await self._get(f"{self.base_url}/accounts", params={
            "$select": "createdon", "$orderby": "createdon asc", "$top": 1,
        })
        rows = data.get("value")
        if not isinstance(rows, list) or len(rows) > 1:
            raise MaintenanceQueryError("invalid_sector_boundary")
        if not rows:
            return None
        try:
            timestamp = datetime.fromisoformat(rows[0]["createdon"].replace("Z", "+00:00"))
            if timestamp.tzinfo is None:
                raise ValueError()
            return timestamp.astimezone(timezone.utc)
        except (KeyError, TypeError, AttributeError, ValueError):
            raise MaintenanceQueryError("invalid_sector_boundary") from None

    async def sector_counts(self, start, end):
        fetch = ET.Element("fetch", {"aggregate": "true"})
        entity = ET.SubElement(fetch, "entity", {"name": "account"})
        ET.SubElement(entity, "attribute", {"name": "new_sector", "alias": "sector", "groupby": "true"})
        ET.SubElement(entity, "attribute", {"name": "accountid", "alias": "account_count", "aggregate": "count"})
        filters = ET.SubElement(entity, "filter", {"type": "and"})
        for operator, boundary in (("ge", start), ("lt", end)):
            ET.SubElement(filters, "condition", {"attribute": "createdon", "operator": operator, "value": utc_timestamp(boundary)})
        self.headers["Prefer"] = 'odata.include-annotations="OData.Community.Display.V1.FormattedValue"'
        async with self._query_slots:
            data = await self._get(f"{self.base_url}/accounts", params={"fetchXml": ET.tostring(fetch, encoding="unicode")})
        if data.get("@odata.nextLink") or data.get("@Microsoft.Dynamics.CRM.totalrecordcountlimitexceeded"):
            raise AggregateLimitExceeded("aggregate_limit_exceeded")
        rows = data.get("value")
        if not isinstance(rows, list):
            raise MaintenanceQueryError("invalid_sector_counts")
        if len(rows) >= 5000:
            raise AggregateLimitExceeded("aggregate_limit_exceeded")
        counts = {}
        for row in rows:
            if not isinstance(row, dict):
                raise MaintenanceQueryError("invalid_sector_counts")
            raw = row.get("sector@OData.Community.Display.V1.FormattedValue", row.get("sector"))
            label = str(raw).strip() if raw is not None else ""
            label = label or "Unspecified"
            counts[label] = counts.get(label, 0) + nonnegative_count(row.get("account_count"))
        return counts


async def count_sector_interval(client, start, end, budget):
    budget.consume()
    try:
        return await client.sector_counts(start, end)
    except AggregateLimitExceeded:
        if end - start <= timedelta(microseconds=1):
            raise MaintenanceQueryError("sector_interval_unsplittable") from None
        middle = start + (end - start) / 2
        tasks = [asyncio.create_task(count_sector_interval(client, start, middle, budget)),
                 asyncio.create_task(count_sector_interval(client, middle, end, budget))]
        try:
            left, right = await asyncio.gather(*tasks)
        except BaseException:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            raise
        for sector, count in right.items():
            left[sector] = left.get(sector, 0) + count
        return left


async def _load_sector_summary():
    budget = RequestBudget(MAX_REQUESTS)
    async with SectorCountClient() as client:
        budget.consume()
        start = await client.first_created_on()
        end = datetime.now(timezone.utc) + timedelta(microseconds=1)
        if start is not None and start >= end:
            raise MaintenanceQueryError("invalid_sector_boundary")
        counts = await count_sector_interval(client, start, end, budget) if start else {}
    sectors = [{"sector": sector, "account_count": count} for sector, count in counts.items()]
    sectors.sort(key=lambda row: (-row["account_count"], row["sector"].casefold()))
    return {"total_accounts": sum(counts.values()), "sector_count": len(sectors), "sectors": sectors}


async def load_sector_summary():
    return await asyncio.wait_for(_load_sector_summary(), timeout=REFRESH_TIMEOUT_SECONDS)
