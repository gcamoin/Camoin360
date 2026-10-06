import { STATE_GROUP_CANADA, STATE_GROUP_UNITED_STATES, STATE_OPTION_MISSING, STATE_OPTION_UNRECOGNIZED, expandSelectedStateProvinceValues, getCanonicalStateProvinceValue, getCityOptions, getStateProvinceFilterOptions, getStateProvinceOptionGroup, getStateProvinceOptionLabel, getStateProvinceOptions, getStateProvinceDisplayValue, getStateProvinceRequestValues, getStateProvinceSelectionSummary, prepareAccountRows } from "./DataQualityTable";

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

describe("Retained legacy Data Quality helpers", () => {
it("keeps only blank websites and shows Website first for a missing website search", () => {
    const rows = prepareAccountRows([
      makeAccount(1, { websiteurl: "https://example.com", new_sector: "" }),
      makeAccount(2, { websiteurl: "", new_sector: "" }),
    ], "websiteurl");

    expect(rows).toHaveLength(1);
    expect(rows[0].accountid).toBe("account-2");
    expect(rows[0].missingFieldsSummary).toMatch(/^Website/);
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
});
