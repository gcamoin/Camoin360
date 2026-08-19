import { useEffect, useState } from "react";
import axios from "axios";
import { Alert, Box, CircularProgress, Paper, Typography } from "@mui/material";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { API_BASE_URL, getApiErrorMessage, getAuthHeaders, handleUnauthorized } from "../auth";

const formatCurrency = (value) => new Intl.NumberFormat(undefined, {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  notation: "standard",
  style: "currency",
}).format(Number(value || 0));

const formatMonth = (monthKey) => {
  const [year, month] = String(monthKey || "").split("-").map(Number);
  if (!year || !month) return monthKey;
  return new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric" })
    .format(new Date(year, month - 1, 1));
};

export default function ContractBacklogSelected() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    axios.get(`${API_BASE_URL}/management/contract-backlog`, { headers: getAuthHeaders() })
      .then((response) => { if (active) setData(response.data); })
      .catch((requestError) => {
        if (active && !handleUnauthorized(requestError)) {
          setError(getApiErrorMessage(requestError, "Unable to load contract backlog from Dynamics."));
        }
      });
    return () => { active = false; };
  }, []);

  if (error) return <Alert severity="error">{error}</Alert>;
  if (!data) return <Box sx={{ display: "grid", minHeight: 320, placeItems: "center" }}><CircularProgress /></Box>;

  return (
    <Paper elevation={0} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: { xs: 2, md: 2.5 } }}>
      <Typography fontWeight={800}>Total Contract Backlog &amp; Total Monthly Revenue</Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }} variant="body2">
        Monthly sums from Dynamics projects, grouped by Contract Date.
      </Typography>
      <Box sx={{ height: 380, minWidth: 0 }}>
        <ResponsiveContainer height="100%" width="100%">
          <LineChart data={data.monthly_totals || []} margin={{ top: 12, right: 24, bottom: 8, left: 14 }}>
            <CartesianGrid stroke="#eef2f7" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="month_key" tick={{ fontSize: 12 }} tickFormatter={formatMonth} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={formatCurrency} width={78} />
            <Tooltip formatter={(value, name) => [formatCurrency(value), name]} labelFormatter={formatMonth} />
            <Legend verticalAlign="top" height={36} />
            <Line dataKey="total_project_fee" name="Total Contract Backlog" stroke="#2563eb" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} type="monotone" />
            <Line dataKey="fee_for_camoin" name="Total Monthly Revenue" stroke="#16a34a" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} type="monotone" />
          </LineChart>
        </ResponsiveContainer>
      </Box>
    </Paper>
  );
}
