import React, { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";

import DataQualityTable, {
  __resetDataQualityCacheForTests,
  STATE_GROUP_CANADA,
  STATE_GROUP_UNITED_STATES,
  STATE_OPTION_MISSING,
  STATE_OPTION_UNRECOGNIZED,
  expandSelectedStateProvinceValues,
  getCanonicalStateProvinceValue,
  getCityOptions,
  getStateProvinceFilterOptions,
  getStateProvinceDisplayValue,
  getStateProvinceOptionGroup,
  getStateProvinceOptionLabel,
  getStateProvinceOptions,
  getStateProvinceRequestValues,
  getStateProvinceSelectionSummary,
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
    new_naicstext: "Industrial Machinery Manufacturing",
    ...overrides,
  };
}

function makeAccounts(count) {
  return Array.from({ length: count }, (_value, index) => makeAccount(index + 1));
}

async function renderDataQualityTable(accounts) {
  axios.get.mockImplementation((_url, options = {}) => {
    const params = options.params || {};
    const page = Number(params.page || 0);
    const pageSize = Number(params.page_size || 25);
    const search = String(params.search || "").trim().toLowerCase();
    const columnFilters = JSON.parse(params.column_filters || "{}");
    const sortKey = params.sort_key || "";
    const sortDirection = params.sort_direction || "asc";
    let filteredAccounts = accounts;

    if (search) {
      filteredAccounts = filteredAccounts.filter((account) =>
        Object.values(account).join(" ").toLowerCase().includes(search)
      );
    }

    for (const [columnKey, filterValue] of Object.entries(columnFilters)) {
      const normalizedFilter = String(filterValue || "").trim().toLowerCase();
      if (!normalizedFilter) continue;
      filteredAccounts = filteredAccounts.filter((account) =>
        String(account[columnKey] || "").toLowerCase().includes(normalizedFilter)
      );
    }

    if (sortKey) {
      filteredAccounts = [...filteredAccounts].sort((firstAccount, secondAccount) => {
        const firstValue = String(firstAccount[sortKey] || "").toLowerCase();
        const secondValue = String(secondAccount[sortKey] || "").toLowerCase();
        return firstValue.localeCompare(secondValue) * (sortDirection === "desc" ? -1 : 1);
      });
    }

    const offset = page * pageSize;
    const data = filteredAccounts.slice(offset, offset + pageSize);

    return Promise.resolve({
      data: {
        count: data.length,
        data,
        facets: {
          cities: Array.from(new Set(filteredAccounts.map((account) => account.address1_city))).filter(Boolean),
          countries: Array.from(new Set(filteredAccounts.map((account) => account.address1_country))).filter(Boolean),
          missing_counts: [],
          sectors: Array.from(new Set(filteredAccounts.map((account) => account.new_sector))).filter(Boolean),
          states: Array.from(new Set(filteredAccounts.map((account) => account.address1_stateorprovince))).filter(Boolean),
        },
        filtered_count: filteredAccounts.length,
        has_more: offset + data.length < filteredAccounts.length,
        page,
        page_size: pageSize,
        sync: { status: "idle", is_stale: false, row_count: accounts.length },
        total_count: accounts.length,
      },
    });
  });

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

    expect(view.container.textContent).toContain("Showing 25 of 30 filtered accounts from 30 cached accounts");
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

    expect(view.container.textContent).toContain("Showing 5 of 30 filtered accounts from 30 cached accounts");
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

    expect(view.container.textContent).toContain("Showing 1 of 1 filtered accounts from 30 cached accounts");
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
    expect(view.container.textContent).toContain("0 Accounts Selected");

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

  it("groups and standardizes state/province filter options by United States and Canada", () => {
    const stateOptions = getStateProvinceFilterOptions(
      ["NY", "New York", " ny ", "CA", "California", "ON", "Ontario", "BC", "British Columbia"],
      "all"
    );

    expect(stateOptions).toEqual([
      STATE_GROUP_UNITED_STATES,
      "CA",
      "NY",
      STATE_GROUP_CANADA,
      "BC",
      "ON",
    ]);
    expect(getStateProvinceOptionGroup("NY")).toBe("United States");
    expect(getStateProvinceOptionGroup("ON")).toBe("Canada");
    expect(getStateProvinceOptionLabel(STATE_GROUP_UNITED_STATES)).toBe("United States (all states)");
    expect(getStateProvinceOptionLabel(STATE_GROUP_CANADA)).toBe("Canada (all provinces/territories)");
    expect(getStateProvinceOptionLabel("BC")).toBe("British Columbia");
    expect(getCanonicalStateProvinceValue(" new york ")).toBe("NY");
    expect(getCanonicalStateProvinceValue("ontario")).toBe("ON");
    expect(expandSelectedStateProvinceValues([STATE_GROUP_UNITED_STATES], stateOptions)).toEqual(["CA", "NY"]);
    expect(expandSelectedStateProvinceValues([STATE_GROUP_UNITED_STATES, STATE_GROUP_CANADA], stateOptions)).toEqual([
      "CA",
      "NY",
      "BC",
      "ON",
    ]);
    expect(getStateProvinceRequestValues(["NY"], ["NY", "New York", "CA"])).toEqual(["NY", "New York"]);
    expect(getStateProvinceSelectionSummary(["NY"], stateOptions)).toBe("United States: 1 of 2 locations");
    expect(getStateProvinceSelectionSummary([STATE_GROUP_CANADA], stateOptions)).toBe("Canada: all locations");
  });

  it("keeps missing and unrecognized state/province values separate", () => {
    const stateOptionRecords = [
      { value: "NY", country_group: "us", status: "recognized", raw_values: ["NY", "New York"] },
      { value: "BC", country_group: "canada", status: "recognized", raw_values: ["BC"] },
      { value: "Bavaria", country_group: null, status: "unrecognized", raw_values: ["Bavaria"] },
      { value: "", country_group: null, status: "missing", raw_values: [""] },
    ];
    const stateOptions = getStateProvinceFilterOptions(["NY", "New York", "BC", "Bavaria", ""], "all", stateOptionRecords);

    expect(stateOptions).toEqual([
      STATE_GROUP_UNITED_STATES,
      "NY",
      STATE_GROUP_CANADA,
      "BC",
      STATE_OPTION_MISSING,
      STATE_OPTION_UNRECOGNIZED,
    ]);
    expect(getStateProvinceOptionGroup(STATE_OPTION_MISSING)).toBe("Missing");
    expect(getStateProvinceOptionGroup(STATE_OPTION_UNRECOGNIZED)).toBe("Needs cleanup");
    expect(getStateProvinceRequestValues([STATE_OPTION_MISSING], [], stateOptionRecords)).toEqual(["__missing_state_province__"]);
    expect(getStateProvinceRequestValues([STATE_OPTION_UNRECOGNIZED], [], stateOptionRecords)).toEqual(["Bavaria"]);
    expect(getStateProvinceRequestValues(["NY"], [], stateOptionRecords)).toEqual(["NY", "New York"]);
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
    expect(getCityOptions(accounts, "Canada", [STATE_GROUP_CANADA])).toEqual(["Toronto"]);
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
        new_naicstext: "Machine Shops",
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

    const stateOptionsButtonAfterSort = view.container.querySelector('button[aria-label="State/Province filter and sort options"]');
    await act(async () => {
      stateOptionsButtonAfterSort.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const sortDescendingButton = Array.from(document.body.querySelectorAll("li")).find(
      (item) => item.textContent.includes("Sort descending")
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

    expect(view.container.textContent).toContain("Showing 1 of 1 filtered accounts from 3 cached accounts");
    expect(getRowNames(view.container)).toEqual(["Contoso Manufacturing"]);

    view.unmount();
  });
});
