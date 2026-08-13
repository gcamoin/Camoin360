import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { Alert, Box, CircularProgress, Paper, Stack, Typography } from "@mui/material";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { API_BASE_URL, getApiErrorMessage, getAuthHeaders, handleUnauthorized } from "../auth";

const API_URL = `${API_BASE_URL}/management/sales-outlook`;
const MONTH_WIDTH = 48;

const tooltipStyle = {
  contentStyle: {
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    boxShadow: "0 4px 6px -1px rgba(0,0,0,0.08)",
    fontSize: 12,
  },
};

function formatCurrency(value) {
  return new Intl.NumberFormat(undefined, {
    currency: "USD",
    maximumFractionDigits: 0,
    notation: Number(value) >= 1000000 ? "compact" : "standard",
    style: "currency",
  }).format(Number(value || 0));
}

function MonthTick({ x, y, payload }) {
  const [year, monthValue] = String(payload?.value || "").split("-");
  const month = Number(monthValue);
  const label = month
    ? new Date(Number(year), month - 1, 1).toLocaleDateString(undefined, { month: "short" })
    : "";

  return (
    <g transform={`translate(${x},${y})`}>
      <text fill="#475569" fontSize="10" textAnchor="middle">
        <tspan x="0" dy="12">{label}</tspan>
        <tspan fontWeight="700" x="0" dy="15">{month === 7 ? year : ""}</tspan>
      </text>
    </g>
  );
}

function ChartCard({ children, description, title }) {
  return (
    <Paper elevation={0} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, minWidth: 0, p: { xs: 2, md: 2.5 } }}>
      <Stack spacing={0.5} sx={{ mb: 2 }}>
        <Typography color="text.primary" fontWeight={800}>{title}</Typography>
        <Typography color="text.secondary" variant="body2">{description}</Typography>
      </Stack>
      {children}
    </Paper>
  );
}

export default function SalesOutlook() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const scrollRef = useRef(null);

  useEffect(() => {
    let active = true;
    axios.get(API_URL, { headers: getAuthHeaders() })
      .then((response) => {
        if (active) setData(response.data);
      })
      .catch((fetchError) => {
        if (!active || handleUnauthorized(fetchError)) return;
        setError(getApiErrorMessage(fetchError, "Unable to load sales outlook."));
      });
    return () => { active = false; };
  }, []);

  const monthlyData = useMemo(() => data?.monthly_projects || [], [data]);

  if (error) return <Alert severity="error">{error}</Alert>;
  if (!data) return <Box sx={{ display: "grid", minHeight: 320, placeItems: "center" }}><CircularProgress /></Box>;

  return (
    <Stack spacing={3}>
      <ChartCard
        title="$ of all contracts signed"
        description="Annual Fee for Camoin totals by contract date, starting in 2020."
      >
        <Box sx={{ height: 340, minWidth: 0 }}>
          <ResponsiveContainer height="100%" width="100%">
            <LineChart data={data.annual_contracts} margin={{ top: 12, right: 24, bottom: 8, left: 14 }}>
              <CartesianGrid stroke="#eef2f7" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={formatCurrency} width={78} />
              <Tooltip {...tooltipStyle} formatter={(value) => [formatCurrency(value), "Fee for Camoin"]} />
              <Line activeDot={{ r: 6 }} dataKey="amount" dot={{ r: 4 }} name="Fee for Camoin" stroke="#0f766e" strokeWidth={3} type="monotone" />
            </LineChart>
          </ResponsiveContainer>
        </Box>
      </ChartCard>

      <ChartCard
        title="Projects Completed by Month"
        description="Monthly project volume from 2021 onward. Scroll horizontally to see later months."
      >
        <Box sx={{ display: "flex", height: 350, minWidth: 0, width: "100%" }}>
          <Box sx={{ flex: "0 0 52px", height: 330 }}>
            <ResponsiveContainer height="100%" width="100%">
              <BarChart data={monthlyData} margin={{ top: 8, right: 0, bottom: 62, left: 0 }}>
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={52} />
                <Bar dataKey="projects" fill="transparent" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </Box>
          <Box ref={scrollRef} sx={{ flex: 1, minWidth: 0, overflowX: "auto", overflowY: "hidden", pb: 1 }}>
            <Box sx={{ height: 330, minWidth: "100%", width: `${Math.max(monthlyData.length * MONTH_WIDTH, 900)}px` }}>
              <ResponsiveContainer height="100%" width="100%">
                <BarChart data={monthlyData} margin={{ top: 8, right: 20, bottom: 8, left: 0 }}>
                  <CartesianGrid stroke="#eef2f7" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="month_key" height={54} interval={0} tick={<MonthTick />} />
                  <Tooltip {...tooltipStyle} labelFormatter={(value) => new Date(`${value}-01T00:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" })} formatter={(value) => [Number(value).toLocaleString(), "Projects"]} />
                  <Bar dataKey="projects" fill="#2563eb" maxBarSize={34} name="Projects" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Box>
          </Box>
        </Box>
      </ChartCard>
    </Stack>
  );
}
