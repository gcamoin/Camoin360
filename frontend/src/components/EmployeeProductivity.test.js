import React, { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import EmployeeProductivity, { buildProposalPrepRows } from "./EmployeeProductivity";

window.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock("axios");
jest.mock("../auth", () => ({
  API_BASE_URL: "http://localhost",
  getApiErrorMessage: (_error, fallback) => fallback,
  getAuthHeaders: () => ({}),
  handleUnauthorized: () => false,
}));
jest.mock("recharts", () => ({
  ...jest.requireActual("recharts"),
  ResponsiveContainer: () => null,
}));

const syncing = {
  data: {
    employees: [],
    sync: { status: "syncing", last_started_at: "2026-09-23T12:00:00Z" },
  },
};

let container;
let root;
beforeEach(() => {
  jest.useFakeTimers();
  axios.get.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  jest.useRealTimers();
});

async function tick() {
  await act(async () => jest.advanceTimersByTime(5000));
}

test("continues polling unchanged sync status until completed data arrives, then stops", async () => {
  axios.get.mockResolvedValue(syncing);
  await act(async () => root.render(<EmployeeProductivity />));
  await tick();
  await tick();
  expect(axios.get).toHaveBeenCalledTimes(3);
  expect(container.textContent).toContain("Syncing Harvest data...");

  axios.get.mockResolvedValue({ data: {
    employees: [{ employee: "Test Employee", total_hours: 8, billable_hours: 6, non_billable_hours: 2 }],
    updated_at: "2026-09-23T12:01:00Z",
    sync: { status: "idle" },
  } });
  await tick();
  expect(container.textContent).not.toContain("Syncing Harvest data...");
  expect(container.textContent).toContain("Updated");
  expect(container.textContent).toContain("8h");
  await tick();
  expect(axios.get).toHaveBeenCalledTimes(4);
});

test("keeps polling after a temporary request failure and clears the error on recovery", async () => {
  axios.get.mockResolvedValueOnce(syncing).mockRejectedValueOnce(new Error("Network error")).mockResolvedValue(syncing);
  await act(async () => root.render(<EmployeeProductivity />));
  await tick();
  expect(container.textContent).toContain("Unable to load employee productivity metrics.");
  await tick();
  expect(axios.get).toHaveBeenCalledTimes(3);
  expect(container.textContent).not.toContain("Unable to load employee productivity metrics.");
});

test("shows sync failures and allows a manual retry", async () => {
  axios.get.mockResolvedValue({ data: { employees: [], sync: { status: "error", last_error: "Harvest unavailable" } } });
  await act(async () => root.render(<EmployeeProductivity />));
  expect(container.textContent).toContain("Harvest sync failed: Harvest unavailable");
  const refresh = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Refresh");
  expect(refresh.disabled).toBe(false);
  axios.get.mockResolvedValue(syncing);
  await act(async () => refresh.click());
  expect(axios.get.mock.calls[1][1].params.refresh).toBe(true);
  expect(container.textContent).not.toContain("Harvest sync failed");
});

test("does not overlap pending polls and cleans up polling on unmount", async () => {
  axios.get.mockResolvedValueOnce(syncing).mockImplementation(() => new Promise(() => {}));
  await act(async () => root.render(<EmployeeProductivity />));
  await tick();
  await tick();
  expect(axios.get).toHaveBeenCalledTimes(2);
  await act(async () => root.unmount());
  root = createRoot(container);
  await tick();
  expect(axios.get).toHaveBeenCalledTimes(2);
});

test("proposal prep chart ranks totals and respects employee and billing filters", () => {
  const employees = [
    { employee: "Casey", total_hours: 10, billable_hours: 8, non_billable_hours: 2 },
    { employee: "Alex", total_hours: 20, billable_hours: 0, non_billable_hours: 20 },
  ];
  expect(buildProposalPrepRows(employees, "all", "all")).toEqual([
    { employee: "Alex", hours: 20 }, { employee: "Casey", hours: 10 },
  ]);
  expect(buildProposalPrepRows(employees, "all", "billable")).toEqual([{ employee: "Casey", hours: 8 }]);
  expect(buildProposalPrepRows(employees, "Casey", "non_billable")).toEqual([{ employee: "Casey", hours: 2 }]);
});

test("renders proposal prep below utilization with a meaningful empty state", async () => {
  axios.get.mockResolvedValue({ data: { sync: { status: "idle" }, proposal_prep_employees: [] } });
  await act(async () => root.render(<EmployeeProductivity />));
  expect(container.textContent.indexOf("Proposal Prep Hours")).toBeGreaterThan(
    container.textContent.indexOf("Utilization Rate by Employee")
  );
  expect(container.textContent).toContain("No proposal preparation hours match these filters.");
});
