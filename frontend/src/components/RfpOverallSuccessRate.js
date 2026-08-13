import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Alert, Box, CircularProgress, FormControl, InputLabel, MenuItem, Paper, Select, Stack, Typography } from "@mui/material";
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

const percent = (value) => `${Number(value).toFixed(0)}%`;
const ALL_SERVICE_LINES = "all";

export default function RfpOverallSuccessRate({ filters }) {
  const [metrics, setMetrics] = useState({ series: [] });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [serviceLine, setServiceLine] = useState(ALL_SERVICE_LINES);

  useEffect(() => {
    let active = true;
    axios.get(`${API_BASE_URL}/management/rfp-success-rate`, { headers: getAuthHeaders() })
      .then((response) => { if (active) setMetrics(response.data || { series: [] }); })
      .catch((requestError) => {
        if (!handleUnauthorized(requestError) && active) {
          setError(getApiErrorMessage(requestError, "Unable to load RFP success rates from Dynamics."));
        }
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const data = useMemo(() => {
    const matchingRows = (metrics.series || []).filter(
        (row) =>
          (!filters || filters.year === "all" || row.year === filters.year) &&
          (!filters || filters.quarter === "all" || row.quarter === filters.quarter) &&
          (serviceLine === ALL_SERVICE_LINES || row.service_line === serviceLine)
      );
    const byPeriod = new Map();
    matchingRows.forEach((row) => {
      const period = byPeriod.get(row.period) || {
        period: row.period, year: row.year, quarter: row.quarter,
        won: 0, lost: 0, open: 0, won_fee: 0, decided_fee: 0,
      };
      ["won", "lost", "open", "won_fee", "decided_fee"].forEach((key) => {
        period[key] += Number(row[key] || 0);
      });
      byPeriod.set(row.period, period);
    });
    return Array.from(byPeriod.values()).map((row) => ({
      ...row,
      count_success_rate: row.won + row.lost ? (row.won / (row.won + row.lost)) * 100 : null,
      dollar_success_rate: row.decided_fee ? (row.won_fee / row.decided_fee) * 100 : null,
    }));
  }, [filters, metrics.series, serviceLine]);

  const overall = useMemo(() => {
    if (!data.length) return { dollarRate: 0, rfpRate: 0 };
    return {
      dollarRate: data.reduce((sum, row) => sum + row.won_fee, 0) / data.reduce((sum, row) => sum + row.decided_fee, 0) * 100 || 0,
      rfpRate: data.reduce((sum, row) => sum + row.won, 0) / data.reduce((sum, row) => sum + row.won + row.lost, 0) * 100 || 0,
    };
  }, [data]);

  if (loading) return <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}><CircularProgress /></Box>;

  return (
    <Stack spacing={2.5}>
      {error ? <Alert severity="error">{error}</Alert> : null}
      <Box
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))" },
        }}
      >
        <Paper elevation={0} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: 2.5 }}>
          <Typography color="text.secondary" variant="overline">$$$ Success Rate</Typography>
          <Typography color="primary.main" sx={{ fontSize: "2.35rem", fontWeight: 800, lineHeight: 1.1, mt: 0.75 }}>
            {percent(overall.dollarRate)}
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 0.75 }} variant="body2">
            Won RFP value as a percentage of submitted RFP value
          </Typography>
        </Paper>
        <Paper elevation={0} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: 2.5 }}>
          <Typography color="text.secondary" variant="overline"># RFP Success Rate</Typography>
          <Typography color="secondary.main" sx={{ fontSize: "2.35rem", fontWeight: 800, lineHeight: 1.1, mt: 0.75 }}>
            {percent(overall.rfpRate)}
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 0.75 }} variant="body2">
            Won RFP count as a percentage of submitted RFP count
          </Typography>
        </Paper>
      </Box>

      <Paper elevation={0} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: { xs: 2, md: 2.5 } }}>
        <Stack alignItems={{ xs: "stretch", sm: "flex-start" }} direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={2} sx={{ mb: 2 }}>
          <Box>
            <Typography color="text.primary" fontWeight={800}>$$$ Success Rate</Typography>
            <Typography color="text.secondary" variant="body2">
              Quarterly dollar and RFP-count win rates from live Dynamics opportunities. Open opportunities are excluded from success-rate denominators.
            </Typography>
          </Box>
          <FormControl size="small" sx={{ flexShrink: 0, minWidth: 230 }}>
            <InputLabel id="rfp-service-line-filter-label">Service line</InputLabel>
            <Select
              label="Service line"
              labelId="rfp-service-line-filter-label"
              onChange={(event) => setServiceLine(event.target.value)}
              value={serviceLine}
            >
              <MenuItem value={ALL_SERVICE_LINES}>All service lines</MenuItem>
              {(metrics.service_lines || []).map((line) => <MenuItem key={line} value={line}>{line}</MenuItem>)}
            </Select>
          </FormControl>
        </Stack>
        {data.length ? (
          <Box sx={{ height: 360, minWidth: 0 }}>
            <ResponsiveContainer height="100%" width="100%">
              <LineChart data={data} margin={{ top: 12, right: 24, bottom: 12, left: 4 }}>
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="period" tick={{ fontSize: 11 }} tickMargin={10} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={percent} width={48} />
                <Tooltip formatter={(value, name) => [percent(value), name]} />
                <Legend verticalAlign="top" height={36} />
                <Line dataKey="dollar_success_rate" name="$$$ Success Rate" stroke="#2563eb" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                <Line dataKey="count_success_rate" name="# RFP Success Rate" stroke="#0f766e" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          </Box>
        ) : (
          <Box sx={{ alignItems: "center", display: "flex", height: 240, justifyContent: "center" }}>
            <Typography color="text.secondary">No RFP success-rate data matches this reporting period.</Typography>
          </Box>
        )}
      </Paper>
    </Stack>
  );
}
