import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
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
import { API_BASE_URL, getApiErrorMessage, getAuthHeaders, handleUnauthorized } from "../auth";

const API_URL = `${API_BASE_URL}/company-financials`;
const REQUEST_TIMEOUT_MS = 60 * 1000;

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

function buildProjectionRows(monthlyFinancials) {
  if (monthlyFinancials.length < 6) {
    return [];
  }

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
  const isMountedRef = useRef(true);
  const theme = useTheme();
  const brandBlue = theme.palette.primary.main;
  const brandGreen = theme.palette.secondary.main;
  const [monthlyFinancials, setMonthlyFinancials] = useState([]);
  const [updatedAt, setUpdatedAt] = useState("");
  const [source, setSource] = useState("QuickBooks Online sandbox");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [selectedYear, setSelectedYear] = useState(ALL_VALUE);
  const [selectedQuarter, setSelectedQuarter] = useState(ALL_VALUE);
  const [selectedMonth, setSelectedMonth] = useState(ALL_VALUE);
  const [isAnalysisOpen, setIsAnalysisOpen] = useState(false);
  const [analysisTab, setAnalysisTab] = useState("analysis");
  const displayRows = monthlyFinancials;
  const yearOptions = useMemo(
    () => [
      { label: "All Years", value: ALL_VALUE },
      ...Array.from(new Set(displayRows.map((row) => row.year)))
        .sort((a, b) => Number(b) - Number(a))
        .map((year) => ({ label: year, value: year })),
    ],
    [displayRows]
  );
  const fetchFinancials = useCallback(async ({ refresh = false, silent = false } = {}) => {
    if (!isMountedRef.current) return;

    if (silent) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError("");

    try {
      const response = await axios.get(API_URL, {
        headers: getAuthHeaders(),
        params: refresh ? { refresh: true } : undefined,
        timeout: REQUEST_TIMEOUT_MS,
      });

      if (!isMountedRef.current) return;

      setMonthlyFinancials(response.data?.rows || []);
      setUpdatedAt(response.data?.updated_at || "");
      setSource(response.data?.source || "QuickBooks Online sandbox");
    } catch (requestError) {
      if (!isMountedRef.current || handleUnauthorized(requestError)) return;

      setError(getApiErrorMessage(requestError, "Unable to load QuickBooks company financials."));
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    fetchFinancials();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchFinancials]);

  const filteredRows = useMemo(
    () =>
      displayRows.filter(
        (row) =>
          (selectedYear === ALL_VALUE || row.year === selectedYear) &&
          (selectedMonth !== ALL_VALUE || selectedQuarter === ALL_VALUE || row.quarter === selectedQuarter) &&
          (selectedMonth === ALL_VALUE || row.monthNumber === selectedMonth)
      ),
    [displayRows, selectedMonth, selectedQuarter, selectedYear]
  );
  const chartRows = filteredRows.length ? filteredRows : displayRows;
  const projectionRows = useMemo(() => buildProjectionRows(displayRows), [displayRows]);
  const latestMonth = displayRows[displayRows.length - 1] || {};
  const recentQuarter = displayRows.slice(-3);
  const priorQuarter = displayRows.slice(-6, -3);
  const recentSalesAverage = average(recentQuarter, "sales");
  const priorSalesAverage = average(priorQuarter, "sales");
  const salesChange = priorSalesAverage ? ((recentSalesAverage - priorSalesAverage) / priorSalesAverage) * 100 : 0;
  const projectedQuarterSales = projectionRows.reduce((sum, row) => sum + row.sales, 0);
  const projectedQuarterNetIncome = projectionRows.reduce((sum, row) => sum + row.netIncome, 0);
  const updatedLabel = updatedAt ? new Date(updatedAt).toLocaleString() : "";

  return (
    <Stack spacing={2.5}>
      {error ? (
        <Alert severity="error" sx={{ borderRadius: 2 }}>
          {error}
        </Alert>
      ) : null}
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
                {yearOptions.map((option) => (
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
          <Stack alignItems={{ xs: "stretch", sm: "center" }} direction={{ xs: "column", sm: "row" }} spacing={1.5}>
            <Stack spacing={0.25}>
              <Typography color="text.secondary" variant="caption">
                {source}
              </Typography>
              {updatedLabel ? (
                <Typography color="text.secondary" variant="caption">
                  Updated {updatedLabel}
                </Typography>
              ) : null}
            </Stack>
            <Button disabled={isRefreshing} onClick={() => fetchFinancials({ refresh: true, silent: true })} sx={{ fontWeight: 800 }} variant="outlined">
              {isRefreshing ? "Refreshing" : "Refresh"}
            </Button>
            <Button onClick={() => setIsAnalysisOpen(true)} sx={{ fontWeight: 800 }} variant="contained">
              AI Analysis
            </Button>
          </Stack>
        </Stack>
      </Paper>

      {isLoading ? (
        <Paper elevation={0} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: 4 }}>
          <Stack alignItems="center" spacing={1.5}>
            <CircularProgress size={28} />
            <Typography color="text.secondary">Loading QuickBooks financials...</Typography>
          </Stack>
        </Paper>
      ) : null}

      {!isLoading && !error && !displayRows.length ? (
        <Alert severity="info" sx={{ borderRadius: 2 }}>
          QuickBooks returned no financial rows for the configured sandbox company.
        </Alert>
      ) : null}

      <ChartPanel
        subtitle={`Monthly sales from ${source} (${displayRows.length.toLocaleString()} values).`}
        title="Monthly Sales"
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={displayRows} margin={{ top: 8, right: 20, bottom: 8, left: 8 }}>
            <CartesianGrid stroke="#f1f5f9" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="month" minTickGap={28} tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(value) => `$${Math.round(value / 1000)}k`} />
            <Tooltip {...tooltipStyle} formatter={(value) => [formatCurrency(value), "Sales"]} />
            <Line dataKey="sales" dot={false} name="Monthly Sales" stroke={brandBlue} strokeWidth={2.5} type="monotone" />
          </LineChart>
        </ResponsiveContainer>
      </ChartPanel>

      <Box sx={{ display: "grid", gap: 2.5, gridTemplateColumns: { xs: "1fr", xl: "1fr 1fr" } }}>
        <ChartPanel subtitle="Grouped bar chart showing QuickBooks liquidity measures." title="Cash on Hand & Current Ratio">
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

        <ChartPanel subtitle="Blue line chart with monthly QuickBooks net income values." title="Net Income">
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
                QuickBooks readout: sales changed {salesChange.toFixed(1)}% versus the prior comparable quarter. Net income is {formatCurrency(latestMonth.netIncome)} in the latest month, with liquidity shown by cash on hand and current ratio across the selected period.
              </Typography>
              <Typography color="text.secondary">
                Balance sheet indicators show owner equity, leverage, and return on assets from the connected QuickBooks sandbox reports. Use refresh to pull the latest report values after sandbox changes.
              </Typography>
            </Stack>
          ) : null}

          {analysisTab === "snipits" ? (
            <Stack spacing={1.5}>
              {[
                `Latest monthly sales are ${formatCurrency(latestMonth.sales)}.`,
                `Latest monthly net income is ${formatCurrency(latestMonth.netIncome)}.`,
                `Cash on hand is ${formatCurrency(latestMonth.cashOnHand)} in the latest QuickBooks balance sheet period.`,
                `Debt-to-equity is ${formatRatio(latestMonth.debtToEquity)} and return on assets is ${formatPercent(latestMonth.returnOnAssets)}.`,
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
                QuickBooks projection: using the latest quarter-over-quarter trend, next quarter sales and net income are estimated from the connected sandbox report history.
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
