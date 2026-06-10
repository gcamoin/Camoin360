import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Box, Button, Paper, Stack, Typography } from "@mui/material";

// ── Raw data ──────────────────────────────────────────────────────────────────

const RAW_SENTIMENT = [
  { year: 2008, date: "Q1 '08", value: 70 },
  { year: 2008, date: "Q3 '08", value: 61 },
  { year: 2009, date: "Q1 '09", value: 56 },
  { year: 2009, date: "Q3 '09", value: 70 },
  { year: 2010, date: "Q1 '10", value: 74 },
  { year: 2010, date: "Q3 '10", value: 68 },
  { year: 2011, date: "Q1 '11", value: 74 },
  { year: 2011, date: "Q3 '11", value: 58 },
  { year: 2012, date: "Q1 '12", value: 75 },
  { year: 2012, date: "Q3 '12", value: 79 },
  { year: 2013, date: "Q1 '13", value: 77 },
  { year: 2013, date: "Q3 '13", value: 85 },
  { year: 2014, date: "Q1 '14", value: 81 },
  { year: 2014, date: "Q3 '14", value: 83 },
  { year: 2015, date: "Q1 '15", value: 95 },
  { year: 2015, date: "Q3 '15", value: 91 },
  { year: 2016, date: "Q1 '16", value: 92 },
  { year: 2016, date: "Q3 '16", value: 89 },
  { year: 2017, date: "Q1 '17", value: 97 },
  { year: 2017, date: "Q3 '17", value: 95 },
  { year: 2018, date: "Q1 '18", value: 99 },
  { year: 2018, date: "Q3 '18", value: 96 },
  { year: 2019, date: "Q1 '19", value: 93 },
  { year: 2019, date: "Q3 '19", value: 93 },
  { year: 2020, date: "Q1 '20", value: 90 },
  { year: 2020, date: "Q3 '20", value: 74 },
  { year: 2021, date: "Q1 '21", value: 84 },
  { year: 2021, date: "Q3 '21", value: 72 },
  { year: 2022, date: "Q1 '22", value: 62 },
  { year: 2022, date: "Q3 '22", value: 59 },
  { year: 2023, date: "Q1 '23", value: 67 },
  { year: 2023, date: "Q3 '23", value: 69 },
  { year: 2024, date: "Q1 '24", value: 77 },
  { year: 2024, date: "Q3 '24", value: 72 },
];

const RAW_GDP = [
  { year: 2018, date: "Q1'18", value: 2.5 },
  { year: 2018, date: "Q2'18", value: 4.2 },
  { year: 2018, date: "Q3'18", value: 3.0 },
  { year: 2018, date: "Q4'18", value: 1.1 },
  { year: 2019, date: "Q1'19", value: 3.1 },
  { year: 2019, date: "Q2'19", value: 2.0 },
  { year: 2019, date: "Q3'19", value: 2.1 },
  { year: 2019, date: "Q4'19", value: 2.4 },
  { year: 2020, date: "Q1'20", value: -5.0 },
  { year: 2020, date: "Q2'20", value: -29.9 },
  { year: 2020, date: "Q3'20", value: 35.3 },
  { year: 2020, date: "Q4'20", value: 4.0 },
  { year: 2021, date: "Q1'21", value: 6.3 },
  { year: 2021, date: "Q2'21", value: 6.7 },
  { year: 2021, date: "Q3'21", value: 2.3 },
  { year: 2021, date: "Q4'21", value: 6.9 },
  { year: 2022, date: "Q1'22", value: -1.6 },
  { year: 2022, date: "Q2'22", value: -0.6 },
  { year: 2022, date: "Q3'22", value: 3.2 },
  { year: 2022, date: "Q4'22", value: 2.6 },
  { year: 2023, date: "Q1'23", value: 2.0 },
  { year: 2023, date: "Q2'23", value: 2.4 },
  { year: 2023, date: "Q3'23", value: 4.9 },
  { year: 2023, date: "Q4'23", value: 3.4 },
  { year: 2024, date: "Q1'24", value: 1.4 },
  { year: 2024, date: "Q2'24", value: 3.0 },
  { year: 2024, date: "Q3'24", value: 2.8 },
];

const RAW_TREASURY = [
  { year: 2018, date: "Q1'18", twoYear: 2.27, tenYear: 2.74 },
  { year: 2018, date: "Q2'18", twoYear: 2.55, tenYear: 2.93 },
  { year: 2018, date: "Q3'18", twoYear: 2.82, tenYear: 3.05 },
  { year: 2018, date: "Q4'18", twoYear: 2.96, tenYear: 3.14 },
  { year: 2019, date: "Q1'19", twoYear: 2.44, tenYear: 2.41 },
  { year: 2019, date: "Q2'19", twoYear: 1.87, tenYear: 2.00 },
  { year: 2019, date: "Q3'19", twoYear: 1.71, tenYear: 1.66 },
  { year: 2019, date: "Q4'19", twoYear: 1.60, tenYear: 1.92 },
  { year: 2020, date: "Q1'20", twoYear: 0.59, tenYear: 0.87 },
  { year: 2020, date: "Q2'20", twoYear: 0.21, tenYear: 0.66 },
  { year: 2020, date: "Q3'20", twoYear: 0.14, tenYear: 0.68 },
  { year: 2020, date: "Q4'20", twoYear: 0.13, tenYear: 0.93 },
  { year: 2021, date: "Q1'21", twoYear: 0.16, tenYear: 1.74 },
  { year: 2021, date: "Q2'21", twoYear: 0.25, tenYear: 1.52 },
  { year: 2021, date: "Q3'21", twoYear: 0.27, tenYear: 1.52 },
  { year: 2021, date: "Q4'21", twoYear: 0.73, tenYear: 1.51 },
  { year: 2022, date: "Q1'22", twoYear: 2.33, tenYear: 2.33 },
  { year: 2022, date: "Q2'22", twoYear: 2.96, tenYear: 2.98 },
  { year: 2022, date: "Q3'22", twoYear: 4.22, tenYear: 3.83 },
  { year: 2022, date: "Q4'22", twoYear: 4.41, tenYear: 3.87 },
  { year: 2023, date: "Q1'23", twoYear: 4.60, tenYear: 3.96 },
  { year: 2023, date: "Q2'23", twoYear: 4.87, tenYear: 3.84 },
  { year: 2023, date: "Q3'23", twoYear: 5.04, tenYear: 4.57 },
  { year: 2023, date: "Q4'23", twoYear: 4.43, tenYear: 3.97 },
  { year: 2024, date: "Q1'24", twoYear: 4.59, tenYear: 4.20 },
  { year: 2024, date: "Q2'24", twoYear: 4.75, tenYear: 4.36 },
  { year: 2024, date: "Q3'24", twoYear: 3.64, tenYear: 3.79 },
  { year: 2024, date: "Q4'24", twoYear: 4.24, tenYear: 4.57 },
];

const RAW_SP500 = [
  { year: 2008, date: "Q1 '08", value: 195 },
  { year: 2008, date: "Q3 '08", value: 143 },
  { year: 2009, date: "Q1 '09", value: 98 },
  { year: 2009, date: "Q3 '09", value: 125 },
  { year: 2010, date: "Q1 '10", value: 140 },
  { year: 2010, date: "Q3 '10", value: 145 },
  { year: 2011, date: "Q1 '11", value: 162 },
  { year: 2011, date: "Q3 '11", value: 143 },
  { year: 2012, date: "Q1 '12", value: 170 },
  { year: 2012, date: "Q3 '12", value: 192 },
  { year: 2013, date: "Q1 '13", value: 210 },
  { year: 2013, date: "Q3 '13", value: 218 },
  { year: 2014, date: "Q1 '14", value: 235 },
  { year: 2014, date: "Q3 '14", value: 255 },
  { year: 2015, date: "Q1 '15", value: 270 },
  { year: 2015, date: "Q3 '15", value: 248 },
  { year: 2016, date: "Q1 '16", value: 265 },
  { year: 2016, date: "Q3 '16", value: 292 },
  { year: 2017, date: "Q1 '17", value: 295 },
  { year: 2017, date: "Q3 '17", value: 315 },
  { year: 2018, date: "Q1 '18", value: 295 },
  { year: 2018, date: "Q3 '18", value: 315 },
  { year: 2019, date: "Q1 '19", value: 310 },
  { year: 2019, date: "Q3 '19", value: 342 },
  { year: 2020, date: "Q1 '20", value: 305 },
  { year: 2020, date: "Q3 '20", value: 315 },
  { year: 2021, date: "Q1 '21", value: 358 },
  { year: 2021, date: "Q3 '21", value: 405 },
  { year: 2022, date: "Q1 '22", value: 395 },
  { year: 2022, date: "Q3 '22", value: 322 },
  { year: 2023, date: "Q1 '23", value: 352 },
  { year: 2023, date: "Q3 '23", value: 328 },
  { year: 2024, date: "Q1 '24", value: 375 },
  { year: 2024, date: "Q3 '24", value: 392 },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const RANGES = [
  { label: "1Y", years: 1 },
  { label: "3Y", years: 3 },
  { label: "5Y", years: 5 },
  { label: "All Years", years: null },
];

function filterByRange(data, years) {
  if (!years) return data;
  const cutoff = new Date().getFullYear() - years;
  return data.filter((d) => d.year >= cutoff);
}

const tooltipStyle = {
  contentStyle: {
    borderRadius: 8,
    border: "1px solid #e2e8f0",
    fontSize: 12,
    boxShadow: "0 4px 6px -1px rgba(0,0,0,0.08)",
  },
};

// ── Chart card ────────────────────────────────────────────────────────────────

function ChartCard({ title, source, children }) {
  return (
    <Paper
      elevation={0}
      sx={{
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 2,
        p: 2.5,
        display: "flex",
        flexDirection: "column",
        gap: 1.5,
        backgroundColor: "common.white",
      }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
        <Typography fontWeight={700} fontSize="0.88rem" color="text.primary">
          {title}
        </Typography>
        <Typography
          fontSize="0.72rem"
          color="text.secondary"
          sx={{ textAlign: "right", maxWidth: 180, lineHeight: 1.3 }}
        >
          {source}
        </Typography>
      </Stack>
      {children}
    </Paper>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function EconomicIndicators() {
  const [range, setRange] = useState("All Years");
  const years = RANGES.find((r) => r.label === range)?.years ?? null;

  const sentiment = useMemo(() => filterByRange(RAW_SENTIMENT, years), [years]);
  const gdp = useMemo(() => filterByRange(RAW_GDP, years), [years]);
  const treasury = useMemo(() => filterByRange(RAW_TREASURY, years), [years]);
  const sp500 = useMemo(() => filterByRange(RAW_SP500, years), [years]);

  const xInterval = (len) => Math.max(0, Math.floor(len / 6) - 1);

  return (
    <Stack spacing={2.5}>
      {/* Filter bar */}
      <Stack direction="row" justifyContent="flex-end" alignItems="center" spacing={0.75}>
        {RANGES.map(({ label }) => {
          const isActive = range === label;
          return (
            <Button
              key={label}
              size="small"
              onClick={() => setRange(label)}
              variant={isActive ? "contained" : "outlined"}
              disableElevation
              sx={{
                fontSize: "0.75rem",
                fontWeight: 700,
                px: 1.5,
                py: 0.4,
                minWidth: 0,
                borderRadius: 1,
                ...(!isActive && { borderColor: "divider", color: "text.secondary" }),
              }}
            >
              {label}
            </Button>
          );
        })}
        <Button
          size="small"
          onClick={() => setRange("All Years")}
          sx={{ fontSize: "0.75rem", color: "text.secondary", fontWeight: 600, minWidth: 0 }}
        >
          Reset
        </Button>
      </Stack>

      {/* 2×2 chart grid */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
          gap: 2.5,
        }}
      >
        {/* Consumer Sentiment Index */}
        <ChartCard title="Consumer Sentiment Index" source="University of Michigan">
          <ResponsiveContainer width="100%" height={210}>
            <AreaChart data={sentiment} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="sentimentGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#2563eb" stopOpacity={0.18} />
                  <stop offset="95%" stopColor="#2563eb" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10 }}
                interval={xInterval(sentiment.length)}
              />
              <YAxis domain={[40, 110]} tick={{ fontSize: 10 }} />
              <Tooltip {...tooltipStyle} formatter={(v) => [v, "Index"]} />
              <Area
                type="monotone"
                dataKey="value"
                stroke="#2563eb"
                strokeWidth={2}
                fill="url(#sentimentGrad)"
                dot={false}
                activeDot={{ r: 4 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Quarterly GDP Growth */}
        <ChartCard title="Quarterly GDP Growth" source="U.S. Bureau of Economic Analysis">
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={gdp} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10 }}
                interval={xInterval(gdp.length)}
              />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
              <Tooltip {...tooltipStyle} formatter={(v) => [`${v}%`, "GDP Growth"]} />
              <ReferenceLine y={0} stroke="#94a3b8" strokeWidth={1} />
              <Bar dataKey="value" radius={[2, 2, 0, 0]} maxBarSize={16}>
                {gdp.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={entry.value >= 0 ? "#0d9488" : "#ef4444"}
                    fillOpacity={0.85}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Treasury Yield Trends */}
        <ChartCard title="Treasury Yield Trends" source="2 Year vs 10 Year Yields">
          <ResponsiveContainer width="100%" height={210}>
            <LineChart data={treasury} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10 }}
                interval={xInterval(treasury.length)}
              />
              <YAxis
                domain={[0, 6]}
                tick={{ fontSize: 10 }}
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip
                {...tooltipStyle}
                formatter={(v, name) => [
                  `${v}%`,
                  name === "twoYear" ? "2-Year" : "10-Year",
                ]}
              />
              <Legend
                formatter={(v) => (v === "twoYear" ? "2-Year" : "10-Year")}
                wrapperStyle={{ fontSize: 11 }}
              />
              <Line
                type="monotone"
                dataKey="twoYear"
                stroke="#2563eb"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Line
                type="monotone"
                dataKey="tenYear"
                stroke="#16a34a"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* S&P 500 Real Estate Index */}
        <ChartCard title="S&P 500 Real Estate Index" source="Sector Performance">
          <ResponsiveContainer width="100%" height={210}>
            <AreaChart data={sp500} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="sp500Grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#7c3aed" stopOpacity={0.18} />
                  <stop offset="95%" stopColor="#7c3aed" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10 }}
                interval={xInterval(sp500.length)}
              />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip {...tooltipStyle} formatter={(v) => [v, "Index"]} />
              <Area
                type="monotone"
                dataKey="value"
                stroke="#7c3aed"
                strokeWidth={2}
                fill="url(#sp500Grad)"
                dot={false}
                activeDot={{ r: 4 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
      </Box>
    </Stack>
  );
}
