import { formatSeoTooltipMetrics } from "./MarketingMetrics";

describe("SEO chart formatting", () => {
  it("formats every Search Console metric for the chart tooltip", () => {
    expect(formatSeoTooltipMetrics({
      clicks: 1234,
      impressions: 50000,
      ctr: 1234 / 50000,
      average_position: 12.456,
    })).toEqual({
      clicks: "1,234",
      impressions: "50,000",
      ctr: "2.47%",
      averagePosition: "12.46",
    });
  });
});
