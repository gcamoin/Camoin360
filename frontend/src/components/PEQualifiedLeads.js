import { filterReportingRows, reportingParams } from "../reportingPeriod";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCached } from "../apiClient";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
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
import { subtleTableHeadCellSx } from "./UiPrimitives";

const API_URL = `${API_BASE_URL}/pe-qualified-leads`;

const tooltipStyle = {
  contentStyle: {
    borderRadius: 8,
    border: "1px solid #e2e8f0",
    fontSize: 12,
    boxShadow: "0 4px 6px -1px rgba(0,0,0,0.08)",
  },
};

const leadColumns = [
  { key: "prospect_name", label: "Prospect", width: 300 },
  { key: "client_name", label: "Client", width: 260 },
  { key: "status", label: "Status", width: 125 },
  { key: "createdon", label: "Created", width: 165 },
];
const leadTableMinWidth = leadColumns.reduce((width, column) => width + column.width, 0);

export function filterAndSortQualifiedLeads(leads, query, clientFilter, sortBy) {
  const search = query.trim().toLocaleLowerCase();
  return leads
    .filter((lead) => !clientFilter || lead.client_name === clientFilter)
    .filter((lead) => [lead.prospect_name, lead.client_name].some((value) =>
      String(value ?? "").toLocaleLowerCase().includes(search)
    ))
    .sort((first, second) => {
      if (sortBy === "oldest") {
        return String(first.createdon || "9999-12-31").localeCompare(String(second.createdon || "9999-12-31"));
      }
      if (sortBy === "client") {
        return String(first.client_name || "").localeCompare(String(second.client_name || ""))
          || String(first.prospect_name || "").localeCompare(String(second.prospect_name || ""));
      }
      if (sortBy === "prospect") {
        return String(first.prospect_name || "").localeCompare(String(second.prospect_name || ""));
      }
      return String(second.createdon || "0000-00-00").localeCompare(String(first.createdon || "0000-00-00"));
    });
}

function formatLeadDate(value) {
  if (!value) return "Not set";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString();
}

function escapeCsvValue(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export default function PEQualifiedLeads({ filters } = {}) {
  const isMountedRef = useRef(true);
  const latestRequestIdRef = useRef(0);
  const forceNextRequestRef = useRef(false);
  const [leads, setLeads] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [leadSearch, setLeadSearch] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [leadSort, setLeadSort] = useState("newest");
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [rollups, setRollups] = useState([]);
  const [yearlyRollups, setYearlyRollups] = useState([]);
  const [statusLabel, setStatusLabel] = useState("Qualified");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchLeads = useCallback(async () => {
    if (!isMountedRef.current) return;

    const requestId = ++latestRequestIdRef.current;
    setIsLoading(true);
    setError("");

    try {
      const params = reportingParams(filters);
      params.limit = 5000;

      const force = forceNextRequestRef.current;
      forceNextRequestRef.current = false;
      const response = await getCached(API_URL, {
        force,
        headers: getAuthHeaders(),
        params,
        timeout: 60000,
      });

      if (!isMountedRef.current || requestId !== latestRequestIdRef.current) return;

      setLeads(response.data?.data || []);
      setTotalCount(response.data?.total_count ?? response.data?.data?.length ?? 0);
      setRollups(response.data?.rollups || []);
      setYearlyRollups(filterReportingRows(response.data?.yearly_rollups, filters));
      setStatusLabel(response.data?.status || "Qualified");
    } catch (fetchError) {
      if (handleUnauthorized(fetchError)) {
        return;
      }

      if (!isMountedRef.current || requestId !== latestRequestIdRef.current) return;

      setError(getApiErrorMessage(fetchError, "Unable to load ProspectEngage qualified leads."));
      setLeads([]);
      setTotalCount(0);
      setRollups([]);
      setYearlyRollups([]);
    } finally {
      if (!isMountedRef.current || requestId !== latestRequestIdRef.current) return;

      setIsLoading(false);
    }
  }, [filters, refreshKey]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchLeads();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchLeads]);

  const periodLabel = Object.keys(reportingParams(filters)).length ? "the selected reporting period" : "all time";
  const leadsByClient = useMemo(() => {
    if (rollups.length) {
      return rollups;
    }

    const counts = new Map();

    for (const lead of leads) {
      const clientName = String(lead.client_name || "").trim();
      if (!clientName) {
        continue;
      }

      counts.set(clientName, (counts.get(clientName) || 0) + 1);
    }

    return Array.from(counts.entries())
      .map(([client_name, qualified_leads]) => ({ client_name, qualified_leads }))
      .sort((a, b) => b.qualified_leads - a.qualified_leads || a.client_name.localeCompare(b.client_name));
  }, [leads, rollups]);
  const chartHeight = Math.max(360, leadsByClient.length * 34 + 48);
  const clientOptions = useMemo(
    () => [...new Set(leads.map((lead) => lead.client_name).filter(Boolean))].sort((first, second) => first.localeCompare(second)),
    [leads]
  );
  const visibleLeads = useMemo(
    () => filterAndSortQualifiedLeads(leads, leadSearch, clientFilter, leadSort),
    [leads, leadSearch, clientFilter, leadSort]
  );
  const paginatedLeads = visibleLeads.slice(page * rowsPerPage, (page + 1) * rowsPerPage);

  useEffect(() => {
    if (clientFilter && !clientOptions.includes(clientFilter)) {
      setClientFilter("");
      setPage(0);
    }
  }, [clientFilter, clientOptions]);

  useEffect(() => {
    const lastPage = Math.max(0, Math.ceil(visibleLeads.length / rowsPerPage) - 1);
    if (page > lastPage) setPage(lastPage);
  }, [page, rowsPerPage, visibleLeads.length]);

  function exportVisibleLeads() {
    if (!visibleLeads.length) return;
    const rows = [
      leadColumns.map((column) => escapeCsvValue(column.label)).join(","),
      ...visibleLeads.map((lead) => leadColumns.map((column) => escapeCsvValue(lead[column.key])).join(",")),
    ];
    const downloadUrl = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = "pe-qualified-leads.csv";
    link.click();
    URL.revokeObjectURL(downloadUrl);
  }

  return (
    <Stack spacing={2.5}>
      {error ? <Alert severity="error">{error}</Alert> : null}

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "minmax(0, 1fr)", lg: "repeat(2, minmax(0, 1fr))" }, gap: 2.5 }}>
        <Paper
          elevation={0}
          sx={{
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 2,
            p: { xs: 2, md: 2.5 },
            backgroundColor: "common.white",
            minWidth: 0,
          }}
        >
          <Stack spacing={0.5} sx={{ mb: 2 }}>
            <Typography fontWeight={800} color="text.primary">
              ProspectEngage Qualified Leads
            </Typography>
            <Typography color="text.secondary" variant="body2">
              Prospects with the {statusLabel} dropdown option for {periodLabel}.
            </Typography>
          </Stack>

          {isLoading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
              <CircularProgress />
            </Box>
          ) : leadsByClient.length ? (
            <Box sx={{ height: 420, overflowY: "auto" }}>
            <Box sx={{ height: chartHeight, minWidth: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={leadsByClient} layout="vertical" margin={{ top: 12, right: 24, bottom: 12, left: 0 }}>
                  <CartesianGrid horizontal={false} stroke="#f1f5f9" strokeDasharray="3 3" />
                  <XAxis allowDecimals={false} tick={{ fontSize: 11 }} type="number" />
                  <YAxis
                    dataKey="client_name"
                    type="category"
                    interval={0}
                    width={170}
                    tick={{ fontSize: 11 }}
                    tickFormatter={(value) => (value.length > 25 ? `${value.slice(0, 25)}...` : value)}
                  />
                  <Tooltip
                    {...tooltipStyle}
                    formatter={(value) => [Number(value).toLocaleString(), "Qualified Leads"]}
                  />
                  <Bar
                    dataKey="qualified_leads"
                    fill="#073469"
                    fillOpacity={0.86}
                    maxBarSize={24}
                    name="Qualified Leads"
                    radius={[0, 3, 3, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </Box>
            </Box>
          ) : (
            <Typography color="text.secondary" variant="body2">
              No qualified leads match this period.
            </Typography>
          )}
        </Paper>
        <Paper
          elevation={0}
          sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: { xs: 2, md: 2.5 }, backgroundColor: "common.white", minWidth: 0 }}
        >
          <Stack spacing={0.5} sx={{ mb: 2 }}>
            <Typography fontWeight={800} color="text.primary">
              PE Leads: Year to Year
            </Typography>
            <Typography color="text.secondary" variant="body2">
              ProspectEngage qualified leads by creation year. Current year is year to date.
            </Typography>
          </Stack>
          {isLoading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
              <CircularProgress />
            </Box>
          ) : yearlyRollups.length ? (
            <Box sx={{ height: 420, minWidth: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={yearlyRollups} margin={{ top: 12, right: 24, bottom: 12, left: 0 }}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                  <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} domain={[0, "auto"]} tick={{ fontSize: 11 }} />
                  <Tooltip {...tooltipStyle} formatter={(value) => [Number(value).toLocaleString(), "Qualified Leads"]} />
                  <Line type="linear" dataKey="qualified_leads" name="Qualified Leads" stroke="#073469" strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </Box>
          ) : (
            <Typography color="text.secondary" variant="body2">
              No qualified leads with creation dates are available.
            </Typography>
          )}
        </Paper>
      </Box>
      <Paper
        elevation={0}
        sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, minWidth: 0, overflow: "hidden" }}
      >
        <Stack
          alignItems={{ xs: "stretch", md: "center" }}
          direction={{ xs: "column", md: "row" }}
          justifyContent="space-between"
          spacing={1.5}
          sx={{ px: { xs: 2, md: 3 }, py: 2.5 }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography color="primary.main" fontWeight={800} variant="h6">
              Qualified Lead Details
            </Typography>
            <Typography color="text.secondary" variant="body2">
              Prospects marked {statusLabel} for {periodLabel}.
            </Typography>
          </Box>
          <Stack alignItems={{ xs: "stretch", sm: "center" }} direction={{ xs: "column", sm: "row" }} spacing={1}>
            <Chip label={`${leads.length.toLocaleString()} loaded`} sx={{ fontWeight: 700 }} />
            <Button disabled={isLoading} onClick={() => { forceNextRequestRef.current = true; setRefreshKey((key) => key + 1); }} variant="outlined">
              Refresh leads
            </Button>
            <Button disabled={!visibleLeads.length || isLoading} onClick={exportVisibleLeads} variant="outlined">
              Export filtered CSV
            </Button>
          </Stack>
        </Stack>
        <Typography color="text.secondary" sx={{ px: { xs: 2, md: 3 }, pb: 1 }} variant="caption">
          Results are cached for up to 5 minutes. Refresh leads to check for newer data.
        </Typography>
        <Box
          sx={{
            borderBottom: "1px solid",
            borderColor: "divider",
            display: "grid",
            gap: 1.5,
            gridTemplateColumns: { xs: "1fr", md: "minmax(220px, 1fr) minmax(180px, 240px) minmax(180px, 240px)" },
            px: { xs: 2, md: 3 },
            py: 2,
          }}
        >
          <TextField
            label="Search leads"
            onChange={(event) => { setLeadSearch(event.target.value); setPage(0); }}
            placeholder="Prospect or client name"
            size="small"
            value={leadSearch}
          />
          <FormControl size="small">
            <InputLabel id="pe-lead-client-filter-label">Client</InputLabel>
            <Select
              label="Client"
              labelId="pe-lead-client-filter-label"
              onChange={(event) => { setClientFilter(event.target.value); setPage(0); }}
              value={clientFilter}
            >
              <MenuItem value="">All clients</MenuItem>
              {clientOptions.map((client) => <MenuItem key={client} value={client}>{client}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small">
            <InputLabel id="pe-lead-sort-label">Sort leads</InputLabel>
            <Select
              label="Sort leads"
              labelId="pe-lead-sort-label"
              onChange={(event) => { setLeadSort(event.target.value); setPage(0); }}
              value={leadSort}
            >
              <MenuItem value="newest">Newest first</MenuItem>
              <MenuItem value="oldest">Oldest first</MenuItem>
              <MenuItem value="client">Client (A–Z)</MenuItem>
              <MenuItem value="prospect">Prospect (A–Z)</MenuItem>
            </Select>
          </FormControl>
        </Box>
        {totalCount > leads.length && !isLoading ? (
          <Alert severity="info" sx={{ borderRadius: 0 }}>
            Showing the first {leads.length.toLocaleString()} of {totalCount.toLocaleString()} leads. Search and sort apply to the loaded records.
          </Alert>
        ) : null}
        <Typography color="text.secondary" sx={{ display: { xs: "none", md: "block", lg: "none" }, px: 2, pt: 1.5 }} variant="caption">
          Scroll horizontally to see all lead details.
        </Typography>
        <Stack spacing={1.5} sx={{ display: { xs: "flex", md: "none" }, px: 2, py: 2 }}>
          {isLoading && <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}><CircularProgress size={28} /></Box>}
          {paginatedLeads.map((lead) => (
            <Paper elevation={0} key={lead.id || `${lead.prospect_name}-${lead.createdon}`} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: 2 }}>
              <Stack spacing={0.75}>
                <Typography fontWeight={800} sx={{ overflowWrap: "anywhere" }}>{lead.prospect_name || "Missing prospect"}</Typography>
                <Typography variant="body2"><strong>Client:</strong> {lead.client_name || "Missing"}</Typography>
                <Typography variant="body2"><strong>Status:</strong> {lead.status || statusLabel}</Typography>
                <Typography variant="body2"><strong>Created:</strong> {formatLeadDate(lead.createdon)}</Typography>
              </Stack>
            </Paper>
          ))}
          {!isLoading && !paginatedLeads.length && <Typography color="text.secondary">{leads.length ? "No leads match these filters." : "No qualified leads match this period."}</Typography>}
        </Stack>
        <TableContainer sx={{ display: { xs: "none", md: "block" }, overflowX: "auto" }}>
          <Table size="small" sx={{ minWidth: leadTableMinWidth, tableLayout: "fixed" }}>
            <TableHead>
              <TableRow>
                {leadColumns.map((column) => (
                  <TableCell key={column.key} sx={{ ...subtleTableHeadCellSx, px: 2, width: column.width }}>
                    {column.label}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell align="center" colSpan={leadColumns.length} sx={{ py: 6 }}><CircularProgress size={28} /></TableCell></TableRow>
              ) : paginatedLeads.length ? (
                paginatedLeads.map((lead) => (
                  <TableRow hover key={lead.id || `${lead.prospect_name}-${lead.createdon}`} sx={{ "& td": { px: 2, py: 1.5, verticalAlign: "middle" } }}>
                    <TableCell sx={{ fontWeight: 700, overflowWrap: "anywhere" }}>{lead.prospect_name || "Missing"}</TableCell>
                    <TableCell sx={{ overflowWrap: "anywhere" }}>{lead.client_name || "Missing"}</TableCell>
                    <TableCell>{lead.status || statusLabel}</TableCell>
                    <TableCell>{formatLeadDate(lead.createdon)}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell align="center" colSpan={leadColumns.length} sx={{ color: "text.secondary", py: 6 }}>
                    {leads.length ? "No leads match these filters." : "No qualified leads match this period."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          component="div"
          count={visibleLeads.length}
          onPageChange={(_event, nextPage) => setPage(nextPage)}
          onRowsPerPageChange={(event) => { setRowsPerPage(Number(event.target.value)); setPage(0); }}
          page={page}
          rowsPerPage={rowsPerPage}
          rowsPerPageOptions={[10, 25, 50, 100]}
          sx={{ "& .MuiTablePagination-toolbar": { flexWrap: "wrap", justifyContent: "flex-end", py: 1, rowGap: 1 } }}
        />
      </Paper>
    </Stack>
  );
}
