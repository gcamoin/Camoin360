# Week 2: request reduction

## Confirmed request paths

The baseline counts below come from the October 26 source at `91183c57`.
The after counts are asserted in `PEClients.test.js` and `PEQualifiedLeads.test.js` with a mocked HTTP client. They count requests issued by the React components, not browser network timing or live Dynamics traffic.

| Interaction | Before GET requests | After GET requests |
| --- | ---: | ---: |
| Open Qualified Leads, leave, then return within five minutes | 2 `/pe-qualified-leads` | 1 `/pe-qualified-leads` |
| Open Clients organization list | 1 `/organizations` + 1 `/users` | 1 `/organizations` + 0 `/users` |
| Open an organization, return to the list, then open it again | `/users` already fetched on list entry | 1 `/users` on first detail entry, 0 on second |
| Click Refresh leads | No control | 1 new `/pe-qualified-leads` |
| Click Refresh users in organization detail | No control | 1 new `/users` |

Qualified Leads now uses the existing five-minute API cache, keyed by reporting period. A new period gets its own request. Refresh bypasses the cache. The interface states the cache duration. Clients loads users when an organization is opened, then reuses those users during the current visit. Its total user count uses the organization summaries; organization and user refresh buttons bypass the cache. User and organization changes invalidate affected cached responses.

## Verification

- `CI=true npm test -- --watch=false --runInBand src/components/PEClients.test.js src/components/PEQualifiedLeads.test.js`
- `npm run build`

Browser network traces and responsive screenshots remain outstanding because the computer-use service reported no available browser or native app. Live data freshness and request timing still need a browser run against a working API.
