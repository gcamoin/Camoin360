import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Alert, Box, CircularProgress, Paper, Stack, Typography } from "@mui/material";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { API_BASE_URL, getApiErrorMessage, getAuthHeaders, handleUnauthorized } from "../auth";

const API_URL = `${API_BASE_URL}/management/sales-outlook-rfp`;
const MONTH_WIDTH = 44;
const tooltipStyle = { contentStyle: { border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12 } };

const formatCurrency = (value) => new Intl.NumberFormat(undefined, {
  currency: "USD", maximumFractionDigits: 0, notation: Math.abs(Number(value)) >= 1000000 ? "compact" : "standard", style: "currency",
}).format(Number(value || 0));

function MonthTick({ x, y, payload }) {
  const [year, month] = String(payload?.value || "").split("-");
  const label = month ? new Date(Number(year), Number(month) - 1, 1).toLocaleDateString(undefined, { month: "short" }) : "";
  return <g transform={`translate(${x},${y})`}><text fill="#475569" fontSize="10" textAnchor="middle"><tspan x="0" dy="12">{label}</tspan><tspan fontWeight="700" x="0" dy="15">{month === "01" ? year : ""}</tspan></text></g>;
}

function ChartCard({ children, description, title }) {
  return <Paper elevation={0} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, minWidth: 0, p: { xs: 2, md: 2.5 } }}>
    <Typography fontWeight={800}>{title}</Typography><Typography color="text.secondary" sx={{ mb: 2 }} variant="body2">{description}</Typography>{children}
  </Paper>;
}

function MonthlyBar({ color, data, dataKey, name, valueFormatter = (value) => Number(value).toLocaleString() }) {
  return <Box sx={{ height: 340, minWidth: 0, overflowX: "auto", overflowY: "hidden" }}>
    <Box sx={{ height: 325, minWidth: "100%", width: `${Math.max(data.length * MONTH_WIDTH, 900)}px` }}>
      <ResponsiveContainer height="100%" width="100%"><BarChart data={data} margin={{ top: 10, right: 20, bottom: 10, left: 14 }}>
        <CartesianGrid stroke="#eef2f7" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="month_key" height={54} interval={0} tick={<MonthTick />} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} tickFormatter={valueFormatter} width={78} />
        <Tooltip {...tooltipStyle} formatter={(value) => [valueFormatter(value), name]} labelFormatter={(value) => new Date(`${value}-01T00:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" })} />
        <Bar dataKey={dataKey} fill={color} maxBarSize={32} name={name} radius={[4, 4, 0, 0]} />
      </BarChart></ResponsiveContainer>
    </Box>
  </Box>;
}

export default function SalesOutlookRfp() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    axios.get(API_URL, { headers: getAuthHeaders() }).then((response) => { if (active) setData(response.data); }).catch((requestError) => {
      if (active && !handleUnauthorized(requestError)) setError(getApiErrorMessage(requestError, "Unable to load RFP sales outlook from Dynamics."));
    });
    return () => { active = false; };
  }, []);
  const monthly = useMemo(() => data?.monthly_contracts || [], [data]);
  if (error) return <Alert severity="error">{error}</Alert>;
  if (!data) return <Box sx={{ display: "grid", minHeight: 320, placeItems: "center" }}><CircularProgress /></Box>;

  return <Stack spacing={3}>
    <ChartCard title="$ amount of proposals submitted (month)" description="Annual sum of Fee for Camoin for proposals submitted since 2016.">
      <Box sx={{ height: 340 }}><ResponsiveContainer height="100%" width="100%"><LineChart data={data.annual_proposals} margin={{ top: 12, right: 24, bottom: 8, left: 14 }}>
        <CartesianGrid stroke="#eef2f7" strokeDasharray="3 3" vertical={false} /><XAxis dataKey="year" tick={{ fontSize: 12 }} /><YAxis tick={{ fontSize: 11 }} tickFormatter={formatCurrency} width={78} />
        <Tooltip {...tooltipStyle} formatter={(value) => [formatCurrency(value), "Fee for Camoin"]} /><Line dataKey="amount" dot={{ r: 4 }} activeDot={{ r: 6 }} name="Fee for Camoin" stroke="#0f766e" strokeWidth={3} type="monotone" />
      </LineChart></ResponsiveContainer></Box>
    </ChartCard>
    <ChartCard title="$ of RFP Contracts Signed" description="Monthly Fee for Camoin for won RFP opportunities by Actual Close Date, starting in 2020."><MonthlyBar color="#2563eb" data={monthly} dataKey="rfp_signed_amount" name="Fee for Camoin" valueFormatter={formatCurrency} /></ChartCard>
    <ChartCard title="# of RFP contracts won" description="Monthly count of won RFP opportunities by Actual Close Date, starting in 2020."><MonthlyBar color="#0f766e" data={monthly} dataKey="rfp_contracts_won" name="RFP Contracts Won" /></ChartCard>
    <ChartCard title="$ of non-bid contracts signed" description="Monthly Fee for Camoin for won non-bid opportunities by Actual Close Date, starting in 2020."><MonthlyBar color="#7c3aed" data={monthly} dataKey="non_bid_signed_amount" name="Fee for Camoin" valueFormatter={formatCurrency} /></ChartCard>
  </Stack>;
}
