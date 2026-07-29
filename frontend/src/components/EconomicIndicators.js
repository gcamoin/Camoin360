import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Alert, Box, Button, CircularProgress, Paper, Stack, Typography } from "@mui/material";
import { API_BASE_URL, getApiErrorMessage, getAuthHeaders, handleUnauthorized } from "../auth";

const API_URL = `${API_BASE_URL}/economic-indicators`;
const REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const EMPTY_SERIES = {
  sentiment: [],
  gdp: [],
  treasury: [],
  housing: [],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const RANGES = [
  { label: "1Y", years: 1 },
  { label: "3Y", years: 3 },
  { label: "5Y", years: 5 },
  { label: "All Years", years: null },
];

function filterByRange(data, years) {
  if (!years) return data;
  const cutoff = new Date().getFullYear() - years;
  return data.filter((d) => d.year >= cutoff);
}

const tooltipStyle = {
  contentStyle: {
    borderRadius: 8,
    border: "1px solid #e2e8f0",
    fontSize: 12,
    boxShadow: "0 4px 6px -1px rgba(0,0,0,0.08)",
  },
};

// ── Chart card ────────────────────────────────────────────────────────────────

function ChartCard({ title, source, children }) {
  return (
    <Paper
      elevation={0}
      sx={{
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 2,
        p: 2.5,
        display: "flex",
        flexDirection: "column",
        gap: 1.5,
        backgroundColor: "common.white",
      }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
        <Typography fontWeight={700} fontSize="0.88rem" color="text.primary">
          {title}
        </Typography>
        <Typography
          fontSize="0.72rem"
          color="text.secondary"
          sx={{ textAlign: "right", maxWidth: 180, lineHeight: 1.3 }}
        >
          {source}
        </Typography>
      </Stack>
      {children}
    </Paper>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

const TREND_STYLES = {
  RISING: { label: "RISING", bg: "#fff7ed", color: "#ea580c" },
  MODERATE: { label: "MODERATE", bg: "#f0fdf4", color: "#16a34a" },
  STABLE: { label: "STABLE", bg: "#eff6ff", color: "#2563eb" },
  DECLINING: { label: "DECLINING", bg: "#fef2f2", color: "#dc2626" },
  UNKNOWN: { label: "—", bg: "#f8fafc", color: "#64748b" },
};

function TrendBadge({ trend }) {
  const style = TREND_STYLES[trend] || TREND_STYLES.UNKNOWN;
  return (
    <Box
      component="span"
      sx={{
        display: "inline-block",
        px: 1,
        py: 0.25,
        borderRadius: 0.75,
        fontSize: "0.7rem",
        fontWeight: 700,
        letterSpacing: "0.04em",
        backgroundColor: style.bg,
        color: style.color,
      }}
    >
      {style.label}
    </Box>
  );
}

function InflationTable({ rows }) {
  if (!rows || rows.length === 0) return null;
  return (
    <Paper
      elevation={0}
      sx={{
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 2,
        p: 2.5,
        backgroundColor: "common.white",
      }}
    >
      <Typography fontWeight={700} fontSize="0.88rem" color="text.primary" mb={1.5}>
        Inflation Index – Consumer Price Index
      </Typography>
      <Box
        component="table"
        sx={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}
      >
        <Box component="thead">
          <Box component="tr">
            {["INDEX", "MONTH", "CHANGE", "TREND"].map((col) => (
              <Box
                key={col}
                component="th"
                sx={{
                  textAlign: "left",
                  pb: 1,
                  pt: 0,
                  pr: 2,
                  color: "text.disabled",
                  fontWeight: 600,
                  fontSize: "0.72rem",
                  letterSpacing: "0.06em",
                  borderBottom: "1px solid",
                  borderColor: "divider",
                }}
              >
                {col}
              </Box>
            ))}
          </Box>
        </Box>
        <Box component="tbody">
          {rows.map((row, i) => (
            <Box component="tr" key={i}>
              <Box component="td" sx={{ py: 1.25, pr: 2, color: "text.primary", fontWeight: 500 }}>
                {row.index}
              </Box>
              <Box component="td" sx={{ py: 1.25, pr: 2, color: "text.secondary" }}>
                {row.month}
              </Box>
              <Box component="td" sx={{ py: 1.25, pr: 2, color: "text.primary", fontWeight: 600 }}>
                {row.change}
              </Box>
              <Box component="td" sx={{ py: 1.25 }}>
                <TrendBadge trend={row.trend} />
              </Box>
            </Box>
          ))}
        </Box>
      </Box>
    </Paper>
  );
}

export default function EconomicIndicators() {
  const isMountedRef = useRef(true);
  const [range, setRange] = useState("All Years");
  const [series, setSeries] = useState(EMPTY_SERIES);
  const [cpiTable, setCpiTable] = useState([]);
  const [sources, setSources] = useState({});
  const [updatedAt, setUpdatedAt] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState("");
  const years = RANGES.find((r) => r.label === range)?.years ?? null;

  const fetchIndicators = useCallback(async ({ refresh = false, silent = false } = {}) => {
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
        params: refresh ? { refresh: true } : undefined,
      });

      if (!isMountedRef.current) return;

      setSeries({
        sentiment: response.data?.series?.sentiment || [],
        gdp: response.data?.series?.gdp || [],
        treasury: response.data?.series?.treasury || [],
        housing: response.data?.series?.housing || [],
      });
      setCpiTable(response.data?.cpi_table || []);
      setSources(response.data?.sources || {});
      setUpdatedAt(response.data?.updated_at || "");
    } catch (fetchError) {
      if (handleUnauthorized(fetchError)) {
        return;
      }

      if (!isMountedRef.current) return;

      setError(getApiErrorMessage(fetchError, "Unable to load live economic indicators."));
    } finally {
      if (!isMountedRef.current) return;

      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    fetchIndicators();
    const intervalId = setInterval(() => {
      fetchIndicators({ silent: true });
    }, REFRESH_INTERVAL_MS);

    return () => {
      isMountedRef.current = false;
      clearInterval(intervalId);
    };
  }, [fetchIndicators]);

  const sentiment = useMemo(() => filterByRange(series.sentiment, years), [series.sentiment, years]);
  const gdp = useMemo(() => filterByRange(series.gdp, years), [series.gdp, years]);
  const treasury = useMemo(() => filterByRange(series.treasury, years), [series.treasury, years]);
  const housing = useMemo(() => filterByRange(series.housing, years), [series.housing, years]);
  const xInterval = (len) => Math.max(0, Math.floor(len / 6) - 1);
  const updatedLabel = updatedAt
    ? `Updated ${new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(updatedAt))}`
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
      {/* Filter bar */}
      {error ? <Alert severity="error">{error}</Alert> : null}
      <Stack
        direction={{ xs: "column", sm: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "stretch", sm: "center" }}
        spacing={1.5}
      >
        <Typography color="text.secondary" fontSize="0.75rem">
          {updatedLabel || "Live economic data"}
        </Typography>
        <Stack direction="row" justifyContent="flex-end" alignItems="center" spacing={0.75} flexWrap="wrap">
          {RANGES.map(({ label }) => {
            const isActive = range === label;
            return (
              <Button
                key={label}
                size="small"
                onClick={() => setRange(label)}
                variant={isActive ? "contained" : "outlined"}
                disableElevation
                sx={{
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  px: 1.5,
                  py: 0.4,
                  minWidth: 0,
                  borderRadius: 1,
                  ...(!isActive && { borderColor: "divider", color: "text.secondary" }),
                }}
              >
                {label}
              </Button>
            );
          })}
          <Button
            size="small"
            onClick={() => setRange("All Years")}
            sx={{ fontSize: "0.75rem", color: "text.secondary", fontWeight: 600, minWidth: 0 }}
          >
            Reset
          </Button>
          <Button
            disabled={isRefreshing}
            onClick={() => fetchIndicators({ refresh: true, silent: true })}
            size="small"
            variant="outlined"
            sx={{ fontSize: "0.75rem", fontWeight: 700, minWidth: 0, borderRadius: 1 }}
          >
            {isRefreshing ? "Refreshing" : "Refresh"}
          </Button>
        </Stack>
      </Stack>

      {/* 2×2 chart grid */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
          gap: 2.5,
        }}
      >
        {/* Consumer Sentiment Index */}
        <ChartCard title="Consumer Sentiment Index" source={sources.sentiment || "University of Michigan via FRED"}>
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={sentiment} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="sentimentGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#2563eb" stopOpacity={0.18} />
                  <stop offset="95%" stopColor="#2563eb" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10 }}
                interval={xInterval(sentiment.length)}
              />
              <YAxis domain={[40, 110]} tick={{ fontSize: 10 }} />
              <Tooltip {...tooltipStyle} formatter={(v) => [v, "Index"]} />
              <Area
                type="monotone"
                dataKey="value"
                stroke="#2563eb"
                strokeWidth={2}
                fill="url(#sentimentGrad)"
                dot={false}
                activeDot={{ r: 4 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Quarterly GDP Growth */}
        <ChartCard title="Quarterly GDP Growth" source={sources.gdp || "U.S. Bureau of Economic Analysis via FRED"}>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={gdp} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10 }}
                interval={xInterval(gdp.length)}
              />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
              <Tooltip {...tooltipStyle} formatter={(v) => [`${v}%`, "GDP Growth"]} />
              <ReferenceLine y={0} stroke="#94a3b8" strokeWidth={1} />
              <Bar dataKey="value" radius={[2, 2, 0, 0]} maxBarSize={16}>
                {gdp.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={entry.value >= 0 ? "#0d9488" : "#ef4444"}
                    fillOpacity={0.85}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Treasury Yield Trends */}
        <ChartCard title="Treasury Yield Trends" source={sources.treasury || "2 Year vs 10 Year Yields"}>
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={treasury} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10 }}
                interval={xInterval(treasury.length)}
              />
              <YAxis
                domain={[0, 6]}
                tick={{ fontSize: 10 }}
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip
                {...tooltipStyle}
                formatter={(v, name) => [
                  `${v}%`,
                  name === "twoYear" ? "2-Year" : "10-Year",
                ]}
              />
              <Legend
                formatter={(v) => (v === "twoYear" ? "2-Year" : "10-Year")}
                wrapperStyle={{ fontSize: 11 }}
              />
              <Line
                type="monotone"
                dataKey="twoYear"
                stroke="#2563eb"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Line
                type="monotone"
                dataKey="tenYear"
                stroke="#16a34a"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* U.S. House Price Index */}
        <ChartCard title="U.S. House Price Index" source={sources.housing || "Federal Housing Finance Agency via FRED"}>
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={housing} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="sp500Grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#7c3aed" stopOpacity={0.18} />
                  <stop offset="95%" stopColor="#7c3aed" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10 }}
                interval={xInterval(housing.length)}
              />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip {...tooltipStyle} formatter={(v) => [v, "Index"]} />
              <Area
                type="monotone"
                dataKey="value"
                stroke="#7c3aed"
                strokeWidth={2}
                fill="url(#sp500Grad)"
                dot={false}
                activeDot={{ r: 4 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
      </Box>

      {/* Inflation Index Table */}
      <InflationTable rows={cpiTable} />
    </Stack>
  );
}
