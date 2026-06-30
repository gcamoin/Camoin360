import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { API_BASE_URL, getApiErrorMessage, getAuthHeaders, handleUnauthorized } from "../auth";
import { subtleTableHeadCellSx } from "./UiPrimitives";

const API_URL = `${API_BASE_URL}/marketing-lists/conversion-analysis/summary`;
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const DEFAULT_YEARS = ["2025", "2026"];
const MATCH_MODES = [
  { label: "Same-year", value: "same_year" },
  { label: "Any-time", value: "any_time" },
  { label: "On/after list creation", value: "on_after_list_creation" },
];

function formatPercent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function formatCompaniesPerProspect(value) {
  if (value === null || value === undefined) {
    return "No prospects";
  }

  return Number(value).toFixed(1);
}

function formatDate(value) {
  if (!value) {
    return "Missing";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function KpiCard({ label, value, helper }) {
  return (
    <Paper
      elevation={0}
      sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: 2.5 }}
    >
      <Typography color="text.secondary" variant="overline">
        {label}
      </Typography>
      <Typography color="primary.main" sx={{ fontSize: "2.1rem", fontWeight: 800, lineHeight: 1.1, mt: 0.75 }}>
        {value}
      </Typography>
      <Typography color="text.secondary" sx={{ mt: 0.75 }} variant="body2">
        {helper}
      </Typography>
    </Paper>
  );
}

export default function MarketingListConversionAnalysis() {
  const isMountedRef = useRef(true);
  const [analysis, setAnalysis] = useState({
    campaign_type_rollups: [],
    client_rollups: [],
    companies_per_prospect: null,
    company_count: 0,
    conversion_rate: 0,
    excluded_company_count: 0,
    excluded_list_count: 0,
    exclusion_rollups: [],
    list_count: 0,
    lists: [],
    methodology: {},
    match_mode: "same_year",
    pe_clients: [],
    prospect_count: 0,
    trade_show_rollups: [],
    updated_at: "",
    year_bucket_rollups: [],
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [isMethodologyOpen, setIsMethodologyOpen] = useState(false);
  const [matchMode, setMatchMode] = useState("same_year");
  const [yearsInput, setYearsInput] = useState(DEFAULT_YEARS.join(", "));
  const [peClientOverrides, setPeClientOverrides] = useState("");
  const [bucketOverrides, setBucketOverrides] = useState("");
  const [tradeShowTerms, setTradeShowTerms] = useState("");
  const [exclusionKeywords, setExclusionKeywords] = useState("");
  const [sizeThreshold, setSizeThreshold] = useState("1500");

  const selectedYears = useMemo(
    () =>
      yearsInput
        .split(",")
        .map((year) => year.trim())
        .filter(Boolean),
    [yearsInput]
  );

  const overridePeClients = useMemo(
    () =>
      peClientOverrides
        .split(",")
        .map((clientName) => clientName.trim())
        .filter(Boolean),
    [peClientOverrides]
  );
  const parsedBucketOverrides = useMemo(
    () =>
      bucketOverrides
        .split(",")
        .map((override) => override.trim())
        .filter(Boolean),
    [bucketOverrides]
  );
  const parsedTradeShowTerms = useMemo(
    () =>
      tradeShowTerms
        .split(",")
        .map((term) => term.trim())
        .filter(Boolean),
    [tradeShowTerms]
  );
  const parsedExclusionKeywords = useMemo(
    () =>
      exclusionKeywords
        .split(",")
        .map((term) => term.trim())
        .filter(Boolean),
    [exclusionKeywords]
  );

  const fetchAnalysis = useCallback(async ({ silent = false } = {}) => {
    if (!isMountedRef.current) return;

    if (silent) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError("");

    try {
      const response = await axios.get(API_URL, {
        headers: getAuthHeaders(),
        params: {
          limit: 100,
          years: selectedYears.length ? selectedYears : DEFAULT_YEARS,
          match_mode: matchMode,
          pe_clients: overridePeClients,
          bucket_overrides: parsedBucketOverrides,
          trade_show_terms: parsedTradeShowTerms,
          exclusion_keywords: parsedExclusionKeywords,
          size_threshold: Number(sizeThreshold) || 1500,
        },
        paramsSerializer: { indexes: null },
        timeout: 90 * 1000,
      });

      if (!isMountedRef.current) return;

      setAnalysis({
        campaign_type_rollups: response.data?.campaign_type_rollups || [],
        client_rollups: response.data?.client_rollups || [],
        companies_per_prospect: response.data?.companies_per_prospect ?? null,
        company_count: response.data?.company_count || 0,
        conversion_rate: response.data?.conversion_rate || 0,
        excluded_company_count: response.data?.excluded_company_count || 0,
        excluded_list_count: response.data?.excluded_list_count || 0,
        exclusion_rollups: response.data?.exclusion_rollups || [],
        list_count: response.data?.list_count || 0,
        lists: response.data?.lists || [],
        methodology: response.data?.methodology || {},
        match_mode: response.data?.match_mode || matchMode,
        pe_clients: response.data?.pe_clients || [],
        prospect_count: response.data?.prospect_count || 0,
        trade_show_rollups: response.data?.trade_show_rollups || [],
        updated_at: response.data?.updated_at || "",
        year_bucket_rollups: response.data?.year_bucket_rollups || [],
      });
    } catch (fetchError) {
      if (handleUnauthorized(fetchError)) return;
      if (!isMountedRef.current) return;
      setError(getApiErrorMessage(fetchError, "Unable to load marketing-list conversion analysis."));
    } finally {
      if (!isMountedRef.current) return;
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [matchMode, overridePeClients, parsedBucketOverrides, parsedExclusionKeywords, parsedTradeShowTerms, selectedYears, sizeThreshold]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchAnalysis();

    const intervalId = setInterval(() => {
      fetchAnalysis({ silent: true });
    }, REFRESH_INTERVAL_MS);

    return () => {
      isMountedRef.current = false;
      clearInterval(intervalId);
    };
  }, [fetchAnalysis]);

  const topClients = useMemo(() => analysis.client_rollups.slice(0, 8), [analysis.client_rollups]);
  const yearComparisonRows = useMemo(() => {
    const buckets = [
      "ProspectEngage (PE)",
      "Trade Show",
      "Marketing Mission / Other",
      "ALL OTHER LEAD GEN (TS+Missions)",
    ];
    const rowsByBucket = new Map();

    for (const bucket of buckets) {
      rowsByBucket.set(bucket, { campaign_type: bucket });
    }

    for (const row of analysis.year_bucket_rollups) {
      if (!rowsByBucket.has(row.campaign_type)) {
        rowsByBucket.set(row.campaign_type, { campaign_type: row.campaign_type });
      }
      rowsByBucket.get(row.campaign_type)[row.year] = row;
    }

    return Array.from(rowsByBucket.values()).filter((row) => DEFAULT_YEARS.some((year) => row[year]));
  }, [analysis.year_bucket_rollups]);
  const updatedLabel = analysis.updated_at
    ? `Updated ${new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(analysis.updated_at))}`
    : "Marketing-list conversion analysis";

  if (isLoading) {
    return (
      <Box sx={{ alignItems: "center", display: "flex", flexDirection: "column", gap: 2, justifyContent: "center", py: 8 }}>
        <CircularProgress />
        <Typography color="text.secondary" variant="body2">
          Loading conversion analysis...
        </Typography>
      </Box>
    );
  }

  return (
    <Stack spacing={2.5}>
      {error ? <Alert severity="error">{error}</Alert> : null}

      <Stack
        direction={{ xs: "column", sm: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "stretch", sm: "center" }}
        spacing={1.5}
      >
        <Box>
          <Typography color="text.secondary" variant="body2">
            {updatedLabel}
          </Typography>
          <Typography color="text.secondary" variant="body2">
            {analysis.match_mode === "any_time"
              ? "Any-time conversion view"
              : analysis.match_mode === "on_after_list_creation"
                ? "On/after list creation conversion view"
                : "Same-year conversion view"}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button
            onClick={() => setIsMethodologyOpen(true)}
            size="small"
            variant="outlined"
            sx={{ borderRadius: 1, fontSize: "0.75rem", fontWeight: 700 }}
          >
            Methodology
          </Button>
          <Button
            disabled={isRefreshing}
            onClick={() => fetchAnalysis({ silent: true })}
            size="small"
            variant="outlined"
            sx={{ borderRadius: 1, fontSize: "0.75rem", fontWeight: 700 }}
          >
            {isRefreshing ? "Refreshing" : "Refresh"}
          </Button>
        </Stack>
      </Stack>

      <Paper elevation={0} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: 2 }}>
        <Box
          sx={{
            display: "grid",
            gap: 2,
            gridTemplateColumns: {
              xs: "1fr",
              sm: "repeat(2, minmax(0, 1fr))",
              lg: "repeat(3, minmax(240px, 1fr))",
            },
            alignItems: "start",
          }}
        >
          <Stack
            direction="row"
            flexWrap="wrap"
            gap={0.75}
            sx={{
              alignContent: "flex-start",
              minWidth: 0,
              "& .MuiButton-root": {
                minHeight: 32,
                whiteSpace: "normal",
              },
            }}
          >
            {MATCH_MODES.map((option) => {
              const isActive = matchMode === option.value;
              return (
                <Button
                  key={option.value}
                  onClick={() => setMatchMode(option.value)}
                  size="small"
                  variant={isActive ? "contained" : "outlined"}
                  disableElevation
                  sx={{
                    borderRadius: 1,
                    fontSize: "0.75rem",
                    fontWeight: 700,
                    minWidth: 0,
                    ...(!isActive && { borderColor: "divider", color: "text.secondary" }),
                  }}
                >
                  {option.label}
                </Button>
              );
            })}
          </Stack>
          <TextField
            fullWidth
            label="Year patterns"
            onChange={(event) => setYearsInput(event.target.value)}
            placeholder="2025, 2026"
            size="small"
            value={yearsInput}
          />
          <TextField
            fullWidth
            label="Admin PE client overrides"
            onChange={(event) => setPeClientOverrides(event.target.value)}
            placeholder="Client A, Client B"
            size="small"
            value={peClientOverrides}
          />
          <TextField
            fullWidth
            label="Trade-show names"
            onChange={(event) => setTradeShowTerms(event.target.value)}
            placeholder="Hannover Messe, SelectUSA"
            size="small"
            value={tradeShowTerms}
          />
          <TextField
            fullWidth
            label="Exclusion keywords"
            onChange={(event) => setExclusionKeywords(event.target.value)}
            placeholder="suppression, source testing"
            size="small"
            value={exclusionKeywords}
          />
          <TextField
            fullWidth
            label="Size threshold"
            onChange={(event) => setSizeThreshold(event.target.value)}
            size="small"
            type="number"
            value={sizeThreshold}
          />
          <TextField
            fullWidth
            label="Per-list bucket overrides"
            onChange={(event) => setBucketOverrides(event.target.value)}
            placeholder="listid=Trade Show"
            size="small"
            value={bucketOverrides}
          />
        </Box>
      </Paper>

      <Box
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", lg: "repeat(4, minmax(0, 1fr))" },
        }}
      >
        <KpiCard label="Conversion Rate" value={formatPercent(analysis.conversion_rate)} helper={`${analysis.prospect_count.toLocaleString()} prospects from ${analysis.company_count.toLocaleString()} companies`} />
        <KpiCard label="Companies Per Prospect" value={formatCompaniesPerProspect(analysis.companies_per_prospect)} helper="Lower is better for lead generation efficiency" />
        <KpiCard label="Marketing Lists" value={analysis.list_count.toLocaleString()} helper={`${analysis.excluded_list_count.toLocaleString()} excluded before bucketing`} />
        <KpiCard label="Companies Analyzed" value={analysis.company_count.toLocaleString()} helper="Distinct companies within each marketing list" />
      </Box>

      {analysis.pe_clients.length ? (
        <Paper elevation={0} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: 2.5 }}>
          <Stack spacing={1}>
            <Typography fontWeight={800}>Detected PE Clients</Typography>
            <Stack direction="row" flexWrap="wrap" gap={1}>
              {analysis.pe_clients.map((clientName) => (
                <Chip key={clientName} label={clientName} size="small" sx={{ fontWeight: 700 }} />
              ))}
            </Stack>
          </Stack>
        </Paper>
      ) : null}

      <Paper elevation={0} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, overflow: "hidden" }}>
        <Box sx={{ borderBottom: "1px solid", borderColor: "divider", px: 3, py: 2 }}>
          <Typography color="primary.main" fontWeight={800}>Year Rate Comparison</Typography>
          <Typography color="text.secondary" variant="body2">
            Rates are the comparison point; 2026 is partial-year-to-date.
          </Typography>
        </Box>
        <TableContainer sx={{ overflowX: "auto" }}>
          <Table size="small" sx={{ minWidth: 980 }}>
            <TableHead>
              <TableRow>
                <TableCell sx={subtleTableHeadCellSx}>Bucket</TableCell>
                <TableCell align="right" sx={subtleTableHeadCellSx}>2025 Rate</TableCell>
                <TableCell align="right" sx={subtleTableHeadCellSx}>2025 Cos / Prosp</TableCell>
                <TableCell align="right" sx={subtleTableHeadCellSx}>2026 Rate</TableCell>
                <TableCell align="right" sx={subtleTableHeadCellSx}>2026 Cos / Prosp</TableCell>
                <TableCell align="right" sx={subtleTableHeadCellSx}>2025 Companies</TableCell>
                <TableCell align="right" sx={subtleTableHeadCellSx}>2026 Companies</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {yearComparisonRows.map((row) => (
                <TableRow hover key={row.campaign_type}>
                  <TableCell sx={{ fontWeight: row.campaign_type.startsWith("ALL OTHER") ? 800 : 500 }}>
                    {row.campaign_type}
                  </TableCell>
                  <TableCell align="right">{row["2025"] ? formatPercent(row["2025"].conversion_rate) : "No data"}</TableCell>
                  <TableCell align="right">{row["2025"] ? formatCompaniesPerProspect(row["2025"].companies_per_prospect) : "No data"}</TableCell>
                  <TableCell align="right">{row["2026"] ? formatPercent(row["2026"].conversion_rate) : "No data"}</TableCell>
                  <TableCell align="right">{row["2026"] ? formatCompaniesPerProspect(row["2026"].companies_per_prospect) : "No data"}</TableCell>
                  <TableCell align="right">{row["2025"] ? row["2025"].company_count.toLocaleString() : "No data"}</TableCell>
                  <TableCell align="right">{row["2026"] ? row["2026"].company_count.toLocaleString() : "No data"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Box
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: { xs: "1fr", lg: "repeat(2, minmax(0, 1fr))" },
        }}
      >
        <Paper elevation={0} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: 2.5 }}>
          <Stack spacing={0.5} sx={{ mb: 2 }}>
            <Typography fontWeight={800}>PE vs. Other Lead Generation</Typography>
            <Typography color="text.secondary" variant="body2">
              Weighted conversion by final client-engagement bucket.
            </Typography>
          </Stack>
          <Box sx={{ height: 320, minWidth: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analysis.campaign_type_rollups} margin={{ top: 8, right: 18, bottom: 0, left: -12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="campaign_type" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(value, name) => [name === "conversion_rate" ? formatPercent(value) : value, name === "conversion_rate" ? "Conversion Rate" : "Prospects"]} />
                <Bar dataKey="conversion_rate" fill="#0f6b6e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Box>
        </Paper>

        <Paper elevation={0} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: 2.5 }}>
          <Stack spacing={0.5} sx={{ mb: 2 }}>
            <Typography fontWeight={800}>Top Client Rollups</Typography>
            <Typography color="text.secondary" variant="body2">
              Clients from matched prospect records, ranked by converted prospects and conversion rate.
            </Typography>
          </Stack>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 800 }}>Client</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 800 }}>Lists</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 800 }}>Companies</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 800 }}>Prospects</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 800 }}>Rate</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {topClients.map((client) => (
                  <TableRow key={client.client_name}>
                    <TableCell>{client.client_name}</TableCell>
                    <TableCell align="right">{client.list_count}</TableCell>
                    <TableCell align="right">{client.company_count}</TableCell>
                    <TableCell align="right">{client.prospect_count}</TableCell>
                    <TableCell align="right">{formatPercent(client.conversion_rate)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      </Box>

      {analysis.trade_show_rollups.length ? (
        <Paper elevation={0} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: 2.5 }}>
          <Stack spacing={0.5} sx={{ mb: 2 }}>
            <Typography fontWeight={800}>By Trade Show</Typography>
            <Typography color="text.secondary" variant="body2">
              De-duplicated companies and conversions by detected show name.
            </Typography>
          </Stack>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 800 }}>Trade Show</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 800 }}>Lists</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 800 }}>Companies</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 800 }}>Prospects</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 800 }}>Rate</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 800 }}>Companies / Prospect</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {analysis.trade_show_rollups.map((row) => (
                  <TableRow key={row.trade_show_name}>
                    <TableCell>{row.trade_show_name}</TableCell>
                    <TableCell align="right">{row.list_count}</TableCell>
                    <TableCell align="right">{row.company_count}</TableCell>
                    <TableCell align="right">{row.prospect_count}</TableCell>
                    <TableCell align="right">{formatPercent(row.conversion_rate)}</TableCell>
                    <TableCell align="right">{formatCompaniesPerProspect(row.companies_per_prospect)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      ) : null}

      {analysis.exclusion_rollups.length ? (
        <Paper elevation={0} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: 2.5 }}>
          <Stack spacing={0.5} sx={{ mb: 2 }}>
            <Typography fontWeight={800}>Excluded Before Bucketing</Typography>
            <Typography color="text.secondary" variant="body2">
              {analysis.excluded_list_count.toLocaleString()} lists and {analysis.excluded_company_count.toLocaleString()} companies removed from conversion denominators.
            </Typography>
          </Stack>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 800 }}>Reason</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 800 }}>Lists</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 800 }}>Companies</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {analysis.exclusion_rollups.map((row) => (
                  <TableRow key={row.code}>
                    <TableCell>{row.reason}</TableCell>
                    <TableCell align="right">{row.list_count}</TableCell>
                    <TableCell align="right">{row.company_count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      ) : null}

      <Paper elevation={0} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, overflow: "hidden" }}>
        <Box sx={{ alignItems: "center", borderBottom: "1px solid", borderColor: "divider", display: "flex", justifyContent: "space-between", px: 3, py: 2 }}>
          <Box>
            <Typography color="primary.main" fontWeight={800}>List-Level Conversion</Typography>
            <Typography color="text.secondary" variant="body2">
              Source rows behind the rollups.
            </Typography>
          </Box>
          <Chip label={`${analysis.lists.length} lists`} sx={{ fontWeight: 800 }} />
        </Box>
        <TableContainer sx={{ overflowX: "auto" }}>
          <Table size="small" sx={{ minWidth: 1120 }}>
            <TableHead>
              <TableRow>
                <TableCell sx={subtleTableHeadCellSx}>Marketing List</TableCell>
                <TableCell sx={subtleTableHeadCellSx}>Client</TableCell>
                <TableCell sx={subtleTableHeadCellSx}>Campaign Type</TableCell>
                <TableCell sx={subtleTableHeadCellSx}>Created</TableCell>
                <TableCell align="right" sx={subtleTableHeadCellSx}>Companies</TableCell>
                <TableCell align="right" sx={subtleTableHeadCellSx}>Prospects</TableCell>
                <TableCell align="right" sx={subtleTableHeadCellSx}>Rate</TableCell>
                <TableCell align="right" sx={subtleTableHeadCellSx}>Companies / Prospect</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {analysis.lists.map((row) => (
                <TableRow hover key={row.listid || row.marketing_list_name}>
                  <TableCell sx={{ maxWidth: 280, overflowWrap: "anywhere" }}>{row.marketing_list_name || "Missing"}</TableCell>
                  <TableCell>{row.client_name || "Unassigned"}</TableCell>
                  <TableCell>{row.campaign_type || "Other"}</TableCell>
                  <TableCell>{formatDate(row.createdon)}</TableCell>
                  <TableCell align="right">{row.company_count}</TableCell>
                  <TableCell align="right">{row.prospect_count}</TableCell>
                  <TableCell align="right">{formatPercent(row.conversion_rate)}</TableCell>
                  <TableCell align="right">{formatCompaniesPerProspect(row.companies_per_prospect)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Dialog fullWidth maxWidth="md" onClose={() => setIsMethodologyOpen(false)} open={isMethodologyOpen}>
        <DialogContent dividers>
          <Stack spacing={2}>
            <Box>
              <Typography color="primary.main" fontWeight={800}>Methodology</Typography>
              <Typography color="text.secondary" variant="body2">
                {analysis.methodology.conversion_rule || "Prospect conversion is inferred by matching list member company GUIDs to prospect account GUIDs."}
              </Typography>
            </Box>
            {[
              analysis.methodology.member_scope,
              analysis.methodology.exclusion_rule,
              analysis.methodology.bucket_rule,
              analysis.methodology.override_rule,
              analysis.methodology.rollup_rule,
              analysis.methodology.comparison_rule,
              analysis.methodology.causation_caveat,
              analysis.methodology.matching_caveat,
            ].filter(Boolean).map((text) => (
              <Typography color="text.secondary" key={text} variant="body2">
                {text}
              </Typography>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setIsMethodologyOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
