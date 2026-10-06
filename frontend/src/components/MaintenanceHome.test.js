import React, { act } from "react";
import { createRoot } from "react-dom/client";
import MaintenanceHome from "./MaintenanceHome";
import { getCached } from "../apiClient";
import { handleUnauthorized } from "../auth";

jest.mock("./AccountsBySector", () => () => <section>Accounts by Sector</section>);
window.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock("../apiClient", () => ({ getCached: jest.fn() }));
jest.mock("../auth", () => ({ API_BASE_URL: "http://localhost", getAuthHeaders: () => ({ Authorization: "Bearer test" }), handleUnauthorized: jest.fn(() => false) }));
const account = (id, options = {}) => ({ account_id: id, account_name: `Account ${id}`, created_at: "2026-10-06T14:30:00Z",
  display_status: "enriched", display_status_label: "Enriched", needs_attention: false,
  field_labels: ["Website", "NAICS"], result_summary: "Website, NAICS added", ...options });
const fixture = (options = {}) => ({
  reporting: { timezone: "America/New_York", coverage_complete: true },
  metrics: { total_dynamics_accounts: { value: 3124821, fetched_at: "2026-10-06T14:00:00Z", maximum_source_age_hours: 24, is_stale: false },
    new_accounts_today: 127, new_accounts_this_week: 684,
    enrichment_success_rate: { value: 94.7, successful_accounts: 648, known_terminal_accounts: 684, coverage_complete: true } },
  account_creation_by_day: Array.from({ length: 14 }, (_, index) => ({ date: `2026-09-${17 + index}`, count: index === 0 ? 0 : index === 1 ? null : 40 + index, stale: false })),
  recent_accounts: [account("a")], next_cursor: null,
  freshness: { discovery: { coverage_complete: true }, creation_counts: { today_stale: false, week_stale: false } },
  warnings: ["Snapshot freshness depends on a separate worker.", "History is best-effort."], ...options,
});
let root, container;
beforeEach(() => {
  jest.clearAllMocks(); getCached.mockReset(); handleUnauthorized.mockReturnValue(false);
  getCached.mockResolvedValue({ data: fixture() });
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const render = async () => act(async () => root.render(<MaintenanceHome />));
const button = (text) => Array.from(container.querySelectorAll("button")).find((node) => node.textContent === text);
const click = async (text) => { expect(button(text)).toBeTruthy(); await act(async () => button(text).click()); };
const card = (name) => container.querySelector(`section[aria-label="${name}"]`);

it("uses authenticated Home requests and exactly four KPIs with snapshot freshness", async () => {
  await render();
  expect(getCached).toHaveBeenCalledWith("http://localhost/maintenance/home", expect.objectContaining({ headers: { Authorization: "Bearer test" }, params: { days: 14, view: "recent", limit: 25 }, ttl: 30000 }));
  expect(container.querySelector('[data-testid="home-kpis"]').children).toHaveLength(4);
  for (const [label, value] of [["Total Dynamics Accounts", "3,124,821"], ["New Accounts Today", "127"], ["New Accounts This Week", "684"], ["Enrichment Success Rate", "94.7%"]]) expect(card(label).textContent).toContain(value);
  expect(card("Enrichment Success Rate").textContent).toContain("648 of 684 completed");
  expect(card("Total Dynamics Accounts").textContent).toContain("Snapshot");
  expect(card("Total Dynamics Accounts").textContent).toContain("EDT");
});
it("keeps null success rate and metrics distinct from known zero", async () => {
  const data = fixture(); data.metrics.enrichment_success_rate = { value: null, known_terminal_accounts: 0 };
  data.metrics.total_dynamics_accounts = { value: null }; data.metrics.new_accounts_today = 0; data.metrics.new_accounts_this_week = null;
  getCached.mockResolvedValue({ data }); await render();
  expect(card("Enrichment Success Rate").textContent).toContain("—"); expect(card("Enrichment Success Rate").textContent).not.toContain("0%");
  expect(card("Total Dynamics Accounts").textContent).toContain("Snapshot unavailable");
  expect(card("New Accounts Today").textContent).toContain("0"); expect(card("New Accounts This Week").textContent).toContain("—");
});
it("omits the Account creation chart even when daily counts are unavailable", async () => {
  getCached.mockResolvedValue({ data: fixture({ account_creation_by_day: [{ date: "2026-10-06", count: null, stale: true }] }) }); await render();
  expect(container.textContent).not.toContain("Accounts added to Dynamics over the last 14 days");
  expect(container.textContent).not.toContain("No account creation counts are available yet.");
  expect(container.querySelector("#home-chart-title")).toBeNull();
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.textContent).toContain("Recent New Accounts & Enrichment");
  expect(container.textContent).toContain("Accounts by Sector");
});
it("uses backend labels, confirmed field labels, result summaries, and reporting timezone", async () => {
  getCached.mockResolvedValue({ data: fixture({ recent_accounts: [account("a", { backend_status: "failed", display_status_label: "Backend supplied label" }), account("b", { field_labels: [], result_summary: "No paid enrichment needed" })] }) });
  await render(); for (const text of ["Account a", "Backend supplied label", "Website, NAICS", "No paid enrichment needed", "10:30 AM EDT"]) expect(container.textContent).toContain(text);
  expect(container.querySelector("a")).toBeNull();
});
it("switches to attention and resets rows and pagination", async () => {
  getCached.mockResolvedValueOnce({ data: fixture({ next_cursor: "recent-cursor" }) }).mockResolvedValueOnce({ data: fixture({ recent_accounts: [] }) });
  await render(); await click("Needs Attention");
  expect(getCached.mock.calls[1][1].params).toEqual({ days: 14, view: "attention", limit: 25 });
  expect(container.textContent).toContain("No Accounts currently need attention."); expect(container.textContent).not.toContain("Account a"); expect(button("Load more")).toBeUndefined();
});
it("loads more with the exact cursor and appends uniquely", async () => {
  getCached.mockResolvedValueOnce({ data: fixture({ next_cursor: "opaque+/=cursor" }) }).mockResolvedValueOnce({ data: fixture({ recent_accounts: [account("a"), account("b")] }) });
  await render(); await click("Load more");
  expect(getCached.mock.calls[1][1].params.cursor).toBe("opaque+/=cursor"); expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
  expect(container.textContent).toContain("Account b"); expect(button("Load more")).toBeUndefined();
});
it("ignores a late pagination response after changing views", async () => {
  let finish; getCached.mockResolvedValueOnce({ data: fixture({ next_cursor: "cursor" }) }).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValueOnce({ data: fixture({ recent_accounts: [] }) });
  await render(); await click("Load more"); await click("Needs Attention"); await act(async () => finish({ data: fixture({ recent_accounts: [account("old-page")] }) }));
  expect(container.textContent).toContain("No Accounts currently need attention."); expect(container.textContent).not.toContain("old-page");
});
it("ignores stale initial responses after changing views", async () => {
  let finish; getCached.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValueOnce({ data: fixture({ recent_accounts: [] }) });
  await render(); await click("Needs Attention"); await act(async () => finish({ data: fixture() }));
  expect(container.textContent).toContain("No Accounts currently need attention."); expect(container.textContent).not.toContain("Account a");
});
it("shows skeletons for cards and table", async () => {
  getCached.mockImplementation(() => new Promise(() => {})); await render();
  expect(container.querySelectorAll('[aria-label^="Loading"]')).toHaveLength(20); expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
});
it("provides a sanitized dashboard error and force-refresh retry", async () => {
  getCached.mockRejectedValueOnce({ response: { data: { detail: "SECRET stack trace" } } }).mockResolvedValueOnce({ data: fixture() });
  await render(); expect(container.textContent).toContain("Unable to load Sophie Maintenance."); expect(container.textContent).not.toContain("SECRET");
  await click("Retry"); expect(getCached.mock.calls[1][1].force).toBe(true); expect(container.textContent).toContain("Account a");
});
it("preserves rows on load-more failure and supports retry", async () => {
  getCached.mockResolvedValueOnce({ data: fixture({ next_cursor: "cursor" }) }).mockRejectedValueOnce(new Error("SECRET")).mockResolvedValueOnce({ data: fixture({ recent_accounts: [account("b")] }) });
  await render(); await click("Load more"); expect(container.textContent).toContain("Account a"); expect(container.textContent).toContain("Unable to load more Accounts."); expect(container.textContent).not.toContain("SECRET");
  await click("Retry"); expect(container.textContent).toContain("Account b"); expect(getCached.mock.calls[2][1].force).toBe(true);
});
it("handles empty Recent", async () => {
  getCached.mockResolvedValue({ data: fixture({ recent_accounts: [] }) }); await render(); expect(container.textContent).toContain("No recent Accounts to show.");
});
it("shows one compact warning for incomplete coverage", async () => {
  getCached.mockResolvedValue({ data: fixture({ reporting: { coverage_complete: false } }) }); await render();
  expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1); expect(container.textContent).toContain("Some recent Account activity may be incomplete.");
});
it("warns on partial rate coverage", async () => {
  const data = fixture({ account_creation_by_day: [] }); data.metrics.enrichment_success_rate.coverage_complete = false;
  getCached.mockResolvedValue({ data }); await render(); expect(container.textContent).toContain("Some recent Account activity may be incomplete.");
});
it("warns on stale snapshots without extra panels", async () => {
  const data = fixture({ account_creation_by_day: [] }); data.metrics.total_dynamics_accounts.is_stale = true;
  getCached.mockResolvedValue({ data }); await render(); expect(container.textContent).toContain("Some dashboard data is out of date."); expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
});
it("keeps healthy dashboards quiet despite permanent backend information notices", async () => {
  getCached.mockResolvedValue({ data: fixture({ account_creation_by_day: [{ date: "2026-10-06", count: 0, stale: false }] }) }); await render();
  expect(container.querySelector('[role="alert"]')).toBeNull();
  for (const text of ["Alert Center", "Trend Tracking", "Seamless credits", "Run Enrichment", "Data Quality breakdown"]) expect(container.textContent).not.toContain(text);
});
it("uses existing unauthorized handling", async () => {
  handleUnauthorized.mockReturnValue(true); getCached.mockRejectedValue({ response: { status: 401 } }); await render();
  expect(handleUnauthorized).toHaveBeenCalled(); expect(container.textContent).not.toContain("Unable to load Sophie Maintenance.");
});

it("rechecks incomplete coverage and clears the warning when the worker catches up", async () => {
  jest.useFakeTimers();
  try {
    getCached.mockResolvedValueOnce({ data: fixture({ reporting: { coverage_complete: false } }) })
      .mockResolvedValue({ data: fixture({ account_creation_by_day: [{ date: "2026-10-06", count: 0 }] }) });
    await render();
    await act(async () => jest.advanceTimersByTime(120000));
    expect(getCached).toHaveBeenCalledTimes(2);
    expect(getCached.mock.calls[1][1].force).toBe(true);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    await act(async () => jest.advanceTimersByTime(240000));
    expect(getCached).toHaveBeenCalledTimes(2);
  } finally { jest.useRealTimers(); }
});
it("refreshes manually without replacing existing values with skeletons", async () => {
  let resolve;
  getCached.mockResolvedValueOnce({ data: fixture({ reporting: { coverage_complete: false } }) })
    .mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  await render(); await click("Refresh");
  expect(card("Total Dynamics Accounts").textContent).toContain("3,124,821");
  expect(container.querySelector('[aria-label="Loading Account creation chart"]')).toBeNull();
  await act(async () => resolve({ data: fixture({ account_creation_by_day: [] }) }));
  expect(container.querySelector('[role="alert"]')).toBeNull();
});
it("revalidates on focus and distinguishes stale coverage from active syncing", async () => {
  getCached.mockResolvedValue({ data: fixture({ reporting: { coverage_complete: false }, freshness: { discovery: { refresh_incomplete: false } } }) });
  await render();
  expect(container.textContent).toContain("Account activity is out of date.");
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(getCached).toHaveBeenCalledTimes(2);
});

it("displays a multi-million total independently of observation and history coverage", async () => {
  const data = fixture({ reporting: { coverage_complete: false } });
  data.metrics.total_dynamics_accounts.value = 3125000;
  data.metrics.enrichment_success_rate.coverage_complete = false;
  getCached.mockResolvedValue({ data }); await render();
  expect(card("Total Dynamics Accounts").textContent).toContain("3,125,000");
});
it("preserves an actual zero total", async () => {
  const data = fixture(); data.metrics.total_dynamics_accounts.value = 0;
  getCached.mockResolvedValue({ data }); await render();
  expect(card("Total Dynamics Accounts").textContent).not.toContain("—");
  expect(card("Total Dynamics Accounts").textContent).toContain("0");
});
