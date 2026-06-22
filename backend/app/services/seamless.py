import os
import re
from urllib.parse import urlparse

import httpx
from dotenv import load_dotenv

load_dotenv()

SEAMLESS_API_URL = "https://api.seamless.ai/api/client/v1/search/companies"
SEAMLESS_API_KEY = os.getenv("SEAMLESS_API_KEY")
MATCH_CONFIDENCE_THRESHOLD = 60

COMPANY_SUFFIXES = {"co", "company", "corp", "corporation", "inc", "incorporated", "llc", "ltd", "limited", "plc"}
COUNTRY_ALIASES = {
    "us": "united states",
    "usa": "united states",
    "united states of america": "united states",
    "ca": "canada",
}
STATE_NAMES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California",
    "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware", "FL": "Florida", "GA": "Georgia",
    "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa",
    "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri",
    "MT": "Montana", "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey",
    "NM": "New Mexico", "NY": "New York", "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio",
    "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
    "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont",
    "VA": "Virginia", "WA": "Washington", "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
}


def normalize_text(value):
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", str(value or "").casefold())).strip()


def normalize_company_name(value):
    tokens = normalize_text(value).split()
    while tokens and tokens[-1] in COMPANY_SUFFIXES:
        tokens.pop()
    return " ".join(tokens)


def normalize_website(value):
    raw_value = str(value or "").strip().casefold()
    if not raw_value:
        return ""
    parsed = urlparse(raw_value if "://" in raw_value else f"https://{raw_value}")
    return (parsed.hostname or "").removeprefix("www.")


def normalize_phone(value):
    digits = re.sub(r"\D", "", str(value or ""))
    return digits[-10:] if len(digits) >= 10 else digits


def normalize_country(value):
    normalized = normalize_text(value)
    return COUNTRY_ALIASES.get(normalized, normalized)


def normalize_state(value):
    normalized = normalize_text(value)
    state_aliases = {normalize_text(abbreviation): normalize_text(name) for abbreviation, name in STATE_NAMES.items()}
    return state_aliases.get(normalized, normalized)


def extract_phone(item):
    phones = item.get("phones") or item.get("phone")
    if isinstance(phones, str):
        return phones.split(",")[0].strip() or None
    if isinstance(phones, list) and phones:
        first_phone = phones[0]
        if isinstance(first_phone, str):
            return first_phone.strip() or None
    return None


def get_match_confidence(company, candidate):
    source_values = {
        "website": normalize_website(company.get("websiteurl")),
        "phone": normalize_phone(company.get("telephone1")),
        "country": normalize_country(company.get("address1_country")),
        "state": normalize_state(company.get("address1_stateorprovince")),
        "name": normalize_company_name(company.get("name")),
    }
    candidate_values = {
        "website": normalize_website(candidate.get("domain") or candidate.get("website")),
        "phone": normalize_phone(extract_phone(candidate)),
        "country": normalize_country(candidate.get("country")),
        "state": normalize_state(candidate.get("state")),
        "name": normalize_company_name(candidate.get("name")),
    }
    checks = {
        field: bool(source_values[field] and candidate_values[field] and source_values[field] == candidate_values[field])
        for field in source_values
    }
    matched_fields = [field for field, matched in checks.items() if matched]

    return {
        "confidence_score": len(matched_fields) * 20,
        "matched_fields": matched_fields,
        "match_checks": checks,
    }


async def enrich_with_seamless(company):
    company = company or {}

    company_name = company.get("name")
    city = company.get("address1_city")
    state = company.get("address1_stateorprovince")

    if not company_name:
        return {}

    if not SEAMLESS_API_KEY:
        raise RuntimeError("SEAMLESS_API_KEY is not configured")

    headers = {
        "Token": SEAMLESS_API_KEY,
        "Content-Type": "application/json",
    }

    state_map = {
        "TX": "Texas",
        "NY": "New York",
        "CA": "California",
        "FL": "Florida",
    }
    state = state_map.get(state, state)
    company["address1_stateorprovince"] = state

    def has_usable_data(item):
        return bool(item.get("domain") or extract_phone(item))

    def score_match(company, item):
        score = 0

        name = normalize_text(company.get("name"))
        item_name = normalize_text(item.get("name"))

        city = normalize_text(company.get("address1_city"))
        item_city = normalize_text(item.get("city"))

        state = normalize_state(company.get("address1_stateorprovince"))
        item_state = normalize_state(item.get("state"))

        country = normalize_country(company.get("address1_country"))
        item_country = normalize_country(item.get("country"))

        domain = item.get("domain") or ""

        if name and item_name:
            if name == item_name:
                score += 50
            elif name in item_name or item_name in name:
                score += 35

        if city and item_city and city in item_city:
            score += 20

        if state and item_state and state in item_state:
            score += 20

        if country and item_country and country in item_country:
            score += 10

        if domain:
            domain_clean = normalize_text(domain)
            if name and name.split()[0] in domain_clean:
                score += 30

        return score

    async def search(payload):
        print(f"📡 Payload: {payload}")

        async with httpx.AsyncClient() as client:
            response = await client.post(SEAMLESS_API_URL, headers=headers, json=payload)

        if response.status_code != 200:
            raise Exception(f"Seamless API error: {response.text}")

        results = response.json().get("data", [])
        print(f"📊 Raw results: {results}")
        return results

    payload = {
        "companyName": [company_name],
        "companyCity": [city] if city else [],
        "companyState": [state] if state else [],
        "companyCountry": [company.get("address1_country")] if company.get("address1_country") else [],
        "limit": 5,
    }

    results = await search(payload)
    usable_results = [item for item in results if has_usable_data(item)]

    if not usable_results:
        print("🔁 Retrying without location...")
        fallback_payload = {
            "companyName": [company_name],
            "limit": 5,
        }
        results = await search(fallback_payload)
        usable_results = [item for item in results if has_usable_data(item)]

    if not usable_results:
        return {}

    best_match = None
    best_score = -1
    best_confidence = None

    for item in usable_results:
        score = score_match(company, item)
        confidence = get_match_confidence(company, item)

        print(f"🔍 Candidate: {item.get('name')}")
        print(f"📊 Score: {score}")

        candidate_rank = (confidence["confidence_score"], score)
        best_rank = (best_confidence["confidence_score"], best_score) if best_confidence else (-1, -1)
        if candidate_rank > best_rank:
            best_score = score
            best_match = item
            best_confidence = confidence

    if not best_match:
        return {}

    print(f"🏆 Best match: {best_match.get('name')}")
    print(f"🏆 Score: {best_score}")

    print(f"🏆 Match confidence: {best_confidence['confidence_score']}% ({', '.join(best_confidence['matched_fields']) or 'no fields'})")

    if best_confidence["confidence_score"] < MATCH_CONFIDENCE_THRESHOLD:
        print("❌ Match confidence below 60% — skipping update")
        return {
            **best_confidence,
            "meets_confidence_threshold": False,
        }

    domain = best_match.get("domain")
    if domain and not domain.startswith("http"):
        domain = f"https://{domain}"

    phone = extract_phone(best_match)
    description = best_match.get("description")

    print(f"✅ Final match: {{'name': {best_match.get('name')!r}, 'website': {domain!r}, 'phone': {phone!r}}}")

    if (
        not domain
        and not phone
        and not best_match.get("state")
        and not best_match.get("country")
        and not best_match.get("employeeCount")
        and not description
    ):
        return {}

    return {
        **best_confidence,
        "meets_confidence_threshold": True,
        "website": domain or None,
        "phone": phone or None,
        "state": best_match.get("state"),
        "country": best_match.get("country"),
        "employees": best_match.get("employeeCount"),
        "description": description,
    }
