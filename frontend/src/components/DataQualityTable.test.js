import React, { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";

import DataQualityTable, {
  __resetDataQualityCacheForTests,
  getCityOptions,
  getStateProvinceDisplayValue,
  getStateProvinceOptions,
} from "./DataQualityTable";

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
    new_subsector: "Fabricated Metal",
    websiteurl: `company${index}.com`,
    address1_stateorprovince: "NY",
    address1_country: "USA",
    address1_city: "Albany",
    description: `Description ${index}`,
    telephone1: `555-010${index}`,
    new_datasource: "Dynamics",
    new_employees: 100 + index,
    new_NAICStext: "Industrial Machinery Manufacturing",
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
    __resetDataQualityCacheForTests();
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

  it("orders website, country, state/province, and city columns together", async () => {
    const view = await renderDataQualityTable(makeAccounts(1));
    const headerLabels = Array.from(view.container.querySelectorAll("thead tr:first-child th"))
      .map((headerCell) => headerCell.textContent.trim())
      .filter(Boolean);

    expect(headerLabels.slice(2, 10)).toEqual([
      "Subsector",
      "Website",
      "Business Phone",
      "Country",
      "State/Province",
      "City",
      "Employee Count",
      "NAICS Text",
    ]);

    view.unmount();
  });

  it("limits state/province options to the selected country", () => {
    const accounts = [
      makeAccount(1, { address1_country: "USA", address1_stateorprovince: "NY" }),
      makeAccount(2, { address1_country: "United States", address1_stateorprovince: "CA" }),
      makeAccount(3, { address1_country: "Canada", address1_stateorprovince: "ON" }),
      makeAccount(4, { address1_country: "CA", address1_stateorprovince: "BC" }),
    ];

    expect(getStateProvinceOptions(accounts, "USA")).toEqual(["California", "New York"]);
    expect(getStateProvinceOptions(accounts, "Canada")).toEqual(["British Columbia", "Ontario"]);
    expect(getStateProvinceDisplayValue("TX", "United States")).toBe("Texas");
    expect(getStateProvinceDisplayValue("QC", "Canada")).toBe("Quebec");
  });

  it("limits city options to selected country and state/province values", () => {
    const accounts = [
      makeAccount(1, { address1_country: "USA", address1_stateorprovince: "TX", address1_city: "Austin" }),
      makeAccount(2, { address1_country: "USA", address1_stateorprovince: "TX", address1_city: "Dallas" }),
      makeAccount(3, { address1_country: "USA", address1_stateorprovince: "CA", address1_city: "Los Angeles" }),
      makeAccount(4, { address1_country: "Canada", address1_stateorprovince: "ON", address1_city: "Toronto" }),
    ];

    expect(getCityOptions(accounts, "USA", [])).toEqual([]);
    expect(getCityOptions(accounts, "USA", ["Texas"])).toEqual(["Austin", "Dallas"]);
    expect(getCityOptions(accounts, "USA", ["California", "Texas"])).toEqual([
      "Austin",
      "Dallas",
      "Los Angeles",
    ]);
    expect(getCityOptions(accounts, "Canada", ["Ontario"])).toEqual(["Toronto"]);
  });

  it("renders state/province abbreviations as full names", async () => {
    const view = await renderDataQualityTable([
      makeAccount(1, { address1_country: "USA", address1_stateorprovince: "TX" }),
    ]);

    expect(view.container.textContent).toContain("Texas");
    expect(view.container.textContent).not.toContain("TX");

    view.unmount();
  });

  it("opens a formal company preview from the company name", async () => {
    const view = await renderDataQualityTable([
      makeAccount(1, {
        name: "Acme Manufacturing",
        new_sector: "Industrial",
        new_subsector: "Aerospace",
        address1_country: "USA",
        address1_stateorprovince: "TX",
        address1_city: "Austin",
        description: "Builds precision components.",
        new_NAICStext: "Machine Shops",
      }),
    ]);
    const companyButton = Array.from(view.container.querySelectorAll("button")).find(
      (button) => button.textContent === "Acme Manufacturing"
    );

    await act(async () => {
      companyButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("Company Preview");
    expect(document.body.textContent).toContain("Industrial");
    expect(document.body.textContent).toContain("Aerospace");
    expect(document.body.textContent).toContain("USA");
    expect(document.body.textContent).toContain("Texas");
    expect(document.body.textContent).toContain("Builds precision components.");
    expect(document.body.textContent).toContain("Machine Shops");

    view.unmount();
  });

  it("sorts location columns from the column header", async () => {
    const view = await renderDataQualityTable([
      makeAccount(1, { name: "Bravo Co", address1_stateorprovince: "TX" }),
      makeAccount(2, { name: "Alpha Co", address1_stateorprovince: "CA" }),
      makeAccount(3, { name: "Charlie Co", address1_stateorprovince: "NY" }),
    ]);
    const stateOptionsButton = view.container.querySelector('button[aria-label="State/Province filter and sort options"]');

    await act(async () => {
      stateOptionsButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const sortAscendingButton = Array.from(document.body.querySelectorAll("li")).find(
      (item) => item.textContent === "Sort ascending"
    );

    await act(async () => {
      sortAscendingButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(getRowNames(view.container)).toEqual(["Alpha Co", "Charlie Co", "Bravo Co"]);

    await act(async () => {
      stateOptionsButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const sortDescendingButton = Array.from(document.body.querySelectorAll("li")).find(
      (item) => item.textContent === "Sort descending"
    );

    await act(async () => {
      sortDescendingButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(getRowNames(view.container)).toEqual(["Bravo Co", "Charlie Co", "Alpha Co"]);

    view.unmount();
  });

  it("filters from column header inputs", async () => {
    const view = await renderDataQualityTable([
      makeAccount(1, { name: "Northwind Traders" }),
      makeAccount(2, { name: "Contoso Manufacturing" }),
      makeAccount(3, { name: "Fabrikam Industrial" }),
    ]);
    const companyOptionsButton = view.container.querySelector('button[aria-label="Company Name filter and sort options"]');

    await act(async () => {
      companyOptionsButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const companyFilter = document.body.querySelector('input[aria-label="Filter Company Name"]');

    await act(async () => {
      setInputValue(companyFilter, "contoso");
    });

    expect(view.container.textContent).toContain("Showing 1 of 1 Accounts");
    expect(getRowNames(view.container)).toEqual(["Contoso Manufacturing"]);

    view.unmount();
  });
});
