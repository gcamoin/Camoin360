import logging
import os
import re
from difflib import SequenceMatcher
from typing import Any
from urllib.parse import urlparse

import httpx
from dotenv import load_dotenv
from .locations import normalize_state_province
from .usage import update_total_credits_remaining

load_dotenv()

SEAMLESS_API_URL = "https://api.seamless.ai/api/client/v1/search/companies"
SEAMLESS_API_KEY = os.getenv("SEAMLESS_API_KEY")

COMPANY_SUFFIXES = {"co", "company", "corp", "corporation", "inc", "incorporated", "llc", "ltd", "limited", "plc"}
COUNTRY_ALIASES = {
    "us": "united states",
    "usa": "united states",
    "united states of america": "united states",
    "ca": "canada",
}
def normalize_text(value):
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", str(value or "").casefold())).strip()


def normalize_company_name(value):
    tokens = normalize_text(value).split()
    while tokens and tokens[-1] in COMPANY_SUFFIXES:
        tokens.pop()
    return " ".join(tokens)


def company_names_match(source_name, candidate_name):
    """Allow common name variations without accepting a different company."""
    source = normalize_company_name(source_name)
    candidate = normalize_company_name(candidate_name)
    if not source or not candidate:
        return False
    if source == candidate:
        return True

    source_tokens = source.split()
    candidate_tokens = candidate.split()
    shared_tokens = set(source_tokens) & set(candidate_tokens)
    shorter_tokens = min(len(source_tokens), len(candidate_tokens))

    # Multiword legal or branding extensions are safe when every word in the
    # shorter name is present. A single shared word is not enough by itself.
    if shorter_tokens >= 2 and len(shared_tokens) == shorter_tokens:
        return True

    return SequenceMatcher(None, source, candidate).ratio() >= 0.90


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
    return normalize_state_province(value) or normalize_text(value)


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
    checks["name"] = company_names_match(company.get("name"), candidate.get("name"))
    matched_fields = [field for field, matched in checks.items() if matched]

    return {
        "confidence_score": len(matched_fields) * 20,
        "matched_fields": matched_fields,
        "match_checks": checks,
    }


logger = logging.getLogger(__name__)


async def enrich_with_seamless(company: dict[str, Any] | None) -> dict[str, Any]:
    """Search Seamless for a company and return Dynamics logical field names.

    An empty dictionary means that Seamless returned no usable company result.
    Transport/API failures intentionally raise so callers can distinguish a failed
    lookup from a genuine no-match result.
    """
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

    def has_usable_data(item: dict[str, Any]) -> bool:
        return bool(item.get("domain") or extract_phone(item))

    def score_match(company: dict[str, Any], item: dict[str, Any]) -> int:
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

    async def search(payload: dict[str, Any]) -> list[dict[str, Any]]:
        async with httpx.AsyncClient() as client:
            response = await client.post(SEAMLESS_API_URL, headers=headers, json=payload)

        response_headers = getattr(response, "headers", {})
        remaining_credits = (
            response_headers.get("X-PublicAPI-Credits")
            or response_headers.get("X-Credits-Remaining")
        )
        if remaining_credits is not None:
            update_total_credits_remaining(remaining_credits)

        if response.status_code != 200:
            raise RuntimeError(f"Seamless API error ({response.status_code}): {response.text}")

        data = response.json().get("data", [])
        return data if isinstance(data, list) else []

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
        logger.info("No usable Seamless result for %s with location; retrying without location", company_name)
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

        if not confidence["match_checks"]["name"]:
            continue

        candidate_rank = (confidence["confidence_score"], score)
        best_rank = (best_confidence["confidence_score"], best_score) if best_confidence else (-1, -1)
        if candidate_rank > best_rank:
            best_score = score
            best_match = item
            best_confidence = confidence

    if not best_match:
        return {}

    domain = best_match.get("domain")
    if domain and not domain.startswith("http"):
        domain = f"https://{domain}"

    phone = extract_phone(best_match)
    description = best_match.get("description")

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
        "websiteurl": domain or None,
        "telephone1": phone or None,
        "description": description or None,
        "numberofemployees": best_match.get("employeeCount"),
        "address1_city": best_match.get("city") or None,
        "address1_stateorprovince": best_match.get("state") or None,
        "address1_country": best_match.get("country") or None,
    }
