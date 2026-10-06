import React, { act } from "react";
import { createRoot } from "react-dom/client";
import LandingPage from "./landingPage";
import { prefetch } from "./apiClient";
window.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock("./apiClient", () => ({ prefetch: jest.fn() }));
jest.mock("./auth", () => ({ API_BASE_URL: "http://localhost", getAuthHeaders: () => ({ Authorization: "Bearer test" }) }));
jest.mock("./components/MaintenanceHome", () => () => <div>Home content</div>);
jest.mock("./components/EnrichmentWorkspace", () => () => <div>Enrichment content</div>);
jest.mock("./components/DuplicateAccounts", () => () => <div>Duplicate Accounts content</div>);
let root, container;
beforeEach(() => { jest.clearAllMocks(); window.history.replaceState({}, "", "/dashboard"); container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const render = async () => act(async () => root.render(<LandingPage onLogout={() => {}} />));
const button = (text) => Array.from(container.querySelectorAll("button")).find((node) => node.textContent === text);
it("shows exactly the consolidated navigation with Home first", async () => {
  await render(); expect(Array.from(container.querySelectorAll("nav button")).map((node) => node.textContent)).toEqual(["Home", "Enrichment", "Duplicate Accounts"]);
  expect(container.textContent).toContain("Home content"); expect(button("Home").getAttribute("aria-current")).toBe("page");
});
it.each([["/dashboard/enrichment", "Enrichment"], ["/dashboard/duplicate-accounts", "Duplicate Accounts"]])("supports direct navigation to %s", async (route, name) => {
  window.history.replaceState({}, "", route); await render(); expect(container.textContent).toContain(`${name} content`); expect(button(name).getAttribute("aria-current")).toBe("page");
});
it.each(["/dashboard/seamless", "/dashboard/data-quality"])("replaces the legacy bookmark %s with the canonical route", async (route) => {
  window.history.replaceState({}, "", route + "?source=bookmark#accounts");
  const replace = jest.spyOn(window.history, "replaceState"); const push = jest.spyOn(window.history, "pushState");
  await render(); expect(window.location.pathname).toBe("/dashboard/enrichment"); expect(window.location.search).toBe("?source=bookmark"); expect(window.location.hash).toBe("#accounts");
  expect(container.textContent).toContain("Enrichment content"); expect(replace).toHaveBeenCalled(); expect(push).not.toHaveBeenCalled(); replace.mockRestore(); push.mockRestore();
});
it("supports navigation, Home and legacy browser popstate", async () => {
  await render(); await act(async () => button("Enrichment").click()); expect(window.location.pathname).toBe("/dashboard/enrichment");
  expect(container.textContent).toContain("Keep Dynamics account information complete and up to date.");
  await act(async () => button("Home").click()); expect(window.location.pathname).toBe("/dashboard");
  await act(async () => { window.history.replaceState({}, "", "/dashboard/data-quality"); window.dispatchEvent(new PopStateEvent("popstate")); });
  expect(window.location.pathname).toBe("/dashboard/enrichment"); expect(container.textContent).toContain("Enrichment content");
});
it("prefetches only narrow credits for Enrichment and the existing Home contract", async () => {
  await render(); await act(async () => button("Enrichment").focus());
  expect(prefetch).toHaveBeenCalledWith("http://localhost/maintenance/enrichment/credits", expect.objectContaining({ headers: { Authorization: "Bearer test" }, ttl: 30000 }));
  await act(async () => button("Home").focus());
  expect(prefetch).toHaveBeenCalledWith("http://localhost/maintenance/home", expect.objectContaining({ params: { days: 14, view: "recent", limit: 25 }, ttl: 30000 }));
});

it("redirects the retired Summary Analytics bookmark to Home", async () => {
  window.history.replaceState({}, "", "/dashboard/summary-analytics?source=bookmark#sectors");
  const replace = jest.spyOn(window.history, "replaceState");
  await render();
  expect(window.location.pathname).toBe("/dashboard");
  expect(window.location.search).toBe("?source=bookmark");
  expect(container.textContent).toContain("Home content");
  expect(replace).toHaveBeenCalled(); replace.mockRestore();
});
