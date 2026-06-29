import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  Stack,
  Typography,
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

const API_URL = `${API_BASE_URL}/marketing/website-visits`;
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const RANGE_OPTIONS = [
  { label: "Last Week", value: "last_week" },
  { label: "Last Month", value: "last_month" },
  { label: "Last 6 Months", value: "last_6_months" },
  { label: "Last Year", value: "last_year" },
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
    range_label: "Last Year",
    target_total_visitors: 0,
    total_visitors: 0,
    updated_at: "",
  });
  const [range, setRange] = useState("last_year");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState("");

  const fetchMetrics = useCallback(async ({ silent = false } = {}) => {
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
        params: { range },
      });

      if (!isMountedRef.current) return;

      setMetrics({
        bucket_grain: response.data?.bucket_grain || "month",
        landing_pages: response.data?.landing_pages || [],
        months: response.data?.months || [],
        range_label: response.data?.range_label || "Last Year",
        target_total_visitors: response.data?.target_total_visitors || 0,
        total_visitors: response.data?.total_visitors || 0,
        updated_at: response.data?.updated_at || "",
      });
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
            {updatedLabel || "Website visit metrics"}
          </Typography>
          <Button
            disabled={isRefreshing}
            onClick={() => fetchMetrics({ silent: true })}
            size="small"
            variant="outlined"
            sx={{ borderRadius: 1, fontSize: "0.75rem", fontWeight: 700 }}
          >
            {isRefreshing ? "Refreshing" : "Refresh"}
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

    </Stack>
  );
}
