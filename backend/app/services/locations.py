import re


US_STATE_NAMES_BY_ABBREVIATION = {
    "AL": "Alabama",
    "AK": "Alaska",
    "AZ": "Arizona",
    "AR": "Arkansas",
    "CA": "California",
    "CO": "Colorado",
    "CT": "Connecticut",
    "DE": "Delaware",
    "FL": "Florida",
    "GA": "Georgia",
    "HI": "Hawaii",
    "ID": "Idaho",
    "IL": "Illinois",
    "IN": "Indiana",
    "IA": "Iowa",
    "KS": "Kansas",
    "KY": "Kentucky",
    "LA": "Louisiana",
    "ME": "Maine",
    "MD": "Maryland",
    "MA": "Massachusetts",
    "MI": "Michigan",
    "MN": "Minnesota",
    "MS": "Mississippi",
    "MO": "Missouri",
    "MT": "Montana",
    "NE": "Nebraska",
    "NV": "Nevada",
    "NH": "New Hampshire",
    "NJ": "New Jersey",
    "NM": "New Mexico",
    "NY": "New York",
    "NC": "North Carolina",
    "ND": "North Dakota",
    "OH": "Ohio",
    "OK": "Oklahoma",
    "OR": "Oregon",
    "PA": "Pennsylvania",
    "RI": "Rhode Island",
    "SC": "South Carolina",
    "SD": "South Dakota",
    "TN": "Tennessee",
    "TX": "Texas",
    "UT": "Utah",
    "VT": "Vermont",
    "VA": "Virginia",
    "WA": "Washington",
    "WV": "West Virginia",
    "WI": "Wisconsin",
    "WY": "Wyoming",
    "DC": "District of Columbia",
}

CANADA_PROVINCE_NAMES_BY_ABBREVIATION = {
    "AB": "Alberta",
    "BC": "British Columbia",
    "MB": "Manitoba",
    "NB": "New Brunswick",
    "NL": "Newfoundland and Labrador",
    "NT": "Northwest Territories",
    "NS": "Nova Scotia",
    "NU": "Nunavut",
    "ON": "Ontario",
    "PE": "Prince Edward Island",
    "QC": "Quebec",
    "SK": "Saskatchewan",
    "YT": "Yukon",
}


def normalize_location_text(value):
    return re.sub(r"\s+", " ", str(value or "").strip().casefold())


_US_STATE_ABBREVIATIONS_BY_NAME = {
    normalize_location_text(name): abbreviation
    for abbreviation, name in US_STATE_NAMES_BY_ABBREVIATION.items()
}
_CANADA_PROVINCE_ABBREVIATIONS_BY_NAME = {
    normalize_location_text(name): abbreviation
    for abbreviation, name in CANADA_PROVINCE_NAMES_BY_ABBREVIATION.items()
}


def normalize_country_group(value):
    normalized = re.sub(r"[\s.]+", "", normalize_location_text(value))

    if normalized in {"us", "usa", "unitedstates", "unitedstatesofamerica"}:
        return "us"

    if normalized in {"ca", "can", "canada"}:
        return "canada"

    return normalized or None


def normalize_state_province(value):
    normalized = normalize_location_text(value)
    if not normalized:
        return None

    lookup_key = normalized.upper()
    if lookup_key in US_STATE_NAMES_BY_ABBREVIATION:
        return lookup_key
    if lookup_key in CANADA_PROVINCE_NAMES_BY_ABBREVIATION:
        return lookup_key

    return (
        _US_STATE_ABBREVIATIONS_BY_NAME.get(normalized)
        or _CANADA_PROVINCE_ABBREVIATIONS_BY_NAME.get(normalized)
    )


def get_state_province_country_group(value):
    abbreviation = normalize_state_province(value)
    if not abbreviation:
        return None

    if abbreviation in US_STATE_NAMES_BY_ABBREVIATION:
        return "us"

    if abbreviation in CANADA_PROVINCE_NAMES_BY_ABBREVIATION:
        return "canada"

    return None
