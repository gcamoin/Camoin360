import { filterReportingRows, matchesReportingPeriod, reportingParams } from "./reportingPeriod";

const all = { year: "all", quarter: "all", month: "all", startDate: "", endDate: "" };
const monthly = [
  { monthKey: "2024-01", value: 1 }, { monthKey: "2025-01", value: 2 },
  { monthKey: "2025-03", value: 3 }, { monthKey: "2025-04", value: 4 },
];
test("calendar filters intersect and clearing restores all rows", () => {
  expect(filterReportingRows(monthly, { ...all, year: "2025", quarter: "1" }).map((row) => row.value)).toEqual([2, 3]);
  expect(filterReportingRows(monthly, { ...all, month: "1" }).map((row) => row.value)).toEqual([1, 2]);
  expect(filterReportingRows(monthly, { ...all, year: "2023" })).toEqual([]);
  expect(filterReportingRows(monthly, all)).toEqual(monthly);
});
test("monthly periods overlap inclusive date boundaries without falling back to all data", () => {
  expect(filterReportingRows(monthly, { startDate: "2025-01-31", endDate: "2025-03-01" }).map((row) => row.value)).toEqual([2, 3]);
  expect(filterReportingRows(monthly, { startDate: "2025-03-01", endDate: "2025-01-31" })).toEqual([]);
});
test.each([
  [{ period_key: "2025-02" }, { month: "2" }, true],
  [{ period_key: "2025-02-15" }, { endDate: "2025-02-14" }, false],
  [{ month_key: "2025-02" }, { month: "2" }, true],
  [{ month: "2025-02" }, { quarter: "1" }, true],
  [{ year: 2025, month: 2 }, { year: "2025", month: "2" }, true],
  [{ year: "2025", quarter: "Q2" }, { month: "4" }, true],
  [{ year: 2025, quarter: "2" }, { quarter: "1" }, false],
  [{ year: 2025, date: "Q2 '25" }, { month: "5" }, true],
  [{ year: 2025, date: "Jan '25" }, { month: "2" }, false],
  [{ month: "February 2025" }, { month: "2" }, true],
  [{ year: "2025" }, { startDate: "2026-01-01" }, false],
  [{ day_key: "2025-02-03" }, { startDate: "2025-02-04" }, false],
  [{ created_on: "2025-02-03T19:00:00Z" }, { endDate: "2025-02-03" }, true],
])("supports report date formats %j", (row, filters, expected) => {
  expect(matchesReportingPeriod(row, filters)).toBe(expected);
});
test("server params include the complete selection and omit all/blank values", () => {
  expect(reportingParams(all)).toEqual({});
  expect(reportingParams({ ...all, year: "2025", quarter: "2", startDate: "2025-04-15" })).toEqual({ year: "2025", quarter: "2", start_date: "2025-04-15" });
});
