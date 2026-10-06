"""Narrow, read-only Dataverse queries for maintenance observation and counts."""
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlsplit
from xml.etree import ElementTree as ET

import httpx

from .auth import get_access_token

ACCOUNT_FIELDS = (
    "accountid,name,createdon,cr73c_enrichmentattempted,cr73c_enrichmentlastattemptedon"
)
ACCOUNT_ORDER = "createdon asc,accountid asc"
TOTAL_SOURCE = "dataverse_retrieve_total_record_count"


class MaintenanceQueryError(RuntimeError):
    """Only fixed operational codes are safe to propagate to sync state."""


class AggregateLimitExceeded(MaintenanceQueryError):
    pass


class BudgetExceeded(MaintenanceQueryError):
    pass


@dataclass
class RequestBudget:
    limit: int
    used: int = 0

    def consume(self):
        if self.used >= self.limit:
            raise BudgetExceeded("request_budget_exhausted")
        self.used += 1


def utc_timestamp(value):
    if not isinstance(value, datetime) or value.tzinfo is None:
        raise ValueError("An aware UTC-convertible timestamp is required")
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def discovery_params(start, end):
    return {
        "$select": ACCOUNT_FIELDS,
        "$filter": f"createdon ge {utc_timestamp(start)} and createdon lt {utc_timestamp(end)}",
        "$orderby": ACCOUNT_ORDER,
    }


def nonnegative_count(value):
    # Dataverse can serialize Edm.Int64 as a decimal string. Missing is never zero.
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        raise MaintenanceQueryError("invalid_count_response")
    if isinstance(value, str) and (not value or not value.isascii() or not value.isdigit()):
        raise MaintenanceQueryError("invalid_count_response")
    parsed = int(value)
    if not 0 <= parsed <= 9223372036854775807:
        raise MaintenanceQueryError("invalid_count_response")
    return parsed


class MaintenanceDynamicsClient:
    async def __aenter__(self):
        self.base_url = (os.getenv("DYNAMICS_API_URL") or "").rstrip("/")
        base = urlsplit(self.base_url)
        if base.scheme not in {"http", "https"} or not base.netloc or base.username or base.password or base.query or base.fragment:
            raise MaintenanceQueryError("dynamics_configuration_unavailable")
        token = await get_access_token()
        self.headers = {
            "Authorization": f"Bearer {token}", "Accept": "application/json",
            "OData-Version": "4.0", "OData-MaxVersion": "4.0",
        }
        self.client = httpx.AsyncClient(timeout=20, follow_redirects=False)
        await self.client.__aenter__()
        return self

    async def __aexit__(self, *args):
        return await self.client.__aexit__(*args)

    def validate_next_link(self, link, start, end):
        # Never forward the bearer token to another origin/path or an unbounded query.
        if not isinstance(link, str) or len(link) > 32768:
            raise MaintenanceQueryError("invalid_discovery_cursor")
        parsed, expected = urlsplit(link), urlsplit(f"{self.base_url}/accounts")
        if (parsed.scheme, parsed.netloc, parsed.path) != (expected.scheme, expected.netloc, expected.path) or parsed.fragment or parsed.username or parsed.password:
            raise MaintenanceQueryError("invalid_discovery_cursor")
        query = parse_qs(parsed.query, keep_blank_values=True)
        required = discovery_params(start, end)
        if set(query) != set(required) | {"$skiptoken"} or not query.get("$skiptoken", [""])[0]:
            raise MaintenanceQueryError("invalid_discovery_cursor")
        if any(query.get(key) != [value] for key, value in required.items()) or len(query["$skiptoken"]) != 1:
            raise MaintenanceQueryError("invalid_discovery_cursor")

    async def _get(self, url, *, params=None, page_size=None):
        headers = dict(self.headers)
        if page_size is not None:
            headers["Prefer"] = f"odata.maxpagesize={page_size}"
        response = await self.client.get(url, params=params, headers=headers)
        try:
            data = response.json()
        except ValueError:
            raise MaintenanceQueryError("invalid_dynamics_response") from None
        if not isinstance(data, dict):
            raise MaintenanceQueryError("invalid_dynamics_response")
        error = data.get("error")
        code = str(error.get("code", "")) if isinstance(error, dict) else ""
        if code.lower() in {"8004e023", "0x8004e023", "-2147164125"}:
            raise AggregateLimitExceeded("aggregate_limit_exceeded")
        if response.status_code != 200 or error:
            raise MaintenanceQueryError("dynamics_query_failed")
        return data

    async def discovery_page(self, start, end, page_size, next_link=None):
        if next_link:
            self.validate_next_link(next_link, start, end)
        data = await self._get(
            next_link or f"{self.base_url}/accounts",
            params=None if next_link else discovery_params(start, end), page_size=page_size,
        )
        rows = data.get("value")
        if not isinstance(rows, list) or len(rows) > page_size:
            raise MaintenanceQueryError("invalid_discovery_page")
        link = data.get("@odata.nextLink")
        if link is not None:
            self.validate_next_link(link, start, end)
            if link == next_link or not rows:
                raise MaintenanceQueryError("invalid_discovery_cursor")
        return rows, link

    async def total_count(self):
        data = await self._get(
            f"{self.base_url}/RetrieveTotalRecordCount(EntityNames=@p1)",
            params={"@p1": '["account"]'},
        )
        collection = data.get("EntityRecordCountCollection")
        if not isinstance(collection, dict) or collection.get("Keys") != ["account"]:
            raise MaintenanceQueryError("invalid_count_response")
        values = collection.get("Values")
        if not isinstance(values, list) or len(values) != 1:
            raise MaintenanceQueryError("invalid_count_response")
        return nonnegative_count(values[0])

    async def aggregate_count(self, start, end):
        fetch = ET.Element("fetch", {"aggregate": "true"})
        entity = ET.SubElement(fetch, "entity", {"name": "account"})
        ET.SubElement(entity, "attribute", {"name": "accountid", "alias": "account_count", "aggregate": "count"})
        filters = ET.SubElement(entity, "filter", {"type": "and"})
        for operator, boundary in (("ge", start), ("lt", end)):
            ET.SubElement(filters, "condition", {"attribute": "createdon", "operator": operator, "value": utc_timestamp(boundary)})
        data = await self._get(f"{self.base_url}/accounts", params={"fetchXml": ET.tostring(fetch, encoding="unicode")})
        rows = data.get("value")
        if data.get("@Microsoft.Dynamics.CRM.totalrecordcountlimitexceeded"):
            raise AggregateLimitExceeded("aggregate_limit_exceeded")
        if not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict):
            raise MaintenanceQueryError("invalid_count_response")
        return nonnegative_count(rows[0].get("account_count"))


async def count_creation_interval(client, start, end, budget):
    """Count entirely server-side; never substitute row enumeration or partial totals."""
    if start > end:
        raise ValueError("Invalid creation interval")
    if start == end:
        return 0
    budget.consume()
    try:
        return await client.aggregate_count(start, end)
    except AggregateLimitExceeded:
        # A bulk import at one instant may remain uncountable below the platform limit.
        if end - start <= timedelta(seconds=1):
            raise MaintenanceQueryError("aggregate_interval_unsplittable") from None
        middle = start + (end - start) / 2
        left = await count_creation_interval(client, start, middle, budget)
        right = await count_creation_interval(client, middle, end, budget)
        total = left + right
        if total > 9223372036854775807:
            raise MaintenanceQueryError("invalid_count_response")
        return total
