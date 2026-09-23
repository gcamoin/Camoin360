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
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { API_BASE_URL, getApiErrorMessage, getAuthHeaders, handleUnauthorized } from "../auth";

const API_URL = `${API_BASE_URL}/marketing/website-visits`;
const SEO_API_URL = `${API_BASE_URL}/marketing/seo-results`;
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

export function formatSeoTooltipMetrics(row = {}) {
  return {
    clicks: (row.clicks || 0).toLocaleString(),
    averagePosition: (row.average_position || 0).toFixed(2),
    impressions: (row.impressions || 0).toLocaleString(),
    ctr: `${((row.ctr || 0) * 100).toFixed(2)}%`,
  };
}

function SeoTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload || {};
  const values = formatSeoTooltipMetrics(row);
  return (
    <Paper elevation={3} sx={{ border: "1px solid", borderColor: "divider", p: 1.25 }}>
      <Typography fontSize="0.75rem" fontWeight={800} sx={{ mb: 0.5 }}>{label}</Typography>
      <Typography fontSize="0.75rem">Clicks: {values.clicks}</Typography>
      <Typography fontSize="0.75rem">Average position: {values.averagePosition}</Typography>
      <Typography fontSize="0.75rem">Impressions: {values.impressions}</Typography>
      <Typography fontSize="0.75rem">CTR: {values.ctr}</Typography>
    </Paper>
  );
}

export function MarketingOverview() {
  return <MarketingMetrics showOverview showServiceLines={false} />;
}

export default function MarketingMetrics({ showOverview = false, showServiceLines = true } = {}) {
  const isMountedRef = useRef(true);
  const [metrics, setMetrics] = useState({
    bucket_grain: "month",
    landing_pages: [],
    months: [],
    range_label: "Since 2022",
    target_total_visitors: 0,
    total_visitors: 0,
    updated_at: "",
    warnings: [],
  });
  const [range, setRange] = useState("since_2022");
  const [isLoading, setIsLoading] = useState(showOverview);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null);
  const [error, setError] = useState("");
  const [seoMetrics, setSeoMetrics] = useState({ months: [], updated_at: "" });
  const [seoSyncStatus, setSeoSyncStatus] = useState(null);
  const [seoError, setSeoError] = useState("");
  const [isSeoRefreshing, setIsSeoRefreshing] = useState(false);

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
        warnings: response.data?.warnings || [],
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

  const fetchSeoMetrics = useCallback(async ({ refresh = false } = {}) => {
    if (!isMountedRef.current) return;
    setIsSeoRefreshing(true);
    setSeoError("");
    try {
      const response = await axios.get(SEO_API_URL, {
        headers: getAuthHeaders(),
        params: { range, refresh },
      });
      if (!isMountedRef.current) return;
      setSeoMetrics({
        months: response.data?.months || [],
        updated_at: response.data?.updated_at || "",
      });
      setSeoSyncStatus(response.data?.sync || null);
    } catch (fetchError) {
      if (handleUnauthorized(fetchError) || !isMountedRef.current) return;
      setSeoError(getApiErrorMessage(fetchError, "Unable to load Search Console metrics."));
    } finally {
      if (isMountedRef.current) setIsSeoRefreshing(false);
    }
  }, [range]);

  useEffect(() => {
    if (!showOverview) {
      return undefined;
    }

    isMountedRef.current = true;
    fetchMetrics();
    fetchSeoMetrics();

    const intervalId = setInterval(() => {
      fetchMetrics({ silent: true });
      fetchSeoMetrics();
    }, REFRESH_INTERVAL_MS);

    return () => {
      isMountedRef.current = false;
      clearInterval(intervalId);
    };
  }, [fetchMetrics, fetchSeoMetrics, showOverview]);

  useEffect(() => {
    if (!showOverview) {
      return undefined;
    }

    if (syncStatus?.status !== "syncing") {
      return undefined;
    }

    const pollTimer = window.setTimeout(() => {
      fetchMetrics({ silent: true });
    }, 5000);

    return () => {
      window.clearTimeout(pollTimer);
    };
  }, [fetchMetrics, showOverview, syncStatus]);

  useEffect(() => {
    if (!showOverview || seoSyncStatus?.status !== "syncing") return undefined;
    const pollTimer = window.setTimeout(() => fetchSeoMetrics(), 5000);
    return () => window.clearTimeout(pollTimer);
  }, [fetchSeoMetrics, seoSyncStatus, showOverview]);

  const [serviceLineMetrics, setServiceLineMetrics] = useState({ service_lines: [], updated_at: "" });
  const [isServiceLineLoading, setIsServiceLineLoading] = useState(showServiceLines);
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
    if (!showServiceLines) {
      return undefined;
    }

    isMountedRef.current = true;
    fetchServiceLineMetrics();

    const intervalId = setInterval(() => {
      fetchServiceLineMetrics({ silent: true });
    }, REFRESH_INTERVAL_MS);

    return () => {
      isMountedRef.current = false;
      clearInterval(intervalId);
    };
  }, [fetchServiceLineMetrics, showServiceLines]);

  useEffect(() => {
    if (!showServiceLines) {
      return undefined;
    }

    if (serviceLineSyncStatus?.status !== "syncing") {
      return undefined;
    }

    const pollTimer = window.setTimeout(() => {
      fetchServiceLineMetrics({ silent: true });
    }, 5000);

    return () => {
      window.clearTimeout(pollTimer);
    };
  }, [fetchServiceLineMetrics, serviceLineSyncStatus, showServiceLines]);

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

  const updatedLabel = metrics.updated_at
    ? `Updated ${new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(metrics.updated_at))}`
    : "";
  const statusLabel =
    syncStatus?.status === "syncing"
      ? "Syncing GA4 and Dynamics data..."
      : updatedLabel || "Website visit metrics";
  const visitorsChartTitle =
    metrics.bucket_grain === "day" ? "GA4 Website Sessions by Day" : "GA4 Website Sessions by Month";
  const targetVisitorsChartTitle =
    metrics.bucket_grain === "day"
      ? "Target Industry Leadfeeder Visits by Day"
      : "Target Industry Leadfeeder Visits by Month";

  if (showOverview && isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Stack spacing={2.5}>
      {showOverview ? (
        <>
          {error ? <Alert severity="error">{error}</Alert> : null}
          {seoError ? <Alert severity="warning">{seoError}</Alert> : null}
          {syncStatus?.status === "error" && syncStatus.last_error ? (
            <Alert severity="error">{syncStatus.last_error}</Alert>
          ) : null}
          {(metrics.warnings || []).map((warning) => (
            <Alert key={warning} severity="warning">{warning}</Alert>
          ))}
          {seoSyncStatus?.status === "error" && seoSyncStatus.last_error ? (
            <Alert severity="warning">Search Console metrics are unavailable: {seoSyncStatus.last_error}</Alert>
          ) : null}

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
              Total site traffic from Google Analytics 4 in the selected time frame.
            </Typography>
          </Stack>
          <Box sx={{ height: 320, minWidth: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={metrics.months} margin={{ top: 8, right: 18, bottom: 0, left: -12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip {...tooltipStyle} formatter={(value) => [value.toLocaleString(), "GA4 sessions"]} />
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
              Leadfeeder visits whose account NAICS matches Camoin Associates target industries.
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
                  formatter={(value) => [value.toLocaleString(), "Target Leadfeeder visits"]}
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
            {metrics.target_total_visitors.toLocaleString()} target-industry Leadfeeder visit records
          </Typography>
        </Paper>
      </Box>

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
          <Stack
            direction={{ xs: "column", sm: "row" }}
            justifyContent="space-between"
            alignItems={{ xs: "flex-start", sm: "center" }}
            spacing={1}
            sx={{ mb: 2 }}
          >
            <Stack spacing={0.5}>
              <Typography fontWeight={800} color="text.primary">SEO Results</Typography>
              <Typography color="text.secondary" variant="body2">
                Google Search clicks and average search position by month.
              </Typography>
            </Stack>
            <Button
              disabled={isSeoRefreshing || seoSyncStatus?.status === "syncing"}
              onClick={() => fetchSeoMetrics({ refresh: true })}
              size="small"
              variant="outlined"
              sx={{ borderRadius: 1, fontSize: "0.75rem", fontWeight: 700 }}
            >
              {isSeoRefreshing || seoSyncStatus?.status === "syncing" ? "Refreshing" : "Refresh SEO"}
            </Button>
          </Stack>
          {seoMetrics.months.length ? (
            <Box sx={{ height: 340, minWidth: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={seoMetrics.months} margin={{ top: 8, right: 24, bottom: 0, left: -4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="clicks" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis
                    yAxisId="position"
                    orientation="right"
                    reversed
                    domain={[1, "auto"]}
                    tick={{ fontSize: 11 }}
                  />
                  <Tooltip content={<SeoTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar
                    yAxisId="clicks"
                    dataKey="clicks"
                    name="Google Search Clicks"
                    fill="#2563eb"
                    fillOpacity={0.84}
                    radius={[3, 3, 0, 0]}
                    maxBarSize={42}
                  />
                  <Line
                    yAxisId="position"
                    dataKey="average_position"
                    name="Average Search Position"
                    type="monotone"
                    stroke="#d97706"
                    strokeWidth={2.5}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </Box>
          ) : (
            <Box sx={{ alignItems: "center", display: "flex", justifyContent: "center", minHeight: 220 }}>
              <Typography color="text.secondary" variant="body2">
                {seoSyncStatus?.status === "syncing" ? "Syncing Search Console data..." : "No SEO data is available."}
              </Typography>
            </Box>
          )}
        </Paper>
        </>
      ) : null}

      {showServiceLines ? (
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
                    <ComposedChart data={line.months} margin={{ top: 8, right: 18, bottom: 0, left: -12 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                      <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                      <YAxis yAxisId="ga" allowDecimals={false} tick={{ fontSize: 11 }} />
                      <YAxis
                        yAxisId="leadfeeder"
                        allowDecimals={false}
                        orientation="right"
                        tick={{ fontSize: 11 }}
                      />
                      <Tooltip {...tooltipStyle} formatter={(value, name) => [value.toLocaleString(), name]} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar
                        yAxisId="ga"
                        dataKey="ga_visits"
                        name="Google Analytics Visits"
                        fill={GA_VISITS_COLOR}
                        radius={[3, 3, 0, 0]}
                        maxBarSize={28}
                      />
                      <Line
                        yAxisId="leadfeeder"
                        dataKey="leadfeeder_visits"
                        name="Leadfeeder Visits"
                        type="monotone"
                        stroke={LEADFEEDER_VISITS_COLOR}
                        strokeWidth={2.5}
                        dot={{ r: 3 }}
                        activeDot={{ r: 5 }}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </Box>
              </Paper>
            ))}
          </Box>
        )}
      </Stack>
      ) : null}
    </Stack>
  );
}
