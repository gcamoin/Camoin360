import React, { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import CompanyFinancials from "./CompanyFinancials";
import ContractBacklogSelected from "./ContractBacklogSelected";
import MarketingMetrics, { MarketingOverview } from "./MarketingMetrics";
import SalesOutlook from "./SalesOutlook";
import SalesOutlookRfp from "./SalesOutlookRfp";
import ServiceLineFinancials from "./ServiceLineFinancials";
import RfpOverallSuccessRate from "./RfpOverallSuccessRate";

window.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock("axios");
jest.mock("../auth", () => ({
  API_BASE_URL: "http://localhost", getAuthHeaders: () => ({}),
  getCurrentUser: () => ({}), handleUnauthorized: () => false,
  getApiErrorMessage: (_error, fallback) => fallback,
}));
jest.mock("recharts", () => {
  const Chart = ({ data }) => <div data-chart={JSON.stringify(data)} />;
  return {
    ResponsiveContainer: ({ children }) => children,
    LineChart: Chart, BarChart: Chart, ComposedChart: Chart,
    CartesianGrid: () => null, Legend: () => null, Line: () => null,
    Bar: () => null, XAxis: () => null, YAxis: () => null, Tooltip: () => null,
  };
});
const months = [
  { year: "2024", month: "Jan", monthNumber: "1", monthKey: "2024-01", month_key: "2024-01", period_key: "2024-01", sales: 10 },
  { year: "2025", month: "Apr", monthNumber: "4", monthKey: "2025-04", month_key: "2025-04", period_key: "2025-04", sales: 20 },
];
let root, container;
beforeEach(() => {
  axios.get.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
const charts = () => Array.from(container.querySelectorAll("[data-chart]")).map((node) => JSON.parse(node.dataset.chart));

test.each([
  [CompanyFinancials, { rows: months }],
  [ContractBacklogSelected, { monthly_totals: months }],
  [SalesOutlook, { annual_contracts: months, monthly_projects: months, project_details: [] }],
  [SalesOutlookRfp, { annual_proposals: months, monthly_contracts: months }],
  [ServiceLineFinancials, { months, service_lines: [{ key: "sales", label: "Sales" }], record_counts: {} }],
  [MarketingOverview, { months, sync: { status: "idle" } }],
  [MarketingMetrics, { service_lines: [{ key: "consulting", label: "Consulting", months }], sync: { status: "idle" } }],
])("%p updates chart data and keeps unmatched selections empty", async (Component, data) => {
  axios.get.mockResolvedValue({ data });
  await act(async () => root.render(<Component filters={{ year: "2025", quarter: "2" }} />));
  expect(charts().length).toBeGreaterThan(0);
  charts().forEach((rows) => {
    expect(rows).toHaveLength(1);
    expect(rows[0].year).toBe("2025");
  });
  await act(async () => root.render(<Component filters={{ year: "2023" }} />));
  charts().forEach((rows) => expect(rows).toEqual([]));
});

test("RFP success rates accept numeric years, Q-prefixed quarters, month and date boundaries", async () => {
  axios.get.mockResolvedValue({ data: { series: [
    { year: 2025, quarter: "Q1", period: "Q1 2025", won: 1, lost: 1, won_fee: 20, decided_fee: 40 },
    { year: 2025, quarter: "Q2", period: "Q2 2025", won: 3, lost: 1, won_fee: 30, decided_fee: 40 },
  ] } });
  await act(async () => root.render(<RfpOverallSuccessRate filters={{ year: "2025", month: "4", startDate: "2025-04-15", endDate: "2025-05-15" }} />));
  expect(charts()[0]).toEqual([expect.objectContaining({ quarter: "Q2", count_success_rate: 75 })]);
});
