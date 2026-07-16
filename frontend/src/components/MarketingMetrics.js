import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Typography,
} from "@mui/material";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { API_BASE_URL, getApiErrorMessage, getAuthHeaders, handleUnauthorized } from "../auth";

const API_URL = `${API_BASE_URL}/marketing/website-visits`;
const SERVICE_LINE_API_URL = `${API_BASE_URL}/marketing/service-line-metrics`;
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const RANGE_OPTIONS = [
  { label: "Since 2022", value: "since_2022" },
  { label: "Last Week", value: "last_week" },
  { label: "Last Month", value: "last_month" },
  { label: "Last 6 Months", value: "last_6_months" },
  { label: "Last Year", value: "last_year" },
];

const GA_VISITS_COLOR = "#2a78d6";
const LEADFEEDER_VISITS_COLOR = "#008300";

const MONTH_OPTIONS = [
  { label: "January", value: 1 },
  { label: "February", value: 2 },
  { label: "March", value: 3 },
  { label: "April", value: 4 },
  { label: "May", value: 5 },
  { label: "June", value: 6 },
  { label: "July", value: 7 },
  { label: "August", value: 8 },
  { label: "September", value: 9 },
  { label: "October", value: 10 },
  { label: "November", value: 11 },
  { label: "December", value: 12 },
];

const QUARTER_OPTIONS = [
  { label: "Q1", value: 1 },
  { label: "Q2", value: 2 },
  { label: "Q3", value: 3 },
  { label: "Q4", value: 4 },
];

const tooltipStyle = {
  contentStyle: {
    borderRadius: 8,
    border: "1px solid #e2e8f0",
    fontSize: 12,
    boxShadow: "0 4px 6px -1px rgba(0,0,0,0.08)",
  },
};

export default function MarketingMetrics() {
  const isMountedRef = useRef(true);
  const [metrics, setMetrics] = useState({
    bucket_grain: "month",
    landing_pages: [],
    months: [],
    range_label: "Since 2022",
    target_total_visitors: 0,
    total_visitors: 0,
    updated_at: "",
  });
  const [range, setRange] = useState("since_2022");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null);
  const [error, setError] = useState("");

  const fetchMetrics = useCallback(async ({ refresh = false, silent = false } = {}) => {
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
        params: { range, refresh },
      });

      if (!isMountedRef.current) return;

      setMetrics({
        bucket_grain: response.data?.bucket_grain || "month",
        landing_pages: response.data?.landing_pages || [],
        months: response.data?.months || [],
        range_label: response.data?.range_label || "Since 2022",
        target_total_visitors: response.data?.target_total_visitors || 0,
        total_visitors: response.data?.total_visitors || 0,
        updated_at: response.data?.updated_at || "",
      });
      setSyncStatus(response.data?.sync || null);
    } catch (fetchError) {
      if (handleUnauthorized(fetchError)) {
        return;
      }

      if (!isMountedRef.current) return;

      setError(getApiErrorMessage(fetchError, "Unable to load website visit metrics."));
    } finally {
      if (!isMountedRef.current) return;

      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [range]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchMetrics();

    const intervalId = setInterval(() => {
      fetchMetrics({ silent: true });
    }, REFRESH_INTERVAL_MS);

    return () => {
      isMountedRef.current = false;
      clearInterval(intervalId);
    };
  }, [fetchMetrics]);

  useEffect(() => {
    if (syncStatus?.status !== "syncing") {
      return undefined;
    }

    const pollTimer = window.setTimeout(() => {
      fetchMetrics({ silent: true });
    }, 5000);

    return () => {
      window.clearTimeout(pollTimer);
    };
  }, [fetchMetrics, syncStatus]);

  const [serviceLineMetrics, setServiceLineMetrics] = useState({ service_lines: [], updated_at: "" });
  const [isServiceLineLoading, setIsServiceLineLoading] = useState(true);
  const [isServiceLineRefreshing, setIsServiceLineRefreshing] = useState(false);
  const [serviceLineSyncStatus, setServiceLineSyncStatus] = useState(null);
  const [serviceLineError, setServiceLineError] = useState("");
  const [quarterFilter, setQuarterFilter] = useState("all");
  const [monthFilter, setMonthFilter] = useState("all");
  const [yearFilter, setYearFilter] = useState("all");

  const fetchServiceLineMetrics = useCallback(async ({ refresh = false, silent = false } = {}) => {
    if (!isMountedRef.current) return;

    if (silent) {
      setIsServiceLineRefreshing(true);
    } else {
      setIsServiceLineLoading(true);
    }
    setServiceLineError("");

    try {
      const response = await axios.get(SERVICE_LINE_API_URL, {
        headers: getAuthHeaders(),
        params: { refresh },
      });

      if (!isMountedRef.current) return;

      setServiceLineMetrics({
        service_lines: response.data?.service_lines || [],
        updated_at: response.data?.updated_at || "",
      });
      setServiceLineSyncStatus(response.data?.sync || null);
    } catch (fetchError) {
      if (handleUnauthorized(fetchError)) {
        return;
      }

      if (!isMountedRef.current) return;

      setServiceLineError(getApiErrorMessage(fetchError, "Unable to load service line marketing metrics."));
    } finally {
      if (!isMountedRef.current) return;

      setIsServiceLineLoading(false);
      setIsServiceLineRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchServiceLineMetrics();

    const intervalId = setInterval(() => {
      fetchServiceLineMetrics({ silent: true });
    }, REFRESH_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, [fetchServiceLineMetrics]);

  useEffect(() => {
    if (serviceLineSyncStatus?.status !== "syncing") {
      return undefined;
    }

    const pollTimer = window.setTimeout(() => {
      fetchServiceLineMetrics({ silent: true });
    }, 5000);

    return () => {
      window.clearTimeout(pollTimer);
    };
  }, [fetchServiceLineMetrics, serviceLineSyncStatus]);

  const availableYears = useMemo(() => {
    const years = new Set();
    serviceLineMetrics.service_lines.forEach((line) => {
      line.months.forEach((month) => years.add(month.year));
    });
    return Array.from(years).sort((a, b) => a - b);
  }, [serviceLineMetrics.service_lines]);

  const filteredServiceLines = useMemo(() => {
    return serviceLineMetrics.service_lines.map((line) => ({
      ...line,
      months: line.months.filter((month) => {
        if (yearFilter !== "all" && month.year !== yearFilter) return false;
        if (monthFilter !== "all" && month.month !== monthFilter) return false;
        if (quarterFilter !== "all" && Math.ceil(month.month / 3) !== quarterFilter) return false;
        return true;
      }),
    }));
  }, [serviceLineMetrics.service_lines, yearFilter, monthFilter, quarterFilter]);

  const serviceLineUpdatedLabel = serviceLineMetrics.updated_at
    ? `Updated ${new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(serviceLineMetrics.updated_at))}`
    : "";
  const serviceLineStatusLabel =
    serviceLineSyncStatus?.status === "syncing"
      ? "Syncing Google Analytics & Leadfeeder data..."
      : serviceLineUpdatedLabel || "Service line marketing metrics";

  const peakMonth = useMemo(
    () =>
      metrics.months.reduce(
        (peak, month) => (month.visitors > peak.visitors ? month : peak),
        { month: "None", visitors: 0 }
      ),
    [metrics.months]
  );
  const updatedLabel = metrics.updated_at
    ? `Updated ${new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(metrics.updated_at))}`
    : "";
  const statusLabel =
    syncStatus?.status === "syncing"
      ? "Syncing Dynamics data..."
      : updatedLabel || "Website visit metrics";
  const visitorsChartTitle =
    metrics.bucket_grain === "day" ? "Website Visitors by Day" : "Website Visitors by Month";
  const targetVisitorsChartTitle =
    metrics.bucket_grain === "day"
      ? "Target Industry Visitors by Day"
      : "Target Industry Visitors by Month";

  if (isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Stack spacing={2.5}>
      {error ? <Alert severity="error">{error}</Alert> : null}

      <Stack
        direction={{ xs: "column", sm: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "stretch", sm: "center" }}
        spacing={1.5}
      >
        <Stack direction="row" flexWrap="wrap" gap={0.75}>
          {RANGE_OPTIONS.map((option) => {
            const isActive = range === option.value;
            return (
              <Button
                key={option.value}
                onClick={() => setRange(option.value)}
                size="small"
                variant={isActive ? "contained" : "outlined"}
                disableElevation
                sx={{
                  borderRadius: 1,
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  minWidth: 0,
                  ...(!isActive && { borderColor: "divider", color: "text.secondary" }),
                }}
              >
                {option.label}
              </Button>
            );
          })}
        </Stack>
        <Stack alignItems={{ xs: "flex-start", sm: "flex-end" }} spacing={0.75}>
          <Typography color="text.secondary" fontSize="0.75rem">
            {statusLabel}
          </Typography>
          <Button
            disabled={isRefreshing}
            onClick={() => fetchMetrics({ refresh: true, silent: true })}
            size="small"
            variant="outlined"
            sx={{ borderRadius: 1, fontSize: "0.75rem", fontWeight: 700 }}
          >
            {isRefreshing || syncStatus?.status === "syncing" ? "Refreshing" : "Refresh"}
          </Button>
        </Stack>
      </Stack>

      <Box
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" },
        }}
      >
        <Paper
          elevation={0}
          sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: 2.5 }}
        >
          <Typography color="text.secondary" variant="overline">
            {metrics.range_label}
          </Typography>
          <Typography color="primary.main" sx={{ fontSize: "2.35rem", fontWeight: 800, lineHeight: 1.1, mt: 0.75 }}>
            {metrics.total_visitors.toLocaleString()}
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 0.75 }} variant="body2">
            Total website visitor records
          </Typography>
        </Paper>
        <Paper
          elevation={0}
          sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: 2.5 }}
        >
          <Typography color="text.secondary" variant="overline">
            Peak Month
          </Typography>
          <Typography color="primary.main" sx={{ fontSize: "2.35rem", fontWeight: 800, lineHeight: 1.1, mt: 0.75 }}>
            {peakMonth.month}
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 0.75 }} variant="body2">
            {peakMonth.visitors.toLocaleString()} visitor records
          </Typography>
        </Paper>
      </Box>

      <Box
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: { xs: "1fr", lg: "repeat(2, minmax(0, 1fr))" },
        }}
      >
        <Paper
          elevation={0}
          sx={{
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 2,
            p: { xs: 2, md: 2.5 },
            backgroundColor: "common.white",
          }}
        >
          <Stack spacing={0.5} sx={{ mb: 2 }}>
            <Typography fontWeight={800} color="text.primary">
              {visitorsChartTitle}
            </Typography>
            <Typography color="text.secondary" variant="body2">
              Visitors recorded for Camoin Associates in the selected time frame.
            </Typography>
          </Stack>
          <Box sx={{ height: 320, minWidth: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={metrics.months} margin={{ top: 8, right: 18, bottom: 0, left: -12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip {...tooltipStyle} formatter={(value) => [value.toLocaleString(), "Visitors"]} />
                <Bar dataKey="visitors" fill="#0d9488" fillOpacity={0.86} radius={[3, 3, 0, 0]} maxBarSize={42} />
              </BarChart>
            </ResponsiveContainer>
          </Box>
        </Paper>

        <Paper
          elevation={0}
          sx={{
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 2,
            p: { xs: 2, md: 2.5 },
            backgroundColor: "common.white",
          }}
        >
          <Stack spacing={0.5} sx={{ mb: 2 }}>
            <Typography fontWeight={800} color="text.primary">
              {targetVisitorsChartTitle}
            </Typography>
            <Typography color="text.secondary" variant="body2">
              Visitors whose account NAICS matches Camoin Associates target industries.
            </Typography>
          </Stack>
          <Box sx={{ height: 320, minWidth: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={metrics.months} margin={{ top: 8, right: 18, bottom: 0, left: -12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip
                  {...tooltipStyle}
                  formatter={(value) => [value.toLocaleString(), "Target visitors"]}
                />
                <Bar
                  dataKey="target_visitors"
                  fill="#2563eb"
                  fillOpacity={0.84}
                  radius={[3, 3, 0, 0]}
                  maxBarSize={42}
                />
              </BarChart>
            </ResponsiveContainer>
          </Box>
          <Typography color="text.secondary" sx={{ mt: 1.5 }} variant="body2">
            {metrics.target_total_visitors.toLocaleString()} target-industry visitor records
          </Typography>
        </Paper>
      </Box>

      <Stack spacing={2.5} sx={{ pt: 1 }}>
        {serviceLineError ? <Alert severity="error">{serviceLineError}</Alert> : null}

        <Stack
          direction={{ xs: "column", sm: "row" }}
          justifyContent="space-between"
          alignItems={{ xs: "stretch", sm: "center" }}
          spacing={1.5}
        >
          <Stack spacing={0.25}>
            <Typography fontWeight={800} color="text.primary">
              Monthly Service Line Marketing Metrics
            </Typography>
            <Typography color="text.secondary" variant="body2">
              Google Analytics vs. Leadfeeder landing page visits by service line.
            </Typography>
          </Stack>
          <Stack alignItems={{ xs: "flex-start", sm: "flex-end" }} spacing={0.75}>
            <Typography color="text.secondary" fontSize="0.75rem">
              {serviceLineStatusLabel}
            </Typography>
            <Button
              disabled={isServiceLineRefreshing}
              onClick={() => fetchServiceLineMetrics({ refresh: true, silent: true })}
              size="small"
              variant="outlined"
              sx={{ borderRadius: 1, fontSize: "0.75rem", fontWeight: 700 }}
            >
              {isServiceLineRefreshing || serviceLineSyncStatus?.status === "syncing" ? "Refreshing" : "Refresh"}
            </Button>
          </Stack>
        </Stack>

        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel id="service-line-quarter-label">Quarter</InputLabel>
            <Select
              labelId="service-line-quarter-label"
              label="Quarter"
              value={quarterFilter}
              onChange={(event) => setQuarterFilter(event.target.value)}
            >
              <MenuItem value="all">All</MenuItem>
              {QUARTER_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel id="service-line-month-label">Month</InputLabel>
            <Select
              labelId="service-line-month-label"
              label="Month"
              value={monthFilter}
              onChange={(event) => setMonthFilter(event.target.value)}
            >
              <MenuItem value="all">All</MenuItem>
              {MONTH_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 110 }}>
            <InputLabel id="service-line-year-label">Year</InputLabel>
            <Select
              labelId="service-line-year-label"
              label="Year"
              value={yearFilter}
              onChange={(event) => setYearFilter(event.target.value)}
            >
              <MenuItem value="all">All</MenuItem>
              {availableYears.map((year) => (
                <MenuItem key={year} value={year}>
                  {year}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>

        {isServiceLineLoading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Box
            sx={{
              display: "grid",
              gap: 2,
              gridTemplateColumns: { xs: "1fr", lg: "repeat(2, minmax(0, 1fr))" },
            }}
          >
            {filteredServiceLines.map((line) => (
              <Paper
                key={line.key}
                elevation={0}
                sx={{
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: 2,
                  p: { xs: 2, md: 2.5 },
                  backgroundColor: "common.white",
                }}
              >
                <Stack spacing={0.5} sx={{ mb: 2 }}>
                  <Typography fontWeight={800} color="text.primary">
                    {line.label} - Landing Page Visits
                  </Typography>
                </Stack>
                <Box sx={{ height: 320, minWidth: 0 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={line.months} margin={{ top: 8, right: 18, bottom: 0, left: -12 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                      <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip {...tooltipStyle} formatter={(value, name) => [value.toLocaleString(), name]} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar
                        dataKey="ga_visits"
                        name="Google Analytics Visits"
                        fill={GA_VISITS_COLOR}
                        radius={[3, 3, 0, 0]}
                        maxBarSize={28}
                      />
                      <Bar
                        dataKey="leadfeeder_visits"
                        name="Leadfeeder Visits"
                        fill={LEADFEEDER_VISITS_COLOR}
                        radius={[3, 3, 0, 0]}
                        maxBarSize={28}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </Box>
              </Paper>
            ))}
          </Box>
        )}
      </Stack>
    </Stack>
  );
}
