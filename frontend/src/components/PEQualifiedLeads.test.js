import React, { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import PEQualifiedLeads, { filterAndSortQualifiedLeads } from "./PEQualifiedLeads";

jest.mock("axios");
jest.mock("../auth", () => ({
  API_BASE_URL: "http://localhost:8000",
  getApiErrorMessage: () => "Request failed",
  getAuthHeaders: () => ({}),
  handleUnauthorized: () => false,
}));
jest.mock("recharts", () => ({
  Bar: () => null, BarChart: () => null, CartesianGrid: () => null,
  Line: () => null, LineChart: () => null, ResponsiveContainer: () => null,
  Tooltip: () => null, XAxis: () => null, YAxis: () => null,
}));

window.IS_REACT_ACT_ENVIRONMENT = true;

const leads = [
  { id: "1", prospect_name: "Zeta Manufacturing", client_name: "Client B", status: "Qualified", createdon: "2026-02-01T10:00:00Z" },
  { id: "2", prospect_name: "Alpha & Sons", client_name: "Client A", status: "Qualified", createdon: "2026-01-01T10:00:00Z" },
  { id: "3", prospect_name: "Blue Works", client_name: "Client A", status: "Qualified", createdon: null },
];

test("searches prospects and clients, filters by client, and sorts dates with missing dates last", () => {
  expect(filterAndSortQualifiedLeads(leads, "client a", "", "prospect").map((lead) => lead.id)).toEqual(["2", "3"]);
  expect(filterAndSortQualifiedLeads(leads, "blue", "Client A", "newest").map((lead) => lead.id)).toEqual(["3"]);
  expect(filterAndSortQualifiedLeads(leads, "", "", "oldest").map((lead) => lead.id)).toEqual(["2", "1", "3"]);
  expect(filterAndSortQualifiedLeads(leads, "", "", "newest").map((lead) => lead.id)).toEqual(["1", "2", "3"]);
});

test("shows lead rows and makes the API record limit clear", async () => {
  axios.get.mockResolvedValue({ data: {
    data: leads, total_count: 12, rollups: [], yearly_rollups: [], status: "Qualified",
  } });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  try {
    await act(async () => root.render(<PEQualifiedLeads />));
    expect(container.textContent).toContain("Qualified Lead Details");
    expect(container.textContent).toContain("Zeta Manufacturing");
    expect(container.textContent).toContain("Showing the first 3 of 12 leads");
    expect(container.querySelectorAll("tbody tr")).toHaveLength(3);
    expect(axios.get).toHaveBeenCalledWith("http://localhost:8000/pe-qualified-leads", expect.objectContaining({
      params: expect.objectContaining({ limit: 5000 }),
    }));
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
