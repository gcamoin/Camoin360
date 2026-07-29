import { useMemo, useState } from "react";
import {
  Box,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Tabs,
  Typography,
  useTheme,
} from "@mui/material";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const START_YEAR = 2021;
const ALL_VALUE = "all";
const quarterOptions = [
  { label: "All Quarters", value: ALL_VALUE },
  { label: "Q1", value: "Q1" },
  { label: "Q2", value: "Q2" },
  { label: "Q3", value: "Q3" },
  { label: "Q4", value: "Q4" },
];
const monthOptions = [
  { label: "All Months", value: ALL_VALUE },
  { label: "January", value: "1" },
  { label: "February", value: "2" },
  { label: "March", value: "3" },
  { label: "April", value: "4" },
  { label: "May", value: "5" },
  { label: "June", value: "6" },
  { label: "July", value: "7" },
  { label: "August", value: "8" },
  { label: "September", value: "9" },
  { label: "October", value: "10" },
  { label: "November", value: "11" },
  { label: "December", value: "12" },
];
const calendarMonths = monthOptions
  .filter((option) => option.value !== ALL_VALUE)
  .map((option) => ({
    label: option.label,
    shortLabel: option.label.slice(0, 3),
    value: option.value,
  }));

const serviceLines = [
  { key: "prospecting", label: "Prospecting", base: 210000, growth: 4200 },
  { key: "impact_analysis", label: "Impact Analysis", base: 185000, growth: 3600 },
  { key: "real_estate", label: "Real Estate", base: 165000, growth: 3100 },
  { key: "strategic_planning", label: "Strategic Planning", base: 195000, growth: 3900 },
  { key: "housing", label: "Housing", base: 142000, growth: 2800 },
  { key: "target_industry_analytics", label: "Target Industry Analytics", base: 156000, growth: 3300 },
  { key: "workforce", label: "Workforce", base: 128000, growth: 2600 },
  { key: "prospect_engage", label: "ProspectEngage", base: 118000, growth: 2400 },
];

const tooltipStyle = {
  contentStyle: {
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    boxShadow: "0 4px 6px -1px rgba(0,0,0,0.08)",
    fontSize: 12,
  },
};

function buildMonthlyRows() {
  const today = new Date();
  const rows = [];

  for (let year = START_YEAR; year <= today.getFullYear(); year += 1) {
    for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
      const monthNumber = monthIndex + 1;
      const sequence = (year - START_YEAR) * 12 + monthIndex;
      const row = {
        month: calendarMonths[monthIndex].shortLabel,
        monthNumber: String(monthNumber),
        monthKey: `${year}-${String(monthNumber).padStart(2, "0")}`,
        quarter: `Q${Math.ceil(monthNumber / 3)}`,
        quarterKey: `${year}-Q${Math.ceil(monthNumber / 3)}`,
        year: String(year),
      };

      for (const serviceLine of serviceLines) {
        const seasonal = Math.sin((monthIndex / 12) * Math.PI * 2 + serviceLine.key.length) * 18500;
        const projectPulse = ((monthIndex + serviceLine.key.length) % 5) * 9500;
        row[serviceLine.key] = Math.round(serviceLine.base + serviceLine.growth * sequence + seasonal + projectPulse);
      }

      rows.push(row);
    }
  }

  return rows;
}

function buildCalendarMonthRows(rows) {
  return calendarMonths.map((calendarMonth) => {
    const matchingRows = rows.filter((row) => row.monthNumber === calendarMonth.value);
    const monthRow = {
      month: calendarMonth.shortLabel,
      monthNumber: calendarMonth.value,
    };

    for (const serviceLine of serviceLines) {
      monthRow[serviceLine.key] = matchingRows.reduce((sum, row) => sum + Number(row[serviceLine.key] || 0), 0);
    }

    return monthRow;
  });
}

const monthlyRows = buildMonthlyRows();
const yearOptions = [
  { label: "All Years", value: ALL_VALUE },
  ...Array.from(new Set(monthlyRows.map((row) => row.year)))
    .sort((a, b) => Number(b) - Number(a))
    .map((year) => ({ label: year, value: year })),
];

function formatCurrency(value) {
  return new Intl.NumberFormat(undefined, {
    currency: "USD",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(Number(value || 0));
}

function average(rows, key) {
  if (!rows.length) {
    return 0;
  }

  return rows.reduce((sum, row) => sum + Number(row[key] || 0), 0) / rows.length;
}

function buildServiceLineProjections() {
  const recentQuarter = monthlyRows.slice(-3);
  const priorQuarter = monthlyRows.slice(-6, -3);

  return serviceLines.map((serviceLine) => {
    const recentAverage = average(recentQuarter, serviceLine.key);
    const priorAverage = average(priorQuarter, serviceLine.key);
    const monthlyTrend = (recentAverage - priorAverage) / 3;
    const projectedQuarter = recentQuarter.reduce(
      (sum, row, index) => sum + Number(row[serviceLine.key] || 0) + monthlyTrend * (index + 1),
      0
    );

    return {
      change: priorAverage ? ((recentAverage - priorAverage) / priorAverage) * 100 : 0,
      projectedQuarter,
      serviceLine: serviceLine.label,
    };
  });
}

function InsightCard({ label, value }) {
  return (
    <Paper elevation={0} sx={{ backgroundColor: "#F8FAFC", border: "1px solid", borderColor: "divider", borderRadius: 2, p: 2 }}>
      <Typography color="text.secondary" fontWeight={800} variant="overline">
        {label}
      </Typography>
      <Typography color="primary.main" fontWeight={800} sx={{ fontSize: "1.35rem", lineHeight: 1.2 }}>
        {value}
      </Typography>
    </Paper>
  );
}

function FinancialBarChart({ color, data, dataKey, title }) {
  const total = data.reduce((sum, row) => sum + Number(row[dataKey] || 0), 0);

  return (
    <Paper
      elevation={0}
      sx={{
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 2,
        p: { xs: 2, md: 2.5 },
      }}
    >
      <Stack spacing={0.5} sx={{ mb: 2 }}>
        <Typography color="text.primary" fontWeight={800}>
          {title}
        </Typography>
        <Typography color="text.secondary" variant="body2">
          Dummy monthly revenue. Total {formatCurrency(total)}.
        </Typography>
      </Stack>
      <Box sx={{ height: 320, minWidth: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 18, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="#f1f5f9" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="month" interval={0} minTickGap={0} tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(value) => `$${Math.round(value / 1000)}k`} />
            <Tooltip {...tooltipStyle} formatter={(value) => [formatCurrency(value), title]} />
            <Bar dataKey={dataKey} fill={color} fillOpacity={0.88} maxBarSize={44} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Box>
    </Paper>
  );
}

export default function ServiceLineFinancials() {
  const theme = useTheme();
  const [year, setYear] = useState(ALL_VALUE);
  const [quarter, setQuarter] = useState(ALL_VALUE);
  const [month, setMonth] = useState(ALL_VALUE);
  const [isAnalysisOpen, setIsAnalysisOpen] = useState(false);
  const [isAnalysisGenerated, setIsAnalysisGenerated] = useState(false);
  const [analysisTab, setAnalysisTab] = useState("analysis");
  const visibleMonthlyRows = useMemo(
    () =>
      monthlyRows.filter(
        (row) =>
          (year === ALL_VALUE || row.year === year) &&
          (month !== ALL_VALUE || quarter === ALL_VALUE || row.quarter === quarter) &&
          (month === ALL_VALUE || row.monthNumber === month)
      ),
    [month, quarter, year]
  );
  const chartMonthlyRows = useMemo(() => buildCalendarMonthRows(visibleMonthlyRows), [visibleMonthlyRows]);
  const colors = [
    theme.palette.primary.main,
    theme.palette.secondary.main,
    "#2a78d6",
    "#7c8a2e",
    "#0d9488",
    "#b45309",
    "#7c3aed",
    "#475569",
  ];
  const projectionRows = useMemo(() => buildServiceLineProjections(), []);
  const totals = serviceLines.map((serviceLine) => ({
    label: serviceLine.label,
    total: chartMonthlyRows.reduce((sum, row) => sum + Number(row[serviceLine.key] || 0), 0),
  }));
  const topLine = [...totals].sort((a, b) => b.total - a.total)[0];

  return (
    <Stack spacing={2.5}>
      <Paper
        elevation={0}
        sx={{
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 2,
          p: { xs: 2, md: 2.5 },
        }}
      >
        <Stack spacing={1.75}>
          <Stack alignItems={{ xs: "stretch", md: "center" }} direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={1.5}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
              <FormControl size="small" sx={{ minWidth: { xs: "100%", md: 180 } }}>
                <InputLabel id="service-line-financial-year-label">Year</InputLabel>
                <Select
                  label="Year"
                  labelId="service-line-financial-year-label"
                  onChange={(event) => setYear(event.target.value)}
                  value={year}
                >
                  {yearOptions.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: { xs: "100%", md: 180 } }}>
                <InputLabel id="service-line-financial-quarter-label">Quarter</InputLabel>
                <Select
                  label="Quarter"
                  labelId="service-line-financial-quarter-label"
                  onChange={(event) => setQuarter(event.target.value)}
                  value={quarter}
                >
                  {quarterOptions.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: { xs: "100%", md: 200 } }}>
                <InputLabel id="service-line-financial-month-label">Month</InputLabel>
                <Select
                  label="Month"
                  labelId="service-line-financial-month-label"
                  onChange={(event) => setMonth(event.target.value)}
                  value={month}
                >
                  {monthOptions.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Stack>
            <Button
              onClick={() => {
                setIsAnalysisGenerated(false);
                setAnalysisTab("analysis");
                setIsAnalysisOpen(true);
              }}
              sx={{ fontWeight: 800 }}
              variant="contained"
            >
              AI Analysis
            </Button>
          </Stack>
        </Stack>
      </Paper>

      <Box sx={{ display: "grid", gap: 2.5, gridTemplateColumns: { xs: "1fr", xl: "1fr 1fr" } }}>
        {serviceLines.map((serviceLine, index) => (
          <FinancialBarChart
            color={colors[index % colors.length]}
            data={chartMonthlyRows}
            dataKey={serviceLine.key}
            key={serviceLine.key}
            title={serviceLine.label}
          />
        ))}
      </Box>

      <Dialog fullWidth maxWidth="md" onClose={() => setIsAnalysisOpen(false)} open={isAnalysisOpen}>
        <DialogTitle sx={{ borderBottom: "1px solid", borderColor: "divider", pb: isAnalysisGenerated ? 0 : 2 }}>
          <Typography color="text.primary" fontWeight={800} variant="h6">
            AI Service Line Financial Analysis
          </Typography>
          {isAnalysisGenerated ? (
            <Tabs onChange={(_event, value) => setAnalysisTab(value)} sx={{ mt: 1 }} value={analysisTab}>
              <Tab label="Analysis" value="analysis" />
              <Tab label="Snipits" value="snipits" />
              <Tab label="Projections" value="projections" />
            </Tabs>
          ) : null}
        </DialogTitle>
        <DialogContent sx={{ p: 3 }}>
          {!isAnalysisGenerated ? (
            <Stack alignItems="center" spacing={2} sx={{ py: { xs: 3, sm: 5 }, textAlign: "center" }}>
              <Box>
                <Typography fontWeight={800} variant="h6">
                  Generate an analysis of service line financials
                </Typography>
                <Typography color="text.secondary" sx={{ mt: 0.75 }}>
                  Review revenue performance, service-line trends, and projections using the selected reporting period.
                </Typography>
              </Box>
              <Button onClick={() => setIsAnalysisGenerated(true)} sx={{ fontWeight: 800, px: 3 }} variant="contained">
                Generate AI Analysis
              </Button>
            </Stack>
          ) : null}

          {isAnalysisGenerated && analysisTab === "analysis" ? (
            <Stack spacing={2}>
              <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" } }}>
                <InsightCard label="Top Service Line" value={topLine ? topLine.label : "No Data"} />
                <InsightCard label="Visible Period Revenue" value={formatCurrency(totals.reduce((sum, row) => sum + row.total, 0))} />
              </Box>
              <Typography color="text.secondary">
                Dummy AI readout: service line revenue remains broad-based, with {topLine?.label || "the leading line"} carrying the strongest visible-period contribution. Monthly and quarterly views should be used together: monthly bars show volatility, while quarterly bars smooth the project timing.
              </Typography>
              <Typography color="text.secondary">
                The placeholder data suggests steady expansion across consulting lines, with Prospecting, Strategic Planning, Housing, Target Industry Analytics, Workforce, and ProspectEngage showing varied monthly project timing in the recent dummy history.
              </Typography>
            </Stack>
          ) : null}

          {isAnalysisGenerated && analysisTab === "snipits" ? (
            <Stack spacing={1.5}>
              {[
                "Quarter and month filters now narrow the monthly service-line bars directly.",
                "Filtering by quarter is useful for comparing planning periods without changing the chart format.",
                "Filtering by month is useful for spotting project timing spikes and dips.",
                "Housing, Target Industry Analytics, Workforce, and ProspectEngage use placeholder monthly revenue until the live service-line source is wired in.",
              ].map((snippet) => (
                <Paper key={snippet} elevation={0} sx={{ backgroundColor: "#F8FAFC", border: "1px solid", borderColor: "divider", borderRadius: 2, p: 2 }}>
                  <Typography color="text.secondary">{snippet}</Typography>
                </Paper>
              ))}
            </Stack>
          ) : null}

          {isAnalysisGenerated && analysisTab === "projections" ? (
            <Stack spacing={2}>
              <Typography color="text.secondary">
                Dummy AI projection: next quarter is projected from the latest quarter-over-quarter average monthly trend for each service line.
              </Typography>
              <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" } }}>
                {projectionRows.map((row) => (
                  <InsightCard
                    key={row.serviceLine}
                    label={`${row.serviceLine} Next Quarter`}
                    value={`${formatCurrency(row.projectedQuarter)} (${row.change.toFixed(1)}%)`}
                  />
                ))}
              </Box>
            </Stack>
          ) : null}
        </DialogContent>
      </Dialog>
    </Stack>
  );
}
