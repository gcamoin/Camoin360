import { useCallback, useEffect, useRef, useState } from "react";
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

const API_URL = `${API_BASE_URL}/productivity/employee-hours`;
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

const tooltipStyle = {
  contentStyle: {
    borderRadius: 8,
    border: "1px solid #e2e8f0",
    fontSize: 12,
    boxShadow: "0 4px 6px -1px rgba(0,0,0,0.08)",
  },
};

const formatShortDate = (dateValue) =>
  new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
    new Date(`${dateValue}T00:00:00`)
  );

export default function EmployeeProductivity() {
  const isMountedRef = useRef(true);
  const [metrics, setMetrics] = useState({
    employees: [],
    from: "",
    to: "",
    weeks: 12,
    updated_at: "",
  });
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
      const response = await axios.get(API_URL, { headers: getAuthHeaders() });

      if (!isMountedRef.current) return;

      setMetrics({
        employees: response.data?.employees || [],
        from: response.data?.from || "",
        to: response.data?.to || "",
        weeks: response.data?.weeks || 12,
        updated_at: response.data?.updated_at || "",
      });
    } catch (fetchError) {
      if (handleUnauthorized(fetchError)) {
        return;
      }

      if (!isMountedRef.current) return;

      setError(getApiErrorMessage(fetchError, "Unable to load employee productivity metrics."));
    } finally {
      if (!isMountedRef.current) return;

      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

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

  const updatedLabel = metrics.updated_at
    ? `Updated ${new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(metrics.updated_at))}`
    : "";
  const dateRangeLabel =
    metrics.from && metrics.to
      ? `${formatShortDate(metrics.from)} - ${formatShortDate(metrics.to)}`
      : `Last ${metrics.weeks} weeks`;
  const chartHeight = Math.max(300, metrics.employees.length * 36 + 72);

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
        <Typography color="text.secondary" fontSize="0.75rem">
          {updatedLabel || "Employee productivity metrics"}
        </Typography>
        <Button
          disabled={isRefreshing}
          onClick={() => fetchMetrics({ silent: true })}
          size="small"
          variant="outlined"
          sx={{ alignSelf: { xs: "flex-start", sm: "auto" }, borderRadius: 1, fontSize: "0.75rem", fontWeight: 700 }}
        >
          {isRefreshing ? "Refreshing" : "Refresh"}
        </Button>
      </Stack>

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
            Average Weekly Hours by Employee
          </Typography>
          <Typography color="text.secondary" variant="body2">
            Harvest hours averaged across {metrics.weeks} weeks, {dateRangeLabel}.
          </Typography>
        </Stack>

        {metrics.employees.length ? (
          <Box sx={{ maxHeight: 560, overflowY: "auto", pr: 1 }}>
            <Box sx={{ height: chartHeight, minWidth: 520 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={metrics.employees}
                  layout="vertical"
                  margin={{ top: 8, right: 28, bottom: 8, left: 18 }}
                >
                  <CartesianGrid horizontal={false} stroke="#f1f5f9" strokeDasharray="3 3" />
                  <XAxis
                    allowDecimals
                    tick={{ fontSize: 11 }}
                    type="number"
                    unit="h"
                  />
                  <YAxis
                    dataKey="employee"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(value) => (value.length > 28 ? `${value.slice(0, 28)}...` : value)}
                    type="category"
                    width={190}
                  />
                  <Tooltip
                    {...tooltipStyle}
                    formatter={(value) => [
                      `${Number(value).toLocaleString(undefined, {
                        maximumFractionDigits: 2,
                        minimumFractionDigits: 0,
                      })} hours/week`,
                      "Average",
                    ]}
                    labelFormatter={(label) => {
                      const employee = metrics.employees.find((row) => row.employee === label);
                      return employee
                        ? `${label} - ${employee.total_hours.toLocaleString(undefined, {
                            maximumFractionDigits: 2,
                          })} total hours`
                        : label;
                    }}
                  />
                  <Bar
                    dataKey="average_weekly_hours"
                    fill="#0d9488"
                    fillOpacity={0.86}
                    radius={[0, 3, 3, 0]}
                    maxBarSize={24}
                  />
                </BarChart>
              </ResponsiveContainer>
            </Box>
          </Box>
        ) : (
          <Typography color="text.secondary" variant="body2">
            No Harvest time entries found for this period.
          </Typography>
        )}
      </Paper>
    </Stack>
  );
}
