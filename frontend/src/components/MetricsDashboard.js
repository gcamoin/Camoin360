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
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
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
import {
  Area,
  AreaChart,
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

import { API_BASE_URL, getAuthHeaders, handleUnauthorized } from "../auth";

const API_URL = `${API_BASE_URL}/metrics`;
const ENRICH_ALL_URL = `${API_BASE_URL}/accounts/enrich-all`;

const valueSx = {
  fontSize: { xs: "2rem", md: "2.4rem" },
  fontWeight: 700,
  lineHeight: 1.1,
  mt: 1,
};

function MetricCard({ title, value, subtitle, children }) {
  const theme = useTheme();

  return (
    <Card
      sx={{
        width: "100%",
        display: "flex",
        borderRadius: 3,
        boxShadow: "0 10px 30px rgba(0, 51, 108, 0.08)",
        height: "100%",
        minHeight: 220,
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
        {children}
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

function getStatusProgressColor(status) {
  const normalizedStatus = String(status || "").toLowerCase();

  if (normalizedStatus === "updated") {
    return "success.main";
  }

  if (normalizedStatus === "failed") {
    return "error.main";
  }

  if (normalizedStatus === "pending") {
    return "info.main";
  }

  if (["skipped", "no match found"].includes(normalizedStatus)) {
    return "warning.main";
  }

  return "text.secondary";
}

function getAlertColor(severity) {
  const normalizedSeverity = String(severity || "").toLowerCase();

  if (normalizedSeverity === "critical") {
    return "error";
  }

  if (normalizedSeverity === "warning") {
    return "warning";
  }

  if (normalizedSeverity === "info") {
    return "info";
  }

  return "default";
}

function TrendChartCard({ children, subtitle, title }) {
  return (
    <Box
      sx={{
        border: "1px solid rgba(0, 51, 108, 0.10)",
        borderRadius: 1,
        p: 2,
        minHeight: 280,
      }}
    >
      <Stack spacing={1.5} sx={{ height: "100%" }}>
        <Box>
          <Typography color="primary.main" sx={{ fontWeight: 800 }} variant="body1">
            {title}
          </Typography>
          <Typography color="text.secondary" variant="body2">
            {subtitle}
          </Typography>
        </Box>
        <Box sx={{ flex: 1, minHeight: 190 }}>
          {children}
        </Box>
      </Stack>
    </Box>
  );
}

function EmptySection({ message, minHeight = 160 }) {
  return (
    <Box
      sx={{
        alignItems: "center",
        display: "flex",
        justifyContent: "center",
        minHeight,
        px: 2,
        py: 3,
        textAlign: "center",
      }}
    >
      <Typography color="text.secondary">{message}</Typography>
    </Box>
  );
}

function hasChartData(data) {
  return Array.isArray(data) && data.length > 0;
}

export default function MetricsDashboard() {
  const theme = useTheme();
  const [metrics, setMetrics] = useState({
    credits_used: 0,
    weekly_limit: 2000,
    remaining_credits: 2000,
    usage_percent: 0,
    accounts_processed: 0,
    accounts_updated: 0,
    alert_center: [],
    audit_history: [],
    data_quality_pipeline: [],
    outcome_breakdown: [],
    field_impact: [],
    recent_activity: [],
    trend_tracking: {},
  });
  const [expandedAuditRun, setExpandedAuditRun] = useState("");
  const [isRunningEnrichment, setIsRunningEnrichment] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionInfo, setActionInfo] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [selectedPipelineCategory, setSelectedPipelineCategory] = useState(null);
  const [isLoadingMetrics, setIsLoadingMetrics] = useState(true);
  const [hasLoadedMetrics, setHasLoadedMetrics] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [auditPage, setAuditPage] = useState(0);
  const [auditRowsPerPage, setAuditRowsPerPage] = useState(5);
  const [recentPage, setRecentPage] = useState(0);
  const [recentRowsPerPage, setRecentRowsPerPage] = useState(10);
  const alerts = metrics.alert_center || [];
  const auditHistory = metrics.audit_history || [];
  const dataQualityPipeline = metrics.data_quality_pipeline || [];
  const outcomeBreakdown = metrics.outcome_breakdown || [];
  const fieldImpact = metrics.field_impact || [];
  const recentActivity = metrics.recent_activity || [];
  const selectedPipelineRecords = selectedPipelineCategory?.records || [];
  const trends = metrics.trend_tracking || {};
  const paginatedAuditHistory = auditHistory.slice(
    auditPage * auditRowsPerPage,
    auditPage * auditRowsPerPage + auditRowsPerPage
  );
  const paginatedRecentActivity = recentActivity.slice(
    recentPage * recentRowsPerPage,
    recentPage * recentRowsPerPage + recentRowsPerPage
  );

  const loadMetrics = useCallback(async (showLoading = false) => {
    if (showLoading) {
      setIsLoadingMetrics(true);
    }

    try {
      const response = await axios.get(API_URL, { headers: getAuthHeaders() });
      setMetrics(response.data);
      setHasLoadedMetrics(true);
      setLoadError("");
      return response.data;
    } catch (error) {
      if (handleUnauthorized(error)) {
        return null;
      }

      console.error("Failed to fetch metrics", error);
      setLoadError("Unable to load enrichment dashboard metrics.");
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

  function exportFieldImpactCsv() {
    downloadCsv(
      `field-impact-analytics-${getExportDateStamp()}.csv`,
      ["Field", "Total Updates", "Percentage of Total Updates"],
      fieldImpact.map((field) => ({
        "Field": field.field,
        "Total Updates": field.total_updates,
        "Percentage of Total Updates": `${Number(field.percentage || 0).toFixed(1)}%`,
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
    await loadMetrics();
  }

  async function runEnrichment() {
    setIsRunningEnrichment(true);
    setActionError("");
    setActionInfo("");
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

  function previewNextBatch() {
    // TODO: Replace this placeholder with a backend endpoint that returns the next enrichment batch preview.
    setActionError("");
    setActionInfo("Preview Next Batch is not connected yet.");
  }

  function viewPipelineCategory(category) {
    const pipelineCategory = dataQualityPipeline.find((item) => item.category === category);

    if (pipelineCategory) {
      setSelectedPipelineCategory(pipelineCategory);
    }
  }

  useEffect(() => {
    let isMounted = true;

    const fetchMetrics = async (showLoading = false) => {
      if (isMounted) {
        await loadMetrics(showLoading);
      }
    };

    fetchMetrics(true);
    const intervalId = setInterval(() => fetchMetrics(false), 10000);

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
        <Typography color="text.secondary">Loading enrichment dashboard metrics...</Typography>
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
            onClick={() => loadMetrics(true)}
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
    <Stack spacing={3}>
      {loadError ? (
        <Alert
          action={
            <Button color="inherit" onClick={() => loadMetrics()} size="small">
              Retry
            </Button>
          }
          severity="warning"
        >
          {loadError}
        </Alert>
      ) : null}

      <Box
        sx={{
          display: "grid",
          gap: 3,
          gridTemplateColumns: {
            xs: "1fr",
            sm: "repeat(2, minmax(0, 1fr))",
            lg: "repeat(5, minmax(0, 1fr))",
          },
          alignItems: "stretch",
        }}
      >
        <Box sx={{ display: "flex" }}>
          <MetricCard
            title="Credits Used"
            value={metrics.credits_used}
            subtitle={`Weekly limit: ${metrics.weekly_limit}`}
          />
        </Box>
        <Box sx={{ display: "flex" }}>
          <MetricCard
            title="Remaining Credits"
            value={metrics.remaining_credits}
            subtitle="Available before weekly reset"
          />
        </Box>
        <Box sx={{ display: "flex" }}>
          <MetricCard
            title="Usage %"
            value={`${Number(metrics.usage_percent || 0).toFixed(1)}%`}
            subtitle="Weekly credit consumption"
          >
            <LinearProgress
              sx={{
                height: 10,
                borderRadius: 999,
                mt: 2,
                backgroundColor: `${theme.palette.primary.main}22`,
                "& .MuiLinearProgress-bar": {
                  backgroundColor: theme.palette.secondary.main,
                },
              }}
              value={Math.min(metrics.usage_percent || 0, 100)}
              variant="determinate"
            />
          </MetricCard>
        </Box>
        <Box sx={{ display: "flex" }}>
          <MetricCard
            title="Accounts Processed"
            value={metrics.accounts_processed}
            subtitle="Every enrichment attempt counted"
          />
        </Box>
        <Box sx={{ display: "flex" }}>
          <MetricCard
            title="Accounts Updated"
            value={metrics.accounts_updated}
            subtitle="Dynamics records changed successfully"
          />
        </Box>
      </Box>

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
              Action Center
            </Typography>
            <Typography color="text.secondary" variant="body2">
              Common enrichment actions and account review shortcuts.
            </Typography>
          </Box>
          <Chip label="4 actions" sx={{ fontWeight: 800 }} />
        </Box>
        <Box
          sx={{
            display: "grid",
            gap: 1.5,
            gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", lg: "repeat(4, minmax(0, 1fr))" },
            p: { xs: 2, md: 3 },
          }}
        >
          <Button
            disabled={isRunningEnrichment}
            onClick={runEnrichment}
            sx={{ borderRadius: 1, fontWeight: 800, minHeight: 44 }}
            variant="contained"
          >
            {isRunningEnrichment ? "Running..." : "Run Enrichment"}
          </Button>
          <Button
            onClick={previewNextBatch}
            sx={{ borderRadius: 1, fontWeight: 800, minHeight: 44 }}
            variant="outlined"
          >
            Preview Next Batch
          </Button>
          <Button
            disabled={!dataQualityPipeline.find((item) => item.category === "Ready for Enrichment")?.records?.length}
            onClick={() => viewPipelineCategory("Ready for Enrichment")}
            sx={{ borderRadius: 1, fontWeight: 800, minHeight: 44 }}
            variant="outlined"
          >
            View Accounts Ready
          </Button>
          <Button
            disabled={!dataQualityPipeline.find((item) => item.category === "Requires Manual Review")?.records?.length}
            onClick={() => viewPipelineCategory("Requires Manual Review")}
            sx={{ borderRadius: 1, fontWeight: 800, minHeight: 44 }}
            variant="outlined"
          >
            View Manual Review
          </Button>
        </Box>
      </Paper>

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
              Alert Center
            </Typography>
            <Typography color="text.secondary" variant="body2">
              Operational risks and recommended actions.
            </Typography>
          </Box>
          <Chip
            color={alerts.length ? "warning" : "success"}
            label={alerts.length ? `${alerts.length} active` : "No active alerts"}
            sx={{ fontWeight: 800 }}
            variant="outlined"
          />
        </Box>
        {alerts.length ? (
          <Box
            sx={{
              display: "grid",
              gap: 2,
              gridTemplateColumns: { xs: "1fr", lg: "repeat(2, minmax(0, 1fr))" },
              p: { xs: 2, md: 3 },
            }}
          >
            {alerts.map((alert, index) => (
              <Box
                key={`${alert.severity}-${index}`}
                sx={{
                  border: "1px solid rgba(0, 51, 108, 0.10)",
                  borderRadius: 1,
                  p: 2,
                }}
              >
                <Stack spacing={1.25}>
                  <Stack alignItems="center" direction="row" justifyContent="space-between" spacing={1}>
                    <Typography color="primary.main" sx={{ fontWeight: 800 }} variant="body1">
                      {alert.description}
                    </Typography>
                    <Chip
                      color={getAlertColor(alert.severity)}
                      label={alert.severity || "info"}
                      size="small"
                      sx={{ fontWeight: 800, textTransform: "capitalize" }}
                      variant="outlined"
                    />
                  </Stack>
                  <Typography color="text.secondary" variant="body2">
                    {alert.recommended_action}
                  </Typography>
                </Stack>
              </Box>
            ))}
          </Box>
        ) : (
          <Box sx={{ px: { xs: 2, md: 3 }, py: 4, textAlign: "center" }}>
            <Typography color="text.secondary">
              No active enrichment alerts. Usage and recent outcomes are within expected ranges.
            </Typography>
          </Box>
        )}
      </Paper>

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
              Trend Tracking
            </Typography>
            <Typography color="text.secondary" variant="body2">
              Usage patterns and enrichment performance over time.
            </Typography>
          </Box>
          <Chip label="5 trends" sx={{ fontWeight: 800 }} />
        </Box>
        <Box
          sx={{
            display: "grid",
            gap: 2,
            gridTemplateColumns: { xs: "1fr", lg: "repeat(2, minmax(0, 1fr))" },
            p: { xs: 2, md: 3 },
          }}
        >
          <TrendChartCard subtitle="Credits consumed by day" title="Daily Credits Used">
            {hasChartData(trends.daily_credits_used) ? (
              <ResponsiveContainer height="100%" width="100%">
                <AreaChart data={trends.daily_credits_used}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Area dataKey="credits_used" fill={theme.palette.secondary.main} fillOpacity={0.24} stroke={theme.palette.secondary.main} strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptySection message="No daily credit usage has been recorded yet." minHeight={190} />
            )}
          </TrendChartCard>

          <TrendChartCard subtitle="Credits consumed by ISO week" title="Weekly Credits Used">
            {hasChartData(trends.weekly_credits_used) ? (
              <ResponsiveContainer height="100%" width="100%">
                <BarChart data={trends.weekly_credits_used}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="credits_used" fill={theme.palette.primary.main} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptySection message="No weekly credit usage has been recorded yet." minHeight={190} />
            )}
          </TrendChartCard>

          <TrendChartCard subtitle="Enrichment attempts by day" title="Accounts Processed Per Day">
            {hasChartData(trends.accounts_processed_per_day) ? (
              <ResponsiveContainer height="100%" width="100%">
                <LineChart data={trends.accounts_processed_per_day}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Line dataKey="accounts_processed" dot={{ r: 3 }} stroke={theme.palette.primary.main} strokeWidth={2} type="monotone" />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <EmptySection message="No account processing trend data has been recorded yet." minHeight={190} />
            )}
          </TrendChartCard>

          <TrendChartCard subtitle="Dynamics records changed by day" title="Accounts Updated Per Day">
            {hasChartData(trends.accounts_updated_per_day) ? (
              <ResponsiveContainer height="100%" width="100%">
                <LineChart data={trends.accounts_updated_per_day}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Line dataKey="accounts_updated" dot={{ r: 3 }} stroke={theme.palette.secondary.main} strokeWidth={2} type="monotone" />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <EmptySection message="No account update trend data has been recorded yet." minHeight={190} />
            )}
          </TrendChartCard>

          <Box sx={{ gridColumn: { xs: "auto", lg: "1 / -1" } }}>
            <TrendChartCard subtitle="Updated accounts divided by processed accounts" title="Success Rate Over Time">
              {hasChartData(trends.success_rate_over_time) ? (
                <ResponsiveContainer height="100%" width="100%">
                  <AreaChart data={trends.success_rate_over_time}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(value) => [`${Number(value || 0).toFixed(1)}%`, "Success Rate"]} />
                    <Area dataKey="success_rate" fill={theme.palette.success.main} fillOpacity={0.18} stroke={theme.palette.success.main} strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <EmptySection message="No success rate trend data has been recorded yet." minHeight={190} />
              )}
            </TrendChartCard>
          </Box>
        </Box>
      </Paper>

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
              Data Quality Pipeline
            </Typography>
            <Typography color="text.secondary" variant="body2">
              Account readiness for Seamless enrichment.
            </Typography>
          </Box>
          <Chip
            label={`${dataQualityPipeline.reduce((total, item) => total + Number(item.count || 0), 0)} accounts`}
            sx={{ fontWeight: 800 }}
          />
        </Box>
        <Box
          sx={{
            display: "grid",
            gap: 2,
            gridTemplateColumns: {
              xs: "1fr",
              sm: "repeat(2, minmax(0, 1fr))",
              lg: "repeat(3, minmax(0, 1fr))",
            },
            p: { xs: 2, md: 3 },
          }}
        >
          {dataQualityPipeline.length ? (
            dataQualityPipeline.map((pipelineItem) => (
              <Box
                key={pipelineItem.category}
                sx={{
                  border: "1px solid rgba(0, 51, 108, 0.10)",
                  borderRadius: 1,
                  p: 2,
                }}
              >
                <Stack spacing={1.5}>
                  <Stack alignItems="flex-start" direction="row" justifyContent="space-between" spacing={1}>
                    <Typography color="text.secondary" sx={{ fontWeight: 800 }} variant="body2">
                      {pipelineItem.category}
                    </Typography>
                    <Chip label={pipelineItem.count} size="small" sx={{ fontWeight: 800 }} variant="outlined" />
                  </Stack>
                  <Typography color="primary.main" sx={{ fontSize: "1.7rem", fontWeight: 800, lineHeight: 1 }}>
                    {Number(pipelineItem.percentage || 0).toFixed(1)}%
                  </Typography>
                  <LinearProgress
                    sx={{
                      backgroundColor: `${theme.palette.primary.main}18`,
                      borderRadius: 999,
                      height: 8,
                      "& .MuiLinearProgress-bar": {
                        backgroundColor: theme.palette.secondary.main,
                      },
                    }}
                    value={Math.min(Number(pipelineItem.percentage || 0), 100)}
                    variant="determinate"
                  />
                  <Button
                    disabled={!pipelineItem.records?.length}
                    onClick={() => setSelectedPipelineCategory(pipelineItem)}
                    size="small"
                    sx={{ alignSelf: "flex-start", borderRadius: 1, fontWeight: 800 }}
                    variant="outlined"
                  >
                    View Records
                  </Button>
                </Stack>
              </Box>
            ))
          ) : (
            <Box sx={{ gridColumn: "1 / -1" }}>
              <EmptySection message="No account readiness data is available yet." />
            </Box>
          )}
        </Box>
      </Paper>

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
              Enrichment Outcome Breakdown
            </Typography>
            <Typography color="text.secondary" variant="body2">
              Result mix for recent Seamless enrichment activity.
            </Typography>
          </Box>
          <Chip
            label={`${outcomeBreakdown.reduce((total, outcome) => total + Number(outcome.count || 0), 0)} outcomes`}
            sx={{ fontWeight: 800 }}
          />
        </Box>
        <Box
          sx={{
            display: "grid",
            gap: 2,
            gridTemplateColumns: {
              xs: "1fr",
              sm: "repeat(2, minmax(0, 1fr))",
              lg: "repeat(5, minmax(0, 1fr))",
            },
            p: { xs: 2, md: 3 },
          }}
        >
          {outcomeBreakdown.length ? (
            outcomeBreakdown.map((outcome) => {
              const progressColor = getStatusProgressColor(outcome.result_status);

              return (
                <Box
                  key={outcome.result_status}
                  sx={{
                    border: "1px solid rgba(0, 51, 108, 0.10)",
                    borderRadius: 1,
                    p: 2,
                  }}
                >
                  <Stack spacing={1.25}>
                    <Stack alignItems="center" direction="row" justifyContent="space-between" spacing={1}>
                      <Typography color="text.secondary" sx={{ fontWeight: 800 }} variant="body2">
                        {outcome.result_status}
                      </Typography>
                      <Chip
                        color={getStatusColor(outcome.result_status)}
                        label={outcome.count}
                        size="small"
                        sx={{ fontWeight: 800 }}
                        variant="outlined"
                      />
                    </Stack>
                    <Typography color="primary.main" sx={{ fontSize: "1.65rem", fontWeight: 800, lineHeight: 1 }}>
                      {Number(outcome.percentage || 0).toFixed(1)}%
                    </Typography>
                    <LinearProgress
                      sx={{
                        backgroundColor: `${theme.palette.primary.main}18`,
                        borderRadius: 999,
                        height: 8,
                        "& .MuiLinearProgress-bar": {
                          backgroundColor: progressColor,
                        },
                      }}
                      value={Math.min(Number(outcome.percentage || 0), 100)}
                      variant="determinate"
                    />
                  </Stack>
                </Box>
              );
            })
          ) : (
            <Box sx={{ gridColumn: "1 / -1" }}>
              <EmptySection message="No enrichment outcome data is available yet." />
            </Box>
          )}
        </Box>
      </Paper>

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
              Field Impact Analytics
            </Typography>
            <Typography color="text.secondary" variant="body2">
              Fields most frequently improved by Seamless enrichment.
            </Typography>
          </Box>
          <Stack
            alignItems={{ xs: "stretch", sm: "center" }}
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            sx={{ width: { xs: "100%", sm: "auto" } }}
          >
            <Button
              disabled={!fieldImpact.length}
              onClick={exportFieldImpactCsv}
              size="small"
              sx={{ borderRadius: 1, fontWeight: 800 }}
              variant="outlined"
            >
              Export CSV
            </Button>
            <Chip
              label={`${fieldImpact.reduce((total, field) => total + Number(field.total_updates || 0), 0)} updates`}
              sx={{ fontWeight: 800 }}
            />
          </Stack>
        </Box>
        <Box sx={{ p: { xs: 2, md: 3 } }}>
          {fieldImpact.length ? (
            <Stack spacing={2}>
              {fieldImpact.map((field) => (
                <Box
                  key={field.field}
                  sx={{
                    display: "grid",
                    gap: 1.5,
                    gridTemplateColumns: { xs: "1fr", sm: "180px minmax(0, 1fr) 120px" },
                    alignItems: "center",
                  }}
                >
                  <Typography color="text.secondary" sx={{ fontWeight: 800 }} variant="body2">
                    {field.field}
                  </Typography>
                  <LinearProgress
                    sx={{
                      backgroundColor: `${theme.palette.primary.main}18`,
                      borderRadius: 999,
                      height: 10,
                      "& .MuiLinearProgress-bar": {
                        backgroundColor: theme.palette.secondary.main,
                      },
                    }}
                    value={Math.min(Number(field.percentage || 0), 100)}
                    variant="determinate"
                  />
                  <Stack alignItems={{ xs: "flex-start", sm: "flex-end" }} spacing={0.25}>
                    <Typography color="primary.main" sx={{ fontWeight: 800 }} variant="body2">
                      {field.total_updates} update{Number(field.total_updates || 0) === 1 ? "" : "s"}
                    </Typography>
                    <Typography color="text.secondary" variant="caption">
                      {Number(field.percentage || 0).toFixed(1)}%
                    </Typography>
                  </Stack>
                </Box>
              ))}
            </Stack>
          ) : (
            <EmptySection message="No field impact data is available yet." />
          )}
        </Box>
      </Paper>

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
            <Chip label={`${recentActivity.length} recent`} sx={{ fontWeight: 800 }} />
          </Stack>
        </Box>
        <TableContainer sx={{ overflowX: "auto" }}>
          <Table size="small" sx={{ minWidth: 880 }}>
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

      <Dialog
        fullWidth
        maxWidth="md"
        onClose={() => setSelectedPipelineCategory(null)}
        open={Boolean(selectedPipelineCategory)}
      >
        <DialogTitle sx={{ fontWeight: 800 }}>
          {selectedPipelineCategory?.category || "Pipeline Records"}
        </DialogTitle>
        <DialogContent dividers>
          <TableContainer sx={{ overflowX: "auto" }}>
            <Table size="small" sx={{ minWidth: 720 }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 800 }}>Account Name</TableCell>
                  <TableCell sx={{ fontWeight: 800 }}>Website</TableCell>
                  <TableCell sx={{ fontWeight: 800 }}>Location</TableCell>
                  <TableCell sx={{ fontWeight: 800 }}>Missing Fields</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {selectedPipelineRecords.map((record, index) => (
                  <TableRow key={record.account_id || `${record.account_name}-${index}`} hover>
                    <TableCell>{record.account_name || "Missing"}</TableCell>
                    <TableCell sx={{ overflowWrap: "anywhere" }}>{record.website || "Missing"}</TableCell>
                    <TableCell>{record.location || "Missing"}</TableCell>
                    <TableCell sx={{ overflowWrap: "anywhere" }}>
                      {record.missing_fields?.length ? record.missing_fields.join(", ") : "None"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelectedPipelineCategory(null)} sx={{ fontWeight: 800 }}>
            Close
          </Button>
        </DialogActions>
      </Dialog>

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
        onClose={() => setActionInfo("")}
        open={Boolean(actionInfo)}
      >
        <Alert onClose={() => setActionInfo("")} severity="info" sx={{ width: "100%" }}>
          {actionInfo}
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
