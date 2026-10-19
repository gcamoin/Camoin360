import React, { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import NewsletterSubscribers from "./NewsletterSubscribers";

window.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock("axios");
jest.mock("../auth", () => ({ API_BASE_URL: "http://localhost", getAuthHeaders: () => ({}), handleUnauthorized: () => false, getApiErrorMessage: (_error, fallback) => fallback }));
jest.mock("recharts", () => ({
  ResponsiveContainer: ({ children }) => children,
  LineChart: ({ data }) => <div data-chart={JSON.stringify(data)} />,
  CartesianGrid: () => null, Line: () => null, Tooltip: () => null, XAxis: () => null, YAxis: () => null,
}));
let root, container;
beforeEach(() => {
  axios.get.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const snapshot = { month_key: "2026-09", period_key: "2026-09", subscriber_count: 4293, captured_at: "2026-09-23T21:20:06+00:00" };
test("shows starting count as a single point and filters the chart and headline together", async () => {
  axios.get.mockResolvedValue({ data: { snapshots: [snapshot], next_snapshot_at: "2026-09-28T09:00:00-04:00" } });
  await act(async () => root.render(<NewsletterSubscribers filters={{ year: "2026" }} />));
  expect(container.textContent).toContain("4,293");
  expect(container.textContent).toContain("One month");
  expect(container.textContent).toContain("Sep 28, 2026");
  expect(JSON.parse(container.querySelector("[data-chart]").dataset.chart)).toEqual([snapshot]);
  await act(async () => root.render(<NewsletterSubscribers filters={{ year: "2025" }} />));
  expect(container.textContent).toContain("No subscriber snapshots match");
  expect(container.textContent).not.toContain("4,293");
  expect(axios.get).toHaveBeenCalledTimes(1);
});
test("retains saved data and shows warning when weekly capture fails", async () => {
  axios.get.mockResolvedValue({ data: { snapshots: [snapshot], warning: "Dynamics unavailable" } });
  await act(async () => root.render(<NewsletterSubscribers />));
  expect(container.textContent).toContain("Dynamics unavailable");
  expect(container.textContent).toContain("4,293");
});

test("monthly selection shows that month's latest count and excludes other months", async () => {
  const october = { month_key: "2026-10", period_key: "2026-10", subscriber_count: 4310, captured_at: "2026-10-05T13:00:00+00:00" };
  axios.get.mockResolvedValue({ data: { snapshots: [snapshot, october] } });
  await act(async () => root.render(<NewsletterSubscribers filters={{ year: "2026", month: "10" }} />));
  expect(JSON.parse(container.querySelector("[data-chart]").dataset.chart)).toEqual([october]);
  expect(container.textContent).toContain("4,310");
  expect(container.textContent).not.toContain("4,293");
  expect(container.textContent).toContain("previous months stay unchanged");
});
