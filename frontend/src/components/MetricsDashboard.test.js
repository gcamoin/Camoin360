/* global globalThis */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import MetricsDashboard from "./MetricsDashboard";
import { getCached, invalidateApiCache } from "../apiClient";

jest.mock("axios");
jest.mock("../apiClient", () => ({ getCached: jest.fn(), invalidateApiCache: jest.fn() }));
jest.mock("../auth", () => ({
  API_BASE_URL: "http://localhost", getAuthHeaders: () => ({ Authorization: "Bearer test" }),
  handleUnauthorized: () => false,
}));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const metrics = {
  accounts_updated: 12, remaining_credits: 90, weekly_limit: 100,
  total_credits_remaining: null,
  data_quality_pipeline: [
    { category: "Ready for Enrichment", count: 8, percentage: 40, records: [{ account_name: "Ready Company" }] },
    { category: "Already Enriched", count: 12, percentage: 60, records: [] },
  ],
  recent_activity: [{ account_name: "Recent Company", result_status: "Updated", fields_updated: ["Phone"], credits_used: 1 }],
  audit_history: [],
  alert_center: [{ title: "Unwanted alert" }], trend_tracking: { credits_used_per_day: [{ period: "Today", credits_used: 1 }] },
};
let container, root;
const click = async (label) => {
  const button = Array.from(document.querySelectorAll("button")).find((item) => item.textContent === label);
  expect(button).toBeTruthy();
  await act(async () => button.click());
};
beforeEach(() => {
  jest.clearAllMocks();
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  getCached.mockResolvedValue({ data: metrics });
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
});
const render = async () => act(async () => root.render(<MetricsDashboard />));

it("uses existing snapshot metrics and hides removed sections and audit detail by default", async () => {
  await render();
  expect(container.textContent).toContain("Accounts Updated12");
  expect(container.textContent).toContain("Seamless Credits Remaining—");
  expect(container.textContent).toContain("Weekly allowance: 90 remaining of 100 credits.");
  expect(container.textContent).toContain("Recent Company");
  ["Data Quality", "Total Accounts", "Ready for Enrichment", "Already Enriched", "View Accounts Ready", "View Manual Review", "Alert Center", "Trend Tracking", "Unwanted alert", "Preview Next Batch", "Field Impact Analytics", "Enrichment Outcome Breakdown"].forEach((text) => expect(container.textContent).not.toContain(text));
  expect(container.querySelector("details").open).toBe(false);
});

it("preserves the authenticated enrichment request and refreshes metrics on success", async () => {
  axios.post.mockResolvedValue({ data: { processed: 8, updated: 6 } });
  await render(); await click("Run Enrichment");
  expect(axios.post).toHaveBeenCalledWith("http://localhost/accounts/enrich-all", {}, { headers: { Authorization: "Bearer test" } });
  expect(invalidateApiCache).toHaveBeenCalledWith("http://localhost/metrics");
  expect(getCached).toHaveBeenCalledTimes(2);
  expect(container.textContent).toContain("Enrichment complete: 8 processed, 6 updated.");
});

it("shows loading, initial fetch errors, and a working retry", async () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  let rejectRequest;
  getCached.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectRequest = reject; }));
  await render(); expect(container.textContent).toContain("Loading Sophie Maintenance metrics");
  await act(async () => rejectRequest(new Error("Unavailable")));
  expect(container.textContent).toContain("Unable to load Sophie Maintenance metrics.");
  await click("Retry"); expect(container.textContent).toContain("Recent Company");
  log.mockRestore();
});

it("reports enrichment failure and re-enables the action", async () => {
  axios.post.mockRejectedValue(new Error("Unavailable"));
  await render(); await click("Run Enrichment");
  expect(container.textContent).toContain("Unable to run enrichment.");
  expect(Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Run Enrichment").disabled).toBe(false);
});

it("keeps unavailable data distinct from zero", async () => {
  getCached.mockResolvedValue({ data: { data_quality_pipeline: [], recent_activity: [], audit_history: [] } });
  await render();
  expect(container.textContent).toContain("Accounts Updated—");
  expect(container.textContent).toContain("Seamless Credits Remaining—");
  expect(container.textContent).toContain("No recent Seamless activity has been recorded yet.");
});
