import React, { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import CompanyFinancials from "./CompanyFinancials";
import { getCurrentUser } from "../auth";
import { getQuickBooksConnectUrl } from "../quickbooksApi";

window.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock("axios");
jest.mock("../quickbooksApi", () => ({ getQuickBooksConnectUrl: jest.fn() }));
jest.mock("../auth", () => ({
  API_BASE_URL: "http://localhost",
  getAuthHeaders: () => ({}),
  getCurrentUser: jest.fn(),
  handleUnauthorized: () => false,
  getApiErrorMessage: (_error, fallback) => fallback,
}));
jest.mock("recharts", () => ({ ...jest.requireActual("recharts"), ResponsiveContainer: () => null }));
let root;
let container;
beforeEach(() => {
  jest.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  axios.get.mockRejectedValue({ response: { status: 409 } });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

test("admin can start authorization directly and retry if it cannot start", async () => {
  getCurrentUser.mockReturnValue({ role: "admin" });
  getQuickBooksConnectUrl.mockRejectedValue({ userMessage: "Authorization unavailable" });
  await act(async () => root.render(<CompanyFinancials />));
  const button = Array.from(container.querySelectorAll("button")).find((node) => node.textContent === "Connect QuickBooks");
  expect(button).toBeDefined();
  await act(async () => button.click());
  expect(getQuickBooksConnectUrl).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain("Authorization unavailable");
  expect(button.disabled).toBe(false);
});

test("non-admin is told who can connect and is not shown the admin action", async () => {
  getCurrentUser.mockReturnValue({ role: "user", modules: ["management"] });
  await act(async () => root.render(<CompanyFinancials />));
  expect(container.textContent).toContain("administrator needs to connect QuickBooks");
  expect(Array.from(container.querySelectorAll("button")).some((node) => node.textContent === "Connect QuickBooks")).toBe(false);
});
