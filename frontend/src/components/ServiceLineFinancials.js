import { useCallback, useEffect, useMemo, useState } from "react";
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
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { API_BASE_URL, getApiErrorMessage, getAuthHeaders, handleUnauthorized } from "../auth";

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
const API_URL = `${API_BASE_URL}/management/service-line-financials`;
const MONTH_PIXEL_WIDTH = 46;

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

function average(rows, key) {
  if (!rows.length) {
    return 0;
  }

  return rows.reduce((sum, row) => sum + Number(row[key] || 0), 0) / rows.length;
}

function buildServiceLineProjections(monthlyRows, serviceLines) {
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

function FinancialTimelineTick({ x, y, payload }) {
  const [year, monthValue] = String(payload?.value || "").split("-");
  const month = Number(monthValue);
  const monthLabel = month
    ? new Date(Number(year), month - 1, 1).toLocaleDateString(undefined, { month: "short" })
    : "";
  const quarterLabel = month ? `Q${Math.ceil(month / 3)}` : "";
  const showQuarter = [2, 5, 8, 11].includes(month);
  const showYear = month === 7;

  return (
    <g transform={`translate(${x},${y})`}>
      <text fill="#475569" fontSize="10" textAnchor="middle">
        <tspan x="0" dy="12">{monthLabel}</tspan>
        <tspan fontWeight="700" x="0" dy="12">{showQuarter ? quarterLabel : ""}</tspan>
        <tspan fontWeight="700" x={showYear ? -(MONTH_PIXEL_WIDTH / 2) : 0} dy="12">{showYear ? year : ""}</tspan>
      </text>
    </g>
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
        minWidth: 0,
        overflow: "hidden",
        p: { xs: 2, md: 2.5 },
        width: "100%",
      }}
    >
      <Stack spacing={0.5} sx={{ mb: 2 }}>
        <Typography color="text.primary" fontWeight={800}>
          {title}
        </Typography>
        <Typography color="text.secondary" variant="body2">
          Live contracted Camoin fees. Total {formatCurrency(total)}.
        </Typography>
      </Stack>
      <Box sx={{ display: "flex", height: 340, maxWidth: "100%", minWidth: 0, width: "100%" }}>
        <Box sx={{ flex: "0 0 58px", height: 320, position: "relative", zIndex: 1 }}>
          <ResponsiveContainer height="100%" width="100%">
            <BarChart data={data} margin={{ top: 8, right: 0, bottom: 62, left: 0 }}>
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(value) => `$${Math.round(value / 1000)}k`} width={58} />
              <Bar dataKey={dataKey} fill="transparent" isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </Box>
        <Box sx={{ flex: 1, minWidth: 0, overflowX: "auto", overflowY: "hidden", pb: 1 }}>
        <Box sx={{ height: 320, minWidth: "100%", width: `${Math.max(data.length * MONTH_PIXEL_WIDTH, 552)}px` }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 18, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="#f1f5f9" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="monthKey"
              height={54}
              interval={0}
              tick={<FinancialTimelineTick />}
            />
            <YAxis hide width={0} />
            <Tooltip {...tooltipStyle} formatter={(value) => [formatCurrency(value), title]} />
            <Bar dataKey={dataKey} fill={color} fillOpacity={0.88} maxBarSize={44} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
        </Box>
        </Box>
      </Box>
    </Paper>
  );
}

export default function ServiceLineFinancials() {
  const theme = useTheme();
  const [financials, setFinancials] = useState({ months: [], service_lines: [], record_counts: {} });
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [year, setYear] = useState(ALL_VALUE);
  const [quarter, setQuarter] = useState(ALL_VALUE);
  const [month, setMonth] = useState(ALL_VALUE);
  const [isAnalysisOpen, setIsAnalysisOpen] = useState(false);
  const [isAnalysisGenerated, setIsAnalysisGenerated] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const [analysisTab, setAnalysisTab] = useState("analysis");
  const monthlyRows = financials.months;
  const serviceLines = financials.service_lines;
  const yearOptions = useMemo(() => [
    { label: "All Years", value: ALL_VALUE },
    ...Array.from(new Set(monthlyRows.map((row) => row.year)))
      .sort((a, b) => Number(b) - Number(a))
      .map((optionYear) => ({ label: optionYear, value: optionYear })),
  ], [monthlyRows]);

  const fetchFinancials = useCallback(async ({ refresh = false } = {}) => {
    if (refresh) setIsRefreshing(true); else setIsLoading(true);
    setError("");
    try {
      const response = await axios.get(API_URL, { headers: getAuthHeaders() });
      setFinancials(response.data || { months: [], service_lines: [], record_counts: {} });
      setLastRefreshed(new Date(response.data?.updated_at || Date.now()));
    } catch (requestError) {
      if (!handleUnauthorized(requestError)) {
        setError(getApiErrorMessage(requestError, "Unable to load service-line financials from Dynamics."));
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchFinancials(); }, [fetchFinancials]);
  const visibleMonthlyRows = useMemo(
    () =>
      monthlyRows.filter(
        (row) =>
          (year === ALL_VALUE || row.year === year) &&
          (month !== ALL_VALUE || quarter === ALL_VALUE || row.quarter === quarter) &&
          (month === ALL_VALUE || row.monthNumber === month)
      ),
    [month, monthlyRows, quarter, year]
  );
  const chartMonthlyRows = visibleMonthlyRows;
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
  const projectionRows = useMemo(() => buildServiceLineProjections(monthlyRows, serviceLines), [monthlyRows, serviceLines]);
  const totals = serviceLines.map((serviceLine) => ({
    label: serviceLine.label,
    total: chartMonthlyRows.reduce((sum, row) => sum + Number(row[serviceLine.key] || 0), 0),
  }));
  const topLine = [...totals].sort((a, b) => b.total - a.total)[0];

  function refreshFinancials() {
    fetchFinancials({ refresh: true });
  }

  if (isLoading) {
    return <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}><CircularProgress /></Box>;
  }

  return (
    <Stack spacing={2.5}>
      {error ? <Alert severity="error">{error}</Alert> : null}
      <Paper
        elevation={0}
        sx={{
          background: "linear-gradient(135deg, #ffffff 0%, #f8fbff 100%)",
          border: "1px solid rgba(0, 51, 108, 0.14)",
          borderRadius: 3,
          boxShadow: "0 12px 32px rgba(0, 51, 108, 0.07)",
          p: { xs: 2.25, md: 3 },
        }}
      >
        <Stack alignItems={{ xs: "stretch", lg: "center" }} direction={{ xs: "column", lg: "row" }} justifyContent="space-between" spacing={2}>
          <Stack spacing={0.65}>
            <Stack alignItems="center" direction="row" spacing={1}>
              <Box sx={{ backgroundColor: "success.main", borderRadius: "50%", height: 8, width: 8 }} />
              <Typography color="success.dark" fontWeight={800} variant="overline">
                Live Dynamics data
              </Typography>
            </Stack>
            <Typography color="primary.main" fontWeight={850} variant="h6">
              Service Line Performance
            </Typography>
            <Typography color="text.secondary" variant="body2">
              Compare contracted Camoin fees by primary service line and reporting period.
            </Typography>
          </Stack>
          <Stack alignItems={{ xs: "stretch", sm: "center" }} direction={{ xs: "column", sm: "row" }} spacing={1.5}>
            <Stack spacing={0.25}>
              <Typography color="text.secondary" variant="caption">Dynamics contracted projects</Typography>
              <Typography color="text.secondary" variant="caption">
                {lastRefreshed ? `Updated ${lastRefreshed.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}` : "Not updated"}
              </Typography>
            </Stack>
            <Button
              disabled={isRefreshing}
              onClick={refreshFinancials}
              startIcon={isRefreshing ? null : (
                <Box component="span" sx={{ display: "inline-flex" }}>
                  <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18"><path d="M20 11a8 8 0 1 0-2.34 5.66M20 4v7h-7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>
                </Box>
              )}
              sx={{ borderRadius: 2, fontWeight: 800, minHeight: 42, px: 2 }}
              variant="outlined"
            >
              {isRefreshing ? "Refreshing" : "Refresh"}
            </Button>
            <Button
              onClick={() => {
                setIsAnalysisGenerated(false);
                setAnalysisTab("analysis");
                setIsAnalysisOpen(true);
              }}
              startIcon={(
                <Box component="span" sx={{ display: "inline-flex" }}>
                  <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18"><path d="m12 3 1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4L12 3Zm6 10 .8 2.2L21 16l-2.2.8L18 19l-.8-2.2L15 16l2.2-.8L18 13Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>
                </Box>
              )}
              sx={{ borderRadius: 2, boxShadow: "0 8px 18px rgba(0, 51, 108, 0.20)", fontWeight: 800, minHeight: 42, px: 2.25 }}
              variant="contained"
            >
              AI Analysis
            </Button>
          </Stack>
        </Stack>
      </Paper>

      <Paper elevation={0} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: 2 }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} useFlexGap flexWrap="wrap">
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel id="service-line-year-label">Year</InputLabel>
            <Select label="Year" labelId="service-line-year-label" onChange={(event) => setYear(event.target.value)} value={year}>
              {yearOptions.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel id="service-line-quarter-label">Quarter</InputLabel>
            <Select label="Quarter" labelId="service-line-quarter-label" onChange={(event) => setQuarter(event.target.value)} value={quarter}>
              {quarterOptions.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel id="service-line-month-label">Month</InputLabel>
            <Select label="Month" labelId="service-line-month-label" onChange={(event) => setMonth(event.target.value)} value={month}>
              {monthOptions.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
            </Select>
          </FormControl>
        </Stack>
        <Typography color="text.secondary" sx={{ mt: 1.25 }} variant="caption">
          {financials.record_counts?.included?.toLocaleString() || 0} mapped contracted projects included. Values use Fee for Camoin and Contract Date from Dynamics; subcontractor fees are excluded.
        </Typography>
      </Paper>

      <Box sx={{ display: "grid", gap: 2.5, gridTemplateColumns: { xs: "minmax(0, 1fr)", lg: "repeat(2, minmax(0, 1fr))" }, minWidth: 0 }}>
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

      <Dialog
        fullWidth
        maxWidth="md"
        onClose={() => setIsAnalysisOpen(false)}
        open={isAnalysisOpen}
        PaperProps={{ sx: { borderRadius: 3, boxShadow: "0 24px 80px rgba(15, 23, 42, 0.24)", overflow: "hidden" } }}
      >
        <DialogTitle sx={{ background: "linear-gradient(135deg, #f8fbff 0%, #eef6ff 100%)", borderBottom: "1px solid", borderColor: "divider", px: 3, pb: isAnalysisGenerated ? 0 : 2.5, pt: 2.5 }}>
          <Typography color="primary.main" fontWeight={850} variant="h6">
            AI Service Line Financial Analysis
          </Typography>
          <Typography color="text.secondary" variant="body2">
            Executive insights generated from the current service-line reporting view
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
                  Review contracted Camoin-fee performance, service-line trends, and projections using the selected reporting period.
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
                <InsightCard label="Visible Camoin Fees" value={formatCurrency(totals.reduce((sum, row) => sum + row.total, 0))} />
              </Box>
              <Typography color="text.secondary">
                Live Dynamics data shows {topLine?.label || "the leading line"} carrying the strongest contracted Camoin-fee contribution in the visible period. Monthly and quarterly views can be used together to review contract timing.
              </Typography>
              <Typography color="text.secondary">
                Values represent Fee for Camoin and exclude subcontractor fees. They are contracted amounts, not recognized or invoiced revenue. Each project is assigned using its primary Dynamics service line.
              </Typography>
            </Stack>
          ) : null}

          {isAnalysisGenerated && analysisTab === "snipits" ? (
            <Stack spacing={1.5}>
              {[
                "Quarter and month filters now narrow the monthly service-line bars directly.",
                "Filtering by quarter is useful for comparing planning periods without changing the chart format.",
                "Filtering by month is useful for spotting project timing spikes and dips.",
                "All eight charts now use live contracted-project records from Dynamics.",
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
                Illustrative next-quarter projection based on the latest quarter-over-quarter average monthly trend in live contracted fees.
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
