import re
import string
from difflib import SequenceMatcher


COMPANY_SUFFIXES = {
    "co",
    "company",
    "corp",
    "corporation",
    "inc",
    "incorporated",
    "llc",
    "l l c",
    "llp",
    "l l p",
    "lp",
    "l p",
    "ltd",
    "limited",
    "plc",
    "p l c",
}

_PUNCTUATION_TRANSLATION = str.maketrans({character: " " for character in string.punctuation})
_WHITESPACE_PATTERN = re.compile(r"\s+")
_URL_SCHEME_PATTERN = re.compile(r"^https?://", re.IGNORECASE)
_URL_PREFIX_PATTERN = re.compile(r"^www\.", re.IGNORECASE)

CONFIDENCE_RANK = {
    "low": 1,
    "medium": 2,
    "high": 3,
}

MATCH_POINTS = {
    "website": 40,
    "name": 30,
    "country": 15,
    "state": 15,
}

COUNTRY_ALIASES = {
    "us": "united states",
    "usa": "united states",
    "u s": "united states",
    "u s a": "united states",
    "united states of america": "united states",
    "ca": "canada",
    "can": "canada",
}


def normalize_spaces(value: str) -> str:
    return _WHITESPACE_PATTERN.sub(" ", value).strip()


def normalize_text_value(value) -> str:
    if value is None:
        return ""

    return normalize_spaces(str(value).lower().translate(_PUNCTUATION_TRANSLATION))


def remove_company_suffix(value: str) -> str:
    normalized_value = normalize_spaces(value)

    while normalized_value:
        next_value = normalized_value

        for suffix in sorted(COMPANY_SUFFIXES, key=len, reverse=True):
            suffix_with_space = f" {suffix}"
            if next_value == suffix:
                next_value = ""
                break
            if next_value.endswith(suffix_with_space):
                next_value = next_value[: -len(suffix_with_space)]
                break

        next_value = normalize_spaces(next_value)
        if next_value == normalized_value:
            break

        normalized_value = next_value

    return normalized_value


def normalize_company_name(value) -> str:
    return remove_company_suffix(normalize_text_value(value))


def normalize_website(value) -> str:
    if value is None:
        return ""

    normalized_value = str(value).strip().lower()
    normalized_value = _URL_SCHEME_PATTERN.sub("", normalized_value)
    normalized_value = _URL_PREFIX_PATTERN.sub("", normalized_value)
    normalized_value = normalized_value.split("/", 1)[0]

    return normalized_value.strip()


def normalize_location_value(value) -> str:
    return normalize_text_value(value)


def normalize_country_value(value) -> str:
    normalized_value = normalize_location_value(value)

    return COUNTRY_ALIASES.get(normalized_value, normalized_value)


def are_company_names_similar(first_name: str, second_name: str) -> bool:
    if not first_name or not second_name:
        return False

    if first_name == second_name:
        return True

    return SequenceMatcher(None, first_name, second_name).ratio() >= 0.88


def get_confidence_level(score: int) -> str:
    if score >= 90:
        return "high"

    if score >= 70:
        return "medium"

    return "low"


def prepare_duplicate_account(account: dict) -> dict:
    return {
        "account": account,
        "accountid": account.get("accountid"),
        "name": normalize_company_name(account.get("name")),
        "website": normalize_website(account.get("websiteurl")),
        "country": normalize_country_value(account.get("address1_country")),
        "state": normalize_location_value(account.get("address1_stateorprovince")),
    }


def get_duplicate_match(first_account: dict, second_account: dict) -> dict | None:
    first = prepare_duplicate_account(first_account)
    second = prepare_duplicate_account(second_account)
    same_name = first["name"] and first["name"] == second["name"]
    similar_name = are_company_names_similar(first["name"], second["name"])
    same_website = first["website"] and first["website"] == second["website"]
    same_country = first["country"] and first["country"] == second["country"]
    same_state = first["state"] and first["state"] == second["state"]
    missing_website = not first["website"] or not second["website"]
    score = 0
    reasons = []

    if same_website:
        score += MATCH_POINTS["website"]
        reasons.append("same website")

    if similar_name:
        score += MATCH_POINTS["name"]
        reasons.append("very similar name" if not same_name else "same name")

    if same_country:
        score += MATCH_POINTS["country"]
        reasons.append("same country")

    if same_state:
        score += MATCH_POINTS["state"]
        reasons.append("same state")

    if same_website and same_country and same_state and similar_name:
        return {
            "confidence_score": score,
            "confidence": get_confidence_level(score),
            "reasons": reasons,
        }

    if same_name and same_country and same_state and missing_website:
        return {
            "confidence_score": score,
            "confidence": get_confidence_level(score),
            "reasons": [*reasons, "missing website"],
        }

    if same_name:
        return {
            "confidence_score": score,
            "confidence": get_confidence_level(score),
            "reasons": reasons,
        }

    return None


def find_duplicate_account_groups(accounts: list[dict]) -> list[dict]:
    parent_by_index = list(range(len(accounts)))
    group_metadata_by_root = {}

    def find_root(index: int) -> int:
        while parent_by_index[index] != index:
            parent_by_index[index] = parent_by_index[parent_by_index[index]]
            index = parent_by_index[index]

        return index

    def union(first_index: int, second_index: int, match: dict):
        first_root = find_root(first_index)
        second_root = find_root(second_index)

        if first_root != second_root:
            parent_by_index[second_root] = first_root
            second_metadata = group_metadata_by_root.pop(second_root, None)
            if second_metadata:
                first_metadata = group_metadata_by_root.setdefault(
                    first_root,
                    {"confidence_score": 0, "confidence": "low", "reasons": set()},
                )
                if second_metadata["confidence_score"] > first_metadata["confidence_score"]:
                    first_metadata["confidence_score"] = second_metadata["confidence_score"]
                    first_metadata["confidence"] = second_metadata["confidence"]
                first_metadata["reasons"].update(second_metadata["reasons"])

        root = find_root(first_index)
        metadata = group_metadata_by_root.setdefault(
            root,
            {"confidence_score": 0, "confidence": "low", "reasons": set()},
        )

        if match["confidence_score"] > metadata["confidence_score"]:
            metadata["confidence_score"] = match["confidence_score"]
            metadata["confidence"] = match["confidence"]
        metadata["reasons"].update(match["reasons"])

    for first_index, first_account in enumerate(accounts):
        for second_index in range(first_index + 1, len(accounts)):
            match = get_duplicate_match(first_account, accounts[second_index])

            if match:
                union(first_index, second_index, match)

    accounts_by_root = {}
    for index, account in enumerate(accounts):
        root = find_root(index)
        if root in group_metadata_by_root:
            accounts_by_root.setdefault(root, []).append(account)

    duplicate_groups = []
    for group_index, (root, group_accounts) in enumerate(accounts_by_root.items(), start=1):
        if len(group_accounts) < 2:
            continue

        metadata = group_metadata_by_root[root]
        duplicate_groups.append({
            "group_id": f"duplicate-group-{group_index}",
            "confidence_score": metadata["confidence_score"],
            "confidence": metadata["confidence"],
            "reasons": sorted(metadata["reasons"]),
            "accounts": group_accounts,
        })

    duplicate_groups.sort(
        key=lambda group: (
            -group["confidence_score"],
            normalize_company_name(group["accounts"][0].get("name")),
        )
    )

    return duplicate_groups
