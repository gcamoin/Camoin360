import os
import asyncio
import time
import httpx
import re
import logging
from dotenv import load_dotenv
from pathlib import Path
from datetime import datetime, timedelta, timezone
from .auth import get_access_token
from .metrics import increment_processed, log_update
from .seamless import enrich_with_seamless
from .usage import can_make_request, increment_usage, load_usage, WEEKLY_LIMIT

logger = logging.getLogger(__name__)


class DynamicsApiError(RuntimeError):
    def __init__(self, message: str, status_code: int):
        super().__init__(message)
        self.status_code = status_code

REPO_ROOT = Path(__file__).resolve().parents[3]
BACKEND_ROOT = Path(__file__).resolve().parents[2]

load_dotenv(REPO_ROOT / ".env")
load_dotenv(BACKEND_ROOT / ".env")

API_URL = os.getenv("DYNAMICS_API_URL")
DATA_QUALITY_CACHE_TTL_SECONDS = 300
DATA_QUALITY_ACCOUNT_LIMIT = int(os.getenv("DATA_QUALITY_ACCOUNT_LIMIT", "5000"))
SUMMARY_CACHE_TTL_SECONDS = 600
DATA_QUALITY_REQUEST_TIMEOUT_SECONDS = 60
DUPLICATE_ACCOUNT_DEFAULT_LIMIT = 1000
DUPLICATE_ACCOUNT_MAX_LIMIT = 1000
MARKETING_LIST_DEFAULT_LIMIT = int(os.getenv("MARKETING_LIST_DEFAULT_LIMIT", "500"))
MARKETING_LIST_REQUEST_TIMEOUT_SECONDS = 60
MARKETING_LIST_CLIENT_ACCOUNT_SCAN_LIMIT = 25
MARKETING_LIST_CLIENT_ENRICHMENT_LIMIT = int(os.getenv("MARKETING_LIST_CLIENT_ENRICHMENT_LIMIT", "50"))
LEADFEEDER_VISIT_DEFAULT_LIMIT = 200
LEADFEEDER_VISIT_MAX_LIMIT = 1000
LEADFEEDER_VISIT_REQUEST_TIMEOUT_SECONDS = 60
PE_CLIENT_DEFAULT_LIMIT = 1000
PE_CLIENT_MAX_LIMIT = 5000
PE_CLIENT_REQUEST_TIMEOUT_SECONDS = 60
MARKETING_LIST_ACCOUNT_WEBSITE_VISIT_RELATIONSHIP_CANDIDATES = (
    "cr73c_lfapp_websitevisit",
)
WEBSITE_VISIT_CLIENT_RELATIONSHIP_CANDIDATES = ("new_Client",)
_DATA_QUALITY_CACHE = {"expires_at": 0, "data": None, "limit": 0}
_SUMMARY_CACHE = {"expires_at": 0, "data": None}
_MARKETING_LIST_CAMPAIGN_NAVIGATION_CACHE = {"loaded": False, "value": None}
_ACCOUNT_WEBSITE_VISIT_NAVIGATION_CACHE = {"loaded": False, "value": None}
_WEBSITE_VISIT_CLIENT_NAVIGATION_CACHE = {"loaded": False, "value": None}
_WEBSITE_VISIT_ACCOUNT_NAVIGATION_CACHE = {"loaded": False, "value": None}
_DATA_QUALITY_REFRESH_TASK = None
MARKETING_METRICS_CACHE_TTL_SECONDS = 600
INTERNAL_COMPANY_ACCOUNT_ID = "08c283ff-6186-eb11-a812-0022481d279b"
TARGET_INDUSTRIES_TABLE = "new_targetindustries"
TARGET_INDUSTRY_CLIENT_LOOKUP_FIELD = "_new_clientid_value"
TARGET_INDUSTRY_NAME_FIELD = "new_targetindustrydisplayname"
TARGET_INDUSTRY_NAICS_FIELD = "new_naicsprefixcode"
TARGET_INDUSTRY_CODE_FIELDS = (
    "new_naicsprefixcode",
    "naicscode",
    "new_naicscode",
)
TARGET_INDUSTRY_ENTITY_SET_CANDIDATES = (
    "new_targetindustries",
    "new_targetindustrieses",
    "new_targetindustry",
)
ACCOUNT_NAICS_FIELDS = (
    "new_naicsprefixcode",
    "naicscode",
    "new_naicscode",
)
VISITOR_ACCOUNT_LOOKUP_FIELDS = (
    "_new_account_value",
    "_lfapp_account_value",
    "_new_visitoraccount_value",
    "_lfapp_visitoraccount_value",
    "_new_visitor_value",
    "_lfapp_visitor_value",
)
_DATA_QUALITY_CACHE = {"expires_at": 0, "data": None}
_SUMMARY_CACHE = {"expires_at": 0, "data": None}
_MARKETING_METRICS_CACHE = {"expires_at": 0, "data": None}
_PROJECT_METRICS_CACHE = {"expires_at": 0, "data": None}
MARKETING_RANGE_OPTIONS = {
    "last_week": {"label": "Last Week", "days": 7},
    "last_month": {"label": "Last Month", "days": 30},
    "last_6_months": {"label": "Last 6 Months", "months": 6},
    "last_year": {"label": "Last Year", "months": 12},
}

STATE_ABBREVIATIONS = {
    "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR",
    "California": "CA", "Colorado": "CO", "Connecticut": "CT", "Delaware": "DE",
    "Florida": "FL", "Georgia": "GA", "Hawaii": "HI", "Idaho": "ID",
    "Illinois": "IL", "Indiana": "IN", "Iowa": "IA", "Kansas": "KS",
    "Kentucky": "KY", "Louisiana": "LA", "Maine": "ME", "Maryland": "MD",
    "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN", "Mississippi": "MS",
    "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV",
    "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
    "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK",
    "Oregon": "OR", "Pennsylvania": "PA", "Rhode Island": "RI",
    "South Carolina": "SC", "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX",
    "Utah": "UT", "Vermont": "VT", "Virginia": "VA", "Washington": "WA",
    "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY"
}


async def get_account(account_id: str, select_fields: str = "name,websiteurl"):
    token = await get_access_token()

    url = f"{API_URL}/accounts({account_id})?$select={select_fields}"

    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "OData-Version": "4.0"
    }

    async with httpx.AsyncClient() as client:
        response = await client.get(url, headers=headers)

    if response.status_code != 200:
        raise Exception(f"Failed to fetch account: {response.text}")

    return response.json()


async def get_accounts_missing_data():
    token = await get_access_token()

    url = (
        f"{API_URL}/accounts?"
        "$select=name,accountid,emailaddress1,telephone1,address1_city,address1_stateorprovince&"
        "$filter=(emailaddress1 eq null or telephone1 eq null)&"
        "$top=100"
    )

    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "OData-Version": "4.0"
    }

    async with httpx.AsyncClient() as client:
        response = await client.get(url, headers=headers)

    if response.status_code != 200:
        raise Exception(f"Dynamics GET error: {response.text}")

    return response.json().get("value", [])


async def get_accounts_data_quality(limit: int | None = None):
    account_limit = max(1, min(limit or DATA_QUALITY_ACCOUNT_LIMIT, DATA_QUALITY_ACCOUNT_LIMIT))
    now = time.time()
    if (
        _DATA_QUALITY_CACHE["data"] is not None
        and _DATA_QUALITY_CACHE["expires_at"] > now
        and _DATA_QUALITY_CACHE["limit"] >= account_limit
    ):
        return _DATA_QUALITY_CACHE["data"][:account_limit]

    token = await get_access_token()

    url = (
        f"{API_URL}/accounts?"
        "$select=accountid,name,address1_stateorprovince,address1_country,address1_city,new_sector,new_subsector,new_naicstext,description,websiteurl,telephone1,new_datasource,new_employees&"
        "$orderby=name asc&"
        f"$top={account_limit}"
    )

    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "OData-Version": "4.0",
        "Prefer": "odata.maxpagesize=5000",
    }

    accounts = []
    next_url = url

    timeout = httpx.Timeout(DATA_QUALITY_REQUEST_TIMEOUT_SECONDS)

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            while next_url and len(accounts) < account_limit:
                response = await client.get(next_url, headers=headers)

                if response.status_code != 200:
                    raise Exception(f"Dynamics GET error: {response.text}")

                response_data = response.json()
                accounts.extend(response_data.get("value", []))
                next_url = response_data.get("@odata.nextLink")
    except httpx.TimeoutException as exc:
        raise Exception(
            f"Dynamics request timed out after {DATA_QUALITY_REQUEST_TIMEOUT_SECONDS} seconds while loading data quality accounts"
        ) from exc

    accounts = accounts[:account_limit]
    _DATA_QUALITY_CACHE["data"] = accounts
    _DATA_QUALITY_CACHE["limit"] = account_limit
    _DATA_QUALITY_CACHE["expires_at"] = now + DATA_QUALITY_CACHE_TTL_SECONDS

    return accounts


def get_cached_accounts_data_quality():
    return _DATA_QUALITY_CACHE["data"] or []


def invalidate_account_read_caches():
    _DATA_QUALITY_CACHE["data"] = None
    _DATA_QUALITY_CACHE["expires_at"] = 0
    _DATA_QUALITY_CACHE["limit"] = 0
    _SUMMARY_CACHE["data"] = None
    _SUMMARY_CACHE["expires_at"] = 0


def start_data_quality_refresh():
    global _DATA_QUALITY_REFRESH_TASK

    if _DATA_QUALITY_REFRESH_TASK and not _DATA_QUALITY_REFRESH_TASK.done():
        return

    async def refresh():
        global _DATA_QUALITY_REFRESH_TASK
        try:
            await get_accounts_data_quality(1000)
        except Exception:
            return
        finally:
            _DATA_QUALITY_REFRESH_TASK = None

    _DATA_QUALITY_REFRESH_TASK = asyncio.create_task(refresh())


async def get_duplicate_account_records(limit: int = DUPLICATE_ACCOUNT_DEFAULT_LIMIT):
    account_limit = max(1, min(limit, DUPLICATE_ACCOUNT_MAX_LIMIT))
    token = await get_access_token()

    url = (
        f"{API_URL}/accounts?"
        "$select=accountid,name,websiteurl,emailaddress1,telephone1,address1_line1,address1_city,address1_stateorprovince,address1_postalcode,address1_country,new_sector,new_datasource,new_employees,description,createdon&"
        "$orderby=name asc&"
        f"$top={account_limit}"
    )

    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "OData-Version": "4.0",
        "Prefer": f"odata.maxpagesize={account_limit}",
    }

    accounts = []
    next_url = url
    timeout = httpx.Timeout(DATA_QUALITY_REQUEST_TIMEOUT_SECONDS)

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            while next_url and len(accounts) < account_limit:
                response = await client.get(next_url, headers=headers)

                if response.status_code != 200:
                    raise Exception(f"Dynamics GET error: {response.text}")

                payload = response.json()
                accounts.extend(payload.get("value", []))
                next_url = payload.get("@odata.nextLink")
    except httpx.TimeoutException as exc:
        raise Exception(
            f"Dynamics request timed out after {DATA_QUALITY_REQUEST_TIMEOUT_SECONDS} seconds while loading duplicate account records"
        ) from exc

    return accounts[:account_limit]


async def delete_account(account_id: str):
    token = await get_access_token()
    url = f"{API_URL}/accounts({account_id})"
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "OData-Version": "4.0",
    }

    async with httpx.AsyncClient() as client:
        response = await client.delete(url, headers=headers)

    if response.status_code not in [200, 204]:
        raise Exception(f"Dynamics DELETE error: {response.text}")

    invalidate_account_read_caches()

    return {"status": "deleted", "account_id": account_id}


def get_formatted_value(record: dict, field_name: str):
    return record.get(f"{field_name}@OData.Community.Display.V1.FormattedValue", record.get(field_name))


def is_guid_like(value):
    if not value:
        return False

    value_text = str(value).strip()
    return len(value_text) == 36 and value_text.count("-") == 4


def get_lookup_display_value(record: dict, field_name: str):
    value = get_formatted_value(record, field_name)
    return "" if is_guid_like(value) else value


def get_related_record_value(record: dict, relationship_name: str, field_names: tuple[str, ...]):
    related_record = record.get(relationship_name)

    if not isinstance(related_record, dict):
        return ""

    for field_name in field_names:
        value = get_formatted_value(related_record, field_name)
        if value:
            return value

    return ""


def get_first_present_record_value(record: dict, field_names: tuple[str, ...]):
    for field_name in field_names:
        value = get_formatted_value(record, field_name)
        if value:
            return value

    return ""


def get_client_name_from_marketing_list_accounts(
    record: dict,
    account_website_visit_relationship_name: str | None = None,
    website_visit_client_relationship_name: str | None = None,
):
    accounts = record.get("listaccount_association")

    if not isinstance(accounts, list):
        return ""

    account_website_visit_relationship_names = []
    if account_website_visit_relationship_name:
        account_website_visit_relationship_names.append(account_website_visit_relationship_name)
    account_website_visit_relationship_names.extend(
        relationship_name
        for relationship_name in MARKETING_LIST_ACCOUNT_WEBSITE_VISIT_RELATIONSHIP_CANDIDATES
        if relationship_name not in account_website_visit_relationship_names
    )

    website_visit_client_relationship_names = []
    if website_visit_client_relationship_name:
        website_visit_client_relationship_names.append(website_visit_client_relationship_name)
    website_visit_client_relationship_names.extend(
        relationship_name
        for relationship_name in WEBSITE_VISIT_CLIENT_RELATIONSHIP_CANDIDATES
        if relationship_name not in website_visit_client_relationship_names
    )

    for account in accounts:
        if not isinstance(account, dict):
            continue

        for account_relationship_name in account_website_visit_relationship_names:
            website_visit = account.get(account_relationship_name)
            if not isinstance(website_visit, dict):
                continue

            for client_relationship_name in website_visit_client_relationship_names:
                client_name = get_related_record_value(
                    website_visit,
                    client_relationship_name,
                    ("name", "new_client"),
                )
                if client_name:
                    return client_name

            client_name = get_first_present_record_value(website_visit, ("new_clientname", "_new_client_value"))
            if client_name:
                return client_name

    return ""


def normalize_marketing_list_record(
    record: dict,
    campaign_relationship_name: str | None = None,
    account_website_visit_relationship_name: str | None = None,
    website_visit_client_relationship_name: str | None = None,
):
    created_by = record.get("createdby", {}) if isinstance(record.get("createdby"), dict) else {}
    client_name = (
        get_related_record_value(record, "new_client", ("name",))
        or get_related_record_value(record, "new_clientid", ("name",))
        or get_related_record_value(record, "new_ClientId", ("name",))
        or get_first_present_record_value(record, ("new_client", "_new_client_value", "_new_clientid_value"))
        or get_client_name_from_marketing_list_accounts(
            record,
            account_website_visit_relationship_name,
            website_visit_client_relationship_name,
        )
    )
    campaign = ""
    if campaign_relationship_name:
        campaign = get_related_record_value(record, campaign_relationship_name, ("name",))

    return {
        "listid": record.get("listid"),
        "name": record.get("listname"),
        "marketing_list_name": record.get("listname"),
        "createdon": record.get("createdon"),
        "created_by": created_by.get("fullname") or get_formatted_value(record, "_createdby_value") or "",
        "member_count": record.get("membercount"),
        "list_member_type": get_formatted_value(record, "createdfromcode") or "",
        "list_type": get_formatted_value(record, "type") or "",
        "client_name": client_name or "",
        "campaign": campaign or "",
    }


async def get_list_campaign_navigation_property(client: httpx.AsyncClient, headers: dict):
    if _MARKETING_LIST_CAMPAIGN_NAVIGATION_CACHE["loaded"]:
        return _MARKETING_LIST_CAMPAIGN_NAVIGATION_CACHE["value"]

    metadata_url = (
        f"{API_URL}/EntityDefinitions(LogicalName='list')/ManyToOneRelationships?"
        "$select=ReferencingAttribute,ReferencingEntityNavigationPropertyName,ReferencedEntity&"
        "$filter=ReferencedEntity%20eq%20'campaign'"
    )

    response = await client.get(metadata_url, headers=headers)
    campaign_navigation_property = None

    if response.status_code == 200:
        relationships = response.json().get("value", [])
        for relationship in relationships:
            referencing_attribute = str(relationship.get("ReferencingAttribute") or "").lower()
            navigation_property = relationship.get("ReferencingEntityNavigationPropertyName")

            if navigation_property and (referencing_attribute == "campaignid" or "campaign" in navigation_property.lower()):
                campaign_navigation_property = navigation_property
                break

    _MARKETING_LIST_CAMPAIGN_NAVIGATION_CACHE["loaded"] = True
    _MARKETING_LIST_CAMPAIGN_NAVIGATION_CACHE["value"] = campaign_navigation_property

    return campaign_navigation_property


async def get_account_website_visit_navigation_property(client: httpx.AsyncClient, headers: dict):
    if _ACCOUNT_WEBSITE_VISIT_NAVIGATION_CACHE["loaded"]:
        return _ACCOUNT_WEBSITE_VISIT_NAVIGATION_CACHE["value"]

    metadata_url = (
        f"{API_URL}/EntityDefinitions(LogicalName='account')/ManyToOneRelationships?"
        "$select=ReferencingAttribute,ReferencingEntityNavigationPropertyName,ReferencedEntity,SchemaName"
    )

    response = await client.get(metadata_url, headers=headers)
    account_website_visit_navigation_property = None

    if response.status_code == 200:
        relationships = response.json().get("value", [])
        for relationship in relationships:
            searchable_values = [
                relationship.get("ReferencingAttribute"),
                relationship.get("ReferencingEntityNavigationPropertyName"),
                relationship.get("ReferencedEntity"),
                relationship.get("SchemaName"),
            ]
            searchable_text = " ".join(str(value or "").lower() for value in searchable_values)

            if "websitevisit" in searchable_text and relationship.get("ReferencedEntity") == "lfapp_websitevisit":
                account_website_visit_navigation_property = relationship.get("ReferencingEntityNavigationPropertyName")
                break

        if not account_website_visit_navigation_property:
            for relationship in relationships:
                navigation_property = relationship.get("ReferencingEntityNavigationPropertyName")
                if navigation_property in MARKETING_LIST_ACCOUNT_WEBSITE_VISIT_RELATIONSHIP_CANDIDATES:
                    account_website_visit_navigation_property = navigation_property
                    break

    _ACCOUNT_WEBSITE_VISIT_NAVIGATION_CACHE["loaded"] = True
    _ACCOUNT_WEBSITE_VISIT_NAVIGATION_CACHE["value"] = account_website_visit_navigation_property

    return account_website_visit_navigation_property


async def get_website_visit_client_navigation_property(client: httpx.AsyncClient, headers: dict):
    if _WEBSITE_VISIT_CLIENT_NAVIGATION_CACHE["loaded"]:
        return _WEBSITE_VISIT_CLIENT_NAVIGATION_CACHE["value"]

    metadata_url = (
        f"{API_URL}/EntityDefinitions(LogicalName='lfapp_websitevisit')/ManyToOneRelationships?"
        "$select=ReferencingAttribute,ReferencingEntityNavigationPropertyName,ReferencedEntity,SchemaName"
    )

    response = await client.get(metadata_url, headers=headers)
    website_visit_client_navigation_property = None

    if response.status_code == 200:
        relationships = response.json().get("value", [])
        for relationship in relationships:
            referencing_attribute = str(relationship.get("ReferencingAttribute") or "").lower()
            referenced_entity = str(relationship.get("ReferencedEntity") or "").lower()
            navigation_property = relationship.get("ReferencingEntityNavigationPropertyName")

            if navigation_property and referencing_attribute == "new_client" and referenced_entity == "account":
                website_visit_client_navigation_property = navigation_property
                break

        if not website_visit_client_navigation_property:
            for relationship in relationships:
                navigation_property = relationship.get("ReferencingEntityNavigationPropertyName")
                if navigation_property in WEBSITE_VISIT_CLIENT_RELATIONSHIP_CANDIDATES:
                    website_visit_client_navigation_property = navigation_property
                    break

    _WEBSITE_VISIT_CLIENT_NAVIGATION_CACHE["loaded"] = True
    _WEBSITE_VISIT_CLIENT_NAVIGATION_CACHE["value"] = website_visit_client_navigation_property

    return website_visit_client_navigation_property


async def get_website_visit_account_navigation_property(client: httpx.AsyncClient, headers: dict):
    if _WEBSITE_VISIT_ACCOUNT_NAVIGATION_CACHE["loaded"]:
        return _WEBSITE_VISIT_ACCOUNT_NAVIGATION_CACHE["value"]

    metadata_url = (
        f"{API_URL}/EntityDefinitions(LogicalName='lfapp_websitevisit')/ManyToOneRelationships?"
        "$select=ReferencingAttribute,ReferencingEntityNavigationPropertyName,ReferencedEntity,SchemaName"
    )

    response = await client.get(metadata_url, headers=headers)
    website_visit_account_navigation_property = None

    if response.status_code == 200:
        relationships = response.json().get("value", [])
        for relationship in relationships:
            referencing_attribute = str(relationship.get("ReferencingAttribute") or "").lower()
            referenced_entity = str(relationship.get("ReferencedEntity") or "").lower()
            navigation_property = relationship.get("ReferencingEntityNavigationPropertyName")

            if navigation_property and referencing_attribute == "lfapp_account" and referenced_entity == "account":
                website_visit_account_navigation_property = navigation_property
                break

        if not website_visit_account_navigation_property:
            for relationship in relationships:
                navigation_property = relationship.get("ReferencingEntityNavigationPropertyName")
                if navigation_property and "account" in navigation_property.lower():
                    website_visit_account_navigation_property = navigation_property
                    break

    _WEBSITE_VISIT_ACCOUNT_NAVIGATION_CACHE["loaded"] = True
    _WEBSITE_VISIT_ACCOUNT_NAVIGATION_CACHE["value"] = website_visit_account_navigation_property

    return website_visit_account_navigation_property


def build_marketing_lists_url(
    limit: int,
    campaign_navigation_property: str | None = None,
    include_client_column: bool = True,
):
    expand_parts = ["createdby($select=fullname)"]
    if campaign_navigation_property:
        expand_parts.append(f"{campaign_navigation_property}($select=name)")
    select_fields = [
        "listid",
        "listname",
        "createdon",
        "membercount",
        "createdfromcode",
        "type",
        "_createdby_value",
    ]
    if include_client_column:
        select_fields.append("new_client")

    return (
        f"{API_URL}/lists?"
        f"$select={','.join(select_fields)}&"
        f"$expand={','.join(expand_parts)}&"
        "$orderby=createdon desc&"
        f"$top={limit}"
    )


async def get_marketing_list_client_name_from_accounts(
    client: httpx.AsyncClient,
    headers: dict,
    list_id: str,
    account_website_visit_relationship_name: str,
    website_visit_client_relationship_name: str,
):
    url = (
        f"{API_URL}/lists({list_id})/listaccount_association?"
        "$select=accountid&"
        f"$top={MARKETING_LIST_CLIENT_ACCOUNT_SCAN_LIMIT}"
    )

    while url:
        response = await client.get(url, headers=headers)
        if response.status_code != 200:
            return ""

        payload = response.json()
        accounts = payload.get("value", [])
        account_ids = [
            account.get("accountid")
            for account in accounts
            if isinstance(account, dict) and account.get("accountid")
        ]

        if account_ids:
            account_id_values = ",".join(f"'{account_id}'" for account_id in account_ids)
            website_visit_url = (
                f"{API_URL}/lfapp_websitevisits?"
                "$select=lfapp_websitevisitid&"
                f"$expand={website_visit_client_relationship_name}($select=name)&"
                "$filter="
                "Microsoft.Dynamics.CRM.In("
                "PropertyName='lfapp_account',"
                f"PropertyValues=[{account_id_values}]"
                ")%20and%20_new_client_value%20ne%20null&"
                "$top=1"
            )
            website_visit_response = await client.get(website_visit_url, headers=headers)
            if website_visit_response.status_code == 200:
                website_visits = website_visit_response.json().get("value", [])
                for website_visit in website_visits:
                    client_name = get_related_record_value(
                        website_visit,
                        website_visit_client_relationship_name,
                        ("name",),
                    )
                    if client_name:
                        return client_name

        url = payload.get("@odata.nextLink")

    return ""


async def enrich_marketing_lists_with_client_names(
    client: httpx.AsyncClient,
    headers: dict,
    marketing_lists: list[dict],
    account_website_visit_relationship_name: str | None,
    website_visit_client_relationship_name: str | None,
):
    if not account_website_visit_relationship_name or not website_visit_client_relationship_name:
        return marketing_lists

    semaphore = asyncio.Semaphore(8)

    async def enrich_row(marketing_list: dict):
        if marketing_list.get("client_name") or not marketing_list.get("listid"):
            return marketing_list

        async with semaphore:
            client_name = await get_marketing_list_client_name_from_accounts(
                client,
                headers,
                marketing_list["listid"],
                account_website_visit_relationship_name,
                website_visit_client_relationship_name,
            )

        if client_name:
            return {**marketing_list, "client_name": client_name}

        return marketing_list

    enrichment_candidates = []
    for marketing_list in marketing_lists:
        if (
            len(enrichment_candidates) < MARKETING_LIST_CLIENT_ENRICHMENT_LIMIT
            and not marketing_list.get("client_name")
            and marketing_list.get("listid")
        ):
            enrichment_candidates.append(marketing_list)

    enriched_rows = await asyncio.gather(*(enrich_row(marketing_list) for marketing_list in enrichment_candidates))
    enriched_by_id = {row.get("listid"): row for row in enriched_rows}
    return [
        enriched_by_id.get(marketing_list.get("listid"), marketing_list)
        for marketing_list in marketing_lists
    ]


def is_missing_dynamics_property_error(response: httpx.Response):
    return response.status_code == 400 and "0x80060888" in response.text and "Could not find a property named" in response.text


async def get_marketing_lists(limit: int = MARKETING_LIST_DEFAULT_LIMIT):
    token = await get_access_token()
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "OData-Version": "4.0",
        "Prefer": 'odata.include-annotations="OData.Community.Display.V1.FormattedValue",odata.maxpagesize=5000',
    }

    marketing_lists = []
    timeout = httpx.Timeout(MARKETING_LIST_REQUEST_TIMEOUT_SECONDS)

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            campaign_navigation_property = await get_list_campaign_navigation_property(client, headers)
            account_website_visit_relationship_name = await get_account_website_visit_navigation_property(client, headers)
            website_visit_client_relationship_name = await get_website_visit_client_navigation_property(client, headers)
            include_client_column = True
            next_url = build_marketing_lists_url(
                limit,
                campaign_navigation_property,
                include_client_column,
            )

            while next_url and len(marketing_lists) < limit:
                response = await client.get(next_url, headers=headers)

                if response.status_code != 200:
                    if include_client_column and is_missing_dynamics_property_error(response) and "new_client" in response.text:
                        include_client_column = False
                        next_url = build_marketing_lists_url(
                            limit,
                            campaign_navigation_property,
                            include_client_column,
                        )
                        continue

                    if campaign_navigation_property and is_missing_dynamics_property_error(response):
                        campaign_navigation_property = None
                        _MARKETING_LIST_CAMPAIGN_NAVIGATION_CACHE["loaded"] = True
                        _MARKETING_LIST_CAMPAIGN_NAVIGATION_CACHE["value"] = None
                        next_url = build_marketing_lists_url(
                            limit,
                            None,
                            include_client_column,
                        )
                        continue

                    raise Exception(f"Dynamics GET error: {response.text}")

                payload = response.json()
                marketing_lists.extend(
                    normalize_marketing_list_record(
                        record,
                        campaign_navigation_property,
                    )
                    for record in payload.get("value", [])
                )
                next_url = payload.get("@odata.nextLink")

            marketing_lists = await enrich_marketing_lists_with_client_names(
                client,
                headers,
                marketing_lists,
                account_website_visit_relationship_name,
                website_visit_client_relationship_name,
            )
    except httpx.TimeoutException as exc:
        raise Exception(
            f"Dynamics request timed out after {MARKETING_LIST_REQUEST_TIMEOUT_SECONDS} seconds while loading marketing lists"
        ) from exc

    return marketing_lists[:limit]


async def get_leadfeeder_visits(limit: int = LEADFEEDER_VISIT_DEFAULT_LIMIT):
    visit_limit = max(1, min(limit, LEADFEEDER_VISIT_MAX_LIMIT))
    token = await get_access_token()
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "OData-Version": "4.0",
        "Prefer": f"odata.maxpagesize={visit_limit}",
    }

    visits = []
    timeout = httpx.Timeout(LEADFEEDER_VISIT_REQUEST_TIMEOUT_SECONDS)

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            website_visit_client_relationship_name = await get_website_visit_client_navigation_property(client, headers)
            website_visit_account_relationship_name = await get_website_visit_account_navigation_property(client, headers)

            expand_parts = []
            if website_visit_client_relationship_name:
                expand_parts.append(f"{website_visit_client_relationship_name}($select=name)")
            if website_visit_account_relationship_name:
                expand_parts.append(
                    f"{website_visit_account_relationship_name}($select=name,websiteurl,address1_country,address1_stateorprovince,address1_city,new_sector,telephone1,emailaddress1)"
                )

            next_url = f"{API_URL}/lfapp_websitevisits?$select=lfapp_websitevisitid,createdon,_lfapp_account_value,_new_client_value"
            if expand_parts:
                next_url += f"&$expand={','.join(expand_parts)}"
            next_url += f"&$orderby=createdon desc&$top={visit_limit}"

            while next_url and len(visits) < visit_limit:
                response = await client.get(next_url, headers=headers)

                if response.status_code != 200:
                    raise Exception(f"Dynamics GET error: {response.text}")

                payload = response.json()
                for record in payload.get("value", []):
                    visits.append(
                        {
                            "visit_id": record.get("lfapp_websitevisitid"),
                            "createdon": record.get("createdon"),
                            "account_name": (
                                get_related_record_value(
                                    record,
                                    website_visit_account_relationship_name,
                                    ("name",),
                                )
                                if website_visit_account_relationship_name
                                else ""
                            )
                            or get_lookup_display_value(record, "_lfapp_account_value")
                            or "",
                            "account_id": record.get("_lfapp_account_value") or "",
                            "website": (
                                get_related_record_value(
                                    record,
                                    website_visit_account_relationship_name,
                                    ("websiteurl",),
                                )
                                if website_visit_account_relationship_name
                                else ""
                            ),
                            "country": (
                                get_related_record_value(
                                    record,
                                    website_visit_account_relationship_name,
                                    ("address1_country",),
                                )
                                if website_visit_account_relationship_name
                                else ""
                            ),
                            "state": (
                                get_related_record_value(
                                    record,
                                    website_visit_account_relationship_name,
                                    ("address1_stateorprovince",),
                                )
                                if website_visit_account_relationship_name
                                else ""
                            ),
                            "city": (
                                get_related_record_value(
                                    record,
                                    website_visit_account_relationship_name,
                                    ("address1_city",),
                                )
                                if website_visit_account_relationship_name
                                else ""
                            ),
                            "industry": (
                                get_related_record_value(
                                    record,
                                    website_visit_account_relationship_name,
                                    ("new_sector",),
                                )
                                if website_visit_account_relationship_name
                                else ""
                            ),
                            "phone": (
                                get_related_record_value(
                                    record,
                                    website_visit_account_relationship_name,
                                    ("telephone1",),
                                )
                                if website_visit_account_relationship_name
                                else ""
                            ),
                            "email": (
                                get_related_record_value(
                                    record,
                                    website_visit_account_relationship_name,
                                    ("emailaddress1",),
                                )
                                if website_visit_account_relationship_name
                                else ""
                            ),
                            "client_name": (
                                get_related_record_value(
                                    record,
                                    website_visit_client_relationship_name,
                                    ("name",),
                                )
                                if website_visit_client_relationship_name
                                else ""
                            )
                            or get_lookup_display_value(record, "_new_client_value")
                            or "",
                        }
                    )

                next_url = payload.get("@odata.nextLink")
    except httpx.TimeoutException as exc:
        raise Exception(
            f"Dynamics request timed out after {LEADFEEDER_VISIT_REQUEST_TIMEOUT_SECONDS} seconds while loading Leadfeeder visits"
        ) from exc

    return visits[:visit_limit]


async def _get_marketing_list_relationship_members(list_id: str, relationship: str, select_fields: str):
    token = await get_access_token()
    url = (
        f"{API_URL}/lists({list_id})/{relationship}?"
        f"$select={select_fields}"
    )
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "OData-Version": "4.0",
        "Prefer": 'odata.include-annotations="OData.Community.Display.V1.FormattedValue",odata.maxpagesize=5000',
    }
    members = []
    timeout = httpx.Timeout(MARKETING_LIST_REQUEST_TIMEOUT_SECONDS)

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            while url:
                response = await client.get(url, headers=headers)

                if response.status_code != 200:
                    raise Exception(f"Dynamics GET error for {relationship}: {response.text}")

                payload = response.json()
                members.extend(payload.get("value", []))
                url = payload.get("@odata.nextLink")
    except httpx.TimeoutException as exc:
        raise Exception(
            f"Dynamics request timed out after {MARKETING_LIST_REQUEST_TIMEOUT_SECONDS} seconds while loading {relationship}"
        ) from exc

    return members


async def get_marketing_list_members(list_id: str):
    accounts, contacts = await asyncio.gather(
        _get_marketing_list_relationship_members(
            list_id,
            "listaccount_association",
            "accountid,name,websiteurl,emailaddress1,telephone1,new_sector",
        ),
        _get_marketing_list_relationship_members(
            list_id,
            "listcontact_association",
            "contactid,fullname,emailaddress1,telephone1,jobtitle",
        ),
    )

    return {
        "list_id": list_id,
        "account_count": len(accounts),
        "contact_count": len(contacts),
        "accounts": accounts,
        "contacts": contacts,
    }


async def get_account_sector_counts():
    now = time.time()
    if _SUMMARY_CACHE["data"] is not None and _SUMMARY_CACHE["expires_at"] > now:
        return _SUMMARY_CACHE["data"]

    token = await get_access_token()

    url = (
        f"{API_URL}/accounts?"
        "$select=new_sector"
    )

    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "OData-Version": "4.0",
        "Prefer": 'odata.include-annotations="OData.Community.Display.V1.FormattedValue",odata.maxpagesize=5000',
    }

    sector_counts = {}

    async with httpx.AsyncClient() as client:
        while url:
            response = await client.get(url, headers=headers)

            if response.status_code != 200:
                raise Exception(f"Dynamics GET error: {response.text}")

            payload = response.json()

            for account in payload.get("value", []):
                raw_sector = account.get("new_sector@OData.Community.Display.V1.FormattedValue", account.get("new_sector"))
                sector = str(raw_sector).strip() if raw_sector is not None else ""
                sector = sector or "Unspecified"
                sector_counts[sector] = sector_counts.get(sector, 0) + 1

            url = payload.get("@odata.nextLink")

    sectors = [
        {"sector": sector, "account_count": account_count}
        for sector, account_count in sector_counts.items()
    ]
    sectors.sort(key=lambda item: (-item["account_count"], item["sector"].casefold()))

    total_accounts = sum(item["account_count"] for item in sectors)

    summary = {
        "total_accounts": total_accounts,
        "sector_count": len(sectors),
        "sectors": sectors
    }
    _SUMMARY_CACHE["data"] = summary
    _SUMMARY_CACHE["expires_at"] = now + SUMMARY_CACHE_TTL_SECONDS

    return summary


def _shift_month(year: int, month: int, offset: int) -> tuple[int, int]:
    month_index = (year * 12) + (month - 1) + offset
    return month_index // 12, (month_index % 12) + 1


def _month_buckets(now: datetime, month_count: int) -> list[dict[str, int | str]]:
    start_year, start_month = _shift_month(now.year, now.month, -(month_count - 1))

    return [
        {
            "year": year,
            "month": month,
            "month_key": f"{year}-{month:02d}",
            "month_label": datetime(year, month, 1).strftime("%b '%y"),
        }
        for year, month in (_shift_month(start_year, start_month, offset) for offset in range(month_count))
    ]


def _last_twelve_months(now: datetime) -> list[dict[str, int | str]]:
    return _month_buckets(now, 12)


def _day_buckets(start_date: datetime, day_count: int) -> list[dict[str, str]]:
    return [
        {
            "day_key": (start_date + timedelta(days=offset)).strftime("%Y-%m-%d"),
            "day_label": (start_date + timedelta(days=offset)).strftime("%b %-d"),
        }
        for offset in range(day_count)
    ]


def _marketing_window(range_key: str, now: datetime) -> dict[str, object]:
    option = MARKETING_RANGE_OPTIONS.get(range_key, MARKETING_RANGE_OPTIONS["last_year"])

    if "days" in option:
        day_count = int(option["days"])
        start_date = (now - timedelta(days=day_count - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
        return {
            "range": range_key if range_key in MARKETING_RANGE_OPTIONS else "last_year",
            "label": option["label"],
            "start_date": start_date,
            "buckets": _day_buckets(start_date, day_count),
            "bucket_key": "day_key",
            "bucket_label": "day_label",
            "bucket_grain": "day",
        }

    month_count = int(option["months"])
    buckets = _month_buckets(now, month_count)
    return {
        "range": range_key if range_key in MARKETING_RANGE_OPTIONS else "last_year",
        "label": option["label"],
        "start_date": datetime(
            int(buckets[0]["year"]),
            int(buckets[0]["month"]),
            1,
            tzinfo=timezone.utc,
        ),
        "buckets": buckets,
        "bucket_key": "month_key",
        "bucket_label": "month_label",
        "bucket_grain": "month",
    }


async def get_website_visit_metrics(range_key: str = "last_year"):
    now = time.time()
    cache_key = range_key if range_key in MARKETING_RANGE_OPTIONS else "last_year"
    cached_data = _MARKETING_METRICS_CACHE["data"] or {}
    if cache_key in cached_data and _MARKETING_METRICS_CACHE["expires_at"] > now:
        return cached_data[cache_key]

    token = await get_access_token()
    current_time = datetime.now(timezone.utc)
    window = _marketing_window(range_key, current_time)
    buckets = window["buckets"]
    start_date = window["start_date"].strftime("%Y-%m-%dT%H:%M:%SZ")
    headers = _dynamics_read_headers(token)

    website_visits_url = (
        f"{API_URL}/lfapp_websitevisits?"
        f"$filter=_new_client_value eq {INTERNAL_COMPANY_ACCOUNT_ID} and lfapp_time ge {start_date}&"
        "$orderby=lfapp_time asc"
    )

    async with httpx.AsyncClient() as client:
        target_naics_codes = await _fetch_target_industry_naics_codes(client, headers)
        website_visit_counts = await _count_website_visits(
            client,
            website_visits_url,
            headers,
            buckets,
            window["bucket_key"],
            window["bucket_grain"],
            target_naics_codes,
        )

    visit_buckets = [
        {
            "period": bucket[window["bucket_label"]],
            "period_key": bucket[window["bucket_key"]],
            "visitors": website_visit_counts["counts_by_bucket"][bucket[window["bucket_key"]]],
            "target_visitors": website_visit_counts["target_counts_by_bucket"][bucket[window["bucket_key"]]],
        }
        for bucket in buckets
    ]

    result = {
        "company_id": INTERNAL_COMPANY_ACCOUNT_ID,
        "range": window["range"],
        "range_label": window["label"],
        "bucket_grain": window["bucket_grain"],
        "updated_at": current_time.isoformat(),
        "total_visitors": website_visit_counts["total"],
        "target_total_visitors": website_visit_counts["target_total"],
        "months": visit_buckets,
        "landing_pages": website_visit_counts["landing_pages"],
    }
    cached_data[cache_key] = result
    _MARKETING_METRICS_CACHE["data"] = cached_data
    _MARKETING_METRICS_CACHE["expires_at"] = now + MARKETING_METRICS_CACHE_TTL_SECONDS

    return result


async def get_project_creation_metrics():
    now = time.time()
    if _PROJECT_METRICS_CACHE["data"] is not None and _PROJECT_METRICS_CACHE["expires_at"] > now:
        return _PROJECT_METRICS_CACHE["data"]

    token = await get_access_token()
    current_time = datetime.now(timezone.utc)
    months = _last_twelve_months(current_time)
    start_date = _month_window_start(months)
    headers = _dynamics_read_headers(token)

    projects_url = (
        f"{API_URL}/new_projects?"
        "$select=new_projectid,createdon,new_serviceline&"
        f"$filter=createdon ge {start_date}&"
        "$orderby=createdon asc"
    )

    async with httpx.AsyncClient() as client:
        project_counts = await _count_projects_by_month_and_service_line(
            client,
            projects_url,
            headers,
            months,
        )

    project_months = [
        {
            "month": month["month_label"],
            "month_key": month["month_key"],
            "projects": project_counts["counts_by_month"][month["month_key"]],
            "service_lines": project_counts["service_lines_by_month"][month["month_key"]],
        }
        for month in months
    ]

    result = {
        "updated_at": current_time.isoformat(),
        "total_projects": project_counts["total"],
        "months": project_months,
        "service_lines": project_counts["service_line_totals"],
    }
    _PROJECT_METRICS_CACHE["data"] = result
    _PROJECT_METRICS_CACHE["expires_at"] = now + MARKETING_METRICS_CACHE_TTL_SECONDS

    return result


async def _count_projects_by_month_and_service_line(
    client: httpx.AsyncClient,
    url: str,
    headers: dict[str, str],
    months: list[dict[str, int | str]],
) -> dict[str, dict[str, int] | int]:
    counts_by_month = {month["month_key"]: 0 for month in months}
    service_counts_by_month = {month["month_key"]: {} for month in months}
    service_line_totals = {}
    total = 0

    while url:
        response = await client.get(url, headers=headers)

        if response.status_code != 200:
            raise Exception(f"Dynamics GET error: {response.text}")

        payload = response.json()

        for project in payload.get("value", []):
            created_on = project.get("createdon")
            if not created_on:
                continue

            parsed_time = datetime.fromisoformat(created_on.replace("Z", "+00:00"))
            month_key = parsed_time.strftime("%Y-%m")

            if month_key not in counts_by_month:
                continue

            counts_by_month[month_key] += 1
            total += 1

            formatted_service_lines = project.get(
                "new_serviceline@OData.Community.Display.V1.FormattedValue",
                "",
            )
            service_lines = [
                service_line.strip()
                for service_line in formatted_service_lines.split(";")
                if service_line.strip()
            ] or ["Unspecified"]

            for service_line in service_lines:
                service_counts = service_counts_by_month[month_key]
                service_counts[service_line] = service_counts.get(service_line, 0) + 1
                service_line_totals[service_line] = service_line_totals.get(service_line, 0) + 1

        url = payload.get("@odata.nextLink")

    service_lines_by_month = {
        month_key: [
            {"service_line": service_line, "projects": project_count}
            for service_line, project_count in sorted(
                service_counts.items(),
                key=lambda item: (-item[1], item[0].casefold()),
            )
        ]
        for month_key, service_counts in service_counts_by_month.items()
    }

    return {
        "counts_by_month": counts_by_month,
        "service_lines_by_month": service_lines_by_month,
        "service_line_totals": [
            {"service_line": service_line, "projects": project_count}
            for service_line, project_count in sorted(
                service_line_totals.items(),
                key=lambda item: (-item[1], item[0].casefold()),
            )
        ],
        "total": total,
    }


def _month_window_start(months: list[dict[str, int | str]]) -> str:
    first_month = months[0]
    return datetime(
        int(first_month["year"]),
        int(first_month["month"]),
        1,
        tzinfo=timezone.utc,
    ).strftime("%Y-%m-%dT%H:%M:%SZ")


def _dynamics_read_headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "OData-Version": "4.0",
        "Prefer": 'odata.include-annotations="OData.Community.Display.V1.FormattedValue",odata.maxpagesize=5000',
    }


async def _count_website_visits(
    client: httpx.AsyncClient,
    url: str,
    headers: dict[str, str],
    buckets: list[dict[str, int | str]],
    bucket_key: str,
    bucket_grain: str,
    target_naics_codes: set[str] | None = None,
) -> dict[str, object]:
    counts_by_bucket = {bucket[bucket_key]: 0 for bucket in buckets}
    target_counts_by_bucket = {bucket[bucket_key]: 0 for bucket in buckets}
    landing_page_counts = {}
    visits_for_targeting = []
    total = 0
    target_total = 0

    while url:
        response = await client.get(url, headers=headers)

        if response.status_code != 200:
            raise Exception(f"Dynamics GET error: {response.text}")

        payload = response.json()

        for visit in payload.get("value", []):
            visit_time = visit.get("lfapp_time")
            if not visit_time:
                continue

            parsed_time = datetime.fromisoformat(visit_time.replace("Z", "+00:00"))
            current_key = parsed_time.strftime("%Y-%m-%d" if bucket_grain == "day" else "%Y-%m")

            if current_key not in counts_by_bucket:
                continue

            landing_page = (visit.get("lfapp_landingpage") or "").strip() or "Unspecified"
            counts_by_bucket[current_key] += 1
            landing_page_counts[landing_page] = landing_page_counts.get(landing_page, 0) + 1
            total += 1

            visitor_account_id = _get_visitor_account_id(visit)
            if visitor_account_id:
                visits_for_targeting.append(
                    {
                        "bucket_key": current_key,
                        "visitor_account_id": visitor_account_id,
                    }
                )

        url = payload.get("@odata.nextLink")

    if target_naics_codes and visits_for_targeting:
        visitor_account_ids = {
            visit["visitor_account_id"]
            for visit in visits_for_targeting
        }
        account_naics_codes = await _fetch_account_naics_codes(client, headers, visitor_account_ids)

        for visit in visits_for_targeting:
            account_naics = account_naics_codes.get(visit["visitor_account_id"], set())
            if _has_target_naics_match(account_naics, target_naics_codes):
                target_counts_by_bucket[visit["bucket_key"]] += 1
                target_total += 1

    return {
        "counts_by_bucket": counts_by_bucket,
        "target_counts_by_bucket": target_counts_by_bucket,
        "landing_pages": [
            {"landing_page": landing_page, "visitors": visitor_count}
            for landing_page, visitor_count in sorted(
                landing_page_counts.items(),
                key=lambda item: (-item[1], item[0].casefold()),
            )
        ],
        "total": total,
        "target_total": target_total,
    }


async def _fetch_target_industry_naics_codes(
    client: httpx.AsyncClient,
    headers: dict[str, str],
) -> set[str]:
    entity_set_name = await _resolve_entity_set_name(
        client,
        headers,
        TARGET_INDUSTRIES_TABLE,
        TARGET_INDUSTRY_ENTITY_SET_CANDIDATES,
    )
    target_naics_codes = set()
    code_field = await _resolve_existing_field(
        client,
        headers,
        entity_set_name,
        TARGET_INDUSTRY_CODE_FIELDS,
        "target industries NAICS",
    )
    url = _target_industries_url(entity_set_name, code_field)

    while url:
        response = await client.get(url, headers=headers)

        if response.status_code == 404:
            entity_set_name = await _find_working_entity_set_name(
                client,
                headers,
                TARGET_INDUSTRY_ENTITY_SET_CANDIDATES,
            )
            code_field = await _resolve_existing_field(
                client,
                headers,
                entity_set_name,
                TARGET_INDUSTRY_CODE_FIELDS,
                "target industries NAICS",
            )
            url = _target_industries_url(entity_set_name, code_field)
            response = await client.get(url, headers=headers)

        if response.status_code != 200:
            raise Exception(f"Dynamics GET error: {response.text}")

        payload = response.json()

        for target_industry in payload.get("value", []):
            target_naics_codes.update(
                _normalize_naics_codes(target_industry.get(code_field))
            )

        url = payload.get("@odata.nextLink")

    return target_naics_codes


async def _resolve_entity_set_name(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    logical_name: str,
    fallback_candidates: tuple[str, ...],
) -> str:
    metadata_url = (
        f"{API_URL}/EntityDefinitions(LogicalName='{logical_name}')?"
        "$select=EntitySetName"
    )
    response = await client.get(metadata_url, headers=headers)

    if response.status_code == 200:
        entity_set_name = response.json().get("EntitySetName")
        if entity_set_name:
            return entity_set_name

    return await _find_working_entity_set_name(client, headers, fallback_candidates)


async def _find_working_entity_set_name(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    candidates: tuple[str, ...],
) -> str:
    last_error = ""

    for candidate in candidates:
        response = await client.get(
            f"{API_URL}/{candidate}?$select={TARGET_INDUSTRY_NAICS_FIELD}&$top=1",
            headers=headers,
        )
        if response.status_code == 200:
            return candidate

        last_error = response.text

    raise Exception(f"Unable to find target industries entity set: {last_error}")


async def _resolve_existing_field(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    entity_set_name: str,
    field_candidates: tuple[str, ...],
    field_label: str,
) -> str:
    last_error = ""

    for field_name in field_candidates:
        response = await client.get(
            f"{API_URL}/{entity_set_name}?$select={field_name}&$top=1",
            headers=headers,
        )
        if response.status_code == 200:
            return field_name

        last_error = response.text

    raise Exception(f"Unable to find {field_label} field: {last_error}")


def _target_industries_url(entity_set_name: str, code_field: str) -> str:
    return (
        f"{API_URL}/{entity_set_name}?"
        f"$select={code_field}&"
        f"$filter={TARGET_INDUSTRY_CLIENT_LOOKUP_FIELD} eq {INTERNAL_COMPANY_ACCOUNT_ID}"
    )


async def _fetch_account_naics_codes(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    account_ids: set[str],
) -> dict[str, set[str]]:
    account_naics_codes = {}
    account_id_list = sorted(account_ids)
    chunk_size = 20
    try:
        account_naics_field = await _resolve_existing_field(
            client,
            headers,
            "accounts",
            ACCOUNT_NAICS_FIELDS,
            "account NAICS",
        )
    except Exception:
        return account_naics_codes

    for index in range(0, len(account_id_list), chunk_size):
        chunk = account_id_list[index:index + chunk_size]
        account_filter = " or ".join(
            f"accountid eq {account_id}"
            for account_id in chunk
        )
        url = (
            f"{API_URL}/accounts?"
            f"$select=accountid,{account_naics_field}&"
            f"$filter={account_filter}"
        )

        while url:
            response = await client.get(url, headers=headers)

            if response.status_code != 200:
                raise Exception(f"Dynamics GET error: {response.text}")

            payload = response.json()

            for account in payload.get("value", []):
                account_id = _clean_guid(account.get("accountid"))
                if not account_id:
                    continue

                account_naics_codes[account_id] = _normalize_naics_codes(
                    account.get(account_naics_field)
                )

            url = payload.get("@odata.nextLink")

    return account_naics_codes


def _get_visitor_account_id(visit: dict) -> str | None:
    for field_name in VISITOR_ACCOUNT_LOOKUP_FIELDS:
        account_id = _clean_guid(visit.get(field_name))
        if account_id:
            return account_id

    for field_name, field_value in visit.items():
        normalized_name = field_name.casefold()
        if (
            field_name.startswith("_")
            and field_name.endswith("_value")
            and "account" in normalized_name
            and "client" not in normalized_name
            and "owner" not in normalized_name
        ):
            account_id = _clean_guid(field_value)
            if account_id:
                return account_id

    return None


def _clean_guid(value: object) -> str | None:
    if not value:
        return None

    return str(value).strip("{}").casefold()


def _normalize_naics_codes(value: object) -> set[str]:
    if not value:
        return set()

    codes = set()
    for part in re.split(r"[,;|/\\\s]+", str(value)):
        digits = re.sub(r"\D", "", part)
        if digits:
            codes.add(digits)

    return codes


def _has_target_naics_match(account_naics_codes: set[str], target_naics_codes: set[str]) -> bool:
    for account_code in account_naics_codes:
        for target_code in target_naics_codes:
            if account_code == target_code or account_code.startswith(target_code):
                return True

    return False


async def _count_records_by_month(
    client: httpx.AsyncClient,
    url: str,
    headers: dict[str, str],
    months: list[dict[str, int | str]],
    date_field: str,
) -> dict[str, dict[str, int] | int]:
    counts_by_month = {month["month_key"]: 0 for month in months}
    total = 0

    while url:
        response = await client.get(url, headers=headers)

        if response.status_code != 200:
            raise Exception(f"Dynamics GET error: {response.text}")

        payload = response.json()

        for record in payload.get("value", []):
            date_value = record.get(date_field)
            if not date_value:
                continue

            parsed_time = datetime.fromisoformat(date_value.replace("Z", "+00:00"))
            month_key = parsed_time.strftime("%Y-%m")

            if month_key in counts_by_month:
                counts_by_month[month_key] += 1
                total += 1

        url = payload.get("@odata.nextLink")

    return {"counts_by_month": counts_by_month, "total": total}


async def get_accounts_needing_enrichment():
    token = await get_access_token()

    url = (
        f"{API_URL}/accounts?"
        "$select=accountid,name,websiteurl,telephone1&"
        "$filter=(websiteurl eq null or telephone1 eq null) and address1_country eq 'United States'&"
        "$top=10"
    )

    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "OData-Version": "4.0"
    }

    async with httpx.AsyncClient() as client:
        response = await client.get(url, headers=headers)

    if response.status_code != 200:
        raise Exception(f"Dynamics GET error: {response.text}")

    return response.json().get("value", [])


def normalize_pe_client_record(account: dict):
    return {
        "account_id": account.get("accountid", ""),
        "client_name": account.get("name", ""),
        "city": account.get("address1_city", ""),
        "state": account.get("address1_stateorprovince", ""),
        "users": len(account.get("new_account_contact") or []),
        "contract_expiration": account.get("cr73c_softwarecontractexpirationdate"),
    }


async def get_pe_clients(limit: int | None = None):
    client_limit = max(1, min(limit or PE_CLIENT_DEFAULT_LIMIT, PE_CLIENT_MAX_LIMIT))
    token = await get_access_token()
    url = (
        f"{API_URL}/accounts?"
        "$select=accountid,name,address1_city,address1_stateorprovince,"
        "cr73c_softwarecontractexpirationdate&"
        "$expand=new_account_contact($select=contactid)&"
        "$filter=new_client eq true&"
        "$orderby=name asc&"
        f"$top={client_limit}"
    )
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "OData-Version": "4.0",
        "Prefer": "odata.maxpagesize=5000",
    }
    accounts = []
    next_url = url

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(PE_CLIENT_REQUEST_TIMEOUT_SECONDS)) as client:
            while next_url and len(accounts) < client_limit:
                response = await client.get(next_url, headers=headers)

                if response.status_code != 200:
                    raise Exception(f"Dynamics GET error: {response.text}")

                payload = response.json()
                accounts.extend(payload.get("value", []))
                next_url = payload.get("@odata.nextLink")
    except httpx.TimeoutException as exc:
        raise Exception(
            f"Dynamics request timed out after {PE_CLIENT_REQUEST_TIMEOUT_SECONDS} seconds while loading PE clients"
        ) from exc

    return [normalize_pe_client_record(account) for account in accounts[:client_limit]]


async def create_pe_client(client_details: dict):
    token = await get_access_token()
    url = f"{API_URL}/accounts"
    payload = {
        "name": client_details["client_name"],
        "address1_city": client_details.get("city") or None,
        "address1_stateorprovince": client_details.get("state") or None,
        "cr73c_softwarecontractexpirationdate": client_details.get("contract_expiration") or None,
        "new_client": True,
    }
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "OData-Version": "4.0",
        "Prefer": "return=representation",
    }

    async with httpx.AsyncClient(timeout=httpx.Timeout(PE_CLIENT_REQUEST_TIMEOUT_SECONDS)) as client:
        response = await client.post(url, headers=headers, json=payload)

    if response.status_code not in (200, 201, 204):
        raise Exception(f"Dynamics CREATE error: {response.text}")

    account = response.json() if response.status_code != 204 else payload
    if response.status_code == 204:
        entity_url = response.headers.get("OData-EntityId", "")
        account["accountid"] = entity_url.rsplit("(", 1)[-1].rstrip(")") if entity_url else ""

    return normalize_pe_client_record(account)


async def create_pe_client_user(user_details: dict):
    token = await get_access_token()
    account_id = user_details["account_id"]
    url = f"{API_URL}/contacts"
    payload = {
        "firstname": user_details["first_name"],
        "lastname": user_details["last_name"],
        "emailaddress1": user_details["email"],
        "telephone1": user_details.get("phone") or None,
        "adx_identity_username": user_details.get("username") or user_details["email"],
        "adx_identity_newpassword": user_details["password"],
        "adx_identity_logonenabled": True,
        "new_client@odata.bind": f"/accounts({account_id})",
        "parentcustomerid_account@odata.bind": f"/accounts({account_id})",
    }
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "OData-Version": "4.0",
        "Prefer": "return=representation",
    }

    async with httpx.AsyncClient(timeout=httpx.Timeout(PE_CLIENT_REQUEST_TIMEOUT_SECONDS)) as client:
        response = await client.post(url, headers=headers, json=payload)

    if response.status_code not in (200, 201, 204):
        raise Exception(f"Dynamics CREATE contact error: {response.text}")

    contact = response.json() if response.status_code != 204 else payload
    return {
        "contact_id": contact.get("contactid", ""),
        "account_id": account_id,
        "first_name": contact.get("firstname", user_details["first_name"]),
        "last_name": contact.get("lastname", user_details["last_name"]),
        "email": contact.get("emailaddress1", user_details["email"]),
        "phone": contact.get("telephone1", user_details.get("phone") or ""),
        "username": contact.get(
            "adx_identity_username",
            user_details.get("username") or user_details["email"],
        ),
    }


async def update_account(account_id: str, updates: dict):
    token = await get_access_token()

    url = f"{API_URL}/accounts({account_id})"

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "OData-Version": "4.0"
    }

    async with httpx.AsyncClient() as client:
        response = await client.patch(url, headers=headers, json=updates)

    if response.status_code not in [200, 204]:
        raise DynamicsApiError(f"Dynamics UPDATE error: {response.text}", response.status_code)

    return True


ENRICHMENT_ACCOUNT_FIELDS = (
    "accountid,name,websiteurl,telephone1,description,numberofemployees,"
    "address1_city,address1_stateorprovince,address1_country,"
    "cr73c_enrichmentattempted"
)
ENRICHMENT_FIELD_NAMES = (
    "websiteurl",
    "telephone1",
    "description",
    "numberofemployees",
    "address1_city",
    "address1_stateorprovince",
    "address1_country",
)


def _is_blank(value: object) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def _normalise_enrichment_value(field_name: str, value: object) -> object | None:
    if _is_blank(value):
        return None
    if field_name == "numberofemployees":
        try:
            return int(str(value).replace(",", ""))
        except (TypeError, ValueError):
            logger.warning("Ignoring invalid Seamless employee count: %r", value)
            return None
    return str(value).strip() if isinstance(value, str) else value


async def _mark_enrichment_attempted(account_id: str, updates: dict[str, object]) -> None:
    """Set the required attempt flag and include the optional timestamp when available."""
    attempt_updates = {
        **updates,
        "cr73c_enrichmentattempted": True,
        "cr73c_enrichmentlastattemptedon": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    try:
        await update_account(account_id, attempt_updates)
    except DynamicsApiError as exc:
        if exc.status_code != 400:
            raise
        # Some Dataverse environments do not have the optional timestamp field.
        # Retry without it so the required attempt flag is never lost for that reason.
        logger.warning("Could not update optional enrichment timestamp for %s: %s", account_id, exc)
        attempt_updates.pop("cr73c_enrichmentlastattemptedon")
        await update_account(account_id, attempt_updates)


async def enrich_one_account(account_id: str) -> dict[str, object]:
    """Enrich one Account for the Power Automate trigger without overwriting data."""
    try:
        account = await get_account(account_id, ENRICHMENT_ACCOUNT_FIELDS)
    except Exception as exc:
        logger.exception("Enrichment failed while fetching Dynamics account %s", account_id)
        return {
            "account_id": account_id,
            "account_name": None,
            "status": "failed",
            "fields_updated": [],
            "skipped_reason": f"Unable to fetch Dynamics account: {exc}",
        }

    account_name = account.get("name")
    if account.get("cr73c_enrichmentattempted") is True:
        logger.info("Enrichment skipped for account_id=%s name=%r: already attempted", account_id, account_name)
        return {
            "account_id": account_id,
            "account_name": account_name,
            "status": "skipped_already_attempted",
            "fields_updated": [],
            "skipped_reason": "Enrichment has already been attempted for this account.",
        }

    if not account_name:
        try:
            await _mark_enrichment_attempted(account_id, {})
        except Exception:
            logger.exception("Could not mark nameless account attempted for account_id=%s", account_id)
            return {
                "account_id": account_id,
                "account_name": account_name,
                "status": "failed",
                "fields_updated": [],
                "skipped_reason": "Unable to update Dynamics account.",
            }
        logger.info("Enrichment no_match for account_id=%s: account has no name", account_id)
        return {
            "account_id": account_id,
            "account_name": account_name,
            "status": "no_match",
            "fields_updated": [],
            "skipped_reason": "Account has no name to search.",
        }

    if not os.getenv("SEAMLESS_API_KEY"):
        logger.error("Seamless enrichment cannot run for account_id=%s: SEAMLESS_API_KEY is not configured", account_id)
        try:
            await _mark_enrichment_attempted(account_id, {})
        except Exception:
            logger.exception("Could not mark unconfigured enrichment attempted for account_id=%s", account_id)
        return {
            "account_id": account_id,
            "account_name": account_name,
            "status": "failed",
            "fields_updated": [],
            "skipped_reason": "Seamless enrichment is not configured.",
        }

    if not can_make_request():
        logger.warning("Enrichment skipped for account_id=%s name=%r: weekly credit limit reached", account_id, account_name)
        return {
            "account_id": account_id,
            "account_name": account_name,
            "status": "skipped_credit_limit",
            "fields_updated": [],
            "skipped_reason": f"Weekly Seamless credit limit ({WEEKLY_LIMIT}) has been reached.",
        }

    try:
        # A credit is consumed once a Seamless request is attempted, even if it has no match or errors.
        try:
            seamless_data = await enrich_with_seamless(account)
        finally:
            usage = increment_usage()
            logger.info("Seamless credit used for account_id=%s; usage=%s/%s", account_id, usage.get("credits_used"), WEEKLY_LIMIT)
    except Exception as exc:
        logger.exception("Seamless enrichment failed for account_id=%s name=%r", account_id, account_name)
        try:
            await _mark_enrichment_attempted(account_id, {})
        except Exception:
            logger.exception("Could not mark failed enrichment attempted for account_id=%s", account_id)
        return {
            "account_id": account_id,
            "account_name": account_name,
            "status": "failed",
            "fields_updated": [],
            "skipped_reason": "Seamless enrichment request failed.",
        }

    updates: dict[str, object] = {}
    for field_name in ENRICHMENT_FIELD_NAMES:
        value = _normalise_enrichment_value(field_name, seamless_data.get(field_name))
        if _is_blank(account.get(field_name)) and value is not None:
            updates[field_name] = value

    try:
        await _mark_enrichment_attempted(account_id, updates)
    except Exception as exc:
        logger.exception("Dynamics update failed for account_id=%s name=%r", account_id, account_name)
        return {
            "account_id": account_id,
            "account_name": account_name,
            "status": "failed",
            "fields_updated": [],
            "skipped_reason": "Unable to update Dynamics account.",
        }

    if not seamless_data:
        result_status = "no_match"
    elif updates:
        result_status = "updated"
    else:
        result_status = "no_updates_needed"
    logger.info("Enrichment %s for account_id=%s name=%r fields=%s", result_status, account_id, account_name, list(updates))
    return {
        "account_id": account_id,
        "account_name": account_name,
        "status": result_status,
        "fields_updated": list(updates),
        "skipped_reason": None,
    }


async def enrich_single_account_test(account_id: str):
    account = await get_account(account_id, "name,emailaddress1,telephone1")

    updates = {}

    if not account.get("telephone1"):
        updates["telephone1"] = "555-123-4567"

    if not account.get("emailaddress1"):
        updates["emailaddress1"] = "test@example.com"

    if not updates:
        return {
            "message": "No missing fields to update",
            "account_id": account_id
        }

    await update_account(account_id, updates)

    return {
        "account_id": account_id,
        "updates_applied": updates
    }


async def revert_account_fields(account_id: str, fields: dict = None):
    token = await get_access_token()

    url = f"{API_URL}/accounts({account_id})"

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "OData-Version": "4.0"
    }

    if not fields:
        fields = {
            "emailaddress1": None,
            "telephone1": None
        }

    async with httpx.AsyncClient() as client:
        response = await client.patch(url, headers=headers, json=fields)

    if response.status_code not in [200, 204]:
        raise Exception(f"Revert failed: {response.text}")

    return {
        "account_id": account_id,
        "reverted_fields": fields
    }


def should_update_field(field_key: str, fields_to_update: set[str] | None):
    return fields_to_update is None or field_key in fields_to_update


async def enrich_account(account_id: str, fields_to_update: list[str] | None = None):
    increment_processed()
    requested_fields = set(fields_to_update) if fields_to_update else None

    account = await get_account(
        account_id,
        "name,websiteurl,telephone1,address1_city,address1_stateorprovince,address1_country,numberofemployees,new_sector"
    )

    company_name = account.get("name")
    sector = account.get("new_sector") or ""

    print(f"🔍 Enriching: {company_name}")
    print(f"🏭 Sector: {sector}")
    print("✅ Proceeding with enrichment")

    usage = load_usage()
    credits_used = usage.get("credits_used", 0)
    print(f"📊 Credits used: {credits_used}/{WEEKLY_LIMIT}")

    if not can_make_request():
        print("🚫 Weekly credit cap reached (2000)")
        print("🚫 Cap reached — stopping enrichment")
        return {
            "account_id": account_id,
            "updated": False,
            "reason": "Weekly credit cap reached"
        }

    seamless_data = await enrich_with_seamless(account)
    usage = increment_usage()
    print("✅ Credit consumed")
    print(f"📊 Credits used: {usage.get('credits_used', 0)}/{WEEKLY_LIMIT}")

    print(f"🌐 Seamless result: {seamless_data}")

    confidence_score = int(seamless_data.get("confidence_score", 0))
    matched_fields = seamless_data.get("matched_fields", [])
    if confidence_score < 60 or not seamless_data.get("meets_confidence_threshold", False):
        return {
            "account_id": account_id,
            "updated": False,
            "skipped": True,
            "reason": "Match confidence below 60%",
            "confidence_score": confidence_score,
            "matched_fields": matched_fields,
        }

    updates = {}

    # WEBSITE
    website = seamless_data.get("websiteurl")
    if should_update_field("websiteurl", requested_fields) and not account.get("websiteurl") and website:
        if not website.startswith("http"):
            website = f"https://{website}"
        updates["websiteurl"] = website

    # PHONE
    phone = seamless_data.get("telephone1")
    if should_update_field("telephone1", requested_fields) and not account.get("telephone1") and phone:
        updates["telephone1"] = phone

    # STATE
    state = seamless_data.get("address1_stateorprovince")
    print(f"📍 Raw state: {state}")
    if should_update_field("address1_stateorprovince", requested_fields) and state:
        state_clean = state.strip()
        state_abbr = STATE_ABBREVIATIONS.get(state_clean.title(), state_clean)
        print(f"📍 Converted state: {state_abbr}")
        if not account.get("address1_stateorprovince"):
            updates["address1_stateorprovince"] = state_abbr

    # COUNTRY
    country = seamless_data.get("address1_country")
    if should_update_field("address1_country", requested_fields) and not account.get("address1_country") and country:
        updates["address1_country"] = country

    # EMPLOYEES
    employees = seamless_data.get("numberofemployees")
    if should_update_field("new_employees", requested_fields) and not account.get("numberofemployees") and employees:
        try:
            updates["numberofemployees"] = int(employees)
        except Exception:
            pass

    # DESCRIPTION
    description = seamless_data.get("description")
    if should_update_field("description", requested_fields) and description:
        print(f"📝 Description found: {description[:100]}")
        if not account.get("description") or account.get("description").strip() == "":
            updates["description"] = description
            print("📝 Description updated")

    city = seamless_data.get("address1_city")
    if not account.get("address1_city") and city:
        updates["address1_city"] = city

    if updates:
        print(f"🚀 Updating: {updates}")
        await update_account(account_id, updates)
        log_update(company_name, updates)

    return {
        "account_id": account_id,
        "updated": bool(updates),
        "updates": updates or None,
        "confidence_score": confidence_score,
        "matched_fields": matched_fields,
    }


async def enrich_selected_accounts(account_ids: list[str], fields_to_update: list[str]):
    results = []

    for account_id in account_ids:
        if not account_id:
            continue

        try:
            result = await enrich_account(account_id, fields_to_update)
        except Exception as exc:
            result = {
                "account_id": account_id,
                "updated": False,
                "error": str(exc),
            }

        results.append(result)
        await asyncio.sleep(1)

    updated_count = sum(1 for result in results if result.get("updated"))
    skipped_count = sum(1 for result in results if result.get("skipped"))

    return {
        "processed": len(results),
        "updated": updated_count,
        "skipped": skipped_count,
        "results": results
    }


async def enrich_accounts():
    accounts = await get_accounts_needing_enrichment()
    results = []

    print(f"🚀 Starting bulk enrichment for {len(accounts)} accounts")

    for account in accounts:
        account_id = account.get("accountid")

        if not account_id:
            continue

        result = await enrich_account(account_id)
        results.append(result)

        # Rate limit safety
        await asyncio.sleep(1)

    updated_count = sum(1 for result in results if result["updated"])

    return {
        "processed": len(results),
        "updated": updated_count,
        "results": results
    }
