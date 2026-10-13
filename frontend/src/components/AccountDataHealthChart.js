import { Box, Paper, Skeleton, Typography, useTheme } from "@mui/material";
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const number = (value) => typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("en-US") : "—";
function HealthTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return <Paper elevation={2} sx={{ p: 1.5 }}>
    <Typography variant="body2" fontWeight={650}>{row.label}</Typography>
    <Typography variant="body2">{number(row.count)} Accounts · {row.percentage == null ? "Percentage unavailable" : `${number(row.percentage)}%`}</Typography>
  </Paper>;
}
function CategoryTick({ x, y, payload }) {
  return <text x={x - 6} y={y} textAnchor="end" fontSize={12} fill="currentColor">
    {payload.value === "Needs Enrichment" ? <><tspan x={x - 6} dy="-0.3em">Needs</tspan><tspan x={x - 6} dy="1.2em">Enrichment</tspan></> : <tspan dy="0.3em">{payload.value}</tspan>}
  </text>;
}

export default function AccountDataHealthChart({ distribution = [], health = {}, loading }) {
  const theme = useTheme();
  const known = distribution.length === 4 && distribution.every((row) => typeof row.count === "number");
  return <Paper elevation={0} component="section" aria-labelledby="home-health-title"
    sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: { xs: 2, sm: 3 }, minWidth: 0 }}>
    <Typography id="home-health-title" component="h3" variant="h6">Account Data Health</Typography>
    <Box sx={{ height: 280, mt: 2, minWidth: 0 }}>
      {loading ? <Skeleton aria-label="Loading Data Health chart" variant="rounded" height="100%" /> : known ?
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={distribution} layout="vertical" margin={{ top: 8, right: 45, left: 0, bottom: 8 }} accessibilityLayer>
            <CartesianGrid horizontal={false} stroke={theme.palette.divider} strokeDasharray="3 3" />
            <XAxis type="number" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(value) => `${value}%`} tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="label" width={95} interval={0} tick={<CategoryTick />} />
            <Tooltip content={<HealthTooltip />} />
            <Bar dataKey="percentage" name="Classified Accounts" fill={theme.palette.primary.main} radius={[0, 4, 4, 0]} isAnimationActive={false}>
              <LabelList dataKey="percentage" position="right" formatter={(value) => value == null ? "—" : `${number(value)}%`} style={{ fill: theme.palette.text.primary, fontSize: 12 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer> : <Box sx={{ height: "100%", display: "grid", placeItems: "center" }}><Typography variant="body2" color="text.secondary">Data Health data is not available yet.</Typography></Box>}
    </Box>
    {!loading && known && health.classified_accounts === 0 && <Typography variant="body2" color="text.secondary">No Accounts have a Data Health classification yet.</Typography>}
    {!loading && health.unscored_accounts > 0 && <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{number(health.unscored_accounts)} Accounts are still awaiting a Data Health Score.</Typography>}
    {!loading && health.unclassified_accounts > 0 && health.unclassified_accounts !== health.unscored_accounts && <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 0 }}>{number(health.unclassified_accounts)} Accounts have no valid Data Health classification and are excluded from percentages.</Typography>}
  </Paper>;
}
