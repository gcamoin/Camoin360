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
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { API_BASE_URL, getApiErrorMessage, getAuthHeaders, handleUnauthorized } from "../auth";

const API_URL = `${API_BASE_URL}/marketing/service-line-metrics`;
const SOURCE_COLORS = [
  "#0b3f78", "#6b8e3a", "#7c3aed", "#d97706", "#0891b2",
  "#be185d", "#4f46e5", "#059669", "#9333ea", "#64748b",
];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const tooltipStyle = {
  contentStyle: {
    borderRadius: 8,
    border: "1px solid #e2e8f0",
    fontSize: 12,
    boxShadow: "0 4px 6px -1px rgba(0,0,0,0.08)",
  },
};

export function buildMarketingSourceCharts(rows, filters = {}) {
  const filteredRows = rows.filter((row) => {
    if (filters.serviceLine && filters.serviceLine !== "all" && row.service_line_key !== filters.serviceLine) return false;
    if (filters.source && filters.source !== "all" && row.source !== filters.source) return false;
    if (filters.month && filters.month !== "all" && row.month !== Number(filters.month)) return false;
    return true;
  });

  const sourceTotals = new Map();
  filteredRows.forEach((row) => sourceTotals.set(row.source, (sourceTotals.get(row.source) || 0) + row.visits));
  const rankedSources = Array.from(sourceTotals.entries()).sort((a, b) => b[1] - a[1]);
  const chartSources = filters.source && filters.source !== "all"
    ? [filters.source]
    : rankedSources.slice(0, 10).map(([source]) => source);
  const visibleSourceSet = new Set(chartSources);
  const includesOther = filters.source === "all" && rankedSources.length > chartSources.length;

  const bucketMap = new Map();
  filteredRows.forEach((row) => {
    const key = `${row.service_line_key}:${row.month_key}`;
    if (!bucketMap.has(key)) {
      bucketMap.set(key, {
        key,
        month_key: row.month_key,
        period: row.period,
        service_line: row.service_line,
        axis_label: `${row.period} · ${row.service_line}`,
      });
    }
    const bucket = bucketMap.get(key);
    const sourceKey = visibleSourceSet.has(row.source) ? row.source : "Other";
    bucket[sourceKey] = (bucket[sourceKey] || 0) + row.visits;
  });

  const serviceOrder = new Map();
  rows.forEach((row) => {
    if (!serviceOrder.has(row.service_line_key)) serviceOrder.set(row.service_line_key, serviceOrder.size);
  });
  const monthly = Array.from(bucketMap.values()).sort((a, b) => {
    const aKey = a.key.split(":")[0];
    const bKey = b.key.split(":")[0];
    return (serviceOrder.get(aKey) - serviceOrder.get(bKey)) || a.month_key.localeCompare(b.month_key);
  });
  const monthlyByServiceLine = Array.from(
    monthly.reduce((groups, row) => {
      if (!groups.has(row.service_line)) groups.set(row.service_line, []);
      groups.get(row.service_line).push(row);
      return groups;
    }, new Map())
  ).map(([serviceLineName, data]) => ({ serviceLine: serviceLineName, data }));

  return {
    filteredRows,
    monthly,
    monthlyByServiceLine,
    chartSources: includesOther ? [...chartSources, "Other"] : chartSources,
    trafficBySource: rankedSources.map(([source, visits]) => ({ source, visits })),
  };
}

export default function MarketingSource() {
  const mountedRef = useRef(true);
  const [metrics, setMetrics] = useState({ source_months: [], updated_at: "" });
  const [sync, setSync] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [serviceLine, setServiceLine] = useState("all");
  const [source, setSource] = useState("all");
  const [month, setMonth] = useState("all");

  const fetchMetrics = useCallback(async ({ refresh = false, silent = false } = {}) => {
    if (!silent) setLoading(true);
    setRefreshing(refresh || silent);
    setError("");
    try {
      const response = await axios.get(API_URL, {
        headers: getAuthHeaders(),
        params: { refresh },
      });
      if (!mountedRef.current) return;
      setMetrics({
        source_months: (response.data?.source_months || []).filter((row) => row.year >= 2024),
        updated_at: response.data?.updated_at || "",
      });
      setSync(response.data?.sync || null);
    } catch (fetchError) {
      if (handleUnauthorized(fetchError) || !mountedRef.current) return;
      setError(getApiErrorMessage(fetchError, "Unable to load marketing source metrics."));
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchMetrics();
    return () => { mountedRef.current = false; };
  }, [fetchMetrics]);

  useEffect(() => {
    if (sync?.status !== "syncing") return undefined;
    const timer = window.setTimeout(() => fetchMetrics({ silent: true }), 5000);
    return () => window.clearTimeout(timer);
  }, [fetchMetrics, sync]);

  const serviceLines = useMemo(() => {
    const values = new Map();
    metrics.source_months.forEach((row) => values.set(row.service_line_key, row.service_line));
    return Array.from(values.entries());
  }, [metrics.source_months]);
  const sources = useMemo(
    () => Array.from(new Set(metrics.source_months.map((row) => row.source))).sort((a, b) => a.localeCompare(b)),
    [metrics.source_months]
  );
  const charts = useMemo(
    () => buildMarketingSourceCharts(metrics.source_months, { serviceLine, source, month }),
    [metrics.source_months, serviceLine, source, month]
  );
  const sourceColor = useMemo(
    () => Object.fromEntries(charts.chartSources.map((name, index) => [name, SOURCE_COLORS[index % SOURCE_COLORS.length]])),
    [charts.chartSources]
  );
  const updatedLabel = metrics.updated_at
    ? `Updated ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(metrics.updated_at))}`
    : "Marketing source metrics";

  if (loading) return <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}><CircularProgress /></Box>;

  return (
    <Stack spacing={2.5}>
      {error ? <Alert severity="error">{error}</Alert> : null}
      {sync?.status === "error" && sync.last_error ? <Alert severity="warning">{sync.last_error}</Alert> : null}

      <Paper elevation={0} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: 2 }}>
        <Stack direction={{ xs: "column", lg: "row" }} spacing={1.5} alignItems={{ lg: "center" }}>
          <FormControl size="small" sx={{ flex: 1, minWidth: 180 }}>
            <InputLabel>Service Line</InputLabel>
            <Select label="Service Line" value={serviceLine} onChange={(event) => setServiceLine(event.target.value)}>
              <MenuItem value="all">All service lines</MenuItem>
              {serviceLines.map(([key, label]) => <MenuItem key={key} value={key}>{label}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ flex: 1, minWidth: 180 }}>
            <InputLabel>Source</InputLabel>
            <Select label="Source" value={source} onChange={(event) => setSource(event.target.value)}>
              <MenuItem value="all">All sources</MenuItem>
              {sources.map((name) => <MenuItem key={name} value={name}>{name}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ flex: 1, minWidth: 180 }}>
            <InputLabel>Month</InputLabel>
            <Select label="Month" value={month} onChange={(event) => setMonth(event.target.value)}>
              <MenuItem value="all">All months</MenuItem>
              {MONTHS.map((name, index) => <MenuItem key={name} value={index + 1}>{name}</MenuItem>)}
            </Select>
          </FormControl>
          <Stack alignItems={{ xs: "flex-start", lg: "flex-end" }} sx={{ minWidth: 190 }}>
            <Typography color="text.secondary" fontSize="0.75rem">
              {sync?.status === "syncing" ? "Syncing GA4 source data..." : updatedLabel}
            </Typography>
            <Button disabled={refreshing || sync?.status === "syncing"} onClick={() => fetchMetrics({ refresh: true })} size="small">
              {refreshing || sync?.status === "syncing" ? "Refreshing" : "Refresh"}
            </Button>
          </Stack>
        </Stack>
      </Paper>

      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: "minmax(0, 1fr)" }}>
        <Paper elevation={0} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: 2.5, minWidth: 0, order: 2 }}>
          <Typography fontWeight={800}>Service Line Traffic by Source</Typography>
          <Typography color="text.secondary" variant="body2" sx={{ mb: 2 }}>Monthly GA4 sessions grouped by landing-page service line and acquisition source.</Typography>
          {charts.monthly.length ? (
            <Stack spacing={2}>
              <Stack direction="row" flexWrap="wrap" gap={1.5}>
                {charts.chartSources.map((name) => (
                  <Stack key={name} direction="row" spacing={0.6} alignItems="center">
                    <Box sx={{ backgroundColor: sourceColor[name], borderRadius: "50%", height: 10, width: 10 }} />
                    <Typography color="text.secondary" fontSize="0.72rem">{name}</Typography>
                  </Stack>
                ))}
              </Stack>
              <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", lg: "repeat(2, minmax(0, 1fr))" } }}>
                {charts.monthlyByServiceLine.map(({ serviceLine: serviceLineName, data }) => (
                  <Box
                    key={serviceLineName}
                    sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1.5, minWidth: 0, p: 1.5 }}
                  >
                    <Typography fontSize="0.9rem" fontWeight={800} sx={{ mb: 1 }}>{serviceLineName}</Typography>
                    <Box sx={{ height: 420, overflowX: "auto" }}>
                      <Box sx={{ height: "100%", minWidth: Math.max(460, data.length * 34) }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={data} margin={{ top: 8, right: 12, bottom: 62, left: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                            <XAxis
                              dataKey="period"
                              angle={-50}
                              textAnchor="end"
                              interval={0}
                              tick={{ fontSize: 10 }}
                              height={65}
                            />
                            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                            <Tooltip {...tooltipStyle} />
                            {charts.chartSources.map((name) => (
                              <Bar key={name} dataKey={name} stackId="traffic" fill={sourceColor[name]} maxBarSize={30} />
                            ))}
                          </BarChart>
                        </ResponsiveContainer>
                      </Box>
                    </Box>
                  </Box>
                ))}
              </Box>
            </Stack>
          ) : <Typography color="text.secondary" sx={{ py: 8, textAlign: "center" }}>No traffic matches these filters.</Typography>}
        </Paper>

        <Paper elevation={0} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: 2.5, minWidth: 0, order: 1 }}>
          <Typography fontWeight={800}>Traffic by Source</Typography>
          <Typography color="text.secondary" variant="body2" sx={{ mb: 2 }}>GA4 sessions for the selected service lines and months.</Typography>
          <Box sx={{ maxHeight: 300, overflowY: "auto" }}>
            <Box sx={{ height: Math.max(300, charts.trafficBySource.length * 30), minWidth: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.trafficBySource} layout="vertical" margin={{ top: 4, right: 20, bottom: 20, left: 18 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} />
                  <YAxis dataKey="source" type="category" width={105} tick={{ fontSize: 10 }} />
                  <Tooltip {...tooltipStyle} formatter={(value) => [value.toLocaleString(), "Visits"]} />
                  <Bar dataKey="visits" name="Visits" radius={[0, 3, 3, 0]}>
                    {charts.trafficBySource.map((row, index) => <Cell key={row.source} fill={SOURCE_COLORS[index % SOURCE_COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Box>
          </Box>
        </Paper>
      </Box>
    </Stack>
  );
}
