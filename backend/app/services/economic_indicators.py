import asyncio
import csv
import io
from datetime import datetime, timezone
from typing import Any

import httpx


CACHE_TTL_SECONDS = 60 * 60 * 6
DEFAULT_TIMEOUT_SECONDS = 8

FRED_CSV_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv"

_cache: dict[str, Any] = {
    "loaded_at": None,
    "data": None,
}


def _quarter_label(date_value: str, with_space: bool = False) -> str:
    date = datetime.strptime(date_value, "%Y-%m-%d")
    quarter = ((date.month - 1) // 3) + 1
    separator = " " if with_space else ""
    return f"Q{quarter}{separator}'{date:%y}"


def _monthly_label(date_value: str) -> str:
    date = datetime.strptime(date_value, "%Y-%m-%d")
    return date.strftime("%b '%y")


def _read_csv_rows(text: str) -> list[dict[str, str]]:
    return list(csv.DictReader(io.StringIO(text)))


def _parse_numeric(value: str | None) -> float | None:
    if value in (None, "", "."):
        return None

    try:
        return float(value)
    except ValueError:
        return None


def _round(value: float | None, places: int = 2) -> float | None:
    return round(value, places) if value is not None else None


async def _fetch_text(client: httpx.AsyncClient, url: str, params: dict[str, str] | None = None) -> str:
    response = await asyncio.wait_for(client.get(url, params=params), timeout=DEFAULT_TIMEOUT_SECONDS + 2)
    response.raise_for_status()
    return response.text


async def _fetch_fred_series(client: httpx.AsyncClient, series_id: str) -> list[dict[str, str]]:
    text = await _fetch_text(client, FRED_CSV_URL, {"id": series_id})
    return _read_csv_rows(text)


async def _load_live_indicators() -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT_SECONDS, follow_redirects=True) as client:
        sentiment_rows, gdp_rows, two_year_rows, ten_year_rows, house_price_rows = await asyncio.gather(
            _fetch_fred_series(client, "UMCSENT"),
            _fetch_fred_series(client, "A191RL1Q225SBEA"),
            _fetch_fred_series(client, "DGS2"),
            _fetch_fred_series(client, "DGS10"),
            _fetch_fred_series(client, "USSTHPI"),
        )

    sentiment = [
        {
            "year": datetime.strptime(row["observation_date"], "%Y-%m-%d").year,
            "date": _monthly_label(row["observation_date"]),
            "value": _round(_parse_numeric(row.get("UMCSENT")), 1),
        }
        for row in sentiment_rows
        if _parse_numeric(row.get("UMCSENT")) is not None
    ]

    gdp = [
        {
            "year": datetime.strptime(row["observation_date"], "%Y-%m-%d").year,
            "date": _quarter_label(row["observation_date"]),
            "value": _round(_parse_numeric(row.get("A191RL1Q225SBEA")), 1),
        }
        for row in gdp_rows
        if _parse_numeric(row.get("A191RL1Q225SBEA")) is not None
    ]

    two_year_by_date = {
        row["observation_date"]: _parse_numeric(row.get("DGS2"))
        for row in two_year_rows
        if _parse_numeric(row.get("DGS2")) is not None
    }
    ten_year_by_date = {
        row["observation_date"]: _parse_numeric(row.get("DGS10"))
        for row in ten_year_rows
        if _parse_numeric(row.get("DGS10")) is not None
    }
    treasury_dates = sorted(set(two_year_by_date) & set(ten_year_by_date))
    treasury = [
        {
            "year": datetime.strptime(date_value, "%Y-%m-%d").year,
            "date": _quarter_label(date_value),
            "twoYear": _round(two_year_by_date[date_value]),
            "tenYear": _round(ten_year_by_date[date_value]),
        }
        for date_value in treasury_dates
    ]

    housing = [
        {
            "year": datetime.strptime(row["observation_date"], "%Y-%m-%d").year,
            "date": _quarter_label(row["observation_date"], with_space=True),
            "value": _round(_parse_numeric(row.get("USSTHPI")), 1),
        }
        for row in house_price_rows
        if _parse_numeric(row.get("USSTHPI")) is not None
    ]

    return {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "cache_ttl_seconds": CACHE_TTL_SECONDS,
        "sources": {
            "sentiment": "University of Michigan via FRED",
            "gdp": "U.S. Bureau of Economic Analysis via FRED",
            "treasury": "U.S. Treasury yields via FRED",
            "housing": "Federal Housing Finance Agency via FRED",
        },
        "series": {
            "sentiment": sentiment,
            "gdp": gdp,
            "treasury": treasury,
            "housing": housing,
        },
    }


def _is_cache_fresh() -> bool:
    loaded_at = _cache.get("loaded_at")
    return bool(loaded_at and (datetime.now(timezone.utc) - loaded_at).total_seconds() < CACHE_TTL_SECONDS)


async def get_economic_indicators(force_refresh: bool = False) -> dict[str, Any]:
    if not force_refresh and _cache.get("data") and _is_cache_fresh():
        return _cache["data"]

    data = await _load_live_indicators()
    _cache["loaded_at"] = datetime.now(timezone.utc)
    _cache["data"] = data
    return data
