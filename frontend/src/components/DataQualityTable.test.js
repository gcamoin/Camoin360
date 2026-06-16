import React, { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";

import DataQualityTable from "./DataQualityTable";

const SEARCH_DEBOUNCE_MS = 200;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("axios");
jest.mock("../auth", () => ({
  API_BASE_URL: "http://localhost",
  getApiErrorMessage: (_error, fallback) => fallback,
  getAuthHeaders: () => ({ Authorization: "Bearer test" }),
  handleUnauthorized: () => false,
}));

function makeAccount(index, overrides = {}) {
  return {
    accountid: `account-${index}`,
    name: `Company ${index}`,
    new_sector: index % 2 ? "Manufacturing" : "Technology",
    websiteurl: `company${index}.com`,
    address1_stateorprovince: "NY",
    address1_country: "USA",
    address1_city: "Albany",
    description: `Description ${index}`,
    telephone1: `555-010${index}`,
    new_datasource: "Dynamics",
    new_employees: 100 + index,
    ...overrides,
  };
}

function makeAccounts(count) {
  return Array.from({ length: count }, (_value, index) => makeAccount(index + 1));
}

async function renderDataQualityTable(accounts) {
  axios.get.mockResolvedValueOnce({ data: { data: accounts } });

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<DataQualityTable />);
  });

  await act(async () => {
    await Promise.resolve();
  });

  return {
    container,
    root,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

function getRowNames(container) {
  return Array.from(container.querySelectorAll("tbody tr"))
    .map((row) => row.querySelectorAll("td")[1]?.textContent)
    .filter(Boolean);
}

function setInputValue(input, value) {
  const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;

  valueSetter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("DataQualityTable pagination edge cases", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    axios.get.mockReset();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    document.body.innerHTML = "";
  });

  it("renders 25 rows by default and reports the filtered total", async () => {
    const view = await renderDataQualityTable(makeAccounts(30));

    expect(view.container.textContent).toContain("Showing 25 of 30 Accounts");
    expect(getRowNames(view.container)).toHaveLength(25);
    expect(getRowNames(view.container)[0]).toBe("Company 1");
    expect(getRowNames(view.container)[24]).toBe("Company 25");

    view.unmount();
  });

  it("paginates to the remaining rows without losing filtered totals", async () => {
    const view = await renderDataQualityTable(makeAccounts(30));
    const nextPageButton = view.container.querySelector('button[aria-label="Go to next page"]');

    await act(async () => {
      nextPageButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(view.container.textContent).toContain("Showing 5 of 30 Accounts");
    expect(getRowNames(view.container)).toEqual([
      "Company 26",
      "Company 27",
      "Company 28",
      "Company 29",
      "Company 30",
    ]);

    view.unmount();
  });

  it("resets pagination when search narrows results from a later page", async () => {
    const view = await renderDataQualityTable(makeAccounts(30));
    const nextPageButton = view.container.querySelector('button[aria-label="Go to next page"]');

    await act(async () => {
      nextPageButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const searchInput = view.container.querySelector('input[placeholder="Name, sector, website, state, country, city..."]');
    await act(async () => {
      setInputValue(searchInput, "Company 30");
      jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      await Promise.resolve();
    });

    expect(view.container.textContent).toContain("Showing 1 of 1 Accounts");
    expect(getRowNames(view.container)).toEqual(["Company 30"]);

    view.unmount();
  });

  it("selects only rows visible on the current page", async () => {
    const view = await renderDataQualityTable(makeAccounts(30));
    const selectVisibleCheckbox = view.container.querySelector('thead input[type="checkbox"]');

    await act(async () => {
      selectVisibleCheckbox.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(view.container.textContent).toContain("25 visible selected");
    expect(view.container.textContent).toContain("25 Accounts Selected");

    const nextPageButton = view.container.querySelector('button[aria-label="Go to next page"]');
    await act(async () => {
      nextPageButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(view.container.textContent).toContain("0 visible selected");
    expect(view.container.textContent).toContain("25 Accounts Selected");

    view.unmount();
  });
});
