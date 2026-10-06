# Dynamics Enrichment Service

This repo has a FastAPI backend and a React frontend for the Sophie Maintenance dashboard.

## Backend Files

- `backend/app/main.py` creates the FastAPI app, enables CORS for the React dev server, and registers route modules.
- `backend/app/routes/auth.py` owns authentication API routes:
  - `POST /auth/signup`
  - `POST /auth/login`
- `backend/app/routes/metrics.py` owns the dashboard metrics API:
  - `GET /metrics`
- `backend/app/routes/accounts.py` owns account enrichment/update routes.
- `backend/app/services/users.json` is the local development user store and is ignored by Git.

## Frontend Files

- `frontend/src/App.js` switches between login, signup, and dashboard views.
- `frontend/src/auth.js` calls the backend auth API and stores the auth token in `localStorage`.
- `frontend/src/login.js` renders the login form.
- `frontend/src/signup.js` renders the signup form.
- `frontend/src/components/MetricsDashboard.js` renders dashboard metrics and sends the auth token with metrics requests.
- `frontend/src/components/SoftwareInventory.js` renders the Software Inventory table, filters, forms, detail drawer, CSV export, and delete workflow.

The frontend does not need separate route files unless you want real browser URLs such as `/login`, `/signup`, and `/dashboard`. The current setup keeps page switching inside `App.js`.

## Local Development

Run the backend:

```bash
backend/.venv/bin/uvicorn backend.app.main:app --reload
```

Run the frontend:

```bash
cd frontend
npm start
```

By default, the frontend calls `http://localhost:8000`. To use a different backend URL, start the frontend with `REACT_APP_API_BASE_URL` set.

Signup requires a password with at least 8 characters.

## QuickBooks Company Financials

The management dashboard's Company Financials view reads QuickBooks Online sandbox reports through the authenticated backend endpoint:

```http
GET /company-financials
```

Set these values in the repo `.env` file to connect a sandbox company:

```bash
QUICKBOOKS_CLIENT_ID=
QUICKBOOKS_CLIENT_SECRET=
QUICKBOOKS_REFRESH_TOKEN=
QUICKBOOKS_REALM_ID=
QUICKBOOKS_ENVIRONMENT=sandbox
QUICKBOOKS_MINOR_VERSION=75
QUICKBOOKS_FINANCIALS_START_YEAR=2021
```

The service refreshes the OAuth access token, loads monthly ProfitAndLoss and BalanceSheet reports, and normalizes them into the existing chart fields for sales, net income, cash, liquidity, equity, leverage, and return on assets.

## Software Inventory

The Software Inventory feature tracks software and data subscriptions used by the management dashboard. The frontend calls the authenticated `/software-subscriptions` API and manages search, filtering, sorting, pagination, detail display, CSV export, and CRUD workflows.

### Fields

Required fields:

- `name`: Software or data subscription name. Used as the primary display label and default sort field.
- `category`: Functional category, such as `GIS / Mapping`, `Labor Market Data`, or `Design Tools`. Used for search, filtering, sorting, CSV export, and detail display.
- `department`: Department responsible for the subscription. Used for search, filtering, missing-info checks, CSV export, and detail display.
- `point_of_contact`: Internal owner for the subscription. Displayed as `Owner` in the UI.
- `billing_frequency`: Billing cadence. Typical values are `Monthly`, `Quarterly`, `Annual`, `One-Time`, or `Other`.
- `renewal_date`: Exact renewal date in `YYYY-MM-DD` format. Used for renewal-risk highlighting.
- `renewal_time_frame`: Human-readable renewal window, such as `Annual - July`. Used for filtering and fallback renewal sorting.
- `vendor_rep`: Vendor or vendor representative. Displayed as `Vendor` in the UI.
- `status`: Subscription status. Must be one of `Active`, `Pending Renewal`, `Needs Review`, or `Cancelled`.

Optional fields:

- `description`: Longer description of the subscription and how it is used.
- `assigned_users`: Users, teams, seats, or access notes.
- `cost_2024_2025`: Historical yearly cost for 2024-2025.
- `cost_2025_2026`: Historical yearly cost for 2025-2026.
- `cost_2026_2027`: Current annual cost. If users enter monthly cost in the UI, this field is annualized before saving.
- `subscribed_since`: Free-text subscription start year or date.
- `notes`: Operational notes, renewal context, vendor issues, or cleanup items.
- `created_at`: Server-managed created timestamp.
- `updated_at`: Server-managed last updated timestamp.

### Cost Calculations

The UI clearly separates `Monthly Billing Cost` from `Annual Billing Cost`.

- If a monthly cost is entered and annual cost is blank, the UI calculates the annualized cost as `monthly cost * 12` and saves that value as `cost_2026_2027`.
- If an annual cost is entered and monthly cost is blank, the current monthly cost displayed in the table is calculated as `annual cost / 12`.
- Users cannot submit both monthly and annual current cost fields at the same time.
- Cost fields must be valid numbers and cannot be negative.

### Renewal-Risk Rules

Renewal risk is calculated from `renewal_date` against the user's current date.

- `Expired`: renewal date is before today.
- `Renews <=30d`: renewal date is today or within 30 days.
- `Renews <=60d`: renewal date is within 31-60 days.
- `Renews <=90d`: renewal date is within 61-90 days.
- `On Track`: renewal date is more than 90 days away.
- `Missing Date`: no valid renewal date is available.

Rows are highlighted for expired, 30-day, 60-day, and 90-day renewal windows. The detail drawer also shows a renewal-risk chip.

### API Endpoints

All `/software-subscriptions` endpoints require the normal authenticated user dependency. Frontend requests include the auth headers from `frontend/src/auth.js`.

#### List subscriptions

```http
GET /software-subscriptions?limit=1000
```

`limit` is optional, defaults to `1000`, and must be between `1` and `5000`.

Example response:

```json
{
  "count": 1,
  "data": [
    {
      "id": 1,
      "name": "ArcGIS Online",
      "description": "Cloud mapping and spatial analysis platform used for project maps and data visualization.",
      "category": "GIS / Mapping",
      "department": "Operations",
      "point_of_contact": "Operations",
      "assigned_users": "Planning and analyst team",
      "cost_2024_2025": 2800,
      "cost_2025_2026": 3100,
      "cost_2026_2027": 3300,
      "billing_frequency": "Annual",
      "renewal_date": "2026-07-01",
      "renewal_time_frame": "Annual - July",
      "vendor_rep": "Esri Customer Success",
      "subscribed_since": "2018",
      "status": "Active",
      "notes": "Confirm named-user allocation before the next renewal.",
      "created_at": "2026-07-20 12:00:00",
      "updated_at": "2026-07-20 12:00:00"
    }
  ]
}
```

#### Create subscription

```http
POST /software-subscriptions
Content-Type: application/json
```

Example request:

```json
{
  "name": "Example Data Platform",
  "description": "Research dataset used for market analysis.",
  "category": "Market Data",
  "department": "Research",
  "point_of_contact": "Research Director",
  "assigned_users": "Research team",
  "cost_2024_2025": 1000,
  "cost_2025_2026": 1250,
  "cost_2026_2027": 1500,
  "billing_frequency": "Annual",
  "renewal_date": "2027-06-01",
  "renewal_time_frame": "Annual - June",
  "vendor_rep": "Vendor Account Manager",
  "subscribed_since": "2025",
  "status": "Active",
  "notes": "Review seat count before renewal."
}
```

Example response: `201 Created`

```json
{
  "id": 5,
  "name": "Example Data Platform",
  "description": "Research dataset used for market analysis.",
  "category": "Market Data",
  "department": "Research",
  "point_of_contact": "Research Director",
  "assigned_users": "Research team",
  "cost_2024_2025": 1000,
  "cost_2025_2026": 1250,
  "cost_2026_2027": 1500,
  "billing_frequency": "Annual",
  "renewal_date": "2027-06-01",
  "renewal_time_frame": "Annual - June",
  "vendor_rep": "Vendor Account Manager",
  "subscribed_since": "2025",
  "status": "Active",
  "notes": "Review seat count before renewal.",
  "created_at": "2026-07-20 12:00:00",
  "updated_at": "2026-07-20 12:00:00"
}
```

#### Get one subscription

```http
GET /software-subscriptions/{subscription_id}
```

Returns one subscription response object. Returns `404` when the subscription id does not exist.

#### Update part of a subscription

```http
PATCH /software-subscriptions/{subscription_id}
Content-Type: application/json
```

Example request:

```json
{
  "status": "Pending Renewal",
  "renewal_date": "2026-08-01",
  "notes": "New pricing requested from vendor."
}
```

Example response: `200 OK`

```json
{
  "id": 5,
  "name": "Example Data Platform",
  "description": "Research dataset used for market analysis.",
  "category": "Market Data",
  "department": "Research",
  "point_of_contact": "Research Director",
  "assigned_users": "Research team",
  "cost_2024_2025": 1000,
  "cost_2025_2026": 1250,
  "cost_2026_2027": 1500,
  "billing_frequency": "Annual",
  "renewal_date": "2026-08-01",
  "renewal_time_frame": "Annual - June",
  "vendor_rep": "Vendor Account Manager",
  "subscribed_since": "2025",
  "status": "Pending Renewal",
  "notes": "New pricing requested from vendor.",
  "created_at": "2026-07-20 12:00:00",
  "updated_at": "2026-07-20 12:15:00"
}
```

#### Replace a subscription

```http
PUT /software-subscriptions/{subscription_id}
Content-Type: application/json
```

Uses the same request body as create. Returns the full updated subscription object.

#### Delete a subscription

```http
DELETE /software-subscriptions/{subscription_id}
```

Returns `204 No Content` on success. Returns `404` when the subscription id does not exist.

### Manual QA Checklist

- Create: open Software Inventory, click `Add Subscription`, verify required-field errors show beside fields, create a valid subscription, and confirm it appears in the table without refresh.
- Read: open a row detail view and confirm name, vendor, category, department, owner, status, billing frequency, monthly cost, annualized cost, renewal date, notes, created timestamp, and updated timestamp are shown.
- Update: edit an existing subscription, change text, status, costs, billing frequency, and renewal date, save, and verify the table and detail drawer reflect the changes.
- Delete: delete a subscription, confirm the dialog names the record and warns the action cannot be undone, verify success feedback, and confirm the row disappears without refresh.
- Search: search by software name, vendor, category, department, and notes.
- Filtering: test status, category, department, billing frequency, renewal timeframe, and missing-info quick filters.
- Sorting: sort by software name, vendor, category, monthly cost, annual cost, renewal date, and status in both directions.
- Pagination: change page size, move between pages, and confirm active filters and sort order remain applied.
- CSV export: apply filters, click `Export CSV`, and confirm the file includes only filtered records with escaped commas, quotes, and multiline notes.
- Renewal highlighting: verify expired, within 30 days, within 60 days, within 90 days, missing date, and on-track records display the correct chip and row highlighting.
- Mobile layout: test the inventory page and detail drawer at a narrow viewport; confirm filters stack, text does not overlap, and actions remain usable.
- Desktop layout: test at a wide viewport; confirm table scrolling, sticky header, pagination, CSV export, detail drawer, and dialogs behave correctly.

## Power Automate account enrichment

Configure a Power Automate flow with a Dataverse **When a row is added** trigger for
Accounts, followed by an HTTP action:

```text
Method: POST
URL: https://<backend-url>/accounts/enrich-one/{accountid}
Headers:
  x-api-key: <POWER_AUTOMATE_API_KEY>
  Content-Type: application/json
Body: empty
```

The endpoint reads the Account, skips it when `cr73c_enrichmentattempted` is already
true, and otherwise fills only blank fields before marking the attempt complete. It
returns JSON containing `status`, `fields_updated`, and `skipped_reason`.

Set these backend environment variables: `TENANT_ID`, `CLIENT_ID`, `CLIENT_SECRET`,
`DYNAMICS_SCOPE`, `DYNAMICS_API_URL`, and `SEAMLESS_API_KEY`. Set
`POWER_AUTOMATE_API_KEY` for machine access using the `x-api-key` header. Machine
access is rejected when this variable is unset or empty. This authentication applies
only to `POST /accounts/enrich-one/{accountid}`; other Account endpoints still require
user authentication. Authenticated users with Sophie Maintenance access can also
call this endpoint with their normal Bearer token. If an Authorization header is
supplied, it must pass the normal user-token and module checks.

The backend endpoint is prepared for a future flow; no automatic Account
enrichment flow is included in this repository. `enrich_one_account()` treats the
attempt flag as a completed provider attempt, with missing company name as an
explicit non-retryable exception. Infrastructure failures remain eligible for
resubmission:

| Outcome | Sets `cr73c_enrichmentattempted` to true? |
| --- | --- |
| Account retrieval fails | No |
| Already attempted | No new write; existing flag remains true |
| Account has no name | Yes, if the metadata PATCH succeeds |
| `SEAMLESS_API_KEY` missing | No; returns failed |
| Weekly credit limit reached | No |
| Credit-budget check raises | No; returns failed without calling Seamless |
| Seamless lookup raises | No; returns failed |
| Post-lookup usage or response-balance recording raises | Logged; provider outcome continues unchanged |
| No matching company | Yes, if the metadata PATCH succeeds |
| Matching company, no blank fields to fill | Yes, if the metadata PATCH succeeds |
| Matching company, blank fields updated | Yes, in the same PATCH as field updates |
| Final Dynamics PATCH fails | No confirmed write; a transport failure may have an uncertain outcome |

Completed attempts require a confirmed Dynamics PATCH including both
`cr73c_enrichmentattempted` and `cr73c_enrichmentlastattemptedon` in UTC, alongside
any field updates. Both fields exist in the deployed Account table. A Dynamics
400 is no longer retried without the timestamp; any write failure returns failed.

Local usage and credit-balance JSON writes are best-effort operational telemetry;
failure after a provider response does not invalidate enrichment. A failed
preflight credit-budget check stops enrichment conservatively, because the
backend cannot establish whether another request is within the limit. The
automatic path does not write the separate `metrics_tracker.json` update history.

### Durable automatic enrichment history

Accepted `POST /accounts/enrich-one/{accountid}` requests now write a separate
PostgreSQL `account_enrichment_history` row before Account/provider processing.
The existing idempotent database initializer creates this additive table and its
Account, completion, open-attempt, and Account-created-on indexes. Rejected
authentication requests do not create receipts. No new migration framework is
required.

Each UUID identifies one request, including duplicate deliveries. The row records
Account identity/name/`createdon` when known; UTC received, started, and completed
timestamps; the exact backend status; a structured reason and sanitized failure
category/message; Seamless search activity; confirmed updated logical fields;
and an explicit `completion_uncertain` flag for Dynamics transport failures.
Account IDs remain text to preserve the endpoint's existing accepted input
contract. `status` and `completed_at` are null until there is a terminal outcome.

Provider telemetry counts actual HTTP search attempts, including the existing
name-only fallback (one or two searches), and is checkpointed after each search
settles. It does not change invocation-level credit accounting. A
`no_updates_needed` result with zero searches is an unpaid preflight decision;
the same result with searches means a paid lookup added no fields. Duplicate
`skipped_already_attempted` rows never replace earlier attempts and must be
excluded when selecting an Account's meaningful outcome for future Home metrics.
Fields are recorded only after Dynamics confirms its PATCH, never merely because
the provider supplied them. No field values, raw responses, credentials,
authentication headers, exception strings, or stack traces are stored.

History writes are best effort, use worker threads and bounded database connection,
statement, and lock waits, and log only a fixed tracking-gap warning on failure.
They do not retry enrichment, call Seamless again, change the HTTP response, or
disable enrichment if history persistence fails. A later checkpoint/completion
can insert the same request row if receipt persistence failed. A failed final
write can leave an open row even after successful enrichment.

Cancellation preserves an open attempt rather than inventing a terminal result.
A hard process exit can lose the latest telemetry or completion checkpoint;
open-attempt counters are therefore partial observations, not proof that the
provider was never called. PostgreSQL and Dynamics/provider operations are not
one transaction: a lost Dynamics PATCH response remains unconfirmed even if the
write committed. The history does not infer success from the Dynamics attempted
flag or reconstruct older outcomes. Home must represent such tracking gaps and
uncertainty explicitly. The history step adds no Home UI, count aggregation, retry
scheduler, or Power Automate changes.

The future flow must inspect the returned `status`: enrichment failures currently
return HTTP 200 with `status: failed`. No retry scheduling or queue is provided.
If Dynamics commits a PATCH but its response is lost, the backend returns failed
because completion was not confirmed. A later request rereads the Account and
skips it if the attempt flag is already true. Concurrent requests can still both
pass the initial flag check, and read-then-write updates can race with human edits.
Use a small, sequential controlled test before broader automation.

For a local call:

```bash
curl -X POST "http://localhost:8000/accounts/enrich-one/<accountid>" \
  -H "x-api-key: $POWER_AUTOMATE_API_KEY" \
  -H "Content-Type: application/json"
```

## Sophie Maintenance Account observation and counts (Home Step 2)

`maintenance_observations.py` supplies reusable refresh services and PostgreSQL-only
snapshot readers. It does not add the Home frontend, `/maintenance/home`, a
scheduler, Power Automate changes, enrichment calls, or Dynamics writes.

The existing additive database initializer creates:

- `maintenance_account_observations`: Account ID/name/UTC creation time, observed
  attempt flag/last-attempt time, and UTC first/last observation times. Indexed by
  creation, observation, and attempt state. This is a bounded operational set,
  not an Account mirror.
- `maintenance_total_account_snapshot`: last valid total, fetched time, and source.
- `maintenance_account_creation_counts`: reporting date, exact UTC count interval,
  last valid count/fetched time, and whether the reporting day is complete.
- `maintenance_sync_state`: independent discovery/total/count refresh status,
  tracking start, coverage start, watermark, in-progress interval/paging cursor,
  request/row counts, successful refresh time, and sanitized errors.

### Invocation and freshness

In a configured backend worker or an explicitly invoked maintenance job:

```python
from backend.app.services.maintenance_observations import refresh_maintenance_observations

# Async caller; required DATABASE_URL and Dynamics OAuth environment must be configured.
result = await refresh_maintenance_observations()
```

Individual async services are `refresh_account_discovery`,
`refresh_total_account_count`, and `refresh_account_creation_counts`. Synchronous
`read_count_snapshots` and `read_recent_account_observations` read only PostgreSQL;
an async API can run them in a worker thread. Never invoke the refresh orchestrator
from a browser request. The existing OAuth token cache is reused. PostgreSQL
snapshots, due checks, and session advisory locks coordinate refreshes across
workers; no process-local cache is treated as authoritative.

Recommended future invocation: discovery every 1–2 minutes, today's count every
2–5 minutes, and total count hourly. Defaults skip successful discovery for 120
seconds, refresh today's count after 180 seconds, and refresh the total after
3600 seconds. Completed reporting days are persisted and reused. Counts default
to 14 days and support up to 30; a day first captured while open is finalized on
the next day's refresh. The week count sums Monday through today's cached daily
counts, avoiding another Dynamics request. Missing/incomplete prerequisite days
produce an unknown week total, never a fabricated zero.

### Discovery and coverage

Discovery selects only `accountid`, `name`, `createdon`,
`cr73c_enrichmentattempted`, and `cr73c_enrichmentlastattemptedon`. Every query has
an explicit half-open creation-time filter and deterministic
`createdon asc,accountid asc` ordering. Pagination uses `odata.maxpagesize`, not
`$top`/`$skip`, and follows the server cursor unchanged with the same page size.
Continuation URLs must match the configured Dynamics origin, Account path,
selected fields, ordering, and fixed interval; credentials and unbounded or
foreign continuation queries are rejected. Only the validated paging cursor is
persisted, not headers or HTTP response bodies; snapshot readers omit it.

First discovery establishes `tracking_started_at` and bootstraps the last 14 New
York calendar days, including today. Defaults allow 10 pages of 500 rows per
refresh. Each page's upserts and resume cursor commit together. Only completing
the fixed interval advances the watermark; partial budgets and failures preserve
confirmed coverage and report `coverage_complete=false`. Subsequent invocations
resume unfinished intervals, then catch up if budget remains. Completed intervals
overlap the preceding watermark by five minutes. A restarted worker can resume
without replaying the entire bootstrap.

Observations are retained for 30 days and capped at 50,000 rows by default. Hitting
the cap pauses progress with an explicit incomplete state; it does not silently
discard Accounts from the interval being covered. A backlog older than retention
reports `discovery_retention_gap` without jumping the watermark. An operator must
then choose a larger bounded retention/cap or explicitly establish a new tracking
baseline and acknowledge the gap. Bootstrap coverage is not historical enrichment
coverage. Attempt metadata reflects its last observation and is not continuously
resynchronized outside discovery overlap. Backdated imports or Accounts becoming
visible beyond the overlap can require an explicit bounded reconciliation; this
is not an audit/change-tracking feed.

### Count queries and reporting boundaries

Total count uses `RetrieveTotalRecordCount` for logical table `account`, never
`$count=true` or Account enumeration. This is the Dataverse snapshot (potentially
up to 24 hours old when fetched), not an instantaneous live total. The snapshot
reader returns fetched time, source, and refresh staleness separately.

Creation counts use per-day FetchXML `count(accountid)` aggregates with explicit
`createdon >= start` and `createdon < end` filters. New York local midnights are
converted independently to UTC, handling 23/25-hour DST days and Monday-start
weeks. Today's interval ends at the refresh reference time; completed days use
their full reporting-day boundaries. No raw-datetime grouping is used.

Dataverse aggregate-limit errors split the interval into nonoverlapping halves.
There is a shared 64-request budget per creation-count refresh. Only a completely
counted day replaces its snapshot; partial sums are never stored. If splitting
cannot resolve a bulk import concentrated into a one-second interval, coverage
remains incomplete and the old valid snapshot remains. No fallback downloads
Account rows. Historical counts describe rows available in Dynamics when sampled;
they cannot reconstruct previously deleted Accounts. Persisted complete-day
counts are snapshots, not a live deletion-adjusted series; `force=True` supports
an explicit bounded reconciliation.

### Receipt presence, failures, and configuration

The observation reader joins `account_enrichment_history` by Account ID for
receipt presence. It returns facts, not final enrichment display statuses. An
overdue-no-request flag requires fresh complete discovery coverage, creation
after forward tracking began, and no recorded receipt after the grace period.
The grace clock uses the later of creation or first observation, avoiding
immediate alarms for late discovery. Default grace is 300 seconds. Historical
bootstrap Accounts and stale/incomplete coverage are not declared missed delivery.
No observed receipt is not an enrichment failure, and Step 1 history-write gaps
still remain possible.

All configuration uses `MAINTENANCE_<SETTING>` environment variables, validated
within bounds. Available settings are `BOOTSTRAP_DAYS`, `RETENTION_DAYS`,
`MAX_OBSERVATIONS`, `PAGE_SIZE`, `MAX_DISCOVERY_PAGES`, `OVERLAP_SECONDS`,
`DISCOVERY_SECONDS`, `PENDING_GRACE_SECONDS`, `TODAY_SECONDS`, `TOTAL_SECONDS`, and
`MAX_COUNT_REQUESTS`. Retention must cover the bootstrap window. Refreshes bound
Dynamics requests, use 20-second HTTP timeouts, and bound PostgreSQL connection,
statement, and lock waits. PostgreSQL operations run in worker threads.

Dynamics failure preserves valid snapshots and stores only sanitized error codes.
Missing snapshots stay unknown; successful zero counts remain distinguishable.
PostgreSQL failure stops refresh safely. Cancellation and clock regression do not
advance unconfirmed discovery coverage. No API keys, bearer tokens, unnecessary
Account fields, Seamless data, or raw responses are stored or logged by these
services. Home Step 3 must expose freshness, tracking gaps, and incomplete coverage.
Scheduling, production query validation, final status mapping, and the Home API/UI
remain future work.

## Sophie Maintenance Home API (Home Step 3)

`GET /maintenance/home` requires the existing user Bearer authentication and
`main` module access (including existing administrator access). Power Automate
`x-api-key` authentication does not authorize this route. All `/maintenance`
paths are covered by the existing module middleware, and the router also has a
`require_module("main")` dependency.

Query parameters:

- `days`: 7–30, default 14; controls the daily chart range.
- `view`: `recent` (default) or `attention`.
- `limit`: 1–100, default 25.
- `cursor`: opaque, bounded continuation token returned as `next_cursor`.

The response consists of:

- `reporting`: timezone, Monday week start, tracking/coverage start timestamps,
  and whether discovery coverage is complete and fresh.
- `metrics.total_dynamics_accounts`: value (nullable), source, fetched timestamp,
  source-age caveat (24 hours at fetch), and staleness. No valid snapshot means
  unknown, never an invented zero.
- `metrics.new_accounts_today` / `new_accounts_this_week`: nullable cached counts.
- `metrics.enrichment_success_rate`: nullable percentage, successful and known
  terminal unique Account counts, observed Account count, `this_week` period,
  `observed_new_accounts` scope, and coverage flag.
- `account_creation_by_day`: every requested local reporting date with nullable
  count, completeness/staleness flags, and fetched timestamp. Today's count is
  known through its snapshot cutoff even though the day is not complete. An
  incomplete historical day returns null. A confirmed zero remains zero.
- `recent_accounts`: Account ID/name/creation timestamp, display status and label,
  underlying meaningful backend status, provider-call facts, confirmed logical
  fields and friendly labels, fixed result summary, and attention boolean.
  Provider-call facts are null when no meaningful history exists.
- `next_cursor`: next page token or null.
- `freshness`: generation time, 45-second cache TTL, total snapshot age,
  discovery refresh times/watermark/lag/coverage, count refresh times/staleness,
  and best-effort history tracking limitations.
- `warnings`: fixed readable notices about missing/stale counts, incomplete
  observation coverage, partial-week tracking, dependency on a separate worker,
  and possible enrichment-history persistence gaps. Raw errors and paging
  cookies are not returned.

### One authoritative evidence mapping

The PostgreSQL status expression is shared by table rows, attention filtering,
and success-rate aggregation:

| Persisted evidence | Display status | Attention |
| --- | --- | --- |
| `updated` | Enriched | No |
| `no_updates_needed`, no provider call | No paid enrichment needed | No |
| `no_updates_needed`, provider called | Completed — no fields added | No |
| `no_match`, provider called | No usable match | Yes |
| `no_match`, `missing_company_name` reason | Needs attention — missing company name | Yes |
| `failed` | Failed | Yes |
| `failed`, completion uncertain | Failed — update unconfirmed | Yes |
| `skipped_credit_limit` | Credit limit | Yes |
| Open meaningful attempt | Processing | No |
| Open attempt past configured processing grace | Processing — delayed | Yes |
| No receipt, within creation/first-observation grace | Pending | No |
| No receipt past grace, eligible fresh forward coverage | Needs attention — no Sophie request observed | Yes |
| Duplicate-only, unsupported outcome, or insufficient older coverage | History unavailable | No |

The latest non-duplicate attempt is selected by receipt timestamp, then durable
ID. A newer open meaningful attempt supersedes an earlier completed one.
`skipped_already_attempted` never hides a meaningful result. The Dynamics
attempted flag is never used to infer success. No derived statuses are written.
Missing requests are delivery observations, not enrichment failures. Processing
is delayed after 900 seconds by default, configurable via
`MAINTENANCE_PROCESSING_GRACE_SECONDS` (60–86400). No-receipt grace uses Step 2's
`MAINTENANCE_PENDING_GRACE_SECONDS`, measured from the later of creation and
first observation. Attention requires no Alert Center or new alert persistence.

This week's success numerator includes Enriched and No paid enrichment needed.
The denominator includes all known meaningful terminal outcomes, including paid
lookups adding no fields, no usable match, missing name, failures, and credit
limits. Paid lookups adding no fields are **not successes**: they completed but
did not deliver missing data. Pending, processing (including delayed), missing
requests, and unavailable/duplicate-only history are excluded. Each observed
Account contributes once. A zero denominator returns null. These are outcomes
for observed new Accounts, not a promise of complete historical enrichment
coverage. Coverage is false if discovery is stale/incomplete or tracking began
after the reporting week started, or the retained observation window does not
cover the week.

Only persisted confirmed fields from successful updates are displayed:
Website, Phone, Description, Employees, City, State, Country, Postal Code, and
NAICS. No raw provider data or stored error messages are returned.

### Pagination, caching, errors, and scheduling

The table is a bounded PostgreSQL query over Step 2's retained observations,
with indexed lateral history lookups and server-side attention filtering.
Ordering is creation timestamp descending, then Account ID descending. Cursor
pagination preserves a creation/first-observation upper boundary and a last-row
key; newly discovered Accounts do not shift later pages. Tokens are scoped to
the chart range and view and expire after 24 hours. Outcomes remain live between
pages, so Accounts entering/leaving the attention view can change membership;
pagination is not a frozen history export.

The standard 25-row first page is cached for 45 seconds using `AsyncStaleCache`
with no additional stale-serving period (48 possible range/view combinations).
A cheap PostgreSQL refresh-version read invalidates old cached responses across
web processes when the separate worker commits new refresh state/snapshots.
Other page sizes and continuation pages read PostgreSQL directly. Completion
becomes visible on expiry without changing enrichment or rerunning aggregates;
cache expiration also works across processes. Authorization executes before
cache access. Browser responses use `Cache-Control: private, no-store`.
Invalid cursors return a fixed 400, invalid query bounds return 422, and
PostgreSQL/configuration failures return a fixed sanitized 503 and safe log.

Home never calls Dynamics, Seamless, or a refresh service and never writes to
Dynamics or enrichment history. Snapshot refreshes and observation discovery
remain Step 2 responsibilities. Home does not start a scheduler or a Dynamics
refresh. The separate Step 4 worker below supplies production refreshes; it must
be deployed independently. The Home frontend/navigation are implemented in Step 5 below; durable
history-write gap detection remains a future capability.

## Sophie Maintenance production refresh worker (Home Step 4)

### Deployment evidence and process separation

The repository documents the local Uvicorn target `backend.app.main:app`. The
web module initializes PostgreSQL at import and starts the existing newsletter
scheduler in FastAPI's lifespan. Newsletter also has an independent module/Render
Cron Job command rooted at `backend`. There is no committed Render Blueprint,
Procfile, Dockerfile, production web start command, or prior maintenance worker.
The live web service's exact startup settings must be checked in Render; they
cannot be established from this checkout. The normal module target from a
`backend` root would be `uvicorn app.main:app --host 0.0.0.0 --port $PORT`; from
a repository root it would be `uvicorn backend.app.main:app --host 0.0.0.0 --port $PORT`.
No web startup/lifespan or newsletter scheduling behavior was changed by Step 4.

The maintenance worker is an independent Python process with no HTTP server,
FastAPI import, newsletter scheduler, enrichment invocation, or Seamless import.
It loads the existing dotenv locations before database/auth configuration,
initializes the additive PostgreSQL schema with bounded connection/statement/
lock waits, and calls the existing Step 2 services.

Repository-root commands:

```sh
python -m backend.app.workers.maintenance_refresh
python -m backend.app.workers.maintenance_refresh --once
```

From the `backend` directory (recommended Render Root Directory):

```sh
python -m app.workers.maintenance_refresh
python -m app.workers.maintenance_refresh --once
```

`--once` runs one bounded **due** cycle without forcing refreshes or bypassing
locks/page/request budgets. It exits 0 for successful/no-due work or another
worker owning the cycle, 1 for incomplete/failed work, and 2 for invalid settings.
A lock skip is not proof of complete coverage: validate the saved/API state.
Repeated bounded invocations can resume a large bootstrap, but do not use a
tight shell retry loop. No production refresh was executed during development.

### Configuration and refresh cadence

Use the backend's existing `DATABASE_URL` and Dynamics application credentials:
`TENANT_ID`, `CLIENT_ID`, `CLIENT_SECRET`, `DYNAMICS_SCOPE`, `DYNAMICS_API_URL`.
Existing OAuth aliases (`Tenant_ID`, `Application_ID`, `Client_Secret`) remain
supported. The application user needs Account read access and permission to use
the existing count mechanisms. No `SEAMLESS_API_KEY`, Power Automate API key,
user-login secret, frontend setting, or queue/Redis service is needed.

| Setting | Default | Worker validation / purpose |
| --- | --- | --- |
| `MAINTENANCE_REFRESH_INTERVAL_SECONDS` | 60 | 60–300; wait after each cycle, including failures |
| `MAINTENANCE_DISCOVERY_SECONDS` | 120 | Existing Step 2 setting; worker requires at least 60 |
| `MAINTENANCE_TODAY_SECONDS` | 180 | Existing Step 2 setting; worker requires at least 120 |
| `MAINTENANCE_TOTAL_SECONDS` | 3600 | Existing Step 2 setting; worker requires at least 1800 |
| `MAINTENANCE_RECONCILE_SECONDS` | 21600 | 3600–604800; recent completed-day reconciliation |

Step 2's upper bounds and all existing window/page/request/row-cap settings
continue to apply. Invalid values fail startup with a fixed sanitized log and
exit 2; they are never silently interpreted as an aggressive cadence. A longer
base wait rounds refreshes up to the next cycle; the 60-second default matches
the default service cadence targets. Cycle time can add delay. Reporting timezone
is fixed `America/New_York`, with Monday-start weeks and existing DST conversion;
there is no second worker timezone configuration.

The due plan uses persisted refresh timestamps/status and per-date snapshots,
not local in-memory timers. Discovery normally runs every two minutes, today's
count every three minutes, and total count hourly. Failed/incomplete tasks retry
on a later base cycle. Fourteen daily dates are maintained: missing/incomplete
dates bootstrap/finalize as needed; completed days are otherwise reused. Only
the two most recent completed days are eligible for reconciliation every six
hours, using their persisted `fetched_at`. All count work shares the existing
request budget and aggregate interval splitting. No Account enumeration is used
for counts. Older completed days require a deliberate service refresh if later
changes must be reconciled. Home's optional 30-day chart can still show unknown
older dates until those snapshots have been intentionally populated.

### Concurrency, failures, cache signals, and shutdown

A dedicated PostgreSQL session advisory lock (`66360, 4`) protects the whole
cycle, including its due plan. Step 2's individual refresh locks remain in use
for coexistence with manual/service callers. A second worker normally logs a
safe skip, does no remote work, and waits for its next cycle. No permanent lock
or new cursor implementation is introduced. Discovery retains all existing
checkpoint, overlap, watermark, page-budget, retention, and coverage semantics.

Tasks run sequentially: discovery, total, then counts. A Dynamics or unexpected
individual task failure permits unrelated tasks to attempt their own database
preflight and refresh. A recognized PostgreSQL failure aborts the remaining work;
a planning/lock/startup database failure does no Dynamics work. Existing services
preserve valid values and record fixed refresh errors; missing/stale values are
never replaced with invented zeros. Unexpected exceptions and failed startup
initialization take the normal base wait before retrying. Operational logs use
fixed key/value events for start/end, due work, safe lock skips, request/row
counts, coverage, failures, duration, and shutdown. Raw exception text, Account
payloads/names, keys, tokens, and transport request URLs are not logged.

Committed Step 2 refresh metadata and snapshot timestamps form a cheap durable
Home refresh version. The worker logs a changed version; each authenticated Home
request compares it with its local cache version, clears old cache entries, and
uses a versioned key. This works across independent Render processes without
importing the web router into the worker or adding a message broker. No-due
cycles do not update state or change the version. Freshness/coverage changes also
invalidate cached responses. Enrichment-only completion continues to become
visible via the existing 45-second expiry. A version read failure returns a
sanitized 503 rather than serving a falsely healthy cache entry. Neither version
checks nor cache expiry query Dynamics. No new database table is required.

SIGTERM/SIGINT stop new cycles and new tasks. The current cycle gets a 15-second
grace period; if it is still active it is cancelled and awaited so Step 2 records
interruption, closes HTTP connections, and releases its locks. Bounded database
initialization threads are drained too. Signal shutdown exits normally. Render
currently defaults to a 30-second shutdown delay; retain that margin for cleanup
(or explicitly configure a larger delay if tenant validation requires it).
Abrupt SIGKILL cannot run cleanup: PostgreSQL releases session locks, saved
checkpoints survive, and `running` state is retried rather than claimed successful.

### Render setup (instructions only; no live configuration changed)

1. Create a separate **Background Worker**, Python runtime, from the same
   repository and deployment branch as the backend, containing Steps 1–4. The
   current checkout branch is `main`; verify the web service's actual linked
   branch instead of assuming its dashboard settings.
2. Set Root Directory `backend`; Build Command `pip install -r requirements.txt`;
   Start Command `python -m app.workers.maintenance_refresh`. Use a supported
   Python version aligned with the backend (prefer 3.11+). If Root Directory is
   the repository root, use build `pip install -r backend/requirements.txt` and
   start `python -m backend.app.workers.maintenance_refresh`; the root dependency
   file is not the complete backend dependency set.
3. Use the same Render region and exact backend `DATABASE_URL` (prefer its
   internal URL), plus the Dynamics variables above. Share only needed settings
   through an environment group. One worker instance is sufficient; overlapping
   deployments are protected by advisory locks. No HTTP port/health endpoint,
   persistent filesystem disk, Redis, or Seamless secret is needed.
4. Before enabling continuous operation, run the `--once` command from a
   deployment-side shell/one-off job with the same code/environment (or temporarily
   use it as the worker start command). The same code/database initialization and
   safety rules apply. A large initial bootstrap may return incomplete; inspect
   saved coverage and rerun on the normal interval until complete, or deliberately
   address the documented Step 2 row/page/retention limits.
5. Verify fixed logs, saved total/daily snapshots, discovery watermark/cursor,
   refresh status/coverage, and authenticated `/maintenance/home` freshness.
   Confirm expected selected fields/continuation URLs and count support in the
   production tenant. Inspect stale/unknown warnings rather than interpreting
   exit 0 or HTTP 200 alone as complete coverage. Once validated, use the continuous
   start command and monitor worker failures/lag in Render logs/Home freshness.
   Test graceful redeploy/stop. No Power Automate or Dynamics data changes are needed.

References: [Render Background Workers](https://render.com/docs/background-workers)
and [Render deployment and graceful shutdown](https://render.com/docs/deploys).
The Home frontend is implemented in Step 5 below. Durable enrichment-history
gap detection and operator handling of irrecoverable observation coverage gaps
remain future work.

## Sophie Maintenance Home frontend (Step 5)

`/dashboard` opens Home. Maintenance navigation is Home, Enrichment, Duplicate
Accounts, Summary Analytics. `/dashboard/enrichment` is the Account enrichment
workspace; `/dashboard/seamless` and `/dashboard/data-quality` replace browser
history with that canonical route. Duplicate Accounts, Summary Analytics, and
module permissions retain their existing routes/behavior.

Home contains four KPI cards, one responsive 14-day creation chart, and the
Recent New Accounts & Enrichment table. It uses authenticated
`GET /maintenance/home?days=14&view=recent&limit=25` through the shared frontend
request/cache helper with a 30-second TTL. Home revalidates on focus and, while
observation coverage is incomplete, every two minutes when visible. The Recent / Needs
Attention toggle resets rows and pagination; Load more uses the opaque backend
cursor. Late responses from an older view are ignored. Normal navigation/refetch
is independent of Dynamics refreshes.

The backend supplies status labels, attention flags, confirmed field labels,
and result summaries; the frontend does not infer enrichment outcomes or
updated fields. Timestamps use the reporting timezone (America/New_York).
Unknown metrics display an em dash; null chart counts create gaps and never
become zero. Snapshot freshness stays subtle on the total card. Stale/incomplete
structured freshness produces one compact information notice; permanent
best-effort history/worker notices do not create a banner on a healthy page.
Skeletons, concise empty states, and sanitized retry errors cover loading and
failures. Narrow screens stack cards and keep table scrolling inside its panel.
No direct Dynamics/Seamless requests or backend behavior changes are introduced.

## Consolidated Enrichment workspace

`/dashboard/enrichment` focuses on Accounts to Enrich, without summary cards.
Recent automatic-enrichment outcomes remain on Home.
The standalone Seamless/Data Quality navigation and dashboards are no longer
rendered. Legacy components/endpoints remain available internally; no provider,
credit accounting, automatic enrichment, or legacy Dynamics fields were deleted.

`GET /maintenance/enrichment/credits` requires the existing main-module access
and reads only existing credit usage/balance data. It returns nullable `remaining`,
`weekly_remaining`, `weekly_limit`, `reported_at`, and `is_stale` (24-hour reported
balance age). It does not load `/metrics`, refresh Account caches, or call providers.
Unknown balances remain unknown; zero is valid. Existing usage-file storage and
its deployment/persistence limitations are unchanged.

Accounts load only after Search Dynamics. The workspace uses the existing live
`GET /accounts/data-quality/search` with `enrichment_fields=true`, 25-row pages,
server-side name/text, canonical missing-information, country/location and sector
filters. No legacy facet cache or Account mirror is loaded. Canonical mode selects
Account identity, location, sector details, and the nine manual targets. It returns
canonical employee/postal/NAICS values and missing keys directly without legacy
field aliases or cache persistence. Other search consumers retain their original
contract. The existing five-bucket completeness score uses canonical Employees;
its tooltip explains that it measures Website/Phone/Description/Employees/location,
not provider eligibility or enrichment outcome. Postal/NAICS gaps are shown
independently in Missing Information.

Each canonical search has a 20-Dataverse-page budget and a 5,000-result paging
window, with deterministic name/Account-ID ordering and same-origin Account-only
continuations. Users must narrow filters beyond those budgets; there is no total
population download or count. Pagination is still page based and may replay earlier
pages; it is not a new cursor search service. Search failures are sanitized/retryable.

The table shows selection, Account, combined Location, Missing Information,
Completeness, and Details. Country is a primary filter; State/Province, City and
Sector sit inside More filters. Selection is page scoped. A compact field selector
and Enrich Selected appear only after selection, with explicit nonempty fields.
Confirm enrichment states the blank-only policy, then calls the existing manual
endpoint. Results show actual per-Account statuses/confirmed fields and partial
failures, with optional outcome details. There are no extra summary cards, charts,
exports, audit dashboards or duplicate activity tables. Durable manual history is
still a separate future task; automatic outcomes remain on Home.

### Selected/manual enrichment field contract

`POST /accounts/enrichment-run` requires nonempty `account_ids` and an explicit,
nonempty `fields_to_update` selection. Supported canonical Dynamics logical fields:
`websiteurl`, `telephone1`, `description`, `numberofemployees`, `address1_city`,
`address1_stateorprovince`, `address1_country`, `address1_postalcode`, and
`cr73c_naicscode`. Unsupported fields and empty selections return HTTP 422 before
any Account/provider processing. The existing field dropdown uses these names;
Data Source is not an enrichment target. `new_employees` and `new_naicstext` remain
legacy Data Quality display/classification fields, not aliases or synchronized
copies of provider-enriched Employees/NAICS. Future consolidated search/table
work must read the canonical fields as well.

Manual enrichment reads all supported Dynamics targets, including Description,
before deciding what is blank. Only explicitly selected blank fields can update;
zero is populated, whitespace is blank. A valid provider employee count becomes a
nonnegative Dynamics integer. Postal codes remain text (including leading zeros).
NAICS accepts only six ASCII digits and writes `cr73c_naicscode` as text. Invalid
or absent optional values are ignored without preventing other selected updates.
Selected blank Description/location fields can justify a manual lookup; the
automatic credit-worthy subset is not applied. No eligible selected blank fields
means `no_updates_needed` with no provider call or usage increment.

The selected endpoint returns aggregate `processed`, `updated`, `skipped`, and
per-Account `results`: `account_id`, `account_name`, `status`, `updated`, confirmed
`fields_updated`, and the compatible `updates` object. Statuses are `updated`,
`no_updates_needed`, `no_match`, `skipped_credit_limit`, and `failed`. Non-updated
outcomes include a fixed `reason`/`reason_code`; failures include sanitized
`error`/`error_category`. Failed writes never return intended fields as confirmed.
Transport write failures include `completion_uncertain=true`; confirmation is
not invented and no new retry behavior is added. A failed legacy audit write does
not erase a confirmed Dynamics update.

Legacy single/all-Account manual callers that omit selection retain their original
seven targets (excluding Postal Code/NAICS); explicit empty selection never means
all fields. Manual provider matching, name-only fallback, one usage increment per
successful adapter invocation, and the batch delay remain unchanged. Automatic
`/accounts/enrich-one`, history, preflight, mappings, retries, and machine auth are
unchanged. Manual durable history remains a separate future task.

### Total Accounts cache-aside fallback

Dynamics remains the Account source of truth. PostgreSQL stores a singleton
`maintenance_total_account_snapshot`, not a copy of the Account population.
The maintenance worker remains the normal proactive refresher. Home reads a
present snapshot immediately, including a stale valid value with freshness
warnings. Only when the total snapshot is missing does the authenticated Home
route call the existing read-only `RetrieveTotalRecordCount` for `account`, save
the singleton snapshot, and return that value in the same response. No Account
records, daily counts, discovery, or enrichment are fetched by this fallback.

A shared 60-second async cache coalesces concurrent fallback requests across
Home views/page sizes within each web process; failed lookups are briefly cached
as well. Independent web processes may each make one initial lookup. A worker
snapshot committed during a race is rechecked before contacting Dynamics.
Successful Dynamics counts (including zero) survive snapshot persistence failure
and remain reusable in memory. Lookup failure returns unknown, never fabricated
zero, with a sanitized warning. No raw errors or credentials are logged. Existing
Home refresh-version invalidation detects committed snapshot writes normally.
A failure of the wider PostgreSQL Home read model still returns its existing
controlled 503; the fallback does not replace observation/history storage.

## Newsletter subscriber snapshots

The Marketing overview includes **Newsletter Subscribers**, sourced from the
Economic Navigator Newsletter (Real Time) Dynamics segment definition
`32d99679-2af5-ef11-be20-7c1e520d6c2f`. The initial observation is **4,293**,
verified against Dynamics on September 23, 2026. It is stored in
`backend/app/data/newsletter_initial_snapshot.json` and inserted into PostgreSQL
idempotently during database initialization. Earlier history is not reconstructed.

The chart shows **one point per month**, using the latest subscriber count
observed in that Eastern calendar month. Each weekly update replaces the current
month's displayed count; counts are never added together. Earlier months retain
their last recorded count. Weekly observations are retained internally so the
schedule remains idempotent and existing history is preserved.

The backend starts a scheduler with the application. It captures one snapshot per
week on Monday at 9 a.m. in `America/New_York`, using the existing
Dynamics credentials. It retries failures hourly and checks for a missing current
week after Monday at 9 a.m. on startup and when the chart is loaded. The actual capture timestamp is
saved; downtime does not create backdated observations for missed weeks.
Snapshots are immutable, and a database primary key prevents duplicate weeks
across workers/restarts. Reading/reloading the chart never overwrites a snapshot.

Deploy both backend and frontend to enable this feature. No new environment
variables are required for an always-running backend. The scheduler runs only
while the backend process is running.

For a Render service that sleeps, create an independent **Cron Job** from this
repository with root directory `backend`, build command
`pip install -r requirements.txt`, and command:

```sh
python -m app.services.newsletter
```

Use schedule `0 13,14 * * 1` (Mondays at 13:00 and 14:00 UTC). Render uses UTC;
these two checks cover 9 a.m. Eastern during both daylight and standard time.
The code skips the early check in winter and skips the second check in summer
once that week's snapshot exists. The running backend retries failed captures
hourly; a cron-only deployment can retry manually after a failure. Give it the backend's `DATABASE_URL`, `TENANT_ID`,
`CLIENT_ID`, `CLIENT_SECRET`, `DYNAMICS_SCOPE`, and `DYNAMICS_API_URL` (or share its
environment group). Choose the same Render region so its internal database URL
is reachable. It is safe to run alongside the in-process scheduler.

References: [Dynamics segment Web API](https://learn.microsoft.com/en-us/dynamics365/customer-insights/journeys/real-time-marketing-api-segment)
and [Render cron jobs](https://render.com/docs/cronjobs).
