import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import {
  Alert,
  Box,
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

const API_URL = `${API_BASE_URL}/employee-productivity/billable-breakdown`;
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
const CHART_COLORS = {
  billable: "#0d9488",
  nonBillable: "#2563eb",
};

/**
 * @typedef {Object} BillableBreakdownResponse
 * @property {number} billable_hours
 * @property {number} non_billable_hours
 * @property {number} total_hours
 */

const formatHours = (value) =>
  Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  });

const formatPercent = (value) =>
  `${Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  })}%`;

function ChartTooltip({ active, payload, totalHours }) {
  if (!active || !payload?.length) {
    return null;
  }

  const item = payload.find((entry) => Number(entry.value || 0) > 0) || payload[0];
  const hours = Number(item.value || 0);
  const percentage = totalHours ? (hours / totalHours) * 100 : 0;

  return (
    <Paper elevation={3} sx={{ borderRadius: 1, p: 1.25 }}>
      <Typography color="text.primary" fontSize="0.8rem" fontWeight={800}>
        {item.name}
      </Typography>
      <Typography color="text.secondary" fontSize="0.75rem">
        {formatHours(hours)} hours ({formatPercent(percentage)})
      </Typography>
      <Typography color="text.secondary" fontSize="0.75rem">
        Total: {formatHours(totalHours)} hours
      </Typography>
    </Paper>
  );
}

export default function BillableBreakdownCard() {
  const isMountedRef = useRef(true);
  const [selectedYear, setSelectedYear] = useState(CURRENT_YEAR);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [metrics, setMetrics] = useState({
    billable_hours: 0,
    non_billable_hours: 0,
    total_hours: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchMetrics = useCallback(async () => {
    if (!isMountedRef.current) return;

    setIsLoading(true);
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

      /** @type {BillableBreakdownResponse} */
      const data = response.data || {};
      setMetrics({
        billable_hours: data.billable_hours || 0,
        non_billable_hours: data.non_billable_hours || 0,
        total_hours: data.total_hours || 0,
      });
    } catch (fetchError) {
      if (handleUnauthorized(fetchError)) {
        return;
      }

      if (!isMountedRef.current) return;

      setError(getApiErrorMessage(fetchError, "Unable to load billable breakdown."));
      setMetrics({
        billable_hours: 0,
        non_billable_hours: 0,
        total_hours: 0,
      });
    } finally {
      if (!isMountedRef.current) return;

      setIsLoading(false);
    }
  }, [selectedMonth, selectedYear]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchMetrics();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchMetrics]);

  const billablePercentage = metrics.total_hours
    ? (metrics.billable_hours / metrics.total_hours) * 100
    : 0;
  const chartData = useMemo(
    () => [
      {
        billableHours: metrics.billable_hours,
        name: "Hours",
        nonBillableHours: metrics.non_billable_hours,
      },
    ],
    [metrics.billable_hours, metrics.non_billable_hours]
  );
  const hasData = metrics.total_hours > 0;

  return (
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
        sx={{ mb: 2.5 }}
      >
        <Stack spacing={0.5}>
          <Typography fontWeight={800} color="text.primary">
            Billable vs Non-Billable Hours
          </Typography>
          <Typography color="text.secondary" variant="body2">
            Harvest hours grouped by project task assignment billable status.
          </Typography>
        </Stack>

        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25}>
          <FormControl size="small" sx={{ minWidth: 132 }}>
            <InputLabel id="billable-year-label">Year</InputLabel>
            <Select
              label="Year"
              labelId="billable-year-label"
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
            <InputLabel id="billable-month-label">Month</InputLabel>
            <Select
              label="Month"
              labelId="billable-month-label"
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

      {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}

      <Box
        sx={{
          display: "grid",
          gap: 1.5,
          gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", lg: "repeat(4, minmax(0, 1fr))" },
          mb: 2.5,
        }}
      >
        {[
          ["Total Hours", `${formatHours(metrics.total_hours)}h`],
          ["Billable Hours", `${formatHours(metrics.billable_hours)}h`],
          ["Non-Billable Hours", `${formatHours(metrics.non_billable_hours)}h`],
          ["Billable Percentage", formatPercent(billablePercentage)],
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

      {isLoading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress />
        </Box>
      ) : hasData ? (
        <Box sx={{ height: 340, minWidth: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 20, right: 24, bottom: 8, left: 8 }}>
              <CartesianGrid vertical={false} stroke="#f1f5f9" strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals tick={{ fontSize: 11 }} unit="h" />
              <Tooltip content={<ChartTooltip totalHours={metrics.total_hours} />} />
              <Legend />
              <Bar
                dataKey="nonBillableHours"
                fill={CHART_COLORS.nonBillable}
                fillOpacity={0.88}
                maxBarSize={72}
                name="Non-Billed Hours"
                radius={[3, 3, 0, 0]}
              />
              <Bar
                dataKey="billableHours"
                fill={CHART_COLORS.billable}
                fillOpacity={0.88}
                maxBarSize={72}
                name="Billable Hours"
                radius={[3, 3, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </Box>
      ) : (
        <Typography color="text.secondary" sx={{ py: 3 }} textAlign="center" variant="body2">
          No Harvest time entries found for this period.
        </Typography>
      )}
    </Paper>
  );
}
