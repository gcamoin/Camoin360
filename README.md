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
`POWER_AUTOMATE_API_KEY` to require the `x-api-key` header (strongly recommended for
any deployed endpoint); if it is unset, the header is optional for local development.

For a local call:

```bash
curl -X POST "http://localhost:8000/accounts/enrich-one/<accountid>" \
  -H "x-api-key: $POWER_AUTOMATE_API_KEY" \
  -H "Content-Type: application/json"
```
