import asyncio
import base64
import os
import secrets
from urllib.parse import urlencode
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv

from ..database import get_database_connection


CACHE_TTL_SECONDS = 60 * 15
DEFAULT_TIMEOUT_SECONDS = 12
DEFAULT_MINOR_VERSION = "75"
DEFAULT_START_YEAR = 2021
MAX_CONCURRENT_REPORT_MONTHS = 2
MAX_REPORT_RETRIES = 3
OAUTH_STATE_TTL_SECONDS = 10 * 60
DEFAULT_FRONTEND_BASE_URL = "https://camoin360.com"
DEFAULT_ORGANIZATION_KEY = "camoin360"
AUTHORIZATION_ENDPOINT = "https://appcenter.intuit.com/connect/oauth2"
TOKEN_ENDPOINT = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer"
REVOCATION_ENDPOINT = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke"
BACKEND_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = BACKEND_ROOT.parent

load_dotenv(REPO_ROOT / ".env")
load_dotenv(BACKEND_ROOT / ".env")

_cache: dict[str, Any] = {
    "financials_by_organization": {},
}


class QuickBooksConfigurationError(RuntimeError):
    pass


class QuickBooksOAuthStateError(RuntimeError):
    pass


class QuickBooksConnectionRequiredError(RuntimeError):
    pass


def _get_setting(*names: str) -> str | None:
    for name in names:
        value = os.getenv(name)
        if value:
            return value.strip()
    return None


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def _format_datetime(value: datetime | None) -> str | None:
    return value.astimezone(timezone.utc).isoformat() if value else None


def _get_organization_key() -> str:
    return _get_setting("CAMOIN360_ORGANIZATION_KEY", "QUICKBOOKS_ORGANIZATION_KEY") or DEFAULT_ORGANIZATION_KEY


def get_user_organization_id(user: dict[str, Any] | None = None) -> int:
    value = (user or {}).get("organization_id") or _get_setting("CAMOIN360_ORGANIZATION_ID", "QUICKBOOKS_ORGANIZATION_ID") or "1"
    return int(value)


def _get_frontend_base_url() -> str:
    return (_get_setting("FRONTEND_BASE_URL", "CAMOIN360_FRONTEND_URL") or DEFAULT_FRONTEND_BASE_URL).rstrip("/")


def _get_oauth_config(require_redirect_uri: bool = False) -> dict[str, str]:
    client_id = _get_setting("QUICKBOOKS_CLIENT_ID", "QB_CLIENT_ID", "INTUIT_CLIENT_ID")
    client_secret = _get_setting("QUICKBOOKS_CLIENT_SECRET", "QB_CLIENT_SECRET", "INTUIT_CLIENT_SECRET")
    redirect_uri = _get_setting("QUICKBOOKS_REDIRECT_URI", "QB_REDIRECT_URI", "INTUIT_REDIRECT_URI")
    environment = (_get_setting("QUICKBOOKS_ENVIRONMENT", "QB_ENVIRONMENT", "INTUIT_ENVIRONMENT") or "sandbox").lower()

    missing = [
        label
        for label, value in {
            "QUICKBOOKS_CLIENT_ID": client_id,
            "QUICKBOOKS_CLIENT_SECRET": client_secret,
            "QUICKBOOKS_REDIRECT_URI": redirect_uri if require_redirect_uri else "not-required",
        }.items()
        if not value
    ]
    if missing:
        raise QuickBooksConfigurationError("Missing QuickBooks OAuth configuration: " + ", ".join(missing))

    return {
        "client_id": client_id,
        "client_secret": client_secret,
        "environment": environment,
        "redirect_uri": redirect_uri or "",
    }


def _get_database_report_config(organization_id: int) -> dict[str, str] | None:
    minor_version = _get_setting("QUICKBOOKS_MINOR_VERSION", "QB_MINOR_VERSION", "INTUIT_MINOR_VERSION") or DEFAULT_MINOR_VERSION
    start_year = _get_setting("QUICKBOOKS_FINANCIALS_START_YEAR", "QB_FINANCIALS_START_YEAR") or str(DEFAULT_START_YEAR)

    try:
        with get_database_connection() as connection:
            row = connection.execute(
                """
                SELECT organization_id, organization_key, realm_id, environment, access_token, refresh_token, access_token_expires_at
                FROM quickbooks_connections
                WHERE organization_id = ? AND status = 'connected'
                """,
                (organization_id,),
            ).fetchone()
    except RuntimeError:
        return None

    if not row or not row.get("refresh_token"):
        return None

    oauth_config = _get_oauth_config(require_redirect_uri=False)
    return {
        "access_token": row.get("access_token") or "",
        "access_token_expires_at": row.get("access_token_expires_at") or "",
        "base_url": _get_quickbooks_base_url(row.get("environment") or oauth_config["environment"]),
        "client_id": oauth_config["client_id"],
        "client_secret": oauth_config["client_secret"],
        "environment": row.get("environment") or oauth_config["environment"],
        "minor_version": minor_version,
        "organization_id": row["organization_id"],
        "organization_key": row["organization_key"],
        "realm_id": row["realm_id"],
        "refresh_token": row["refresh_token"],
        "start_year": start_year,
        "token_source": "database",
    }


def _get_env_report_config() -> dict[str, str]:
    oauth_config = _get_oauth_config(require_redirect_uri=False)
    refresh_token = _get_setting("QUICKBOOKS_REFRESH_TOKEN", "QB_REFRESH_TOKEN", "INTUIT_REFRESH_TOKEN")
    realm_id = _get_setting("QUICKBOOKS_REALM_ID", "QB_REALM_ID", "INTUIT_REALM_ID", "QUICKBOOKS_COMPANY_ID")
    environment = oauth_config["environment"]
    minor_version = _get_setting("QUICKBOOKS_MINOR_VERSION", "QB_MINOR_VERSION", "INTUIT_MINOR_VERSION") or DEFAULT_MINOR_VERSION
    start_year = _get_setting("QUICKBOOKS_FINANCIALS_START_YEAR", "QB_FINANCIALS_START_YEAR") or str(DEFAULT_START_YEAR)

    missing = [
        label
        for label, value in {
            "QUICKBOOKS_CLIENT_ID": oauth_config["client_id"],
            "QUICKBOOKS_CLIENT_SECRET": oauth_config["client_secret"],
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
        "client_id": oauth_config["client_id"],
        "client_secret": oauth_config["client_secret"],
        "environment": environment,
        "minor_version": minor_version,
        "realm_id": realm_id,
        "refresh_token": refresh_token,
        "start_year": start_year,
        "token_source": "environment",
    }


def _get_report_config(organization_id: int) -> dict[str, str]:
    database_config = _get_database_report_config(organization_id)
    if database_config:
        return database_config

    environment = (_get_setting("QUICKBOOKS_ENVIRONMENT", "QB_ENVIRONMENT", "INTUIT_ENVIRONMENT") or "sandbox").lower()
    if environment != "production" and _get_setting("QUICKBOOKS_REFRESH_TOKEN", "QB_REFRESH_TOKEN", "INTUIT_REFRESH_TOKEN"):
        return _get_env_report_config()

    if not os.getenv("DATABASE_URL"):
        raise QuickBooksConfigurationError("Missing QuickBooks sandbox configuration")

    raise QuickBooksConnectionRequiredError("QuickBooks Online is not connected for your organization.")


def _get_basic_auth_header(config: dict[str, str]) -> str:
    credentials = f"{config['client_id']}:{config['client_secret']}".encode("utf-8")
    encoded_credentials = base64.b64encode(credentials).decode("ascii")
    return f"Basic {encoded_credentials}"


def _get_quickbooks_base_url(environment: str) -> str:
    return "https://sandbox-quickbooks.api.intuit.com" if environment == "sandbox" else "https://quickbooks.api.intuit.com"


def _sanitize_connection(row: dict[str, Any] | None) -> dict[str, Any]:
    if not row:
        return {
            "connected": False,
            "status": "not_connected",
            "realm_id": None,
            "company_name": None,
            "environment": (_get_setting("QUICKBOOKS_ENVIRONMENT", "QB_ENVIRONMENT", "INTUIT_ENVIRONMENT") or "sandbox").lower(),
            "connected_at": None,
            "updated_at": None,
            "requires_reconnect": False,
        }

    if row.get("status") == "needs_reconnect":
        return {
            "connected": False,
            "status": "needs_reconnect",
            "realm_id": row.get("realm_id"),
            "company_name": row.get("company_name") or "",
            "environment": row.get("environment") or "sandbox",
            "connected_at": row.get("connected_at"),
            "updated_at": row.get("updated_at"),
            "requires_reconnect": True,
        }

    if row.get("status") != "connected":
        return {
            "connected": False,
            "status": "not_connected",
            "realm_id": None,
            "company_name": None,
            "environment": row.get("environment") or (_get_setting("QUICKBOOKS_ENVIRONMENT", "QB_ENVIRONMENT", "INTUIT_ENVIRONMENT") or "sandbox").lower(),
            "connected_at": None,
            "updated_at": row.get("updated_at"),
            "requires_reconnect": False,
        }

    refresh_expires_at = _parse_datetime(row.get("refresh_token_expires_at"))
    requires_reconnect = bool(refresh_expires_at and refresh_expires_at <= _utc_now())
    return {
        "connected": not requires_reconnect,
        "status": "needs_reconnect" if requires_reconnect else "connected",
        "realm_id": row.get("realm_id"),
        "company_name": row.get("company_name") or "",
        "environment": row.get("environment") or "sandbox",
        "connected_at": row.get("connected_at"),
        "updated_at": row.get("updated_at"),
        "requires_reconnect": requires_reconnect,
    }


def get_connection_status(organization_id: int) -> dict[str, Any]:
    with get_database_connection() as connection:
        row = connection.execute(
            """
            SELECT organization_id, realm_id, company_name, environment, status, connected_at, updated_at, refresh_token_expires_at
            FROM quickbooks_connections
            WHERE organization_id = ?
            """,
            (organization_id,),
        ).fetchone()

    return _sanitize_connection(row)


def create_oauth_state(user: dict[str, Any]) -> dict[str, str]:
    config = _get_oauth_config(require_redirect_uri=True)
    organization_key = _get_organization_key()
    organization_id = get_user_organization_id(user)
    state = secrets.token_urlsafe(32)
    expires_at = _utc_now().timestamp() + OAUTH_STATE_TTL_SECONDS
    user_email = str(user.get("email") or "").lower()

    if not user_email:
        raise QuickBooksOAuthStateError("Authenticated user email is required")

    with get_database_connection() as connection:
        connection.execute(
            "DELETE FROM quickbooks_oauth_states WHERE expires_at < CURRENT_TIMESTAMP OR consumed_at IS NOT NULL"
        )
        connection.execute(
            """
            INSERT INTO quickbooks_oauth_states (state, organization_key, organization_id, user_email, environment, expires_at)
            VALUES (?, ?, ?, ?, ?, to_timestamp(?))
            """,
            (state, organization_key, organization_id, user_email, config["environment"], expires_at),
        )

    return {
        "connect_url": f"/quickbooks/connect?state={state}",
        "state": state,
    }


def build_authorization_url(state: str) -> str:
    config = _get_oauth_config(require_redirect_uri=True)

    with get_database_connection() as connection:
        state_row = connection.execute(
            """
            SELECT state
            FROM quickbooks_oauth_states
            WHERE state = ? AND consumed_at IS NULL AND expires_at > CURRENT_TIMESTAMP
            """,
            (state,),
        ).fetchone()

    if not state_row:
        raise QuickBooksOAuthStateError("QuickBooks authorization state is invalid or expired")

    query = urlencode(
        {
            "client_id": config["client_id"],
            "response_type": "code",
            "scope": "com.intuit.quickbooks.accounting",
            "redirect_uri": config["redirect_uri"],
            "state": state,
        }
    )
    return f"{AUTHORIZATION_ENDPOINT}?{query}"


async def exchange_authorization_code(code: str, realm_id: str, state: str) -> dict[str, Any]:
    config = _get_oauth_config(require_redirect_uri=True)

    with get_database_connection() as connection:
        state_row = connection.execute(
            """
            SELECT organization_key, organization_id, user_email, environment
            FROM quickbooks_oauth_states
            WHERE state = ? AND consumed_at IS NULL AND expires_at > CURRENT_TIMESTAMP
            """,
            (state,),
        ).fetchone()

        if not state_row:
            raise QuickBooksOAuthStateError("QuickBooks authorization state is invalid or expired")

        connection.execute(
            "UPDATE quickbooks_oauth_states SET consumed_at = CURRENT_TIMESTAMP WHERE state = ?",
            (state,),
        )

    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT_SECONDS) as client:
        token_response = await client.post(
            TOKEN_ENDPOINT,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": config["redirect_uri"],
            },
            headers={
                "Accept": "application/json",
                "Authorization": _get_basic_auth_header(config),
                "Content-Type": "application/x-www-form-urlencoded",
            },
        )
        token_response.raise_for_status()
        token_payload = token_response.json()
        company_name = await _fetch_company_name(
            client,
            _get_quickbooks_base_url(state_row["environment"]),
            realm_id,
            token_payload["access_token"],
        )

    save_connection(state_row, realm_id, token_payload, company_name)
    return get_connection_status(state_row["organization_id"])


async def _fetch_company_name(client: httpx.AsyncClient, base_url: str, realm_id: str, access_token: str) -> str:
    response = await client.get(
        f"{base_url}/v3/company/{realm_id}/companyinfo/{realm_id}",
        headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {access_token}",
        },
        params={"minorversion": DEFAULT_MINOR_VERSION},
    )
    if response.status_code >= 400:
        return ""

    company_info = response.json().get("CompanyInfo") or {}
    return company_info.get("CompanyName") or company_info.get("LegalName") or ""


def save_connection(state_row: dict[str, Any], realm_id: str, token_payload: dict[str, Any], company_name: str):
    now = _utc_now()
    access_token_expires_at = now.timestamp() + int(token_payload.get("expires_in") or 3600)
    refresh_token_expires_at = now.timestamp() + int(token_payload.get("x_refresh_token_expires_in") or 0)
    with get_database_connection() as connection:
        connection.execute(
            """
            INSERT INTO quickbooks_connections (
                organization_key, organization_id, realm_id, company_name, environment, access_token, refresh_token,
                access_token_expires_at, refresh_token_expires_at, status, connected_at,
                connected_by_email, disconnected_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, to_timestamp(?), to_timestamp(?), 'connected', CURRENT_TIMESTAMP, ?, NULL, CURRENT_TIMESTAMP)
            ON CONFLICT (organization_id) DO UPDATE SET
                realm_id = EXCLUDED.realm_id,
                company_name = EXCLUDED.company_name,
                environment = EXCLUDED.environment,
                access_token = EXCLUDED.access_token,
                refresh_token = EXCLUDED.refresh_token,
                access_token_expires_at = EXCLUDED.access_token_expires_at,
                refresh_token_expires_at = EXCLUDED.refresh_token_expires_at,
                status = 'connected',
                connected_at = CURRENT_TIMESTAMP,
                connected_by_email = EXCLUDED.connected_by_email,
                disconnected_at = NULL,
                updated_at = CURRENT_TIMESTAMP
            """,
            (
                state_row["organization_key"],
                state_row["organization_id"],
                realm_id,
                company_name,
                state_row["environment"],
                token_payload["access_token"],
                token_payload["refresh_token"],
                access_token_expires_at,
                refresh_token_expires_at,
                state_row["user_email"],
            ),
        )


async def disconnect_quickbooks(organization_id: int) -> dict[str, Any]:
    token_to_revoke = None
    with get_database_connection() as connection:
        row = connection.execute(
            """
            SELECT refresh_token
            FROM quickbooks_connections
            WHERE organization_id = ? AND status = 'connected'
            """,
            (organization_id,),
        ).fetchone()
        token_to_revoke = row.get("refresh_token") if row else None

    revoke_error = False
    if token_to_revoke:
        try:
            await revoke_token(token_to_revoke)
        except httpx.HTTPError:
            revoke_error = True

    with get_database_connection() as connection:
        connection.execute(
            """
            UPDATE quickbooks_connections
            SET access_token = '',
                refresh_token = '',
                access_token_expires_at = NULL,
                refresh_token_expires_at = NULL,
                status = 'disconnected',
                disconnected_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE organization_id = ?
            """,
            (organization_id,),
        )

    status_payload = get_connection_status(organization_id)
    status_payload["revoke_error"] = revoke_error
    return status_payload


async def revoke_token(token: str):
    config = _get_oauth_config(require_redirect_uri=False)
    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT_SECONDS) as client:
        response = await client.post(
            REVOCATION_ENDPOINT,
            json={"token": token},
            headers={
                "Accept": "application/json",
                "Authorization": _get_basic_auth_header(config),
                "Content-Type": "application/json",
            },
        )
        response.raise_for_status()


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


def _build_sample_month_row(year: int, month: int) -> dict[str, Any]:
    month_index = month - 1
    sequence = (year - DEFAULT_START_YEAR) * 12 + month_index
    seasonal = 42000 * ((month_index % 4) - 1.5)
    sales = 740000 + sequence * 8200 + seasonal
    net_income = sales * (0.16 + ((month_index % 3) - 1) * 0.012)
    cash_on_hand = 980000 + sequence * 5600 + month_index * 17000
    owner_equity = 4100000 + sequence * 21000
    total_assets = 6200000 + sequence * 26000
    total_liabilities = total_assets - owner_equity

    return {
        "cashOnHand": round(cash_on_hand),
        "currentRatio": round(1.62 + (month_index % 5) * 0.04, 2),
        "debtToAssets": round(total_liabilities / total_assets, 2),
        "debtToEquity": round(total_liabilities / owner_equity, 2),
        "month": _month_label(year, month),
        "monthNumber": str(month),
        "monthKey": _month_key(year, month),
        "netIncome": round(net_income),
        "ownerEquity": round(owner_equity),
        "quarter": str(((month - 1) // 3) + 1),
        "returnOnAssets": round(net_income / total_assets, 3),
        "sales": round(sales),
        "year": str(year),
    }


def _load_sample_financials() -> dict[str, Any]:
    return {
        "cache_ttl_seconds": CACHE_TTL_SECONDS,
        "rows": [
            _build_sample_month_row(year, month)
            for year, month in _iter_months(DEFAULT_START_YEAR)
        ],
        "source": "Sample QuickBooks financials",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


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
    expires_at = _parse_datetime(config.get("access_token_expires_at"))
    if config.get("access_token") and expires_at and expires_at > _utc_now():
        return config["access_token"]

    try:
        response = await client.post(
            TOKEN_ENDPOINT,
            data={
                "grant_type": "refresh_token",
                "refresh_token": config["refresh_token"],
            },
            headers={
                "Accept": "application/json",
                "Authorization": _get_basic_auth_header(config),
                "Content-Type": "application/x-www-form-urlencoded",
            },
        )
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        if config.get("token_source") == "database" and exc.response.status_code in {400, 401}:
            _mark_connection_needs_reconnect(config["organization_id"])
            raise QuickBooksConnectionRequiredError("QuickBooks Online authorization needs to be renewed for your organization.") from exc
        raise
    token_payload = response.json()

    if config.get("token_source") == "database":
        now = _utc_now()
        access_token_expires_at = now.timestamp() + int(token_payload.get("expires_in") or 3600)
        refresh_token_expires_at = now.timestamp() + int(token_payload.get("x_refresh_token_expires_in") or 0)
        with get_database_connection() as connection:
            connection.execute(
                """
                UPDATE quickbooks_connections
                SET access_token = ?,
                    refresh_token = ?,
                    access_token_expires_at = to_timestamp(?),
                    refresh_token_expires_at = to_timestamp(?),
                    updated_at = CURRENT_TIMESTAMP
                WHERE organization_key = ?
                """,
                (
                    token_payload["access_token"],
                    token_payload.get("refresh_token") or config["refresh_token"],
                    access_token_expires_at,
                    refresh_token_expires_at,
                    config["organization_key"],
                ),
            )

    return token_payload["access_token"]


def _mark_connection_needs_reconnect(organization_id: int):
    with get_database_connection() as connection:
        connection.execute(
            """
            UPDATE quickbooks_connections
            SET access_token = '',
                access_token_expires_at = NULL,
                status = 'needs_reconnect',
                updated_at = CURRENT_TIMESTAMP
            WHERE organization_id = ?
            """,
            (organization_id,),
        )


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


async def _load_live_financials(organization_id: int) -> dict[str, Any]:
    config = _get_report_config(organization_id)
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
        "source": f"QuickBooks Online {config['environment']}",
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


async def get_company_financials(user: dict[str, Any] | None = None, force_refresh: bool = False) -> dict[str, Any]:
    organization_id = get_user_organization_id(user)
    organization_cache = _cache["financials_by_organization"].get(organization_id) or {}
    loaded_at = organization_cache.get("loaded_at")
    if (
        not force_refresh
        and organization_cache.get("data")
        and loaded_at
        and (datetime.now(timezone.utc) - loaded_at).total_seconds() < CACHE_TTL_SECONDS
    ):
        return organization_cache["data"]

    try:
        data = await _load_live_financials(organization_id)
    except QuickBooksConfigurationError:
        data = _load_sample_financials()

    _cache["financials_by_organization"][organization_id] = {
        "loaded_at": datetime.now(timezone.utc),
        "data": data,
    }
    return data
