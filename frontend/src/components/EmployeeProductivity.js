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

const API_URL = `${API_BASE_URL}/productivity/employee-hours`;
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: CURRENT_YEAR - 2022 + 1 }, (_, index) => CURRENT_YEAR - index);
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
const ALL_EMPLOYEES_VALUE = "all";
const BILLING_OPTIONS = [
  { label: "All Billing", value: "all" },
  { label: "Billable", value: "billable" },
  { label: "Non-Billed", value: "non_billable" },
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

const formatPercent = (value) =>
  `${Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  })}%`;

const formatHours = (value) =>
  Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  });

const getUtilizationRate = (employee) => {
  if (employee.utilization_rate !== undefined && employee.utilization_rate !== null) {
    return Number(employee.utilization_rate || 0);
  }

  const totalHours = Number(employee.total_hours || 0);
  if (!totalHours) {
    return 0;
  }

  return (Number(employee.billable_hours || 0) / totalHours) * 100;
};

const formatShortDate = (dateValue) =>
  new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
    new Date(`${dateValue}T00:00:00`)
  );

export default function EmployeeProductivity() {
  const isMountedRef = useRef(true);
  const activeFetchKeyRef = useRef("");
  const latestRequestIdRef = useRef(0);
  const [metrics, setMetrics] = useState({
    employees: [],
    excluded_scope: "prospect_engage",
    from: "",
    scope: "consulting",
    to: "",
    utilization_employees: [],
    weeks: 12,
    updated_at: "",
  });
  const [selectedYear, setSelectedYear] = useState("");
  const [selectedMonth, setSelectedMonth] = useState("");
  const [selectedEmployee, setSelectedEmployee] = useState(ALL_EMPLOYEES_VALUE);
  const [selectedBilling, setSelectedBilling] = useState("all");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null);
  const [error, setError] = useState("");

  const fetchMetrics = useCallback(async ({ refresh = false, background = false } = {}) => {
    if (!isMountedRef.current) return;

    const requestKey = `${selectedYear}:${selectedMonth || "all"}:${refresh ? "refresh" : "read"}`;
    if (activeFetchKeyRef.current === requestKey) {
      return;
    }

    activeFetchKeyRef.current = requestKey;
    const requestId = latestRequestIdRef.current + 1;
    latestRequestIdRef.current = requestId;

    if (refresh) {
      setIsRefreshing(true);
    } else if (!background) {
      setIsLoading(true);
      setError("");
    } else {
      setError("");
    }

    try {
      const params = {};
      if (selectedYear) {
        params.year = selectedYear;
      }
      if (selectedMonth) {
        params.month = selectedMonth;
      }
      if (refresh) {
        params.refresh = true;
      }

      const response = await axios.get(API_URL, {
        headers: getAuthHeaders(),
        params,
      });

      if (!isMountedRef.current || requestId !== latestRequestIdRef.current) return;

      setMetrics({
        employees: response.data?.employees || [],
        excluded_scope: response.data?.excluded_scope || "prospect_engage",
        from: response.data?.from || "",
        scope: response.data?.scope || "consulting",
        to: response.data?.to || "",
        utilization_employees: response.data?.utilization_employees || response.data?.employees || [],
        weeks: response.data?.weeks || 12,
        updated_at: response.data?.updated_at || "",
      });
      setSyncStatus(response.data?.sync || null);
    } catch (fetchError) {
      if (handleUnauthorized(fetchError)) {
        return;
      }

      if (!isMountedRef.current || requestId !== latestRequestIdRef.current) return;

      setError(getApiErrorMessage(fetchError, "Unable to load employee productivity metrics."));
    } finally {
      if (activeFetchKeyRef.current === requestKey) {
        activeFetchKeyRef.current = "";
      }

      if (!isMountedRef.current || requestId !== latestRequestIdRef.current) return;

      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [selectedMonth, selectedYear]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchMetrics();

    const intervalId = setInterval(() => {
      fetchMetrics({ background: true });
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
      fetchMetrics({ background: true });
    }, 5000);

    return () => {
      window.clearTimeout(pollTimer);
    };
  }, [fetchMetrics, syncStatus?.last_completed_at, syncStatus?.last_error, syncStatus?.last_started_at, syncStatus?.status]);

  const updatedLabel = metrics.updated_at
    ? `Updated ${new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(metrics.updated_at))}`
    : "";
  const statusLabel =
    syncStatus?.status === "syncing"
      ? "Syncing Harvest data..."
      : updatedLabel || "Employee productivity metrics";
  const dateRangeLabel =
    metrics.from && metrics.to
      ? `${formatShortDate(metrics.from)} - ${formatShortDate(metrics.to)}`
      : `Last ${metrics.weeks} weeks`;
  const employeeOptions = useMemo(
    () =>
      metrics.employees
        .map((employee) => employee.employee)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b)),
    [metrics.employees]
  );
  useEffect(() => {
    if (selectedEmployee !== ALL_EMPLOYEES_VALUE && !employeeOptions.includes(selectedEmployee)) {
      setSelectedEmployee(ALL_EMPLOYEES_VALUE);
    }
  }, [employeeOptions, selectedEmployee]);
  const filteredEmployees = useMemo(
    () =>
      metrics.employees.filter((employee) => {
        const matchesEmployee =
          selectedEmployee === ALL_EMPLOYEES_VALUE || employee.employee === selectedEmployee;
        const matchesBilling =
          selectedBilling === "all" ||
          (selectedBilling === "billable" && Number(employee.average_weekly_billable_hours || 0) > 0) ||
          (selectedBilling === "non_billable" && Number(employee.average_weekly_non_billable_hours || 0) > 0);

        return matchesEmployee && matchesBilling;
      }),
    [metrics.employees, selectedBilling, selectedEmployee]
  );
  const utilizationRows = useMemo(
    () =>
      [...metrics.utilization_employees]
        .map((employee) => ({
          ...employee,
          utilization_rate: getUtilizationRate(employee),
        }))
        .sort((a, b) => b.utilization_rate - a.utilization_rate),
    [metrics.utilization_employees]
  );
  const utilizationSummary = useMemo(() => {
    const totals = metrics.utilization_employees.reduce(
      (summary, employee) => {
        summary.billableHours += Number(employee.billable_hours || 0);
        summary.nonBillableHours += Number(employee.non_billable_hours || 0);
        summary.totalHours += Number(employee.total_hours || 0);
        return summary;
      },
      { billableHours: 0, nonBillableHours: 0, totalHours: 0 }
    );

    return {
      ...totals,
      utilizationRate: totals.totalHours ? (totals.billableHours / totals.totalHours) * 100 : 0,
    };
  }, [metrics.utilization_employees]);
  const chartHeight = filteredEmployees.length > 18 ? 380 : 420;
  const utilizationChartHeight = utilizationRows.length > 18 ? 380 : 420;

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
          {statusLabel}
        </Typography>
        <Button
          disabled={isRefreshing || syncStatus?.status === "syncing"}
          onClick={() => fetchMetrics({ refresh: true })}
          size="small"
          variant="outlined"
          sx={{ alignSelf: { xs: "flex-start", sm: "auto" }, borderRadius: 1, fontSize: "0.75rem", fontWeight: 700 }}
        >
          {isRefreshing || syncStatus?.status === "syncing" ? "Refreshing" : "Refresh"}
        </Button>
      </Stack>

      <Paper
        elevation={0}
        sx={{
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 2,
          p: 2,
          backgroundColor: "common.white",
        }}
      >
        <Stack direction={{ xs: "column", md: "row" }} spacing={1.25} flexWrap="wrap" useFlexGap>
          <FormControl size="small" sx={{ minWidth: 196 }}>
            <InputLabel id="weekly-hours-employee-label">Employee</InputLabel>
            <Select
              label="Employee"
              labelId="weekly-hours-employee-label"
              onChange={(event) => setSelectedEmployee(event.target.value)}
              value={selectedEmployee}
            >
              <MenuItem value={ALL_EMPLOYEES_VALUE}>All Employees</MenuItem>
              {employeeOptions.map((employee) => (
                <MenuItem key={employee} value={employee}>
                  {employee}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 148 }}>
            <InputLabel id="weekly-hours-billing-label">Billed</InputLabel>
            <Select
              label="Billed"
              labelId="weekly-hours-billing-label"
              onChange={(event) => setSelectedBilling(event.target.value)}
              value={selectedBilling}
            >
              {BILLING_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>
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
        </Stack>

        {filteredEmployees.length ? (
          <Box sx={{ pb: 1 }}>
            <Box sx={{ height: chartHeight, minWidth: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  barCategoryGap="8%"
                  barGap={0}
                  data={filteredEmployees}
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
                      const employee = filteredEmployees.find((row) => row.employee === label);
                      return employee
                        ? `${label} - ${employee.total_hours.toLocaleString(undefined, {
                            maximumFractionDigits: 2,
                          })} total hours`
                        : label;
                    }}
                  />
                  <Legend />
                  {selectedBilling !== "billable" && (
                    <Bar
                      dataKey="average_weekly_non_billable_hours"
                      fill={CHART_COLORS.nonBillable}
                      fillOpacity={0.86}
                      maxBarSize={34}
                      name="Non-Billed Hours"
                      radius={[0, 0, 3, 3]}
                      stackId="hours"
                    />
                  )}
                  {selectedBilling !== "non_billable" && (
                    <Bar
                      dataKey="average_weekly_billable_hours"
                      fill={CHART_COLORS.billable}
                      fillOpacity={0.86}
                      maxBarSize={34}
                      name="Billable Hours"
                      radius={[3, 3, 0, 0]}
                      stackId="hours"
                    />
                  )}
                </BarChart>
              </ResponsiveContainer>
            </Box>
          </Box>
        ) : (
          <Typography color="text.secondary" variant="body2">
            No Harvest time entries match these filters.
          </Typography>
        )}
      </Paper>

      <Box
        sx={{
          display: "grid",
          gap: 1.5,
          gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", lg: "repeat(4, minmax(0, 1fr))" },
        }}
      >
        {[
          ["Total Hours", `${formatHours(utilizationSummary.totalHours)}h`],
          ["Billable Hours", `${formatHours(utilizationSummary.billableHours)}h`],
          ["Non-Billed Hours", `${formatHours(utilizationSummary.nonBillableHours)}h`],
          ["Utilization Rate", formatPercent(utilizationSummary.utilizationRate)],
        ].map(([label, value]) => (
          <Box
            key={label}
            sx={{
              border: "1px solid",
              borderColor: "divider",
              borderRadius: 2,
              p: 1.5,
              backgroundColor: "#f8fafc",
            }}
          >
            <Typography color="text.secondary" variant="overline">
              {label}
            </Typography>
            <Typography color="text.primary" sx={{ fontSize: "1.45rem", fontWeight: 800, lineHeight: 1.2 }}>
              {value}
            </Typography>
          </Box>
        ))}
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
        <Stack spacing={0.5} sx={{ mb: 2 }}>
          <Typography fontWeight={800} color="text.primary">
            Utilization Rate by Employee
          </Typography>
          <Typography color="text.secondary" variant="body2">
            Consulting billable hours divided by consulting logged Harvest hours for {dateRangeLabel}.
          </Typography>
        </Stack>

        {utilizationRows.length ? (
          <Box sx={{ height: utilizationChartHeight, minWidth: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={utilizationRows} margin={{ top: 12, right: 16, bottom: 62, left: 0 }}>
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
                  domain={[0, 100]}
                  tick={{ fontSize: 10 }}
                  tickFormatter={(value) => `${value}%`}
                  type="number"
                />
                <Tooltip
                  {...tooltipStyle}
                  formatter={(value) => [formatPercent(value), "Utilization"]}
                  labelFormatter={(label) => {
                    const employee = utilizationRows.find((row) => row.employee === label);
                    return employee
                      ? `${label} - ${employee.billable_hours.toLocaleString(undefined, {
                          maximumFractionDigits: 2,
                        })} billable of ${employee.total_hours.toLocaleString(undefined, {
                          maximumFractionDigits: 2,
                        })} total hours`
                      : label;
                  }}
                />
                <Bar
                  dataKey="utilization_rate"
                  fill={CHART_COLORS.billable}
                  fillOpacity={0.86}
                  maxBarSize={42}
                  name="Utilization"
                  radius={[3, 3, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </Box>
        ) : (
          <Typography color="text.secondary" variant="body2">
            No Harvest time entries match these filters.
          </Typography>
        )}
      </Paper>
    </Stack>
  );
}
