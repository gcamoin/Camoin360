import { useEffect, useState } from "react";
import axios from "axios";
import { Alert, Box, Button, CircularProgress, Paper, Stack, Typography } from "@mui/material";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { API_BASE_URL, getApiErrorMessage, getAuthHeaders, handleUnauthorized } from "../auth";
import { filterReportingRows } from "../reportingPeriod";

const formatMonth = (value) => new Date(`${value}-01T12:00:00`).toLocaleDateString("en-US", { month: "short", year: "numeric" });
const formatDate = (value) => new Date(value).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" });

export default function NewsletterSubscribers({ filters }) {
  const [metrics, setMetrics] = useState({ snapshots: [] });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    axios.get(`${API_BASE_URL}/marketing/newsletter-subscribers`, {
      headers: getAuthHeaders(), timeout: 60000,
    }).then(({ data }) => {
      if (active) setMetrics(data);
    }).catch((requestError) => {
      if (active && !handleUnauthorized(requestError)) setError(getApiErrorMessage(requestError, "Unable to load newsletter subscriber counts."));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload]);
  const rows = filterReportingRows(metrics.snapshots, filters);
  const latest = rows[rows.length - 1];
  return (
    <Paper elevation={0} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: { xs: 2, md: 2.5 } }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={2}>
        <Box>
          <Typography fontWeight={800}>Newsletter Subscribers</Typography>
          <Typography color="text.secondary" variant="body2">Economic Navigator Newsletter (Real Time)</Typography>
        </Box>
        <Button size="small" variant="outlined" disabled={loading} onClick={() => setReload((value) => value + 1)}>Reload</Button>
      </Stack>
      {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      {metrics.warning && <Alert severity="warning" sx={{ mt: 2 }}>{metrics.warning}</Alert>}
      {loading ? <Box sx={{ display: "grid", placeItems: "center", height: 260 }}><CircularProgress size={28} /></Box> : latest ? (
        <>
          <Typography color="primary.main" sx={{ fontSize: "2rem", fontWeight: 800, mt: 2 }}>{latest.subscriber_count.toLocaleString()}</Typography>
          <Typography color="text.secondary" variant="body2">Latest count in selected period · {formatDate(latest.captured_at)}</Typography>
          <Box sx={{ height: 300, minWidth: 0, mt: 2 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={{ top: 12, right: 24, bottom: 8, left: 8 }}>
                <CartesianGrid stroke="#eef2f7" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month_key" tickFormatter={formatMonth} tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tickFormatter={(value) => Number(value).toLocaleString()} />
                <Tooltip labelFormatter={(_label, payload) => payload?.[0]?.payload?.captured_at ? formatDate(payload[0].payload.captured_at) : ""} formatter={(value) => [Number(value).toLocaleString(), "Subscribers"]} />
                <Line dataKey="subscriber_count" name="Subscribers" type="linear" stroke="#00336c" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          </Box>
          {rows.length === 1 && <Typography color="text.secondary" variant="body2">One month in this period. The trend line will appear as more months are recorded.</Typography>}
        </>
      ) : <Typography color="text.secondary" sx={{ py: 6, textAlign: "center" }}>No subscriber snapshots match this reporting period.</Typography>}
      <Typography color="text.secondary" variant="caption" component="p" sx={{ mt: 2, mb: 0 }}>
        Tracking began September 23, 2026. Each month shows its latest subscriber count. The current month updates on Mondays at 9 a.m. Eastern; previous months stay unchanged.
        {metrics.next_snapshot_at ? ` Next scheduled update: ${formatDate(metrics.next_snapshot_at)}.` : ""}
      </Typography>
    </Paper>
  );
}
