import asyncio
import base64
import os
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv


CACHE_TTL_SECONDS = 60 * 15
DEFAULT_TIMEOUT_SECONDS = 12
DEFAULT_MINOR_VERSION = "75"
DEFAULT_START_YEAR = 2021
MAX_CONCURRENT_REPORT_MONTHS = 2
MAX_REPORT_RETRIES = 3
BACKEND_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = BACKEND_ROOT.parent

load_dotenv(REPO_ROOT / ".env")
load_dotenv(BACKEND_ROOT / ".env")

_cache: dict[str, Any] = {
    "loaded_at": None,
    "data": None,
}


class QuickBooksConfigurationError(RuntimeError):
    pass


def _get_setting(*names: str) -> str | None:
    for name in names:
        value = os.getenv(name)
        if value:
            return value.strip()
    return None


def _get_config() -> dict[str, str]:
    client_id = _get_setting("QUICKBOOKS_CLIENT_ID", "QB_CLIENT_ID", "INTUIT_CLIENT_ID")
    client_secret = _get_setting("QUICKBOOKS_CLIENT_SECRET", "QB_CLIENT_SECRET", "INTUIT_CLIENT_SECRET")
    refresh_token = _get_setting("QUICKBOOKS_REFRESH_TOKEN", "QB_REFRESH_TOKEN", "INTUIT_REFRESH_TOKEN")
    realm_id = _get_setting("QUICKBOOKS_REALM_ID", "QB_REALM_ID", "INTUIT_REALM_ID", "QUICKBOOKS_COMPANY_ID")
    environment = (_get_setting("QUICKBOOKS_ENVIRONMENT", "QB_ENVIRONMENT", "INTUIT_ENVIRONMENT") or "sandbox").lower()
    minor_version = _get_setting("QUICKBOOKS_MINOR_VERSION", "QB_MINOR_VERSION", "INTUIT_MINOR_VERSION") or DEFAULT_MINOR_VERSION
    start_year = _get_setting("QUICKBOOKS_FINANCIALS_START_YEAR", "QB_FINANCIALS_START_YEAR") or str(DEFAULT_START_YEAR)

    missing = [
        label
        for label, value in {
            "QUICKBOOKS_CLIENT_ID": client_id,
            "QUICKBOOKS_CLIENT_SECRET": client_secret,
            "QUICKBOOKS_REFRESH_TOKEN": refresh_token,
            "QUICKBOOKS_REALM_ID": realm_id,
        }.items()
        if not value
    ]
    if missing:
        raise QuickBooksConfigurationError(
            "Missing QuickBooks sandbox configuration: " + ", ".join(missing)
        )

    base_url = "https://sandbox-quickbooks.api.intuit.com" if environment == "sandbox" else "https://quickbooks.api.intuit.com"

    return {
        "base_url": base_url,
        "client_id": client_id,
        "client_secret": client_secret,
        "minor_version": minor_version,
        "realm_id": realm_id,
        "refresh_token": refresh_token,
        "start_year": start_year,
    }


def _to_number(value: Any) -> float:
    if value in (None, "", "-"):
        return 0.0
    try:
        return float(str(value).replace(",", ""))
    except ValueError:
        return 0.0


def _month_label(year: int, month: int) -> str:
    return date(year, month, 1).strftime("%b '%y")


def _month_key(year: int, month: int) -> str:
    return f"{year}-{month:02d}"


def _month_date_range(year: int, month: int) -> tuple[str, str]:
    start = date(year, month, 1)
    end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    return start.isoformat(), date.fromordinal(end.toordinal() - 1).isoformat()


def _find_named_value(rows: list[dict[str, Any]], names: tuple[str, ...]) -> float:
    wanted = tuple(name.lower() for name in names)
    for row in rows:
        label = str(row.get("label") or "").strip().lower()
        if any(name == label or name in label for name in wanted):
            return _to_number(row.get("value"))
    return 0.0


def _flatten_report_rows(report: dict[str, Any]) -> list[dict[str, Any]]:
    flattened: list[dict[str, Any]] = []

    def append_col_data(col_data: list[dict[str, Any]] | None, fallback_label: str | None = None):
        if not col_data:
            if fallback_label:
                flattened.append({"label": fallback_label, "value": None})
            return

        label = col_data[0].get("value") or fallback_label
        value = col_data[-1].get("value") if len(col_data) > 1 else None

        if label:
            flattened.append({"label": label, "value": value})

    def visit(lines: list[dict[str, Any]] | None):
        for line in lines or []:
            append_col_data(line.get("ColData"), line.get("group"))
            append_col_data((line.get("Header") or {}).get("ColData"), line.get("group"))

            nested_rows = line.get("Rows") or {}
            visit(nested_rows.get("Row"))
            append_col_data((line.get("Summary") or {}).get("ColData"))

    visit((report.get("Rows") or {}).get("Row"))
    return flattened


def _build_month_row(year: int, month: int, profit_loss: dict[str, Any], balance_sheet: dict[str, Any]) -> dict[str, Any]:
    pl_rows = _flatten_report_rows(profit_loss)
    bs_rows = _flatten_report_rows(balance_sheet)

    sales = _find_named_value(pl_rows, ("total income", "income", "total revenue", "revenue", "sales"))
    net_income = _find_named_value(pl_rows, ("net income", "net earnings", "net profit"))
    cash_on_hand = _find_named_value(bs_rows, ("total bank accounts", "total cash and cash equivalents", "cash"))
    current_assets = _find_named_value(bs_rows, ("total current assets",))
    current_liabilities = _find_named_value(bs_rows, ("total current liabilities",))
    total_assets = _find_named_value(bs_rows, ("total assets",))
    total_liabilities = _find_named_value(bs_rows, ("total liabilities",))
    owner_equity = _find_named_value(bs_rows, ("total equity", "owners equity", "owner's equity"))

    if not owner_equity and total_assets:
        owner_equity = total_assets - total_liabilities

    return {
        "cashOnHand": round(cash_on_hand),
        "currentRatio": round(current_assets / current_liabilities, 2) if current_liabilities else 0,
        "debtToAssets": round(total_liabilities / total_assets, 2) if total_assets else 0,
        "debtToEquity": round(total_liabilities / owner_equity, 2) if owner_equity else 0,
        "month": _month_label(year, month),
        "monthNumber": str(month),
        "monthKey": _month_key(year, month),
        "netIncome": round(net_income),
        "ownerEquity": round(owner_equity),
        "quarter": str(((month - 1) // 3) + 1),
        "returnOnAssets": round(net_income / total_assets, 3) if total_assets else 0,
        "sales": round(sales),
        "year": str(year),
    }


async def _get_access_token(client: httpx.AsyncClient, config: dict[str, str]) -> str:
    credentials = f"{config['client_id']}:{config['client_secret']}".encode("utf-8")
    encoded_credentials = base64.b64encode(credentials).decode("ascii")
    response = await client.post(
        "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
        data={
            "grant_type": "refresh_token",
            "refresh_token": config["refresh_token"],
        },
        headers={
            "Accept": "application/json",
            "Authorization": f"Basic {encoded_credentials}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    response.raise_for_status()
    return response.json()["access_token"]


async def _fetch_report(
    client: httpx.AsyncClient,
    config: dict[str, str],
    access_token: str,
    report_name: str,
    params: dict[str, str],
) -> dict[str, Any]:
    for attempt in range(MAX_REPORT_RETRIES + 1):
        response = await client.get(
            f"{config['base_url']}/v3/company/{config['realm_id']}/reports/{report_name}",
            headers={
                "Accept": "application/json",
                "Authorization": f"Bearer {access_token}",
            },
            params={
                "minorversion": config["minor_version"],
                **params,
            },
        )

        if response.status_code != 429 or attempt >= MAX_REPORT_RETRIES:
            response.raise_for_status()
            return response.json()

        retry_after = response.headers.get("Retry-After")
        delay = float(retry_after) if retry_after else 1.5 * (attempt + 1)
        await asyncio.sleep(delay)

    raise RuntimeError("Unable to fetch QuickBooks report")


def _iter_months(start_year: int) -> list[tuple[int, int]]:
    today = date.today()
    months = []
    for year in range(start_year, today.year + 1):
        final_month = today.month if year == today.year else 12
        for month in range(1, final_month + 1):
            months.append((year, month))
    return months


async def _load_live_financials() -> dict[str, Any]:
    config = _get_config()
    try:
        start_year = int(config["start_year"])
    except ValueError as exc:
        raise QuickBooksConfigurationError("QUICKBOOKS_FINANCIALS_START_YEAR must be a year like 2021") from exc

    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT_SECONDS, follow_redirects=True) as client:
        access_token = await _get_access_token(client, config)
        semaphore = asyncio.Semaphore(MAX_CONCURRENT_REPORT_MONTHS)
        rows = await asyncio.gather(
            *[
                _load_month_row(client, config, access_token, semaphore, year, month)
                for year, month in _iter_months(start_year)
            ]
        )

    return {
        "cache_ttl_seconds": CACHE_TTL_SECONDS,
        "rows": rows,
        "source": "QuickBooks Online sandbox",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


async def _load_month_row(
    client: httpx.AsyncClient,
    config: dict[str, str],
    access_token: str,
    semaphore: asyncio.Semaphore,
    year: int,
    month: int,
) -> dict[str, Any]:
    async with semaphore:
        start_date, end_date = _month_date_range(year, month)
        profit_loss, balance_sheet = await _gather_reports(
            client,
            config,
            access_token,
            start_date,
            end_date,
        )
        return _build_month_row(year, month, profit_loss, balance_sheet)


async def _gather_reports(
    client: httpx.AsyncClient,
    config: dict[str, str],
    access_token: str,
    start_date: str,
    end_date: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    return await asyncio.gather(
        _fetch_report(
            client,
            config,
            access_token,
            "ProfitAndLoss",
            {"start_date": start_date, "end_date": end_date, "accounting_method": "Accrual"},
        ),
        _fetch_report(
            client,
            config,
            access_token,
            "BalanceSheet",
            {"start_date": start_date, "end_date": end_date, "accounting_method": "Accrual"},
        ),
    )


async def get_company_financials(force_refresh: bool = False) -> dict[str, Any]:
    loaded_at = _cache["loaded_at"]
    if (
        not force_refresh
        and _cache["data"]
        and loaded_at
        and (datetime.now(timezone.utc) - loaded_at).total_seconds() < CACHE_TTL_SECONDS
    ):
        return _cache["data"]

    data = await _load_live_financials()
    _cache["loaded_at"] = datetime.now(timezone.utc)
    _cache["data"] = data
    return data
