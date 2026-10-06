import { useEffect, useRef, useState } from "react";
import {
  Alert, Box, Button, Chip, Paper, Skeleton, Stack, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, ToggleButton, ToggleButtonGroup,
  Tooltip, Typography,
} from "@mui/material";
import { API_BASE_URL, getAuthHeaders, handleUnauthorized } from "../auth";
import { getCached } from "../apiClient";

import AccountsBySector from "./AccountsBySector";

const HOME_URL = `${API_BASE_URL}/maintenance/home`;
const REQUEST_PARAMS = { days: 14, limit: 25 };
const CACHE_TTL = 30 * 1000;
const panelSx = { border: "1px solid", borderColor: "divider", borderRadius: 2, p: { xs: 2, sm: 3 }, minWidth: 0 };
const formatNumber = (value) => typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("en-US", { maximumFractionDigits: 1 }) : "—";

function formatTimestamp(value, timezone) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "—";
  const options = { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" };
  try {
    return date.toLocaleString("en-US", { ...options, timeZone: timezone });
  } catch {
    return date.toLocaleString("en-US", { ...options, timeZone: "America/New_York" });
  }
}

function MetricCard({ title, value, subtitle, loading, tooltip }) {
  return (
    <Paper elevation={0} sx={{ ...panelSx, minHeight: 150, containerType: "inline-size" }} component="section" aria-label={title}>
      <Typography color="text.secondary" variant="body2" sx={{ fontWeight: 650, minHeight: { lg: 42 } }}>{title}</Typography>
      {loading ? <Skeleton aria-label={`Loading ${title}`} width="75%" height={50} /> : (
        <Typography sx={{ color: "primary.main", fontSize: "clamp(1.4rem, 16cqi, 2.15rem)", fontWeight: 750, lineHeight: 1.2, mt: 1 }}>{value}</Typography>
      )}
      {loading ? <Skeleton width="60%" /> : subtitle ? (
        <Tooltip title={tooltip || ""} arrow>
          <Typography color="text.secondary" variant="caption" component="p" sx={{ mb: 0, mt: 1 }}>{subtitle}</Typography>
        </Tooltip>
      ) : null}
    </Paper>
  );
}

function warningMessage(data) {
  if (!data) return "";
  const freshness = data.freshness || {};
  if (data.reporting?.coverage_complete === false || freshness.discovery?.coverage_complete === false) {
    return freshness.discovery?.refresh_incomplete === false
      ? "Account activity is out of date. Last available data is shown."
      : "Some recent Account activity may be incomplete.";
  }
  if (data.metrics?.enrichment_success_rate?.coverage_complete === false) {
    return "Some recent Account activity may be incomplete.";
  }
  if (data.metrics?.total_dynamics_accounts?.is_stale || freshness.creation_counts?.today_stale || freshness.creation_counts?.week_stale) {
    return "Some dashboard data is out of date. Last available values are shown.";
  }
  if (data.metrics?.total_dynamics_accounts?.value == null || data.metrics?.new_accounts_today == null || data.metrics?.new_accounts_this_week == null) {
    return "Some Account counts are not yet available.";
  }
  // Permanent best-effort-history/scheduling notices do not indicate an unhealthy snapshot.
  return "";
}

function StatusChip({ account }) {
  const successful = ["enriched", "no_paid_enrichment_needed"].includes(account.display_status);
  const failed = ["failed", "update_unconfirmed"].includes(account.display_status);
  const processing = ["processing", "pending"].includes(account.display_status);
  const color = account.needs_attention ? (failed ? "error" : "warning") : successful ? "success" : processing ? "info" : "default";
  return <Chip label={account.display_status_label || "Status unavailable"} color={color} size="small" variant="outlined"
    sx={{ maxWidth: "100%", height: "auto", minHeight: 28, "& .MuiChip-label": { whiteSpace: "normal", py: 0.5 } }} />;
}

export default function MaintenanceHome() {
  const [view, setView] = useState("recent");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [moreError, setMoreError] = useState("");
  const [reload, setReload] = useState(0);
  const requestVersion = useRef(0);
  const retryRequested = useRef(false);
  const preserveData = useRef(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const version = ++requestVersion.current;
    const background = preserveData.current;
    preserveData.current = false;
    setLoading(!background);
    setRefreshing(background);
    setLoadingMore(false);
    if (!background) setData(null);
    setError("");
    setMoreError("");
    const force = retryRequested.current;
    retryRequested.current = false;
    getCached(HOME_URL, { headers: getAuthHeaders(), params: { ...REQUEST_PARAMS, view }, ttl: CACHE_TTL, force })
      .then(({ data: response }) => { if (requestVersion.current === version) setData(response); })
      .catch((requestError) => {
        if (requestVersion.current === version && !handleUnauthorized(requestError)) setError("Unable to load Sophie Maintenance. Please try again.");
      })
      .finally(() => { if (requestVersion.current === version) { setLoading(false); setRefreshing(false); } });
    return () => { requestVersion.current += 1; };
  }, [view, reload]);

  const coverageIncomplete = data?.reporting?.coverage_complete === false || data?.freshness?.discovery?.coverage_complete === false;
  useEffect(() => {
    if (!data || loading || refreshing || error) return undefined;
    // Recheck PostgreSQL snapshots while coverage is incomplete, without clearing the page.
    // Expiring the API cache alone does not update mounted React state.
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      preserveData.current = true;
      retryRequested.current = true;
      setReload((value) => value + 1);
    };
    const timer = coverageIncomplete ? window.setTimeout(refresh, 120000) : null;
    window.addEventListener("focus", refresh);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [data, loading, refreshing, error, coverageIncomplete]);

  async function loadMore() {
    if (!data?.next_cursor || loadingMore) return;
    const version = requestVersion.current;
    setLoadingMore(true);
    setMoreError("");
    try {
      const { data: response } = await getCached(HOME_URL, {
        headers: getAuthHeaders(), params: { ...REQUEST_PARAMS, view, cursor: data.next_cursor }, ttl: CACHE_TTL, force: Boolean(moreError),
      });
      if (version === requestVersion.current) {
        setData((previous) => {
          const ids = new Set(previous.recent_accounts.map((account) => account.account_id));
          return { ...response, recent_accounts: [...previous.recent_accounts, ...(response.recent_accounts || []).filter((account) => !ids.has(account.account_id))] };
        });
      }
    } catch (requestError) {
      if (version === requestVersion.current && !handleUnauthorized(requestError)) setMoreError("Unable to load more Accounts. Please try again.");
    } finally {
      if (version === requestVersion.current) setLoadingMore(false);
    }
  }

  const metrics = data?.metrics || {};
  const total = metrics.total_dynamics_accounts || {};
  const rate = metrics.enrichment_success_rate || {};
  const timezone = data?.reporting?.timezone || "America/New_York";
  const warning = warningMessage(data);
  const rows = data?.recent_accounts || [];
  const snapshot = total.fetched_at ? `Snapshot · ${formatTimestamp(total.fetched_at, timezone)}` : "Snapshot unavailable";

  if (error) return <Alert severity="error" action={<Button color="inherit" onClick={() => {
    retryRequested.current = true;
    setReload((value) => value + 1);
  }}>Retry</Button>}>{error}</Alert>;

  return <Stack spacing={{ xs: 3, sm: 4 }} aria-busy={loading}>
    {warning && <Alert severity="info" sx={{ py: 0.25 }} action={<Button color="inherit" disabled={refreshing} onClick={() => {
      preserveData.current = true;
      retryRequested.current = true;
      setReload((value) => value + 1);
    }}>{refreshing ? "Refreshing…" : "Refresh"}</Button>}>{warning}</Alert>}
    <Box data-testid="home-kpis" sx={{ display: "grid", gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: "repeat(2, minmax(0, 1fr))", lg: "repeat(4, minmax(0, 1fr))" }, gap: 2 }}>
      <MetricCard title="Total Dynamics Accounts" value={formatNumber(total.value)} subtitle={snapshot} loading={loading}
        tooltip={`Dynamics snapshot. Counts may be up to ${total.maximum_source_age_hours || 24} hours old when fetched.`} />
      <MetricCard title="New Accounts Today" value={formatNumber(metrics.new_accounts_today)} loading={loading} />
      <MetricCard title="New Accounts This Week" value={formatNumber(metrics.new_accounts_this_week)} subtitle="Week starts Monday" loading={loading} />
      <MetricCard title="Enrichment Success Rate" value={rate.value == null ? "—" : `${formatNumber(rate.value)}%`} loading={loading}
        subtitle={rate.known_terminal_accounts > 0 ? `${formatNumber(rate.successful_accounts)} of ${formatNumber(rate.known_terminal_accounts)} completed` : "No completed outcomes yet"} />
    </Box>
    <Paper elevation={0} sx={{ ...panelSx, p: 0, overflow: "hidden" }} component="section" aria-labelledby="home-accounts-title">
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ xs: "flex-start", sm: "center" }} justifyContent="space-between" sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography id="home-accounts-title" component="h3" variant="h6">Recent New Accounts &amp; Enrichment</Typography>
        <ToggleButtonGroup value={view} exclusive size="small" aria-label="Account view" onChange={(_event, next) => {
          if (next && next !== view) { requestVersion.current += 1; setView(next); }
        }}>
          <ToggleButton value="recent">Recent</ToggleButton>
          <ToggleButton value="attention">Needs Attention</ToggleButton>
        </ToggleButtonGroup>
      </Stack>
      <TableContainer component={Box} sx={{ overflowX: "auto" }} tabIndex={0} role="region" aria-label="Recent Accounts table">
        <Table aria-label="Recent New Accounts and Enrichment" sx={{ minWidth: 780 }}>
          <TableHead><TableRow>{["Account", "Created", "Enrichment Status", "Fields Added / Result"].map((label) => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead>
          <TableBody>
            {loading ? Array.from({ length: 4 }, (_, index) => <TableRow key={index}>{Array.from({ length: 4 }, (_value, cell) => <TableCell key={cell}><Skeleton aria-label="Loading Account" width="85%" /></TableCell>)}</TableRow>) : rows.length ? rows.map((account) => (
              <TableRow key={account.account_id} hover>
                <TableCell component="th" scope="row" sx={{ minWidth: 170, maxWidth: 260, overflowWrap: "anywhere", fontWeight: 650 }}>{account.account_name || "Unnamed Account"}</TableCell>
                <TableCell sx={{ minWidth: 155, maxWidth: 190 }}><Typography variant="body2" color="text.secondary" component="time" dateTime={account.created_at}>{formatTimestamp(account.created_at, timezone)}</Typography></TableCell>
                <TableCell sx={{ minWidth: 190, maxWidth: 280 }}><StatusChip account={account} /></TableCell>
                <TableCell sx={{ minWidth: 190, maxWidth: 300, overflowWrap: "anywhere" }}>{account.field_labels?.length ? account.field_labels.join(", ") : account.result_summary || "—"}</TableCell>
              </TableRow>
            )) : <TableRow><TableCell colSpan={4} sx={{ py: 6, textAlign: "center", color: "text.secondary" }}>{view === "attention" ? "No Accounts currently need attention." : "No recent Accounts to show."}</TableCell></TableRow>}
          </TableBody>
        </Table>
      </TableContainer>
      {moreError && <Alert severity="error" sx={{ mx: 2, mt: 2 }} action={<Button color="inherit" onClick={loadMore}>Retry</Button>}>{moreError}</Alert>}
      {!loading && data?.next_cursor && <Box sx={{ p: 2, textAlign: "center" }}><Button variant="outlined" disabled={loadingMore} onClick={loadMore}>{loadingMore ? "Loading more…" : "Load more"}</Button></Box>}
    </Paper>
    <AccountsBySector />
  </Stack>;
}
