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
