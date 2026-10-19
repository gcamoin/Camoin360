import React, { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import { getCached } from "../apiClient";
import PEClients from "./PEClients";
import { filterAndSortClients } from "./PEClients";

jest.mock("axios");
jest.mock("../apiClient", () => ({ getCached: jest.fn(), invalidateApiCache: jest.fn() }));
jest.mock("../auth", () => ({
  API_BASE_URL: "http://localhost:8000",
  getApiErrorMessage: () => "Request failed",
  getAuthHeaders: () => ({}),
  handleUnauthorized: () => false,
}));

window.IS_REACT_ACT_ENVIRONMENT = true;

const clients = [
  { organization_name: "Zeta Systems", city: "New York", state: "NY", user_count: 2, contract_expiration: null },
  { organization_name: "Alpha Consulting", city: "Boston", state: "MA", user_count: 7, contract_expiration: "2027-06-01" },
  { organization_name: "Blue Group", city: "Albany", state: "NY", user_count: 7, contract_expiration: "2026-11-01" },
];

test("searches client names and locations without changing source order", () => {
  expect(filterAndSortClients(clients, "  ny ", "name_asc").map((client) => client.organization_name))
    .toEqual(["Blue Group", "Zeta Systems"]);
  expect(filterAndSortClients(clients, "Boston", "name_asc").map((client) => client.organization_name))
    .toEqual(["Alpha Consulting"]);
  expect(clients[0].organization_name).toBe("Zeta Systems");
});

test("sorts by user count or earliest contract, putting unset contracts last", () => {
  expect(filterAndSortClients(clients, "", "users_desc").map((client) => client.organization_name))
    .toEqual(["Alpha Consulting", "Blue Group", "Zeta Systems"]);
  expect(filterAndSortClients(clients, "", "expiration_asc").map((client) => client.organization_name))
    .toEqual(["Blue Group", "Alpha Consulting", "Zeta Systems"]);
});

test("opens a client through its explicit View action", async () => {
  getCached.mockResolvedValue({ data: { data: [{ ...clients[0], id: 1 }] } });
  axios.get.mockResolvedValue({ data: { data: [] } });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  try {
    await act(async () => root.render(<PEClients />));
    const viewButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "View");
    expect(viewButton).toBeTruthy();
    await act(async () => viewButton.click());
    expect(container.textContent).toContain("Back to Organizations");
    expect(container.textContent).toContain("Zeta Systems");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
