import React, { act } from "react";
import { createRoot } from "react-dom/client";
import AccountsBySector from "./AccountsBySector";
import { getCached } from "../apiClient";
window.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock("../apiClient", () => ({ getCached: jest.fn() }));
jest.mock("../auth", () => ({ API_BASE_URL: "http://localhost", getAuthHeaders: () => ({ Authorization: "Bearer test" }), handleUnauthorized: jest.fn(() => false) }));
jest.mock("recharts", () => ({
  ResponsiveContainer: ({ children }) => children,
  BarChart: ({ data, layout, children }) => <div data-chart={JSON.stringify(data)} data-layout={layout}>{data.map((row) => <span key={row.sector}>{row.sector}</span>)}{children}</div>,
  Bar: ({ children }) => children,
  CartesianGrid: () => null, XAxis: () => null, YAxis: () => null, Tooltip: () => null, LabelList: () => null,
}));
let root, container;
beforeEach(() => { jest.clearAllMocks(); container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const render = () => act(async () => root.render(<AccountsBySector />));
it("renders cached sector counts including actual zero", async () => {
  getCached.mockResolvedValue({ data: { sectors: [{ sector: "Manufacturing", account_count: 205242 }, { sector: "Other", account_count: 0 }] } });
  await render();
  const chart = container.querySelector("[data-chart]");
  expect(chart.dataset.layout).toBe("vertical");
  expect(JSON.parse(chart.dataset.chart)).toEqual([{ sector: "Manufacturing", account_count: 205242 }, { sector: "Other", account_count: 0 }]);
  expect(container.querySelector("table")).toBeNull();
  expect(getCached).toHaveBeenCalledWith("http://localhost/accounts/summary-analytics", expect.objectContaining({ ttl: 600000, headers: { Authorization: "Bearer test" } }));
});
it("shows a concise empty state", async () => {
  getCached.mockResolvedValue({ data: { sectors: [] } }); await render(); expect(container.textContent).toContain("No sector data available.");
});
it("shows loading placeholders", async () => {
  getCached.mockImplementation(() => new Promise(() => {})); await render(); expect(container.querySelector('[aria-label="Loading sector chart"]')).toBeTruthy();
});
it("sanitizes errors and supports retry independently", async () => {
  getCached.mockRejectedValueOnce(new Error("SECRET")).mockResolvedValueOnce({ data: { sectors: [{ sector: "Retail", account_count: 42 }] } });
  await render(); expect(container.textContent).toContain("Unable to load Accounts by Sector."); expect(container.textContent).not.toContain("SECRET");
  await act(async () => container.querySelector("button").click()); expect(container.textContent).toContain("Retail"); expect(getCached.mock.calls[1][1].force).toBe(true);
});
