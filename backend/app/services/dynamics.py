import os
import asyncio
import time
import httpx
from dotenv import load_dotenv
from pathlib import Path
from .auth import get_access_token
from .metrics import increment_processed, log_update
from .seamless import enrich_with_seamless
from .usage import can_make_request, increment_usage, load_usage, WEEKLY_LIMIT

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
        raise Exception(f"Dynamics UPDATE error: {response.text}")

    return True


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
    website = seamless_data.get("website")
    if should_update_field("websiteurl", requested_fields) and not account.get("websiteurl") and website:
        if not website.startswith("http"):
            website = f"https://{website}"
        updates["websiteurl"] = website

    # PHONE
    phone = seamless_data.get("phone")
    if should_update_field("telephone1", requested_fields) and not account.get("telephone1") and phone:
        updates["telephone1"] = phone

    # STATE
    state = seamless_data.get("state")
    print(f"📍 Raw state: {state}")
    if should_update_field("address1_stateorprovince", requested_fields) and state:
        state_clean = state.strip()
        state_abbr = STATE_ABBREVIATIONS.get(state_clean.title(), state_clean)
        print(f"📍 Converted state: {state_abbr}")
        if not account.get("address1_stateorprovince"):
            updates["address1_stateorprovince"] = state_abbr

    # COUNTRY
    country = seamless_data.get("country")
    if should_update_field("address1_country", requested_fields) and not account.get("address1_country") and country:
        updates["address1_country"] = country

    # EMPLOYEES
    employees = seamless_data.get("employees")
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
