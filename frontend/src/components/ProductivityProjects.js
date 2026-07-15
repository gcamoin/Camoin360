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
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
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
import AiChatBox from "./AiChatBox";

const API_URL = `${API_BASE_URL}/productivity/projects`;
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const ALL_FILTER_VALUE = "all";
const QUARTER_OPTIONS = [
  { label: "Q1", value: "1" },
  { label: "Q2", value: "2" },
  { label: "Q3", value: "3" },
  { label: "Q4", value: "4" },
];

const tooltipStyle = {
  contentStyle: {
    borderRadius: 8,
    border: "1px solid #e2e8f0",
    fontSize: 12,
    boxShadow: "0 4px 6px -1px rgba(0,0,0,0.08)",
  },
};

function formatCurrency(value, formattedValue) {
  if (formattedValue) {
    return formattedValue;
  }

  const numericValue = Number(value || 0);
  if (!numericValue) {
    return "$0";
  }

  return new Intl.NumberFormat(undefined, {
    currency: "USD",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(numericValue);
}

function buildMonthlyFeeData(months, rows) {
  const rowsByMonth = Object.fromEntries(
    months.map((month) => [
      month.month_key,
      {
        fee: 0,
        month: month.month,
        month_key: month.month_key,
        records: 0,
      },
    ])
  );

  for (const row of rows) {
    if (!row.date) {
      continue;
    }

    const date = new Date(row.date);
    if (Number.isNaN(date.getTime())) {
      continue;
    }

    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    if (!rowsByMonth[monthKey]) {
      continue;
    }

    rowsByMonth[monthKey].fee += Number(row.fee_for_camoin || 0);
    rowsByMonth[monthKey].records += 1;
  }

  return Object.values(rowsByMonth);
}

function getMonthParts(monthKey) {
  const [year, month] = String(monthKey || "").split("-");
  const monthNumber = Number(month);
  return {
    month: String(monthNumber),
    quarter: String(Math.ceil(monthNumber / 3)),
    year,
  };
}

function filterMonths(months, filters) {
  return months.filter((month) => {
    const parts = getMonthParts(month.month_key);
    return (
      (filters.year === ALL_FILTER_VALUE || parts.year === filters.year) &&
      (filters.quarter === ALL_FILTER_VALUE || parts.quarter === filters.quarter) &&
      (filters.month === ALL_FILTER_VALUE || parts.month === filters.month)
    );
  });
}

function FinancialFeeChart({ barColor, data, dateDescription, title }) {
  const totalFee = data.reduce((sum, row) => sum + row.fee, 0);
  const totalRecords = data.reduce((sum, row) => sum + row.records, 0);

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
          {dateDescription}. Total {formatCurrency(totalFee)} across {totalRecords.toLocaleString()} records.
        </Typography>
      </Stack>
      <Box sx={{ height: 300, minWidth: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 18, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(value) => `$${Math.round(value / 1000)}k`} />
            <Tooltip
              {...tooltipStyle}
              formatter={(value, name) => [
                name === "fee" ? formatCurrency(value) : value.toLocaleString(),
                name === "fee" ? "Fee for Camoin" : "Records",
              ]}
            />
            <Bar dataKey="fee" fill={barColor} fillOpacity={0.86} radius={[3, 3, 0, 0]} maxBarSize={42} />
          </BarChart>
        </ResponsiveContainer>
      </Box>
    </Paper>
  );
}

export default function ProductivityProjects() {
  const isMountedRef = useRef(true);
  const [metrics, setMetrics] = useState({
    contracted_projects: [],
    financial_rows_errors: [],
    months: [],
    proposed_opportunities: [],
    service_lines: [],
    total_projects: 0,
    updated_at: "",
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [timeFilters, setTimeFilters] = useState({
    month: ALL_FILTER_VALUE,
    quarter: ALL_FILTER_VALUE,
    year: ALL_FILTER_VALUE,
  });

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
        contracted_projects: response.data?.contracted_projects || [],
        financial_rows_errors: response.data?.financial_rows_errors || [],
        months: response.data?.months || [],
        proposed_opportunities: response.data?.proposed_opportunities || [],
        service_lines: response.data?.service_lines || [],
        total_projects: response.data?.total_projects || 0,
        updated_at: response.data?.updated_at || "",
      });
    } catch (fetchError) {
      if (handleUnauthorized(fetchError)) {
        return;
      }

      if (!isMountedRef.current) return;

      setError(getApiErrorMessage(fetchError, "Unable to load project metrics."));
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

  const yearOptions = useMemo(
    () => Array.from(new Set(metrics.months.map((month) => getMonthParts(month.month_key).year))).filter(Boolean),
    [metrics.months]
  );
  const monthOptions = useMemo(
    () =>
      metrics.months.map((month) => ({
        label: month.month,
        value: getMonthParts(month.month_key).month,
      })),
    [metrics.months]
  );
  const filteredMonths = useMemo(
    () => filterMonths(metrics.months, timeFilters),
    [metrics.months, timeFilters]
  );
  const filteredTotalProjects = useMemo(
    () => filteredMonths.reduce((sum, month) => sum + month.projects, 0),
    [filteredMonths]
  );
  const peakProjectMonth = useMemo(
    () =>
      filteredMonths.reduce(
        (peak, month) => (month.projects > peak.projects ? month : peak),
        { month: "None", projects: 0 }
      ),
    [filteredMonths]
  );
  const topServiceLine = metrics.service_lines[0] || { service_line: "None", projects: 0 };
  const lowestServiceLine = metrics.service_lines[metrics.service_lines.length - 1] || {
    service_line: "None",
    projects: 0,
  };
  const maxServiceLineProjects = Math.max(...metrics.service_lines.map((serviceLine) => serviceLine.projects), 1);
  const contractedProjectFeeData = useMemo(
    () => buildMonthlyFeeData(filteredMonths, metrics.contracted_projects),
    [filteredMonths, metrics.contracted_projects]
  );
  const proposedOpportunityFeeData = useMemo(
    () => buildMonthlyFeeData(filteredMonths, metrics.proposed_opportunities),
    [filteredMonths, metrics.proposed_opportunities]
  );
  const aiContext = useMemo(
    () => ({
      contracted_project_fee_by_month: contractedProjectFeeData,
      filters: timeFilters,
      months: filteredMonths,
      proposed_opportunity_fee_by_month: proposedOpportunityFeeData,
      service_lines: metrics.service_lines,
      summary: {
        peak_project_month: peakProjectMonth,
        total_projects: filteredTotalProjects,
        top_service_line: topServiceLine,
        lowest_service_line: lowestServiceLine,
      },
      updated_at: metrics.updated_at,
    }),
    [
      contractedProjectFeeData,
      filteredMonths,
      filteredTotalProjects,
      lowestServiceLine,
      metrics.service_lines,
      metrics.updated_at,
      peakProjectMonth,
      proposedOpportunityFeeData,
      timeFilters,
      topServiceLine,
    ]
  );

  function updateTimeFilter(key, value) {
    setTimeFilters((currentFilters) => ({
      ...currentFilters,
      [key]: value,
    }));
  }

  const updatedLabel = metrics.updated_at
    ? `Updated ${new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(metrics.updated_at))}`
    : "";

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
      {metrics.financial_rows_errors.length ? (
        <Alert severity="warning">
          {metrics.financial_rows_errors.join(" ")}
        </Alert>
      ) : null}

      <Stack
        direction={{ xs: "column", sm: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "stretch", sm: "center" }}
        spacing={1.5}
      >
        <Typography color="text.secondary" fontSize="0.75rem">
          {updatedLabel || "Project metrics"}
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

      <AiChatBox
        context={aiContext}
        placeholder="Ask about service lines, project volume, contracts, or proposals..."
        section="Service Lines and Projects"
      />

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
            New Projects
          </Typography>
          <Typography color="primary.main" sx={{ fontSize: "2.35rem", fontWeight: 800, lineHeight: 1.1, mt: 0.75 }}>
            {filteredTotalProjects.toLocaleString()}
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 0.75 }} variant="body2">
            Created in the selected period
          </Typography>
        </Paper>
        <Paper
          elevation={0}
          sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: 2.5 }}
        >
          <Typography color="text.secondary" variant="overline">
            Peak Project Month
          </Typography>
          <Typography color="primary.main" sx={{ fontSize: "2.35rem", fontWeight: 800, lineHeight: 1.1, mt: 0.75 }}>
            {peakProjectMonth.month}
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 0.75 }} variant="body2">
            {peakProjectMonth.projects.toLocaleString()} new projects
          </Typography>
        </Paper>
      </Box>

      <Paper elevation={0} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: 2 }}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
          <FormControl fullWidth size="small">
            <InputLabel id="project-year-filter-label">Year</InputLabel>
            <Select
              label="Year"
              labelId="project-year-filter-label"
              onChange={(event) => updateTimeFilter("year", event.target.value)}
              value={timeFilters.year}
            >
              <MenuItem value={ALL_FILTER_VALUE}>All years</MenuItem>
              {yearOptions.map((year) => (
                <MenuItem key={year} value={year}>{year}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl fullWidth size="small">
            <InputLabel id="project-quarter-filter-label">Quarter</InputLabel>
            <Select
              label="Quarter"
              labelId="project-quarter-filter-label"
              onChange={(event) => updateTimeFilter("quarter", event.target.value)}
              value={timeFilters.quarter}
            >
              <MenuItem value={ALL_FILTER_VALUE}>All quarters</MenuItem>
              {QUARTER_OPTIONS.map((quarter) => (
                <MenuItem key={quarter.value} value={quarter.value}>{quarter.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl fullWidth size="small">
            <InputLabel id="project-month-filter-label">Month</InputLabel>
            <Select
              label="Month"
              labelId="project-month-filter-label"
              onChange={(event) => updateTimeFilter("month", event.target.value)}
              value={timeFilters.month}
            >
              <MenuItem value={ALL_FILTER_VALUE}>All months</MenuItem>
              {monthOptions.map((month) => (
                <MenuItem key={`${month.value}-${month.label}`} value={month.value}>{month.label}</MenuItem>
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
        <Stack spacing={0.5} sx={{ mb: 2 }}>
          <Typography fontWeight={800} color="text.primary">
            New Projects by Month
          </Typography>
          <Typography color="text.secondary" variant="body2">
            Projects grouped by Dynamics created date. Select a bar for service line detail.
          </Typography>
        </Stack>
        <Box sx={{ height: 320, minWidth: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={filteredMonths} margin={{ top: 8, right: 18, bottom: 0, left: -12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip {...tooltipStyle} formatter={(value) => [value.toLocaleString(), "Projects"]} />
              <Bar
                dataKey="projects"
                fill="#2563eb"
                fillOpacity={0.84}
                radius={[3, 3, 0, 0]}
                maxBarSize={42}
                onClick={(month) => setSelectedMonth(month)}
                cursor="pointer"
              />
            </BarChart>
          </ResponsiveContainer>
        </Box>
      </Paper>

      <Box
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: { xs: "1fr", lg: "repeat(2, minmax(0, 1fr))" },
        }}
      >
        <FinancialFeeChart
          barColor="#0f766e"
          data={contractedProjectFeeData}
          dateDescription="Contracted project fees grouped by Contract Date"
          title="$ of all new contracts signed"
        />
        <FinancialFeeChart
          barColor="#7c3aed"
          data={proposedOpportunityFeeData}
          dateDescription="Proposed opportunity fees grouped by Date Proposed"
          title="$ Amount of proposals submitted"
        />
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
            Service Line Popularity
          </Typography>
          <Typography color="text.secondary" variant="body2">
            Ranked by projects created over the last 12 months.
          </Typography>
        </Stack>

        <Box
          sx={{
            display: "grid",
            gap: 2,
            gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" },
            mb: 2.5,
          }}
        >
          <Box
            sx={{
              border: "1px solid",
              borderColor: "divider",
              borderRadius: 2,
              p: 2,
              backgroundColor: "#f0fdfa",
            }}
          >
            <Typography color="text.secondary" variant="overline">
              Most Popular
            </Typography>
            <Typography color="text.primary" sx={{ fontSize: "1.2rem", fontWeight: 800, mt: 0.5 }}>
              {topServiceLine.service_line}
            </Typography>
            <Typography color="text.secondary" variant="body2">
              {topServiceLine.projects.toLocaleString()} project mentions
            </Typography>
          </Box>
          <Box
            sx={{
              border: "1px solid",
              borderColor: "divider",
              borderRadius: 2,
              p: 2,
              backgroundColor: "#f8fafc",
            }}
          >
            <Typography color="text.secondary" variant="overline">
              Least Popular
            </Typography>
            <Typography color="text.primary" sx={{ fontSize: "1.2rem", fontWeight: 800, mt: 0.5 }}>
              {lowestServiceLine.service_line}
            </Typography>
            <Typography color="text.secondary" variant="body2">
              {lowestServiceLine.projects.toLocaleString()} project mentions
            </Typography>
          </Box>
        </Box>

        <Stack spacing={1.25}>
          {metrics.service_lines.map((serviceLine, index) => {
            const width = `${Math.max((serviceLine.projects / maxServiceLineProjects) * 100, 4)}%`;
            return (
              <Box key={serviceLine.service_line}>
                <Stack direction="row" justifyContent="space-between" spacing={2} sx={{ mb: 0.5 }}>
                  <Typography color="text.primary" fontSize="0.85rem" fontWeight={700}>
                    {index + 1}. {serviceLine.service_line}
                  </Typography>
                  <Typography color="text.secondary" fontSize="0.85rem" fontWeight={700}>
                    {serviceLine.projects.toLocaleString()}
                  </Typography>
                </Stack>
                <Box
                  sx={{
                    backgroundColor: "#e2e8f0",
                    borderRadius: 999,
                    height: 10,
                    overflow: "hidden",
                  }}
                >
                  <Box
                    sx={{
                      backgroundColor: index < 3 ? "#0d9488" : "#64748b",
                      borderRadius: 999,
                      height: "100%",
                      width,
                    }}
                  />
                </Box>
              </Box>
            );
          })}
        </Stack>
      </Paper>

      <Dialog
        fullWidth
        maxWidth="sm"
        onClose={() => setSelectedMonth(null)}
        open={Boolean(selectedMonth)}
      >
        <DialogTitle sx={{ pb: 1 }}>
          <Typography component="span" fontWeight={800}>
            {selectedMonth?.month || "Month"} Service Lines
          </Typography>
          <Typography color="text.secondary" display="block" variant="body2">
            {(selectedMonth?.projects || 0).toLocaleString()} projects created
          </Typography>
        </DialogTitle>
        <DialogContent>
          <TableContainer component={Paper} elevation={0} sx={{ border: "1px solid", borderColor: "divider" }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 800 }}>Service Line</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 800 }}>Projects</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(selectedMonth?.service_lines || []).length ? (
                  selectedMonth.service_lines.map((serviceLine) => (
                    <TableRow key={serviceLine.service_line}>
                      <TableCell>{serviceLine.service_line}</TableCell>
                      <TableCell align="right">{serviceLine.projects.toLocaleString()}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={2}>
                      <Typography color="text.secondary" variant="body2">
                        No service line data for this month.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </DialogContent>
      </Dialog>
    </Stack>
  );
}
