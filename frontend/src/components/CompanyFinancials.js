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
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const START_YEAR = 2021;
const ALL_VALUE = "all";
const QUARTER_OPTIONS = [
  { label: "All Quarters", value: ALL_VALUE },
  { label: "Q1", value: "1" },
  { label: "Q2", value: "2" },
  { label: "Q3", value: "3" },
  { label: "Q4", value: "4" },
];
const MONTH_OPTIONS = [
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

const tooltipStyle = {
  contentStyle: {
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    boxShadow: "0 4px 6px -1px rgba(0,0,0,0.08)",
    fontSize: 12,
  },
};

function buildMonthlyFinancials() {
  const today = new Date();
  const rows = [];

  for (let year = START_YEAR; year <= today.getFullYear(); year += 1) {
    const finalMonth = year === today.getFullYear() ? today.getMonth() : 11;
    for (let monthIndex = 0; monthIndex <= finalMonth; monthIndex += 1) {
      const monthNumber = monthIndex + 1;
      const sequence = (year - START_YEAR) * 12 + monthIndex;
      const seasonalLift = Math.sin((monthIndex / 12) * Math.PI * 2) * 85000;
      const sales = 840000 + sequence * 18500 + seasonalLift + (monthIndex % 4) * 42000;
      const cashOnHand = 520000 + sequence * 9500 + Math.cos(monthIndex / 2) * 45000;
      const currentRatio = 1.35 + (sequence % 18) * 0.018 + Math.sin(monthIndex / 3) * 0.06;
      const ownerEquity = 1900000 + sequence * 31500 + Math.sin(monthIndex / 4) * 85000;
      const debtToEquity = 0.92 - sequence * 0.004 + Math.cos(monthIndex / 3) * 0.035;
      const debtToAssets = 0.48 - sequence * 0.0018 + Math.sin(monthIndex / 5) * 0.018;
      const returnOnAssets = 0.055 + sequence * 0.00045 + Math.cos(monthIndex / 4) * 0.006;
      const netIncome = 96000 + sequence * 3100 + Math.sin(monthIndex / 2) * 22000;

      rows.push({
        cashOnHand: Math.round(cashOnHand),
        currentRatio: Number(currentRatio.toFixed(2)),
        debtToAssets: Number(Math.max(0.18, debtToAssets).toFixed(2)),
        debtToEquity: Number(Math.max(0.25, debtToEquity).toFixed(2)),
        month: new Date(year, monthIndex, 1).toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
        monthNumber: String(monthNumber),
        monthKey: `${year}-${String(monthNumber).padStart(2, "0")}`,
        netIncome: Math.round(netIncome),
        ownerEquity: Math.round(ownerEquity),
        quarter: String(Math.ceil(monthNumber / 3)),
        returnOnAssets: Number(Math.max(0.02, returnOnAssets).toFixed(3)),
        sales: Math.round(sales),
        year: String(year),
      });
    }
  }

  return rows;
}

const monthlyFinancials = buildMonthlyFinancials();
const YEAR_OPTIONS = [
  { label: "All Years", value: ALL_VALUE },
  ...Array.from(new Set(monthlyFinancials.map((row) => row.year)))
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

function formatRatio(value) {
  return Number(value || 0).toFixed(2);
}

function formatPercent(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function ChartPanel({ children, subtitle, title }) {
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
          {subtitle}
        </Typography>
      </Stack>
      <Box sx={{ height: 320, minWidth: 0 }}>{children}</Box>
    </Paper>
  );
}

function average(rows, key) {
  if (!rows.length) {
    return 0;
  }

  return rows.reduce((sum, row) => sum + Number(row[key] || 0), 0) / rows.length;
}

function buildProjectionRows() {
  const recentQuarter = monthlyFinancials.slice(-3);
  const priorQuarter = monthlyFinancials.slice(-6, -3);
  const latestRow = monthlyFinancials[monthlyFinancials.length - 1];
  const nextRows = [];
  const salesTrend = average(recentQuarter, "sales") - average(priorQuarter, "sales");
  const netIncomeTrend = average(recentQuarter, "netIncome") - average(priorQuarter, "netIncome");
  const cashTrend = average(recentQuarter, "cashOnHand") - average(priorQuarter, "cashOnHand");

  for (let index = 1; index <= 3; index += 1) {
    const date = new Date(Number(latestRow.year), Number(latestRow.monthNumber) - 1 + index, 1);
    nextRows.push({
      cashOnHand: Math.round(latestRow.cashOnHand + (cashTrend / 3) * index),
      month: date.toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
      netIncome: Math.round(latestRow.netIncome + (netIncomeTrend / 3) * index),
      sales: Math.round(latestRow.sales + (salesTrend / 3) * index),
    });
  }

  return nextRows;
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

export default function CompanyFinancials() {
  const theme = useTheme();
  const brandBlue = theme.palette.primary.main;
  const brandGreen = theme.palette.secondary.main;
  const [selectedYear, setSelectedYear] = useState(ALL_VALUE);
  const [selectedQuarter, setSelectedQuarter] = useState(ALL_VALUE);
  const [selectedMonth, setSelectedMonth] = useState(ALL_VALUE);
  const [isAnalysisOpen, setIsAnalysisOpen] = useState(false);
  const [analysisTab, setAnalysisTab] = useState("analysis");
  const filteredRows = useMemo(
    () =>
      monthlyFinancials.filter(
        (row) =>
          (selectedYear === ALL_VALUE || row.year === selectedYear) &&
          (selectedMonth !== ALL_VALUE || selectedQuarter === ALL_VALUE || row.quarter === selectedQuarter) &&
          (selectedMonth === ALL_VALUE || row.monthNumber === selectedMonth)
      ),
    [selectedMonth, selectedQuarter, selectedYear]
  );
  const chartRows = filteredRows.length ? filteredRows : monthlyFinancials;
  const projectionRows = useMemo(() => buildProjectionRows(), []);
  const latestMonth = monthlyFinancials[monthlyFinancials.length - 1];
  const recentQuarter = monthlyFinancials.slice(-3);
  const priorQuarter = monthlyFinancials.slice(-6, -3);
  const recentSalesAverage = average(recentQuarter, "sales");
  const priorSalesAverage = average(priorQuarter, "sales");
  const salesChange = priorSalesAverage ? ((recentSalesAverage - priorSalesAverage) / priorSalesAverage) * 100 : 0;
  const projectedQuarterSales = projectionRows.reduce((sum, row) => sum + row.sales, 0);
  const projectedQuarterNetIncome = projectionRows.reduce((sum, row) => sum + row.netIncome, 0);

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
        <Stack alignItems={{ xs: "stretch", lg: "center" }} direction={{ xs: "column", lg: "row" }} justifyContent="space-between" spacing={1.5}>
          <Stack direction={{ xs: "column", md: "row" }} spacing={1.5}>
            <FormControl size="small" sx={{ minWidth: { xs: "100%", md: 180 } }}>
              <InputLabel id="financial-year-label">Year</InputLabel>
              <Select
                label="Year"
                labelId="financial-year-label"
                onChange={(event) => setSelectedYear(event.target.value)}
                value={selectedYear}
              >
                {YEAR_OPTIONS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: { xs: "100%", md: 180 } }}>
              <InputLabel id="financial-quarter-label">Quarter</InputLabel>
              <Select
                label="Quarter"
                labelId="financial-quarter-label"
                onChange={(event) => setSelectedQuarter(event.target.value)}
                value={selectedQuarter}
              >
                {QUARTER_OPTIONS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: { xs: "100%", md: 200 } }}>
              <InputLabel id="financial-month-label">Month</InputLabel>
              <Select
                label="Month"
                labelId="financial-month-label"
                onChange={(event) => setSelectedMonth(event.target.value)}
                value={selectedMonth}
              >
                {MONTH_OPTIONS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
          <Button onClick={() => setIsAnalysisOpen(true)} sx={{ fontWeight: 800 }} variant="contained">
            AI Analysis
          </Button>
        </Stack>
      </Paper>

      <ChartPanel
        subtitle={`All-time dummy monthly sales from 2021 through the current month (${monthlyFinancials.length.toLocaleString()} values).`}
        title="Monthly Sales"
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={monthlyFinancials} margin={{ top: 8, right: 20, bottom: 8, left: 8 }}>
            <CartesianGrid stroke="#f1f5f9" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="month" minTickGap={28} tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(value) => `$${Math.round(value / 1000)}k`} />
            <Tooltip {...tooltipStyle} formatter={(value) => [formatCurrency(value), "Sales"]} />
            <Line dataKey="sales" dot={false} name="Monthly Sales" stroke={brandBlue} strokeWidth={2.5} type="monotone" />
          </LineChart>
        </ResponsiveContainer>
      </ChartPanel>

      <Box sx={{ display: "grid", gap: 2.5, gridTemplateColumns: { xs: "1fr", xl: "1fr 1fr" } }}>
        <ChartPanel subtitle="Grouped bar chart showing placeholder liquidity measures." title="Cash on Hand & Current Ratio">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartRows} margin={{ top: 8, right: 20, bottom: 8, left: 8 }}>
              <CartesianGrid stroke="#f1f5f9" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="currency" tick={{ fontSize: 11 }} tickFormatter={(value) => `$${Math.round(value / 1000)}k`} />
              <YAxis orientation="right" yAxisId="ratio" tick={{ fontSize: 11 }} />
              <Tooltip
                {...tooltipStyle}
                formatter={(value, name) => [name === "Cash on Hand" ? formatCurrency(value) : formatRatio(value), name]}
              />
              <Legend />
              <Bar dataKey="cashOnHand" fill={brandBlue} name="Cash on Hand" radius={[3, 3, 0, 0]} yAxisId="currency" />
              <Bar dataKey="currentRatio" fill={brandGreen} name="Current Ratio" radius={[3, 3, 0, 0]} yAxisId="ratio" />
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel subtitle="Owner equity as bars with debt-to-equity ratio overlaid as a line." title="Owner Equity & Debt to Equity">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartRows} margin={{ top: 8, right: 20, bottom: 8, left: 8 }}>
              <CartesianGrid stroke="#f1f5f9" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="currency" tick={{ fontSize: 11 }} tickFormatter={(value) => `$${Math.round(value / 1000000)}m`} />
              <YAxis orientation="right" yAxisId="ratio" tick={{ fontSize: 11 }} />
              <Tooltip
                {...tooltipStyle}
                formatter={(value, name) => [name === "Owner Equity" ? formatCurrency(value) : formatRatio(value), name]}
              />
              <Legend />
              <Bar dataKey="ownerEquity" fill={brandBlue} name="Owner Equity" radius={[3, 3, 0, 0]} yAxisId="currency" />
              <Line dataKey="debtToEquity" dot={false} name="Debt to Equity" stroke={brandGreen} strokeWidth={2.5} type="monotone" yAxisId="ratio" />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel subtitle="Debt-to-assets shown as blue bars with return on assets as a green line." title="Debt to Assets & Return on Assets">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartRows} margin={{ top: 8, right: 20, bottom: 8, left: 8 }}>
              <CartesianGrid stroke="#f1f5f9" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(value) => `${Math.round(value * 100)}%`} yAxisId="ratio" />
              <Tooltip {...tooltipStyle} formatter={(value, name) => [formatPercent(value), name]} />
              <Legend />
              <Bar dataKey="debtToAssets" fill={brandBlue} name="Debt to Assets" radius={[3, 3, 0, 0]} yAxisId="ratio" />
              <Line dataKey="returnOnAssets" dot={false} name="Return on Assets" stroke={brandGreen} strokeWidth={2.5} type="monotone" yAxisId="ratio" />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel subtitle="Blue line chart with placeholder monthly net income values." title="Net Income">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartRows} margin={{ top: 8, right: 20, bottom: 8, left: 8 }}>
              <CartesianGrid stroke="#f1f5f9" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(value) => `$${Math.round(value / 1000)}k`} />
              <Tooltip {...tooltipStyle} formatter={(value) => [formatCurrency(value), "Net Income"]} />
              <Line dataKey="netIncome" dot={false} name="Net Income" stroke={brandBlue} strokeWidth={2.5} type="monotone" />
            </LineChart>
          </ResponsiveContainer>
        </ChartPanel>
      </Box>

      <Dialog fullWidth maxWidth="md" onClose={() => setIsAnalysisOpen(false)} open={isAnalysisOpen}>
        <DialogTitle sx={{ borderBottom: "1px solid", borderColor: "divider", pb: 0 }}>
          <Typography color="text.primary" fontWeight={800} variant="h6">
            AI Financial Analysis
          </Typography>
          <Tabs onChange={(_event, value) => setAnalysisTab(value)} sx={{ mt: 1 }} value={analysisTab}>
            <Tab label="Analysis" value="analysis" />
            <Tab label="Snipits" value="snipits" />
            <Tab label="Projections" value="projections" />
          </Tabs>
        </DialogTitle>
        <DialogContent sx={{ p: 3 }}>
          {analysisTab === "analysis" ? (
            <Stack spacing={2}>
              <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr 1fr" } }}>
                <InsightCard label="Latest Sales" value={formatCurrency(latestMonth.sales)} />
                <InsightCard label="Latest Net Income" value={formatCurrency(latestMonth.netIncome)} />
                <InsightCard label="Recent Sales Change" value={`${salesChange.toFixed(1)}%`} />
              </Box>
              <Typography color="text.secondary">
                Dummy AI readout: sales are trending upward over the latest quarter, while net income remains positive with moderate month-to-month volatility. Liquidity is stable in the placeholder model, with cash on hand continuing to rise and the current ratio holding above operating comfort levels.
              </Typography>
              <Typography color="text.secondary">
                Balance sheet indicators show owner equity expanding while leverage ratios gradually improve. The dummy data suggests the company could sustain near-term investment without materially weakening its debt profile.
              </Typography>
            </Stack>
          ) : null}

          {analysisTab === "snipits" ? (
            <Stack spacing={1.5}>
              {[
                "Monthly sales remain above the long-term dummy trend line.",
                "Cash on hand has increased across the latest rolling quarter.",
                "Debt-to-equity continues to edge down as owner equity grows.",
                "Return on assets is improving gradually, but not sharply enough to suggest an unusual one-time spike.",
              ].map((snippet) => (
                <Paper key={snippet} elevation={0} sx={{ backgroundColor: "#F8FAFC", border: "1px solid", borderColor: "divider", borderRadius: 2, p: 2 }}>
                  <Typography color="text.secondary">{snippet}</Typography>
                </Paper>
              ))}
            </Stack>
          ) : null}

          {analysisTab === "projections" ? (
            <Stack spacing={2}>
              <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" } }}>
                <InsightCard label="Projected Next Quarter Sales" value={formatCurrency(projectedQuarterSales)} />
                <InsightCard label="Projected Next Quarter Net Income" value={formatCurrency(projectedQuarterNetIncome)} />
              </Box>
              <Typography color="text.secondary">
                Dummy AI projection: using the latest quarter-over-quarter trend, next quarter sales are projected to continue increasing at a measured pace. Net income is projected to stay positive, with expected seasonal variation month to month.
              </Typography>
              <Stack spacing={1}>
                {projectionRows.map((row) => (
                  <Paper key={row.month} elevation={0} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: 1.5 }}>
                    <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={1}>
                      <Typography fontWeight={800}>{row.month}</Typography>
                      <Typography color="text.secondary">Sales {formatCurrency(row.sales)}</Typography>
                      <Typography color="text.secondary">Net Income {formatCurrency(row.netIncome)}</Typography>
                    </Stack>
                  </Paper>
                ))}
              </Stack>
            </Stack>
          ) : null}
        </DialogContent>
      </Dialog>
    </Stack>
  );
}
