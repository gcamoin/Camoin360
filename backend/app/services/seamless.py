import os
import httpx
from dotenv import load_dotenv

load_dotenv()

SEAMLESS_API_URL = "https://api.seamless.ai/api/client/v1/search/companies"
SEAMLESS_API_KEY = os.getenv("SEAMLESS_API_KEY")


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

    def normalize(value):
        return (value or "").lower().replace(".", "").replace(",", "").strip()

    def extract_phone(item):
        phones = item.get("phones") or item.get("phone")
        if isinstance(phones, str):
            return phones.split(",")[0].strip() or None
        if isinstance(phones, list) and phones:
            first_phone = phones[0]
            if isinstance(first_phone, str):
                return first_phone.strip() or None
        return None

    def has_usable_data(item):
        return bool(item.get("domain") or extract_phone(item))

    def score_match(company, item):
        score = 0

        name = normalize(company.get("name"))
        item_name = normalize(item.get("name"))

        city = normalize(company.get("address1_city"))
        item_city = normalize(item.get("city"))

        state = normalize(company.get("address1_stateorprovince"))
        item_state = normalize(item.get("state"))

        country = normalize(company.get("address1_country"))
        item_country = normalize(item.get("country"))

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
            domain_clean = normalize(domain)
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
        "companyCountry": ["United States"],
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
    best_score = 0

    for item in usable_results:
        score = score_match(company, item)

        print(f"🔍 Candidate: {item.get('name')}")
        print(f"📊 Score: {score}")

        if score > best_score:
            best_score = score
            best_match = item

    if not best_match:
        return {}

    print(f"🏆 Best match: {best_match.get('name')}")
    print(f"🏆 Score: {best_score}")

    if best_score < 70:
        print("❌ Low confidence match — skipping update")
        print("❌ Skipped due to low confidence")
        return {}

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
        "website": domain or None,
        "phone": phone or None,
        "state": best_match.get("state"),
        "country": best_match.get("country"),
        "employees": best_match.get("employeeCount"),
        "description": description,
    }
