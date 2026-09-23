import { buildMarketingSourceCharts } from "./MarketingSource";

const rows = [
  { service_line_key: "workforce", service_line: "Workforce", month: 1, month_key: "2026-01", period: "Jan '26", source: "Google", visits: 10 },
  { service_line_key: "workforce", service_line: "Workforce", month: 1, month_key: "2026-01", period: "Jan '26", source: "Direct", visits: 6 },
  { service_line_key: "real_estate", service_line: "Real Estate", month: 2, month_key: "2026-02", period: "Feb '26", source: "Google", visits: 4 },
];

describe("marketing source chart transformation", () => {
  it("filters rows and creates stacked monthly and ranked source data", () => {
    const result = buildMarketingSourceCharts(rows, { serviceLine: "workforce", source: "all", month: "all" });
    expect(result.monthly).toEqual([expect.objectContaining({
      Google: 10,
      Direct: 6,
      service_line: "Workforce",
      axis_label: "Jan '26 · Workforce",
    })]);
    expect(result.trafficBySource).toEqual([
      { source: "Google", visits: 10 },
      { source: "Direct", visits: 6 },
    ]);
    expect(result.monthlyByServiceLine).toEqual([
      { serviceLine: "Workforce", data: result.monthly },
    ]);
  });
});
