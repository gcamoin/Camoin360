import { useCallback, useEffect, useRef, useState } from "react";
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

const API_URL = `${API_BASE_URL}/productivity/employee-hours`;
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 6 }, (_, index) => CURRENT_YEAR - index);
const MONTH_OPTIONS = [
  { label: "All Months", value: "" },
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

const tooltipStyle = {
  contentStyle: {
    borderRadius: 8,
    border: "1px solid #e2e8f0",
    fontSize: 12,
    boxShadow: "0 4px 6px -1px rgba(0,0,0,0.08)",
  },
};
const CHART_COLORS = {
  billable: "#0d9488",
  nonBillable: "#2563eb",
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
  const [selectedYear, setSelectedYear] = useState(CURRENT_YEAR);
  const [selectedMonth, setSelectedMonth] = useState("");
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
      const params = { year: selectedYear };
      if (selectedMonth) {
        params.month = selectedMonth;
      }

      const response = await axios.get(API_URL, {
        headers: getAuthHeaders(),
        params,
      });

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
  }, [selectedMonth, selectedYear]);

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
  const chartHeight = metrics.employees.length > 18 ? 380 : 420;

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
        <Stack
          direction={{ xs: "column", md: "row" }}
          justifyContent="space-between"
          alignItems={{ xs: "stretch", md: "flex-start" }}
          spacing={2}
          sx={{ mb: 2 }}
        >
          <Stack spacing={0.5}>
            <Typography fontWeight={800} color="text.primary">
              Billable vs Non-Billed Hours by Employee
            </Typography>
            <Typography color="text.secondary" variant="body2">
              Harvest hours averaged across {metrics.weeks} weeks, {dateRangeLabel}.
            </Typography>
          </Stack>

          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25}>
            <FormControl size="small" sx={{ minWidth: 132 }}>
              <InputLabel id="weekly-hours-year-label">Year</InputLabel>
              <Select
                label="Year"
                labelId="weekly-hours-year-label"
                onChange={(event) => setSelectedYear(Number(event.target.value))}
                value={selectedYear}
              >
                {YEAR_OPTIONS.map((year) => (
                  <MenuItem key={year} value={year}>
                    {year}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 156 }}>
              <InputLabel id="weekly-hours-month-label">Month</InputLabel>
              <Select
                label="Month"
                labelId="weekly-hours-month-label"
                onChange={(event) => setSelectedMonth(event.target.value)}
                value={selectedMonth}
              >
                {MONTH_OPTIONS.map((month) => (
                  <MenuItem key={month.label} value={month.value}>
                    {month.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
        </Stack>

        {isRefreshing ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
            <CircularProgress />
          </Box>
        ) : metrics.employees.length ? (
          <Box sx={{ pb: 1 }}>
            <Box sx={{ height: chartHeight, minWidth: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  barCategoryGap="8%"
                  barGap={0}
                  data={metrics.employees}
                  margin={{ top: 12, right: 16, bottom: 62, left: 0 }}
                >
                  <CartesianGrid vertical={false} stroke="#f1f5f9" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="employee"
                    interval={0}
                    tick={{ fontSize: 10 }}
                    tickFormatter={(value) => (value.length > 16 ? `${value.slice(0, 16)}...` : value)}
                    angle={-45}
                    textAnchor="end"
                    height={64}
                  />
                  <YAxis
                    allowDecimals
                    tick={{ fontSize: 10 }}
                    type="number"
                    unit="h"
                  />
                  <Tooltip
                    {...tooltipStyle}
                    formatter={(value, name) => [
                      `${Number(value).toLocaleString(undefined, {
                        maximumFractionDigits: 2,
                        minimumFractionDigits: 0,
                      })} hours/week`,
                      name,
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
                  <Legend />
                  <Bar
                    dataKey="average_weekly_non_billable_hours"
                    fill={CHART_COLORS.nonBillable}
                    fillOpacity={0.86}
                    maxBarSize={34}
                    name="Non-Billed Hours"
                    radius={[0, 0, 3, 3]}
                    stackId="hours"
                  />
                  <Bar
                    dataKey="average_weekly_billable_hours"
                    fill={CHART_COLORS.billable}
                    fillOpacity={0.86}
                    maxBarSize={34}
                    name="Billable Hours"
                    radius={[3, 3, 0, 0]}
                    stackId="hours"
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
