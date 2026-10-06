import { useEffect, useState } from "react";
import { Alert, Box, Button, Paper, Skeleton, Typography, useTheme } from "@mui/material";
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { API_BASE_URL, getAuthHeaders, handleUnauthorized } from "../auth";
import { getCached } from "../apiClient";

const SUMMARY_URL = `${API_BASE_URL}/accounts/summary-analytics`;

export default function AccountsBySector() {
  const theme = useTheme();
  const [sectors, setSectors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(false);
    getCached(SUMMARY_URL, { headers: getAuthHeaders(), ttl: 10 * 60 * 1000, force: retry > 0 })
      .then(({ data }) => { if (active) setSectors(data?.sectors || []); })
      .catch((err) => { if (active && !handleUnauthorized(err)) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [retry]);

  return <Paper elevation={0} component="section" aria-labelledby="home-sectors-title" sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, overflow: "hidden", minWidth: 0 }}>
    <Typography id="home-sectors-title" component="h3" variant="h6" sx={{ p: { xs: 2, sm: 3 } }}>Accounts by Sector</Typography>
    {error ? <Alert severity="error" sx={{ m: 2 }} action={<Button onClick={() => setRetry((value) => value + 1)}>Retry</Button>}>Unable to load Accounts by Sector.</Alert> :
      <Box role="region" aria-label="Accounts by Sector chart" tabIndex={0} sx={{ maxHeight: { xs: 420, md: 560 }, overflow: "auto", px: { xs: 2, sm: 3 }, pb: 3 }}>
        {loading ? <Skeleton aria-label="Loading sector chart" variant="rounded" height={320} /> : sectors.length ? (
          <Box sx={{ height: Math.max(420, sectors.length * 36 + 80), minWidth: 640, width: "100%" }}>
            <ResponsiveContainer height="100%" width="100%">
              <BarChart data={sectors} layout="vertical" margin={{ top: 10, right: 70, left: 24, bottom: 10 }} accessibilityLayer>
                <CartesianGrid horizontal={false} stroke={theme.palette.divider} strokeDasharray="3 3" />
                <XAxis type="number" allowDecimals={false} tick={{ fill: theme.palette.text.secondary, fontSize: 12 }} />
                <YAxis type="category" dataKey="sector" interval={0} width={170}
                  tickFormatter={(value) => value.length > 24 ? `${value.slice(0, 24)}...` : value}
                  tick={{ fill: theme.palette.text.secondary, fontSize: 12 }} />
                <Tooltip formatter={(value) => [value.toLocaleString("en-US"), "Accounts"]} />
                <Bar dataKey="account_count" name="Accounts" fill={theme.palette.secondary.main} radius={[0, 4, 4, 0]} isAnimationActive={false}>
                  <LabelList dataKey="account_count" position="right" formatter={(value) => value.toLocaleString("en-US")}
                    style={{ fill: theme.palette.text.primary, fontSize: 12, fontWeight: 700 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Box>
        ) : <Typography color="text.secondary" sx={{ py: 4, textAlign: "center" }}>No sector data available.</Typography>}
      </Box>}

  </Paper>;
}
