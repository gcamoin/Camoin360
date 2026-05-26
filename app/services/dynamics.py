import os
import asyncio
import httpx
from dotenv import load_dotenv
from typing import Any
from urllib.parse import quote
import re

from app.services.auth import get_access_token
from app.services.metrics import increment_processed, log_update
from app.services.seamless import enrich_with_seamless
from app.services.usage import (
    can_make_request,
    increment_usage,
    load_usage,
    WEEKLY_LIMIT
)

load_dotenv()

API_URL = os.getenv("DYNAMICS_API_URL")
DEFAULT_PAGE_SIZE = 5000
ACCOUNT_ENTITY_LOGICAL_NAME = "account"
SECTOR_FIELD_LOGICAL_NAME = "new_sector"

# -----------------------------------
# DYNAMICS FIELD
# -----------------------------------
ENRICHMENT_FIELD = "cr73c_enrichmentattempted"

# -----------------------------------
# STATE ABBREVIATIONS
# -----------------------------------
STATE_ABBREVIATIONS = {
    "Alabama": "AL",
    "Alaska": "AK",
    "Arizona": "AZ",
    "Arkansas": "AR",
    "California": "CA",
    "Colorado": "CO",
    "Connecticut": "CT",
    "Delaware": "DE",
    "Florida": "FL",
    "Georgia": "GA",
    "Hawaii": "HI",
    "Idaho": "ID",
    "Illinois": "IL",
    "Indiana": "IN",
    "Iowa": "IA",
    "Kansas": "KS",
    "Kentucky": "KY",
    "Louisiana": "LA",
    "Maine": "ME",
    "Maryland": "MD",
    "Massachusetts": "MA",
    "Michigan": "MI",
    "Minnesota": "MN",
    "Mississippi": "MS",
    "Missouri": "MO",
    "Montana": "MT",
    "Nebraska": "NE",
    "Nevada": "NV",
    "New Hampshire": "NH",
    "New Jersey": "NJ",
    "New Mexico": "NM",
    "New York": "NY",
    "North Carolina": "NC",
    "North Dakota": "ND",
    "Ohio": "OH",
    "Oklahoma": "OK",
    "Oregon": "OR",
    "Pennsylvania": "PA",
    "Rhode Island": "RI",
    "South Carolina": "SC",
    "South Dakota": "SD",
    "Tennessee": "TN",
    "Texas": "TX",
    "Utah": "UT",
    "Vermont": "VT",
    "Virginia": "VA",
    "Washington": "WA",
    "West Virginia": "WV",
    "Wisconsin": "WI",
    "Wyoming": "WY"
}


def normalize_sector_list(sectors: list[str] | None) -> list[str]:

    if not sectors:
        return []

    normalized = []
    seen = set()

    for sector in sectors:

        if not isinstance(sector, str):
            continue

        cleaned = sector.strip()

        if not cleaned:
            continue

        dedupe_key = cleaned.casefold()

        if dedupe_key in seen:
            continue

        seen.add(dedupe_key)
        normalized.append(cleaned)

    return normalized


def escape_odata_string(value: str) -> str:
    return value.replace("'", "''")


def build_sector_filter(sectors: list[str] | None) -> str:

    normalized_sectors = normalize_sector_list(sectors)

    if not normalized_sectors:
        return ""

    clauses = [
        f"new_sector eq '{escape_odata_string(sector)}'"
        for sector in normalized_sectors
    ]

    return f" and ({' or '.join(clauses)})"


def build_state_filter(states: list[str] | None) -> str:

    normalized_states = normalize_sector_list(states)

    if not normalized_states:
        return ""

    clauses = [
        f"address1_stateorprovince eq '{escape_odata_string(state)}'"
        for state in normalized_states
    ]

    return f" and ({' or '.join(clauses)})"


def build_distinct_option_list(
    records: list[dict[str, Any]],
    field_name: str
) -> list[dict[str, Any]]:

    counts = {}

    for record in records:
        value = (record.get(field_name) or "").strip()

        if not value:
            continue

        counts[value] = counts.get(value, 0) + 1

    return [
        {
            "value": value,
            "label": value,
            "account_count": counts[value]
        }
        for value in sorted(counts, key=str.casefold)
    ]


def extract_localized_label(option: dict[str, Any]) -> str | None:

    label = option.get("Label", {})
    user_label = label.get("UserLocalizedLabel")

    if user_label and user_label.get("Label"):
        return user_label["Label"].strip()

    localized_labels = label.get("LocalizedLabels", [])

    for localized_label in localized_labels:
        value = (localized_label.get("Label") or "").strip()

        if value:
            return value

    return None


async def fetch_dynamics_collection(url: str) -> list[dict[str, Any]]:

    token = await get_access_token()

    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "OData-Version": "4.0"
    }

    records = []
    next_url = url

    async with httpx.AsyncClient(timeout=60.0) as client:

        while next_url:

            response = await client.get(
                next_url,
                headers=headers
            )

            if response.status_code != 200:
                raise Exception(f"Dynamics GET error: {response.text}")

            payload = response.json()
            records.extend(payload.get("value", []))
            next_url = payload.get("@odata.nextLink")

    return records


async def fetch_dynamics_json(url: str) -> dict[str, Any]:

    token = await get_access_token()

    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "OData-Version": "4.0"
    }

    async with httpx.AsyncClient(timeout=60.0) as client:

        response = await client.get(
            url,
            headers=headers
        )

    if response.status_code != 200:
        raise Exception(f"Dynamics GET error: {response.text}")

    return response.json()


async def get_configured_sector_options():

    metadata_urls = [
        (
            f"{API_URL}/EntityDefinitions"
            f"(LogicalName='{ACCOUNT_ENTITY_LOGICAL_NAME}')"
            f"/Attributes(LogicalName='{SECTOR_FIELD_LOGICAL_NAME}')"
            "/Microsoft.Dynamics.CRM.PicklistAttributeMetadata"
            "?$select=LogicalName"
            "&$expand=OptionSet($select=Options)"
        ),
        (
            f"{API_URL}/EntityDefinitions"
            f"(LogicalName='{ACCOUNT_ENTITY_LOGICAL_NAME}')"
            f"/Attributes(LogicalName='{SECTOR_FIELD_LOGICAL_NAME}')"
            "/Microsoft.Dynamics.CRM.MultiSelectPicklistAttributeMetadata"
            "?$select=LogicalName"
            "&$expand=OptionSet($select=Options)"
        )
    ]

    for metadata_url in metadata_urls:

        try:
            payload = await fetch_dynamics_json(metadata_url)
        except Exception as exc:
            print(f"⚠️ Sector metadata lookup failed: {exc}")
            continue

        options = payload.get("OptionSet", {}).get("Options", [])

        configured_options = []

        for option in options:
            label = extract_localized_label(option)

            if not label:
                continue

            configured_options.append(
                {
                    "value": label,
                    "label": label,
                    "account_count": None,
                    "option_value": option.get("Value")
                }
            )

        if configured_options:
            configured_options.sort(
                key=lambda option: option["label"].casefold()
            )
            return configured_options

    return []


# -----------------------------------
# GET SINGLE ACCOUNT
# -----------------------------------
async def get_account(
    account_id: str,
    select_fields: str = "name,websiteurl"
):

    token = await get_access_token()

    url = f"{API_URL}/accounts({account_id})?$select={select_fields}"

    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "OData-Version": "4.0"
    }

    async with httpx.AsyncClient(timeout=60.0) as client:

        response = await client.get(
            url,
            headers=headers
        )

    if response.status_code != 200:
        raise Exception(f"Failed to fetch account: {response.text}")

    return response.json()


# -----------------------------------
# GET ACCOUNTS MISSING DATA
# -----------------------------------
async def get_accounts_missing_data():

    url = (
        f"{API_URL}/accounts?"
        "$select="
        "name,"
        "accountid,"
        "emailaddress1,"
        "telephone1,"
        "address1_city,"
        "address1_stateorprovince&"
        "$filter=(emailaddress1 eq null or telephone1 eq null)&"
        "$orderby=createdon asc&"
        "$top=30"
    )

    data = await fetch_dynamics_collection(url)

    return data



async def get_available_sectors():

    token = await get_access_token()

    fetchxml = """
    <fetch distinct='true'>
      <entity name='account'>
        <attribute name='new_sector'/>
        <filter>
          <condition attribute='new_sector' operator='not-null'/>
        </filter>
      </entity>
    </fetch>
    """

    encoded_fetchxml = quote(fetchxml)

    url = (
        f"{API_URL}/accounts"
        f"?fetchXml={encoded_fetchxml}"
    )

    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "OData-Version": "4.0"
    }

    async with httpx.AsyncClient(timeout=120.0) as client:

        response = await client.get(
            url,
            headers=headers
        )

    if response.status_code != 200:
        raise Exception(response.text)

    data = response.json().get("value", [])

    sectors = []

    for row in data:

        sector = (row.get("new_sector") or "").strip()

        if not sector:
            continue

        # Skip numeric-only sectors
        if re.fullmatch(r"\d+", sector):
            continue

        sectors.append({
            "value": sector,
            "label": sector,
            "account_count": None
        })

    sectors.sort(
        key=lambda x: x["label"].casefold()
    )

    print(f"✅ TOTAL DISTINCT SECTORS: {len(sectors)}")

    return sectors


async def get_available_states(
    sectors: list[str] | None = None
):

    token = await get_access_token()

    filter_xml = """
        <condition attribute='address1_country'
                   operator='eq'
                   value='United States'/>

        <condition attribute='address1_stateorprovince'
                   operator='not-null'/>
    """

    # -----------------------------------
    # OPTIONAL SECTOR FILTERING
    # -----------------------------------
    normalized_sectors = normalize_sector_list(sectors)

    if normalized_sectors:

        sector_conditions = ""

        for sector in normalized_sectors:

            escaped_sector = escape_odata_string(sector)

            sector_conditions += f"""
                <condition attribute='new_sector'
                           operator='eq'
                           value='{escaped_sector}'/>
            """

        filter_xml += f"""
            <filter type='or'>
                {sector_conditions}
            </filter>
        """

    # -----------------------------------
    # FETCHXML
    # -----------------------------------
    fetchxml = f"""
    <fetch distinct='true'>
      <entity name='account'>
        <attribute name='address1_stateorprovince'/>
        <filter type='and'>
            {filter_xml}
        </filter>
      </entity>
    </fetch>
    """

    encoded_fetchxml = quote(fetchxml)

    url = (
        f"{API_URL}/accounts"
        f"?fetchXml={encoded_fetchxml}"
    )

    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "OData-Version": "4.0"
    }

    async with httpx.AsyncClient(timeout=120.0) as client:

        response = await client.get(
            url,
            headers=headers
        )

    if response.status_code != 200:
        raise Exception(response.text)

    data = response.json().get("value", [])

    states = []

    for row in data:

        state = (
            row.get("address1_stateorprovince") or ""
        ).strip()

        if not state:
            continue

        states.append({
            "value": state,
            "label": state,
            "account_count": None
        })

    # -----------------------------------
    # REMOVE DUPLICATES
    # -----------------------------------
    seen = set()

    unique_states = []

    for state in states:

        key = state["value"].casefold()

        if key in seen:
            continue

        seen.add(key)

        unique_states.append(state)

    # -----------------------------------
    # SORT STATES
    # -----------------------------------
    unique_states.sort(
        key=lambda x: x["label"].casefold()
    )

    print(
        f"✅ TOTAL DISTINCT STATES: "
        f"{len(unique_states)}"
    )

    return unique_states



# -----------------------------------
# GET ACCOUNTS NEEDING ENRICHMENT
# -----------------------------------
async def get_accounts_needing_enrichment(
    sectors: list[str] | None = None,
    states: list[str] | None = None
):

    sector_filter = build_sector_filter(sectors)
    state_filter = build_state_filter(states)

    url = (
        f"{API_URL}/accounts?"
        "$select="
        "accountid,"
        "name,"
        "websiteurl,"
        "telephone1,"
        "address1_city,"
        "address1_stateorprovince,"
        "address1_country,"
        "numberofemployees,"
        "new_sector,"
        "description,"
        f"{ENRICHMENT_FIELD}&"
        "$filter="
        "address1_country eq 'United States' "
        "and new_sector ne null "
        f"{sector_filter} "
        f"{state_filter} "
        f"and ({ENRICHMENT_FIELD} ne true or {ENRICHMENT_FIELD} eq null)&"
        "$orderby=createdon asc&"
        "$top=30"
    )

    print("====================================")
    print("📡 DYNAMICS ENRICHMENT QUERY")
    print(url)
    print("====================================")

    data = await fetch_dynamics_collection(url)

    print(f"✅ Retrieved {len(data)} accounts")

    return data


# -----------------------------------
# UPDATE ACCOUNT
# -----------------------------------
async def update_account(account_id: str, updates: dict):

    token = await get_access_token()

    url = f"{API_URL}/accounts({account_id})"

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "OData-Version": "4.0"
    }

    print("====================================")
    print(f"🚀 PATCHING ACCOUNT: {account_id}")
    print(f"📦 Updates: {updates}")
    print("====================================")

    async with httpx.AsyncClient(timeout=60.0) as client:

        response = await client.patch(
            url,
            headers=headers,
            json=updates
        )

    print(f"📊 PATCH STATUS: {response.status_code}")

    if response.status_code not in [200, 204]:
        raise Exception(f"Dynamics UPDATE error: {response.text}")

    return True


# -----------------------------------
# REVERT ACCOUNT FIELDS
# -----------------------------------
async def revert_account_fields(
    account_id: str,
    fields: dict = None
):

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

    async with httpx.AsyncClient(timeout=60.0) as client:

        response = await client.patch(
            url,
            headers=headers,
            json=fields
        )

    if response.status_code not in [200, 204]:
        raise Exception(f"Revert failed: {response.text}")

    return {
        "account_id": account_id,
        "reverted_fields": fields
    }


# -----------------------------------
# ENRICH ACCOUNT
# -----------------------------------
async def enrich_account(
    account_id: str,
    allowed_sectors: list[str] | None = None,
    allowed_states: list[str] | None = None
):

    increment_processed()

    account = await get_account(
        account_id,
        (
            "name,"
            "websiteurl,"
            "telephone1,"
            "address1_city,"
            "address1_stateorprovince,"
            "address1_country,"
            "numberofemployees,"
            "new_sector,"
            "description,"
            f"{ENRICHMENT_FIELD}"
        )
    )

    company_name = account.get("name")

    sector = account.get("new_sector") or ""
    state = account.get("address1_stateorprovince") or ""

    print("====================================")
    print(f"🔍 Enriching: {company_name}")
    print(f"🏭 Sector: {sector}")
    print(f"📍 State: {state}")

    normalized_allowed_sectors = normalize_sector_list(
        allowed_sectors
    )

    if normalized_allowed_sectors:

        allowed_sector_lookup = {
            allowed_sector.casefold()
            for allowed_sector in normalized_allowed_sectors
        }

        if sector.strip().casefold() not in allowed_sector_lookup:

            print("❌ Skipping account outside selected sectors")

            return {
                "account_id": account_id,
                "updated": False,
                "reason": "Outside selected sectors"
            }

    normalized_allowed_states = normalize_sector_list(
        allowed_states
    )

    if normalized_allowed_states:

        allowed_state_lookup = {
            allowed_state.casefold()
            for allowed_state in normalized_allowed_states
        }

        if state.strip().casefold() not in allowed_state_lookup:

            print("❌ Skipping account outside selected states")

            return {
                "account_id": account_id,
                "updated": False,
                "reason": "Outside selected states"
            }

    print("✅ Filter checks passed — proceeding")

    # -----------------------------------
    # CREDIT LIMIT CHECK
    # -----------------------------------
    usage = load_usage()

    credits_used = usage.get("credits_used", 0)

    print(
        f"📊 Credits used: "
        f"{credits_used}/{WEEKLY_LIMIT}"
    )

    if not can_make_request():

        print("🚫 Weekly credit cap reached")

        return {
            "account_id": account_id,
            "updated": False,
            "reason": "Weekly credit cap reached"
        }

    # -----------------------------------
    # ENRICH WITH SEAMLESS
    # -----------------------------------
    seamless_data = await enrich_with_seamless(account)

    usage = increment_usage()

    print("✅ Credit consumed")

    print(
        f"📊 Credits used: "
        f"{usage.get('credits_used', 0)}/{WEEKLY_LIMIT}"
    )

    print(f"🌐 Seamless result: {seamless_data}")

    # -----------------------------------
    # TRACK CHANGES
    # -----------------------------------
    updates = {
        ENRICHMENT_FIELD: True
    }

    changes = []

    def add_update(field_name, new_value):

        old_value = account.get(field_name)

        if new_value is None:
            return

        if isinstance(new_value, str) and new_value.strip() == "":
            return

        if old_value == new_value:
            return

        updates[field_name] = new_value

        changes.append({
            "field": field_name,
            "old": old_value,
            "new": new_value
        })

        print(
            f"📝 Change detected | "
            f"{field_name}: "
            f"{old_value} -> {new_value}"
        )

    # -----------------------------------
    # WEBSITE
    # -----------------------------------
    website = seamless_data.get("website")

    if website:

        if not website.startswith("http"):
            website = f"https://{website}"

        add_update(
            "websiteurl",
            website
        )

    # -----------------------------------
    # PHONE
    # -----------------------------------
    phone = seamless_data.get("phone")

    if phone:

        add_update(
            "telephone1",
            phone
        )

    # -----------------------------------
    # STATE
    # -----------------------------------
    state = seamless_data.get("state")

    print(f"📍 Raw state: {state}")

    if state:

        state_clean = state.strip()

        state_abbr = STATE_ABBREVIATIONS.get(
            state_clean.title(),
            state_clean
        )

        print(f"📍 Converted state: {state_abbr}")

        add_update(
            "address1_stateorprovince",
            state_abbr
        )

    # -----------------------------------
    # COUNTRY
    # -----------------------------------
    country = seamless_data.get("country")

    if country:

        add_update(
            "address1_country",
            country
        )

    # -----------------------------------
    # EMPLOYEES
    # -----------------------------------
    employees = seamless_data.get("employees")

    if employees:

        try:

            employees_int = int(employees)

            add_update(
                "numberofemployees",
                employees_int
            )

        except Exception:

            print("⚠️ Could not convert employees to int")

    # -----------------------------------
    # DESCRIPTION
    # -----------------------------------
    description = seamless_data.get("description")

    if description:

        print(
            f"📝 Description found: "
            f"{description[:100]}"
        )

        add_update(
            "description",
            description
        )

        print("📝 Description updated")

    # -----------------------------------
    # DEBUGGING
    # -----------------------------------
    print("====================================")
    print(f"📦 FINAL UPDATES: {updates}")
    print(f"📋 FINAL CHANGES: {changes}")
    print(f"📊 TOTAL CHANGES: {len(changes)}")
    print("====================================")

    # -----------------------------------
    # UPDATE DYNAMICS
    # -----------------------------------
    if updates:

        print("🚀 Sending PATCH to Dynamics")

        await update_account(
            account_id,
            updates
        )

        print("✅ Dynamics updated successfully")

        # -----------------------------------
        # LOG AUDIT HISTORY
        # -----------------------------------
        if changes:

            log_update(
                company_name=company_name,
                changes=changes
            )

            print("✅ Audit log recorded")

        else:
            print("⚠️ No actual field changes detected")

    return {
        "account_id": account_id,
        "company_name": company_name,
        "updated": bool(changes),
        "updates": updates if updates else None,
        "changes": changes if changes else None
    }


# -----------------------------------
# BULK ENRICHMENT
# -----------------------------------
async def enrich_accounts(
    sectors: list[str] | None = None,
    states: list[str] | None = None
):

    selected_sectors = normalize_sector_list(sectors)
    selected_states = normalize_sector_list(states)

    accounts = await get_accounts_needing_enrichment(
        selected_sectors,
        selected_states
    )

    results = []

    print(
        f"🚀 Starting bulk enrichment "
        f"for {len(accounts)} accounts"
    )

    if selected_sectors:
        print(f"🏭 Selected sectors: {selected_sectors}")

    if selected_states:
        print(f"📍 Selected states: {selected_states}")

    for account in accounts:

        account_id = account.get("accountid")

        if not account_id:
            continue

        try:

            result = await enrich_account(
                account_id,
                allowed_sectors=selected_sectors,
                allowed_states=selected_states
            )

            results.append(result)

        except Exception as e:

            print("====================================")
            print(f"❌ FAILED ACCOUNT: {account_id}")
            print(str(e))
            print("====================================")

            results.append({
                "account_id": account_id,
                "updated": False,
                "error": str(e)
            })

        # -----------------------------------
        # RATE LIMIT SAFETY
        # -----------------------------------
        await asyncio.sleep(1)

    updated_count = sum(
        1 for result in results
        if result.get("updated")
    )

    print("====================================")
    print("✅ BULK ENRICHMENT COMPLETE")
    print(f"📊 Processed: {len(results)}")
    print(f"📊 Updated: {updated_count}")
    print("====================================")

    return {
        "processed": len(results),
        "updated": updated_count,
        "selected_sectors": selected_sectors,
        "selected_states": selected_states,
        "results": results
    }
