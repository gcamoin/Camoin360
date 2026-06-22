import { getAccountCompleteness } from "./DuplicateAccounts";

describe("duplicate account completeness scoring", () => {
  it("scores only business data fields and counts zero as a filled value", () => {
    const result = getAccountCompleteness({
      accountid: "record-id",
      name: "Example Company",
      websiteurl: "example.com",
      new_employees: 0,
      createdon: "2026-01-01",
    });

    expect(result).toEqual({
      filledFieldCount: 3,
      totalFieldCount: 13,
      score: 23,
    });
  });

  it("treats blank strings as missing", () => {
    const result = getAccountCompleteness({
      name: "   ",
      websiteurl: null,
      telephone1: undefined,
    });

    expect(result.filledFieldCount).toBe(0);
    expect(result.score).toBe(0);
  });
});
