import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import {
  Alert,
  Card,
  CardContent,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Typography,
  useTheme,
} from "@mui/material";
import { API_BASE_URL, getAuthHeaders, handleUnauthorized } from "../auth";
import { getCached, invalidateApiCache } from "../apiClient";

const API_URL = `${API_BASE_URL}/metrics`;
const ENRICH_ALL_URL = `${API_BASE_URL}/accounts/enrich-all`;

const valueSx = {
  fontSize: { xs: "2rem", md: "2.4rem" },
  fontWeight: 700,
  lineHeight: 1.1,
  mt: 1,
};

function MetricCard({ title, value, subtitle }) {
  const theme = useTheme();

  return (
    <Card
      sx={{
        width: "100%",
        display: "flex",
        borderRadius: 3,
        boxShadow: "0 10px 30px rgba(0, 51, 108, 0.08)",
        height: "100%",
        minHeight: 155,
        borderTop: `4px solid ${theme.palette.secondary.main}`,
      }}
    >
      <CardContent sx={{ p: 3, width: "100%" }}>
        <Typography color="text.secondary" variant="overline">
          {title}
        </Typography>
        <Typography sx={{ ...valueSx, color: "primary.main" }}>{value}</Typography>
        {subtitle ? (
          <Typography color="text.secondary" sx={{ mt: 1 }} variant="body2">
            {subtitle}
          </Typography>
        ) : null}
      </CardContent>
    </Card>
  );
}

function formatTimestamp(value) {
  if (!value) {
    return "Missing";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function getFieldsUpdatedDisplay(fieldsUpdated) {
  if (Array.isArray(fieldsUpdated) && fieldsUpdated.length) {
    return fieldsUpdated.join(", ");
  }

  if (typeof fieldsUpdated === "string" && fieldsUpdated.trim()) {
    return fieldsUpdated;
  }

  return "None";
}

function formatAuditValue(value) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return "Missing";
  }

  return String(value);
}

function escapeCsvValue(value) {
  const stringValue = value === null || value === undefined ? "" : String(value);
  return `"${stringValue.replace(/"/g, '""')}"`;
}

function downloadCsv(filename, headers, rows) {
  const csvRows = [
    headers.map(escapeCsvValue).join(","),
    ...rows.map((row) => headers.map((header) => escapeCsvValue(row[header])).join(",")),
  ];
  const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function getExportDateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function getStatusColor(status) {
  const normalizedStatus = String(status || "").toLowerCase();

  if (normalizedStatus === "updated") {
    return "success";
  }

  if (normalizedStatus === "failed") {
    return "error";
  }

  if (normalizedStatus === "pending") {
    return "info";
  }

  if (["skipped", "no match found"].includes(normalizedStatus)) {
    return "warning";
  }

  return "default";
}

export default function MetricsDashboard() {
  const [metrics, setMetrics] = useState({
    weekly_limit: 2000,
    remaining_credits: 2000,
    total_credits_remaining: null,
    total_credits_updated_at: null,
    accounts_updated: 0,
    audit_history: [],
    recent_activity: [],
  });
  const [expandedAuditRun, setExpandedAuditRun] = useState("");
  const [isRunningEnrichment, setIsRunningEnrichment] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [isLoadingMetrics, setIsLoadingMetrics] = useState(true);
  const [hasLoadedMetrics, setHasLoadedMetrics] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [auditPage, setAuditPage] = useState(0);
  const [auditRowsPerPage, setAuditRowsPerPage] = useState(5);
  const [recentPage, setRecentPage] = useState(0);
  const [recentRowsPerPage, setRecentRowsPerPage] = useState(5);
  const auditHistory = metrics.audit_history || [];
  const recentActivity = metrics.recent_activity || [];
  const paginatedAuditHistory = auditHistory.slice(
    auditPage * auditRowsPerPage,
    auditPage * auditRowsPerPage + auditRowsPerPage
  );
  const paginatedRecentActivity = recentActivity.slice(
    recentPage * recentRowsPerPage,
    recentPage * recentRowsPerPage + recentRowsPerPage
  );

  const loadMetrics = useCallback(async (showLoading = false, force = false) => {
    if (showLoading) {
      setIsLoadingMetrics(true);
    }

    try {
      const response = await getCached(API_URL, {
        force,
        headers: getAuthHeaders(),
        ttl: 30 * 1000,
      });
      setMetrics(response.data);
      setHasLoadedMetrics(true);
      setLoadError("");
      return response.data;
    } catch (error) {
      if (handleUnauthorized(error)) {
        return null;
      }

      console.error("Failed to fetch metrics", error);
      setLoadError("Unable to load Sophie Maintenance metrics.");
      return null;
    } finally {
      if (showLoading) {
        setIsLoadingMetrics(false);
      }
    }
  }, []);

  function exportRecentActivityCsv() {
    downloadCsv(
      `recent-activity-${getExportDateStamp()}.csv`,
      ["Account Name", "Result Status", "Fields Updated", "Credits Used", "Timestamp"],
      recentActivity.map((activity) => ({
        "Account Name": activity.account_name || "Unknown Account",
        "Result Status": activity.result_status || "Pending",
        "Fields Updated": getFieldsUpdatedDisplay(activity.fields_updated),
        "Credits Used": activity.credits_used ?? 0,
        "Timestamp": formatTimestamp(activity.timestamp),
      }))
    );
  }

  function exportAuditHistoryCsv() {
    const rows = auditHistory.flatMap((run) => {
      const details = run.details?.length ? run.details : [{}];

      return details.map((detail) => ({
        "Run Date": run.run_date,
        "Accounts Processed": run.accounts_processed,
        "Accounts Updated": run.accounts_updated,
        "Credits Used": run.credits_used,
        "Success Rate": `${Number(run.success_rate || 0).toFixed(1)}%`,
        "Run Status": run.run_status || "Completed",
        "Account Name": detail.account_name || "",
        "Field Updated": detail.field_updated || "",
        "Old Value": detail.old_value === undefined ? "" : formatAuditValue(detail.old_value),
        "New Value": detail.new_value === undefined ? "" : formatAuditValue(detail.new_value),
        "Result": detail.result || "",
        "Timestamp": detail.timestamp ? formatTimestamp(detail.timestamp) : "",
      }));
    });

    downloadCsv(
      `audit-history-${getExportDateStamp()}.csv`,
      [
        "Run Date",
        "Accounts Processed",
        "Accounts Updated",
        "Credits Used",
        "Success Rate",
        "Run Status",
        "Account Name",
        "Field Updated",
        "Old Value",
        "New Value",
        "Result",
        "Timestamp",
      ],
      rows
    );
  }

  async function refreshMetrics() {
    invalidateApiCache(API_URL);
    await loadMetrics(false, true);
  }

  async function runEnrichment() {
    setIsRunningEnrichment(true);
    setActionError("");
    setActionMessage("");

    try {
      const response = await axios.post(ENRICH_ALL_URL, {}, { headers: getAuthHeaders() });
      const processed = response.data?.processed || 0;
      const updated = response.data?.updated || 0;

      setActionMessage(`Enrichment complete: ${processed} processed, ${updated} updated.`);
      await refreshMetrics();
    } catch (error) {
      if (handleUnauthorized(error)) {
        return;
      }

      setActionError("Unable to run enrichment.");
    } finally {
      setIsRunningEnrichment(false);
    }
  }

  useEffect(() => {
    let isMounted = true;

    const fetchMetrics = async (showLoading = false, force = false) => {
      if (isMounted && document.visibilityState === "visible") {
        await loadMetrics(showLoading, force);
      }
    };

    fetchMetrics(true);
    const intervalId = setInterval(() => fetchMetrics(false, true), 60000);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, [loadMetrics]);

  useEffect(() => {
    const maxAuditPage = Math.max(0, Math.ceil(auditHistory.length / auditRowsPerPage) - 1);
    if (auditPage > maxAuditPage) {
      setAuditPage(maxAuditPage);
    }
  }, [auditHistory.length, auditPage, auditRowsPerPage]);

  useEffect(() => {
    const maxRecentPage = Math.max(0, Math.ceil(recentActivity.length / recentRowsPerPage) - 1);
    if (recentPage > maxRecentPage) {
      setRecentPage(maxRecentPage);
    }
  }, [recentActivity.length, recentPage, recentRowsPerPage]);

  if (isLoadingMetrics && !hasLoadedMetrics) {
    return (
      <Paper
        elevation={0}
        sx={{
          alignItems: "center",
          border: "1px solid rgba(0, 51, 108, 0.10)",
          borderRadius: 2,
          display: "flex",
          flexDirection: "column",
          gap: 2,
          minHeight: 320,
          justifyContent: "center",
          p: 4,
        }}
      >
        <CircularProgress />
        <Typography color="text.secondary">Loading Sophie Maintenance metrics...</Typography>
      </Paper>
    );
  }

  if (loadError && !hasLoadedMetrics) {
    return (
      <Paper
        elevation={0}
        sx={{
          border: "1px solid rgba(0, 51, 108, 0.10)",
          borderRadius: 2,
          p: { xs: 2, md: 3 },
        }}
      >
        <Stack spacing={2}>
          <Alert severity="error">{loadError}</Alert>
          <Button
            onClick={() => loadMetrics(true, true)}
            sx={{ alignSelf: "flex-start", borderRadius: 1, fontWeight: 800 }}
            variant="contained"
          >
            Retry
          </Button>
        </Stack>
      </Paper>
    );
  }

  return (
    <Stack spacing={4} sx={{ minWidth: 0 }}>
      {loadError ? (
        <Alert
          action={
            <Button color="inherit" onClick={() => loadMetrics(false, true)} size="small">
              Retry
            </Button>
          }
          severity="warning"
        >
          {loadError}
        </Alert>
      ) : null}

      <Stack component="section" spacing={2} aria-labelledby="sophie-enrichment">
        <Typography id="sophie-enrichment" component="h2" variant="h6" color="primary.main">Enrichment</Typography>
        <Box sx={{ display: "grid", gap: 3, gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))" } }}>
          <MetricCard title="Accounts Updated" value={metrics.accounts_updated ?? "—"} subtitle="Cumulative Dynamics records changed successfully" />
          <MetricCard title="Seamless Credits Remaining" value={metrics.total_credits_remaining == null ? "—" : Number(metrics.total_credits_remaining).toLocaleString()} subtitle={metrics.total_credits_updated_at ? `Balance reported ${formatTimestamp(metrics.total_credits_updated_at)}` : "Balance not yet reported by Seamless"} />
        </Box>
        <Typography color="text.secondary" variant="body2">
          Weekly allowance: {metrics.remaining_credits ?? "—"} remaining of {metrics.weekly_limit ?? "—"} credits.
        </Typography>
        <Button disabled={isRunningEnrichment} onClick={runEnrichment} sx={{ alignSelf: { xs: "stretch", sm: "flex-start" }, minHeight: 44, fontWeight: 800 }} variant="contained">
          {isRunningEnrichment ? "Running..." : "Run Enrichment"}
        </Button>
      </Stack>

      <Paper
        elevation={0}
        sx={{
          border: "1px solid rgba(0, 51, 108, 0.10)",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <Box
          sx={{
            alignItems: { xs: "flex-start", sm: "center" },
            borderBottom: "1px solid rgba(0, 51, 108, 0.10)",
            display: "flex",
            flexDirection: { xs: "column", sm: "row" },
            gap: 1,
            justifyContent: "space-between",
            px: { xs: 2, md: 3 },
            py: 2,
          }}
        >
          <Box>
            <Typography color="primary.main" sx={{ fontWeight: 800 }} variant="h6">
              Recent Activity
            </Typography>
            <Typography color="text.secondary" variant="body2">
              Latest Seamless enrichment outcomes.
            </Typography>
          </Box>
          <Stack
            alignItems={{ xs: "stretch", sm: "center" }}
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            sx={{ width: { xs: "100%", sm: "auto" } }}
          >
            <Button
              disabled={!recentActivity.length}
              onClick={exportRecentActivityCsv}
              size="small"
              sx={{ borderRadius: 1, fontWeight: 800 }}
              variant="outlined"
            >
              Export CSV
            </Button>
          </Stack>
        </Box>
        <TableContainer sx={{ overflowX: "auto" }}>
          <Table size="small" sx={{ minWidth: 650 }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 800 }}>Account Name</TableCell>
                <TableCell sx={{ fontWeight: 800 }}>Result Status</TableCell>
                <TableCell sx={{ fontWeight: 800 }}>Fields Updated</TableCell>
                <TableCell sx={{ fontWeight: 800 }}>Credits Used</TableCell>
                <TableCell sx={{ fontWeight: 800 }}>Timestamp</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {recentActivity.length ? (
                paginatedRecentActivity.map((activity, index) => (
                  <TableRow key={`${activity.account_name || "activity"}-${activity.timestamp || index}`} hover>
                    <TableCell>{activity.account_name || "Unknown Account"}</TableCell>
                    <TableCell>
                      <Chip
                        color={getStatusColor(activity.result_status)}
                        label={activity.result_status || "Pending"}
                        size="small"
                        sx={{ fontWeight: 800 }}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell sx={{ overflowWrap: "anywhere" }}>
                      {getFieldsUpdatedDisplay(activity.fields_updated)}
                    </TableCell>
                    <TableCell>{activity.credits_used ?? 0}</TableCell>
                    <TableCell>{formatTimestamp(activity.timestamp)}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} sx={{ py: 4, textAlign: "center" }}>
                    <Typography color="text.secondary">
                      No recent Seamless activity has been recorded yet.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
        {recentActivity.length ? (
          <TablePagination
            sx={{ "& .MuiTablePagination-toolbar": { flexWrap: "wrap", justifyContent: "flex-end", px: 1 }, "& .MuiTablePagination-spacer": { display: { xs: "none", sm: "block" } } }}
            component="div"
            count={recentActivity.length}
            onPageChange={(event, nextPage) => setRecentPage(nextPage)}
            onRowsPerPageChange={(event) => {
              setRecentRowsPerPage(parseInt(event.target.value, 10));
              setRecentPage(0);
            }}
            page={recentPage}
            rowsPerPage={recentRowsPerPage}
            rowsPerPageOptions={[5, 10, 25]}
          />
        ) : null}
      </Paper>

      <Box component="details" sx={{ minWidth: 0 }}>
        <Typography component="summary" color="primary.main" sx={{ cursor: "pointer", fontWeight: 700, py: 1 }}>View enrichment audit history</Typography>
      <Paper
        elevation={0}
        sx={{
          border: "1px solid rgba(0, 51, 108, 0.10)",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <Box
          sx={{
            alignItems: { xs: "flex-start", sm: "center" },
            borderBottom: "1px solid rgba(0, 51, 108, 0.10)",
            display: "flex",
            flexDirection: { xs: "column", sm: "row" },
            gap: 1,
            justifyContent: "space-between",
            px: { xs: 2, md: 3 },
            py: 2,
          }}
        >
          <Box>
            <Typography color="primary.main" sx={{ fontWeight: 800 }} variant="h6">
              Audit History
            </Typography>
            <Typography color="text.secondary" variant="body2">
              Enrichment run history and field-level changes.
            </Typography>
          </Box>
          <Stack
            alignItems={{ xs: "stretch", sm: "center" }}
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            sx={{ width: { xs: "100%", sm: "auto" } }}
          >
            <Button
              disabled={!auditHistory.length}
              onClick={exportAuditHistoryCsv}
              size="small"
              sx={{ borderRadius: 1, fontWeight: 800 }}
              variant="outlined"
            >
              Export CSV
            </Button>
            <Chip label={`${auditHistory.length} runs`} sx={{ fontWeight: 800 }} />
          </Stack>
        </Box>
        <TableContainer sx={{ overflowX: "auto" }}>
          <Table size="small" sx={{ minWidth: 980 }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 800 }}>Run Date</TableCell>
                <TableCell sx={{ fontWeight: 800 }}>Accounts Processed</TableCell>
                <TableCell sx={{ fontWeight: 800 }}>Accounts Updated</TableCell>
                <TableCell sx={{ fontWeight: 800 }}>Credits Used</TableCell>
                <TableCell sx={{ fontWeight: 800 }}>Success Rate</TableCell>
                <TableCell sx={{ fontWeight: 800 }}>Run Status</TableCell>
                <TableCell sx={{ fontWeight: 800 }}>Details</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {auditHistory.length ? (
                paginatedAuditHistory.map((run) => {
                  const isExpanded = expandedAuditRun === run.run_date;

                  return (
                    <React.Fragment key={run.run_date}>
                      <TableRow hover>
                        <TableCell>{run.run_date}</TableCell>
                        <TableCell>{run.accounts_processed}</TableCell>
                        <TableCell>{run.accounts_updated}</TableCell>
                        <TableCell>{run.credits_used}</TableCell>
                        <TableCell>{Number(run.success_rate || 0).toFixed(1)}%</TableCell>
                        <TableCell>
                          <Chip
                            color={getStatusColor(run.run_status)}
                            label={run.run_status || "Completed"}
                            size="small"
                            sx={{ fontWeight: 800 }}
                            variant="outlined"
                          />
                        </TableCell>
                        <TableCell>
                          <Button
                            disabled={!run.details?.length}
                            onClick={() => setExpandedAuditRun(isExpanded ? "" : run.run_date)}
                            size="small"
                            sx={{ borderRadius: 1, fontWeight: 800 }}
                            variant="outlined"
                          >
                            {isExpanded ? "Hide Details" : "View Details"}
                          </Button>
                        </TableCell>
                      </TableRow>
                      {isExpanded ? (
                        <TableRow>
                          <TableCell colSpan={7} sx={{ backgroundColor: "rgba(0, 51, 108, 0.03)", p: 0 }}>
                            <Table size="small">
                              <TableHead>
                                <TableRow>
                                  <TableCell sx={{ fontWeight: 800 }}>Account Name</TableCell>
                                  <TableCell sx={{ fontWeight: 800 }}>Field Updated</TableCell>
                                  <TableCell sx={{ fontWeight: 800 }}>Old Value</TableCell>
                                  <TableCell sx={{ fontWeight: 800 }}>New Value</TableCell>
                                  <TableCell sx={{ fontWeight: 800 }}>Result</TableCell>
                                  <TableCell sx={{ fontWeight: 800 }}>Timestamp</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {run.details.map((detail, index) => (
                                  <TableRow key={`${detail.account_name}-${detail.field_updated}-${detail.timestamp}-${index}`}>
                                    <TableCell>{detail.account_name || "Unknown Account"}</TableCell>
                                    <TableCell>{detail.field_updated || "Unknown Field"}</TableCell>
                                    <TableCell sx={{ overflowWrap: "anywhere" }}>{formatAuditValue(detail.old_value)}</TableCell>
                                    <TableCell sx={{ overflowWrap: "anywhere" }}>{formatAuditValue(detail.new_value)}</TableCell>
                                    <TableCell>
                                      <Chip
                                        color={getStatusColor(detail.result)}
                                        label={detail.result || "Updated"}
                                        size="small"
                                        sx={{ fontWeight: 800 }}
                                        variant="outlined"
                                      />
                                    </TableCell>
                                    <TableCell>{formatTimestamp(detail.timestamp)}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </React.Fragment>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={7} sx={{ py: 4, textAlign: "center" }}>
                    <Typography color="text.secondary">
                      No enrichment audit history has been recorded yet.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
        {auditHistory.length ? (
          <TablePagination
            sx={{ "& .MuiTablePagination-toolbar": { flexWrap: "wrap", justifyContent: "flex-end", px: 1 }, "& .MuiTablePagination-spacer": { display: { xs: "none", sm: "block" } } }}
            component="div"
            count={auditHistory.length}
            onPageChange={(event, nextPage) => setAuditPage(nextPage)}
            onRowsPerPageChange={(event) => {
              setAuditRowsPerPage(parseInt(event.target.value, 10));
              setAuditPage(0);
            }}
            page={auditPage}
            rowsPerPage={auditRowsPerPage}
            rowsPerPageOptions={[5, 10, 25]}
          />
        ) : null}
      </Paper>

      </Box>

      <Snackbar
        autoHideDuration={4000}
        onClose={() => setActionMessage("")}
        open={Boolean(actionMessage)}
      >
        <Alert onClose={() => setActionMessage("")} severity="success" sx={{ width: "100%" }}>
          {actionMessage}
        </Alert>
      </Snackbar>

      <Snackbar
        autoHideDuration={5000}
        onClose={() => setActionError("")}
        open={Boolean(actionError)}
      >
        <Alert onClose={() => setActionError("")} severity="error" sx={{ width: "100%" }}>
          {actionError}
        </Alert>
      </Snackbar>
    </Stack>
  );
}
