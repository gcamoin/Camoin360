import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  InputLabel,
  Link,
  LinearProgress,
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
  TableSortLabel,
  TextField,
  Typography,
} from "@mui/material";

import { API_BASE_URL, getApiErrorMessage, getAuthHeaders, handleUnauthorized } from "../auth";

const API_URL = `${API_BASE_URL}/leadfeeder-visits`;
const DEFAULT_ROWS_PER_PAGE = 25;
const numberFormatter = new Intl.NumberFormat();
const DEFAULT_FILTERS = {
  search: "",
  country: "",
  state: "",
  industry: "",
  intentLevel: "",
  visitorType: "",
  reviewStatus: "",
  startDate: "",
  endDate: "",
};
const INTENT_LEVELS = ["High", "Medium", "Low"];
const VISITOR_TYPES = ["New", "Returning"];
const REVIEW_STATUSES = ["Ready", "Needs Review", "Reviewed", "Follow-Up Needed", "Ignored"];
const MISSING_DATA_FIELD_COUNT = 7;
const INTENT_SCORE_WEIGHTS = {
  visitFrequency: 25,
  recency: 20,
  knownCompanyName: 15,
  industryMatch: 15,
  pagesVisited: 15,
  companyCompleteness: 10,
};
const columns = [
  { key: "company_name", label: "Company Name", width: 220 },
  { key: "website", label: "Website", width: 180 },
  { key: "country", label: "Country", width: 140 },
  { key: "state", label: "State", width: 140 },
  { key: "industry", label: "Industry", width: 170 },
  { key: "visit_count", label: "Visit Count", width: 120 },
  { key: "last_visit_date", label: "Last Visit Date", width: 170 },
  { key: "intent_score", label: "Intent Score", width: 130 },
  { key: "missing_fields", label: "Missing Fields", width: 210 },
  { key: "review_status", label: "Review Status", width: 150 },
  { key: "actions", label: "Actions", width: 320, sortable: false },
];
const selectionColumnWidth = 56;
const tableMinWidth = columns.reduce((totalWidth, column) => totalWidth + column.width, selectionColumnWidth);

function MetricCard({ title, value, subtitle, valueSx }) {
  return (
    <Paper
      elevation={0}
      sx={{
        border: "1px solid rgba(0, 51, 108, 0.10)",
        borderRadius: 2,
        height: "100%",
        minWidth: 0,
        p: 2.5,
      }}
    >
      <Typography color="text.secondary" sx={{ fontWeight: 700 }} variant="overline">
        {title}
      </Typography>
      <Typography
        color="primary.main"
        sx={{
          fontSize: { xs: "1.8rem", md: "2.15rem" },
          fontWeight: 800,
          lineHeight: 1.1,
          mt: 0.5,
          ...valueSx,
        }}
      >
        {value}
      </Typography>
      <Typography color="text.secondary" sx={{ mt: 0.75 }} variant="body2">
        {subtitle}
      </Typography>
    </Paper>
  );
}

function isMissingValue(value) {
  return value === null || value === undefined || String(value).trim() === "";
}

function formatDate(value) {
  if (isMissingValue(value)) {
    return "Missing";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleDateString();
}

function formatDateTime(value) {
  if (isMissingValue(value)) {
    return "Missing";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString();
}

function getExportDateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function escapeCsvValue(value) {
  const stringValue = String(value ?? "");

  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

function downloadCsv(filename, rows) {
  const csvContent = rows.map((row) => row.map(escapeCsvValue).join(",")).join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const downloadLink = document.createElement("a");

  downloadLink.href = url;
  downloadLink.download = filename;
  downloadLink.click();
  URL.revokeObjectURL(url);
}

function formatDuration(value) {
  if (isMissingValue(value)) {
    return "";
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return String(value);
  }

  const totalSeconds = Math.max(0, Math.round(numericValue));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function getWebsiteHref(value) {
  if (isMissingValue(value)) {
    return "";
  }

  return String(value).startsWith("http") ? value : `https://${value}`;
}

function getDateInputValue(value) {
  if (isMissingValue(value)) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString().slice(0, 10);
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function getFirstValue(record, keys) {
  for (const key of keys) {
    if (!isMissingValue(record?.[key])) {
      return String(record[key]).trim();
    }
  }

  return "";
}

function getCompanyKey(visit, index) {
  if (!isMissingValue(visit.account_id)) {
    return String(visit.account_id).trim();
  }

  if (!isMissingValue(visit.account_name)) {
    return String(visit.account_name).trim();
  }

  return `visit-${visit.visit_id || visit.createdon || index}`;
}

function getSelectOptions(visits, key) {
  return Array.from(
    new Set(
      visits
        .map((visit) => visit[key])
        .filter((value) => !isMissingValue(value))
        .map((value) => String(value).trim())
    )
  ).sort((firstValue, secondValue) => firstValue.localeCompare(secondValue));
}

function getIntentLevel(intentScore) {
  if (intentScore >= 80) {
    return "High";
  }

  if (intentScore >= 50) {
    return "Medium";
  }

  return "Low";
}

function getIntentColor(intentLevel) {
  if (intentLevel === "High") {
    return "success";
  }

  if (intentLevel === "Medium") {
    return "warning";
  }

  return "error";
}

function getReviewStatusColor(reviewStatus) {
  if (reviewStatus === "Ready" || reviewStatus === "Reviewed") {
    return "success";
  }

  if (reviewStatus === "Follow-Up Needed") {
    return "info";
  }

  if (reviewStatus === "Ignored") {
    return "default";
  }

  return "warning";
}

function getNumericValue(record, keys) {
  for (const key of keys) {
    const parsedValue = Number(record?.[key]);
    if (Number.isFinite(parsedValue) && parsedValue > 0) {
      return parsedValue;
    }
  }

  return 0;
}

function getPageIdentifier(visit) {
  return getFirstValue(visit, [
    "page_url",
    "pageUrl",
    "url",
    "path",
    "visited_page",
    "visitedPage",
    "page_title",
    "pageTitle",
  ]);
}

function getVisitDuration(visit) {
  return getFirstValue(visit, [
    "visit_duration",
    "visitDuration",
    "duration",
    "duration_seconds",
    "durationSeconds",
    "time_on_site",
    "timeOnSite",
  ]);
}

function getDaysSince(value) {
  if (isMissingValue(value)) {
    return Number.POSITIVE_INFINITY;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
}

function getRecencyScore(lastVisitDate) {
  const daysSinceLastVisit = getDaysSince(lastVisitDate);

  if (daysSinceLastVisit <= 7) {
    return INTENT_SCORE_WEIGHTS.recency;
  }

  if (daysSinceLastVisit <= 30) {
    return 14;
  }

  if (daysSinceLastVisit <= 90) {
    return 7;
  }

  return 0;
}

function getPagesVisitedScore(pagesVisited) {
  if (pagesVisited >= 5) {
    return INTENT_SCORE_WEIGHTS.pagesVisited;
  }

  if (pagesVisited >= 3) {
    return 10;
  }

  if (pagesVisited >= 1) {
    return 5;
  }

  return 0;
}

function getIntentScore(row, missingFields) {
  const score =
    Math.min(row.visit_count * 8, INTENT_SCORE_WEIGHTS.visitFrequency) +
    getRecencyScore(row.last_visit_date) +
    (!isMissingValue(row.company_name) ? INTENT_SCORE_WEIGHTS.knownCompanyName : 0) +
    (!isMissingValue(row.industry) ? INTENT_SCORE_WEIGHTS.industryMatch : 0) +
    getPagesVisitedScore(row.pages_visited) +
    Math.round(((MISSING_DATA_FIELD_COUNT - missingFields.length) / MISSING_DATA_FIELD_COUNT) * INTENT_SCORE_WEIGHTS.companyCompleteness);

  return Math.max(0, Math.min(100, score));
}

function IntentScoreBadge({ intentLevel, score }) {
  const color = getIntentColor(intentLevel);

  return (
    <Box sx={{ display: "grid", gap: 0.75, minWidth: 118 }}>
      <Chip
        color={color}
        label={`${score} - ${intentLevel} Intent`}
        size="small"
        sx={{ fontWeight: 800, justifyContent: "flex-start" }}
      />
      <LinearProgress
        color={color}
        sx={{ borderRadius: 999, height: 6 }}
        value={score}
        variant="determinate"
      />
    </Box>
  );
}

function getMissingFields(row) {
  return [
    ["Website", row.website],
    ["Country", row.country],
    ["State", row.state],
    ["Industry", row.industry],
    ["Phone", row.phone],
    ["Contact Name", row.contact_name],
    ["Email", row.email],
  ]
    .filter(([_label, value]) => isMissingValue(value))
    .map(([label]) => `Missing ${label}`);
}

function MissingFieldChips({ fields, maxVisible = 2 }) {
  if (!fields.length) {
    return <Typography color="success.main" variant="body2">Complete</Typography>;
  }

  const visibleFields = fields.slice(0, maxVisible);
  const hiddenCount = fields.length - visibleFields.length;

  return (
    <Stack direction="row" flexWrap="wrap" gap={0.75}>
      {visibleFields.map((fieldName) => (
        <Chip color="warning" key={fieldName} label={fieldName} size="small" />
      ))}
      {hiddenCount > 0 ? (
        <Chip label={`+${hiddenCount} More`} size="small" sx={{ fontWeight: 800 }} />
      ) : null}
    </Stack>
  );
}

function getSortValue(row, key) {
  if (key === "visit_count" || key === "intent_score") {
    return Number(row[key] || 0);
  }

  if (key === "last_visit_date") {
    return new Date(row.last_visit_date || 0).getTime() || 0;
  }

  if (key === "missing_fields") {
    return row.missing_fields.length;
  }

  return normalizeText(row[key]);
}

function sortRows(rows, sortConfig) {
  if (!sortConfig.key) {
    return rows;
  }

  return [...rows].sort((firstRow, secondRow) => {
    const firstValue = getSortValue(firstRow, sortConfig.key);
    const secondValue = getSortValue(secondRow, sortConfig.key);
    const directionMultiplier = sortConfig.direction === "asc" ? 1 : -1;

    if (firstValue === secondValue) {
      return normalizeText(firstRow.company_name).localeCompare(normalizeText(secondRow.company_name));
    }

    if (typeof firstValue === "number" && typeof secondValue === "number") {
      return (firstValue - secondValue) * directionMultiplier;
    }

    return String(firstValue || "").localeCompare(String(secondValue || "")) * directionMultiplier;
  });
}

function EmptyState({ hasActiveFilters = false }) {
  return (
    <Box sx={{ px: { xs: 2, md: 3 }, py: 7, textAlign: "center" }}>
      <Typography color="text.secondary" sx={{ fontWeight: 600 }} variant="h6">
        {hasActiveFilters ? "No matching Leadfeeder visits" : "No Leadfeeder visits found"}
      </Typography>
      <Typography color="text.secondary" sx={{ mt: 1 }}>
        {hasActiveFilters
          ? "Adjust or clear the filters to broaden the result set."
          : "Once Leadfeeder visit records are available in Dynamics, they will appear here automatically."}
      </Typography>
    </Box>
  );
}

function FilterSelect({ label, onChange, options, value }) {
  return (
    <FormControl fullWidth size="small">
      <InputLabel>{label}</InputLabel>
      <Select
        label={label}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        <MenuItem value="">All</MenuItem>
        {options.map((option) => (
          <MenuItem key={option} value={option}>
            {option}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}

function DetailField({ label, children }) {
  return (
    <Box>
      <Typography color="text.secondary" variant="caption">
        {label}
      </Typography>
      <Typography sx={{ mt: 0.25, overflowWrap: "anywhere" }} variant="body2">
        {children || "Missing"}
      </Typography>
    </Box>
  );
}

function FutureActionButton({ children }) {
  return (
    <Button disabled size="small" sx={{ fontWeight: 800, whiteSpace: "nowrap" }} variant="outlined">
      {children}
    </Button>
  );
}

export default function LeadfeederVisits() {
  const [visits, setVisits] = useState([]);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [reviewStatusesByCompanyKey, setReviewStatusesByCompanyKey] = useState({});
  const [selectedCompanyKey, setSelectedCompanyKey] = useState("");
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [notesByCompanyKey, setNotesByCompanyKey] = useState({});
  const [sortConfig, setSortConfig] = useState({ key: "last_visit_date", direction: "desc" });
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_ROWS_PER_PAGE);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function loadVisits() {
      setIsLoading(true);
      setError("");

      try {
        const response = await axios.get(API_URL, { headers: getAuthHeaders() });

        if (isMounted) {
          setVisits(response.data?.data || []);
        }
      } catch (fetchError) {
        if (handleUnauthorized(fetchError)) {
          return;
        }

        if (isMounted) {
          setError(getApiErrorMessage(fetchError, "Unable to load Leadfeeder visits."));
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadVisits();

    return () => {
      isMounted = false;
    };
  }, []);

  const companyRows = useMemo(() => {
    const rowsByCompany = new Map();

    visits.forEach((visit, index) => {
      const companyKey = getCompanyKey(visit, index);
      const existingRow = rowsByCompany.get(companyKey);
      const visitTime = new Date(visit.createdon || 0).getTime() || 0;
      const currentLastVisitTime = existingRow ? new Date(existingRow.last_visit_date || 0).getTime() || 0 : 0;

      const nextRow = existingRow || {
        companyKey,
        company_name: "",
        website: "",
        country: "",
        state: "",
        city: "",
        industry: "",
        phone: "",
        contact_name: "",
        email: "",
        visit_count: 0,
        pages_visited: 0,
        pageIdentifiers: new Set(),
        visit_timestamps: [],
        visit_durations: [],
        first_visit_date: "",
        last_visit_date: "",
        client_name: "",
      };

      nextRow.company_name = nextRow.company_name || visit.account_name || visit.client_name || "";
      nextRow.website = nextRow.website || getFirstValue(visit, ["website", "websiteurl"]);
      nextRow.country = nextRow.country || getFirstValue(visit, ["country", "country_name", "address1_country"]);
      nextRow.state = nextRow.state || getFirstValue(visit, ["state", "state_name", "address1_stateorprovince"]);
      nextRow.city = nextRow.city || getFirstValue(visit, ["city", "address1_city"]);
      nextRow.industry = nextRow.industry || getFirstValue(visit, ["industry", "sector", "new_sector"]);
      nextRow.phone = nextRow.phone || getFirstValue(visit, ["phone", "telephone1", "business_phone"]);
      nextRow.contact_name = nextRow.contact_name || getFirstValue(visit, ["contact_name", "contactName", "visitor_name", "visitorName", "client_name"]);
      nextRow.email = nextRow.email || getFirstValue(visit, ["email", "emailaddress1", "contact_email", "contactEmail"]);
      nextRow.client_name = nextRow.client_name || visit.client_name || "";
      nextRow.visit_count += 1;

      if (!isMissingValue(visit.createdon)) {
        nextRow.visit_timestamps.push(visit.createdon);
      }

      const visitDuration = getVisitDuration(visit);
      if (visitDuration) {
        nextRow.visit_durations.push(visitDuration);
      }

      const pagesVisited = getNumericValue(visit, [
        "pages_visited",
        "pagesVisited",
        "page_count",
        "pageCount",
        "pageviews",
        "page_views",
      ]);
      const pageIdentifier = getPageIdentifier(visit);

      if (pagesVisited) {
        nextRow.pages_visited = Math.max(nextRow.pages_visited, pagesVisited);
      } else if (pageIdentifier) {
        nextRow.pageIdentifiers.add(pageIdentifier);
        nextRow.pages_visited = Math.max(nextRow.pages_visited, nextRow.pageIdentifiers.size);
      }

      if (!nextRow.last_visit_date || visitTime > currentLastVisitTime) {
        nextRow.last_visit_date = visit.createdon || "";
      }

      if (!nextRow.first_visit_date || visitTime < (new Date(nextRow.first_visit_date || 0).getTime() || Number.POSITIVE_INFINITY)) {
        nextRow.first_visit_date = visit.createdon || "";
      }

      rowsByCompany.set(companyKey, nextRow);
    });

    return Array.from(rowsByCompany.values()).map((row) => {
      const missingFields = getMissingFields(row);
      const hasCompany = !isMissingValue(row.company_name);
      const intentScore = getIntentScore(row, missingFields);
      const displayRow = {
        ...row,
        pages_visited_list: Array.from(row.pageIdentifiers),
        visit_timestamps: Array.from(new Set(row.visit_timestamps)).sort(
          (firstValue, secondValue) => new Date(secondValue).getTime() - new Date(firstValue).getTime()
        ),
        visit_durations: Array.from(new Set(row.visit_durations)),
      };
      delete displayRow.pageIdentifiers;

      return {
        ...displayRow,
        intent_score: intentScore,
        intent_level: getIntentLevel(intentScore),
        visitor_type: row.visit_count > 1 ? "Returning" : "New",
        missing_fields: missingFields,
        notes: notesByCompanyKey[row.companyKey] || "",
        review_status:
          reviewStatusesByCompanyKey[row.companyKey] ||
          (hasCompany && missingFields.length === 0 ? "Ready" : "Needs Review"),
        visit_date: getDateInputValue(row.last_visit_date),
      };
    });
  }, [notesByCompanyKey, reviewStatusesByCompanyKey, visits]);

  const filterOptions = useMemo(
    () => ({
      countries: getSelectOptions(companyRows, "country"),
      states: getSelectOptions(companyRows, "state"),
      industries: getSelectOptions(companyRows, "industry"),
    }),
    [companyRows]
  );

  const filteredCompanyRows = useMemo(
    () =>
      companyRows.filter((row) => {
        const companySearch = normalizeText(filters.search);
        const visitDate = row.visit_date;
        const companyMatches = !companySearch || normalizeText(row.company_name).includes(companySearch);
        const startMatches = !filters.startDate || (visitDate && visitDate >= filters.startDate);
        const endMatches = !filters.endDate || (visitDate && visitDate <= filters.endDate);

        return (
          companyMatches &&
          (!filters.country || row.country === filters.country) &&
          (!filters.state || row.state === filters.state) &&
          (!filters.industry || row.industry === filters.industry) &&
          (!filters.intentLevel || row.intent_level === filters.intentLevel) &&
          (!filters.visitorType || row.visitor_type === filters.visitorType) &&
          (!filters.reviewStatus || row.review_status === filters.reviewStatus) &&
          startMatches &&
          endMatches
        );
      }),
    [companyRows, filters]
  );

  const sortedCompanyRows = useMemo(
    () => sortRows(filteredCompanyRows, sortConfig),
    [filteredCompanyRows, sortConfig]
  );

  const activeFilterCount = Object.values(filters).filter((value) => !isMissingValue(value)).length;
  const paginatedCompanyRows = useMemo(
    () => sortedCompanyRows.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage),
    [page, rowsPerPage, sortedCompanyRows]
  );
  const selectedCompany = useMemo(
    () => companyRows.find((row) => row.companyKey === selectedCompanyKey) || null,
    [companyRows, selectedCompanyKey]
  );

  function updateFilter(filterKey, value) {
    setPage(0);
    setFilters((currentFilters) => ({
      ...currentFilters,
      [filterKey]: value,
    }));
  }

  function handleChangePage(_event, nextPage) {
    setPage(nextPage);
  }

  function handleChangeRowsPerPage(event) {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  }

  function handleSort(columnKey) {
    setPage(0);
    setSortConfig((currentSort) => ({
      key: columnKey,
      direction: currentSort.key === columnKey && currentSort.direction === "asc" ? "desc" : "asc",
    }));
  }

  function setCompanyReviewStatus(companyKey, reviewStatus) {
    setReviewStatusesByCompanyKey((currentStatuses) => ({
      ...currentStatuses,
      [companyKey]: reviewStatus,
    }));
  }

  function openCompanyDetails(companyKey) {
    setSelectedCompanyKey(companyKey);
    setIsDetailOpen(true);
  }

  function updateCompanyNotes(companyKey, notes) {
    setNotesByCompanyKey((currentNotes) => ({
      ...currentNotes,
      [companyKey]: notes,
    }));
  }

  function openCompanyWebsite(row) {
    if (!row?.website) {
      return;
    }

    window.open(getWebsiteHref(row.website), "_blank", "noopener,noreferrer");
  }

  function exportLeadfeederCsv() {
    const csvRows = [
      [
        "Company Name",
        "Website",
        "Country",
        "State",
        "Industry",
        "Visit Count",
        "Last Visit Date",
        "Intent Score",
        "Review Status",
        "Missing Fields",
      ],
      ...sortedCompanyRows.map((row) => [
        row.company_name || "Missing",
        row.website || "Missing",
        row.country || "Missing",
        row.state || "Missing",
        row.industry || "Missing",
        row.visit_count,
        formatDate(row.last_visit_date),
        row.intent_score,
        row.review_status,
        row.missing_fields.length ? row.missing_fields.join("; ") : "Complete",
      ]),
    ];

    downloadCsv(`leadfeeder-visits-${getExportDateStamp()}.csv`, csvRows);
  }

  useEffect(() => {
    const lastPage = Math.max(0, Math.ceil(filteredCompanyRows.length / rowsPerPage) - 1);

    if (page > lastPage) {
      setPage(lastPage);
    }
  }, [filteredCompanyRows.length, page, rowsPerPage]);

  const visitSummary = useMemo(() => {
    const companyVisitCounts = new Map();
    const highIntentCompanies = new Set();
    const needingReviewRecords = new Set();

    filteredCompanyRows.forEach((row) => {
      companyVisitCounts.set(row.companyKey, row.visit_count);

      if (row.intent_level === "High") {
        highIntentCompanies.add(row.companyKey);
      }

      if (row.review_status === "Needs Review") {
        needingReviewRecords.add(row.companyKey);
      }
    });

    const companyVisitCountValues = Array.from(companyVisitCounts.values());

    return {
      totalVisitorCompanies: companyVisitCounts.size,
      newVisitors: companyVisitCountValues.filter((count) => count === 1).length,
      returningVisitors: companyVisitCountValues.filter((count) => count > 1).length,
      highIntentVisitors: highIntentCompanies.size,
      visitorsNeedingReview: needingReviewRecords.size,
    };
  }, [filteredCompanyRows]);

  if (isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return <Alert severity="error">{error}</Alert>;
  }

  return (
    <Stack spacing={3}>
      <Box
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: {
            xs: "1fr",
            sm: "repeat(2, minmax(0, 1fr))",
            lg: "repeat(3, minmax(0, 1fr))",
            xl: "repeat(5, minmax(0, 1fr))",
          },
        }}
      >
        <MetricCard
          subtitle="Distinct companies that generated at least one Leadfeeder visit"
          title="Total Visitor Companies"
          value={numberFormatter.format(visitSummary.totalVisitorCompanies)}
        />
        <MetricCard
          subtitle="Companies seen exactly once in the loaded visit set"
          title="New Visitors"
          value={numberFormatter.format(visitSummary.newVisitors)}
        />
        <MetricCard
          subtitle="Companies with more than one recorded visit"
          title="Returning Visitors"
          value={numberFormatter.format(visitSummary.returningVisitors)}
        />
        <MetricCard
          subtitle="Companies with a matched client name"
          title="High Intent Visitors"
          value={numberFormatter.format(visitSummary.highIntentVisitors)}
          valueSx={{
            fontSize: { xs: "2rem", md: "2.35rem" },
          }}
        />
        <MetricCard
          subtitle="Companies missing a name or client match"
          title="Visitors Needing Review"
          value={numberFormatter.format(visitSummary.visitorsNeedingReview)}
        />
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
              Leadfeeder Visitor Companies
            </Typography>
            <Typography color="text.secondary" variant="body2">
              Company-level review table grouped from recent Leadfeeder visits.
            </Typography>
          </Box>
          <Stack direction="row" flexWrap="wrap" gap={1}>
            <Chip
              label={
                activeFilterCount
                  ? `${filteredCompanyRows.length} of ${companyRows.length} companies`
                  : `${companyRows.length} total`
              }
              sx={{ fontWeight: 800 }}
            />
            <Button
              disabled={!sortedCompanyRows.length}
              onClick={exportLeadfeederCsv}
              size="small"
              sx={{ borderRadius: 1, fontWeight: 800, minHeight: 32, whiteSpace: "nowrap" }}
              variant="outlined"
            >
              Export CSV
            </Button>
          </Stack>
        </Box>

        <Stack
          direction={{ xs: "column", lg: "row" }}
          spacing={2}
          sx={{
            alignItems: { xs: "stretch", lg: "center" },
            borderBottom: "1px solid rgba(0, 51, 108, 0.10)",
            flexWrap: { lg: "wrap" },
            px: { xs: 2, md: 3 },
            py: 2,
            rowGap: 2,
          }}
          useFlexGap
        >
          <TextField
            label="Search companies"
            onChange={(event) => updateFilter("search", event.target.value)}
            placeholder="Company name..."
            size="small"
            sx={{ flex: { lg: "0 1 240px" }, maxWidth: { lg: 240 }, minWidth: { lg: 0 } }}
            value={filters.search}
          />
          <Box
            sx={{
              display: "grid",
              flex: { lg: "1 1 640px" },
              gap: 2,
              gridTemplateColumns: {
                xs: "1fr",
                sm: "repeat(2, minmax(0, 1fr))",
                lg: "repeat(4, minmax(0, 1fr))",
              },
              minWidth: 0,
            }}
          >
            <FilterSelect
              label="Country"
              onChange={(value) => updateFilter("country", value)}
              options={filterOptions.countries}
              value={filters.country}
            />
            <FilterSelect
              label="State"
              onChange={(value) => updateFilter("state", value)}
              options={filterOptions.states}
              value={filters.state}
            />
            <FilterSelect
              label="Industry"
              onChange={(value) => updateFilter("industry", value)}
              options={filterOptions.industries}
              value={filters.industry}
            />
            <FilterSelect
              label="Intent Level"
              onChange={(value) => updateFilter("intentLevel", value)}
              options={INTENT_LEVELS}
              value={filters.intentLevel}
            />
            <FilterSelect
              label="Visitor Type"
              onChange={(value) => updateFilter("visitorType", value)}
              options={VISITOR_TYPES}
              value={filters.visitorType}
            />
            <FilterSelect
              label="Review Status"
              onChange={(value) => updateFilter("reviewStatus", value)}
              options={REVIEW_STATUSES}
              value={filters.reviewStatus}
            />
            <TextField
              InputLabelProps={{ shrink: true }}
              label="Date Range Start"
              onChange={(event) => updateFilter("startDate", event.target.value)}
              size="small"
              type="date"
              value={filters.startDate}
            />
            <TextField
              InputLabelProps={{ shrink: true }}
              label="Date Range End"
              onChange={(event) => updateFilter("endDate", event.target.value)}
              size="small"
              type="date"
              value={filters.endDate}
            />
          </Box>
          <Button
            disabled={!activeFilterCount}
            onClick={() => {
              setFilters(DEFAULT_FILTERS);
              setPage(0);
            }}
            size="small"
            sx={{
              borderRadius: 1,
              flex: { lg: "0 0 auto" },
              fontWeight: 800,
              minHeight: 40,
              whiteSpace: "nowrap",
            }}
            variant="outlined"
          >
            Clear filters
          </Button>
        </Stack>

        <Box
          sx={{
            alignItems: "center",
            borderBottom: "1px solid rgba(0, 51, 108, 0.10)",
            display: "flex",
            flexDirection: { xs: "column", sm: "row" },
            gap: 1,
            justifyContent: "space-between",
            px: { xs: 2, md: 3 },
            py: 1.5,
          }}
        >
          <Typography color="text.secondary" variant="body2">
            Showing {paginatedCompanyRows.length} of {filteredCompanyRows.length} Companies
          </Typography>
          <Stack direction="row" spacing={2}>
            <Typography color="text.secondary" variant="body2">
              {selectedCompany ? "1 company selected" : "0 companies selected"}
            </Typography>
            {activeFilterCount > 0 ? (
              <Typography color="text.secondary" variant="body2">
                {activeFilterCount} active filter{activeFilterCount === 1 ? "" : "s"}
              </Typography>
            ) : null}
          </Stack>
        </Box>

        {filteredCompanyRows.length ? (
          <TableContainer sx={{ maxHeight: "calc(100vh - 380px)", overflowX: "auto" }}>
            <Table size="small" stickyHeader sx={{ minWidth: tableMinWidth, tableLayout: "fixed" }}>
              <TableHead>
                <TableRow>
                  <TableCell
                    padding="none"
                    sx={{
                      backgroundColor: "primary.main",
                      color: "common.white",
                      minWidth: selectionColumnWidth,
                      px: 0,
                      py: 1,
                      textAlign: "center",
                      verticalAlign: "middle",
                      width: selectionColumnWidth,
                    }}
                  />
                  {columns.map((column) => (
                    <TableCell
                      key={column.key}
                      sortDirection={sortConfig.key === column.key ? sortConfig.direction : false}
                      sx={{
                        backgroundColor: "primary.main",
                        color: "common.white",
                        fontWeight: 800,
                        py: 1.25,
                        top: 0,
                        width: column.width,
                        zIndex: 3,
                      }}
                    >
                      {column.sortable === false ? (
                        column.label
                      ) : (
                        <TableSortLabel
                          active={sortConfig.key === column.key}
                          direction={sortConfig.key === column.key ? sortConfig.direction : "asc"}
                          onClick={() => handleSort(column.key)}
                          sx={{
                            color: "common.white",
                            fontWeight: 800,
                            "&.Mui-active": { color: "common.white" },
                            "& .MuiTableSortLabel-icon": { color: "common.white !important" },
                          }}
                        >
                          {column.label}
                        </TableSortLabel>
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {paginatedCompanyRows.map((row) => (
                  <TableRow
                    hover
                    key={row.companyKey}
                    onClick={() => setSelectedCompanyKey(row.companyKey)}
                    selected={selectedCompanyKey === row.companyKey}
                    sx={{ cursor: "pointer" }}
                  >
                    <TableCell padding="checkbox" sx={{ textAlign: "center" }}>
                      <Checkbox
                        checked={selectedCompanyKey === row.companyKey}
                        inputProps={{ "aria-label": `Select ${row.company_name || "company"}` }}
                        onChange={(event) => {
                          event.stopPropagation();
                          setSelectedCompanyKey(event.target.checked ? row.companyKey : "");
                        }}
                        size="small"
                      />
                    </TableCell>
                    <TableCell sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>
                      {row.company_name || "Missing"}
                    </TableCell>
                    <TableCell sx={{ overflowWrap: "anywhere" }}>
                      {row.website ? (
                        <Link
                          href={getWebsiteHref(row.website)}
                          onClick={(event) => event.stopPropagation()}
                          rel="noreferrer"
                          target="_blank"
                          underline="hover"
                        >
                          {row.website}
                        </Link>
                      ) : (
                        "Missing"
                      )}
                    </TableCell>
                    <TableCell>{row.country || "Missing"}</TableCell>
                    <TableCell>{row.state || "Missing"}</TableCell>
                    <TableCell sx={{ overflowWrap: "anywhere" }}>{row.industry || "Missing"}</TableCell>
                    <TableCell>{numberFormatter.format(row.visit_count)}</TableCell>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>{formatDate(row.last_visit_date)}</TableCell>
                    <TableCell>
                      <IntentScoreBadge intentLevel={row.intent_level} score={row.intent_score} />
                    </TableCell>
                    <TableCell sx={{ overflowWrap: "anywhere" }}>
                      <MissingFieldChips fields={row.missing_fields} />
                    </TableCell>
                    <TableCell>
                      <Chip
                        color={getReviewStatusColor(row.review_status)}
                        label={row.review_status}
                        size="small"
                        sx={{ fontWeight: 800 }}
                      />
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" flexWrap="wrap" gap={1}>
                        <Button
                          onClick={(event) => {
                            event.stopPropagation();
                            openCompanyDetails(row.companyKey);
                          }}
                          size="small"
                          sx={{ fontWeight: 800, whiteSpace: "nowrap" }}
                          variant="outlined"
                        >
                          Details
                        </Button>
                        <Button
                          disabled={row.review_status === "Reviewed"}
                          onClick={(event) => {
                            event.stopPropagation();
                            setCompanyReviewStatus(row.companyKey, "Reviewed");
                          }}
                          size="small"
                          sx={{ fontWeight: 800, whiteSpace: "nowrap" }}
                          variant="outlined"
                        >
                          {row.review_status === "Reviewed" ? "Reviewed" : "Mark Reviewed"}
                        </Button>
                        <Button
                          disabled={row.review_status === "Follow-Up Needed"}
                          onClick={(event) => {
                            event.stopPropagation();
                            setCompanyReviewStatus(row.companyKey, "Follow-Up Needed");
                          }}
                          size="small"
                          sx={{ fontWeight: 800, whiteSpace: "nowrap" }}
                          variant="outlined"
                        >
                          Follow-Up
                        </Button>
                        <Button
                          disabled={row.review_status === "Ignored"}
                          onClick={(event) => {
                            event.stopPropagation();
                            setCompanyReviewStatus(row.companyKey, "Ignored");
                          }}
                          size="small"
                          sx={{ fontWeight: 800, whiteSpace: "nowrap" }}
                          variant="outlined"
                        >
                          Ignore
                        </Button>
                        <Button
                          disabled={!row.website}
                          onClick={(event) => {
                            event.stopPropagation();
                            openCompanyWebsite(row);
                          }}
                          size="small"
                          sx={{ fontWeight: 800, whiteSpace: "nowrap" }}
                          variant="outlined"
                        >
                          Open Website
                        </Button>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        ) : (
          <EmptyState hasActiveFilters={activeFilterCount > 0} />
        )}
        <TablePagination
          component="div"
          count={filteredCompanyRows.length}
          onPageChange={handleChangePage}
          onRowsPerPageChange={handleChangeRowsPerPage}
          page={page}
          rowsPerPage={rowsPerPage}
          rowsPerPageOptions={[25, 50, 100]}
        />
      </Paper>

      <Paper
        elevation={0}
        sx={{
          border: "1px solid rgba(0, 51, 108, 0.10)",
          borderRadius: 2,
          p: { xs: 2, md: 3 },
        }}
      >
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={2}
          sx={{ alignItems: { xs: "flex-start", md: "center" }, justifyContent: "space-between", mb: 2 }}
        >
          <Box>
            <Typography color="primary.main" sx={{ fontWeight: 800 }} variant="h6">
              Action Panel
            </Typography>
            <Typography color="text.secondary" variant="body2">
              Select a visitor company to review status, notes, and qualification actions.
            </Typography>
          </Box>
          <Button
            disabled={!selectedCompany}
            onClick={() => selectedCompany && setIsDetailOpen(true)}
            size="large"
            sx={{ borderRadius: 1, fontWeight: 800, minWidth: 170 }}
            variant="contained"
          >
            View Details
          </Button>
        </Stack>

        <Box
          sx={{
            display: "grid",
            gap: 2,
            gridTemplateColumns: {
              xs: "1fr",
              md: "240px minmax(0, 1fr)",
            },
          }}
        >
          <Box>
            <Typography color="text.secondary" variant="overline">
              Selected Company
            </Typography>
            <Typography color="primary.main" sx={{ fontSize: "1.5rem", fontWeight: 800, lineHeight: 1.15 }}>
              {selectedCompany?.company_name || "None selected"}
            </Typography>
            {selectedCompany ? (
              <Typography color="text.secondary" sx={{ mt: 0.75 }} variant="body2">
                {selectedCompany.intent_score}% intent - {selectedCompany.review_status}
              </Typography>
            ) : null}
          </Box>
          <Box>
            <Typography color="text.secondary" variant="overline">
              Visitor Management
            </Typography>
            {selectedCompany ? (
              <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mt: 0.75 }}>
                <Button
                  disabled={selectedCompany.review_status === "Reviewed"}
                  onClick={() => setCompanyReviewStatus(selectedCompany.companyKey, "Reviewed")}
                  size="small"
                  sx={{ fontWeight: 800, whiteSpace: "nowrap" }}
                  variant="outlined"
                >
                  {selectedCompany.review_status === "Reviewed" ? "Reviewed" : "Mark Reviewed"}
                </Button>
                <Button
                  disabled={selectedCompany.review_status === "Follow-Up Needed"}
                  onClick={() => setCompanyReviewStatus(selectedCompany.companyKey, "Follow-Up Needed")}
                  size="small"
                  sx={{ fontWeight: 800, whiteSpace: "nowrap" }}
                  variant="outlined"
                >
                  Follow-Up
                </Button>
                <Button
                  disabled={selectedCompany.review_status === "Ignored"}
                  onClick={() => setCompanyReviewStatus(selectedCompany.companyKey, "Ignored")}
                  size="small"
                  sx={{ fontWeight: 800, whiteSpace: "nowrap" }}
                  variant="outlined"
                >
                  Ignore
                </Button>
                <Button
                  disabled={!selectedCompany.website}
                  onClick={() => openCompanyWebsite(selectedCompany)}
                  size="small"
                  sx={{ fontWeight: 800, whiteSpace: "nowrap" }}
                  variant="outlined"
                >
                  Open Website
                </Button>
                <FutureActionButton>Create Prospect</FutureActionButton>
                <FutureActionButton>Match Existing Account</FutureActionButton>
                <FutureActionButton>Send to AI Prospecting</FutureActionButton>
              </Stack>
            ) : (
              <Typography color="text.secondary" sx={{ mt: 0.75 }} variant="body2">
                Select a row in the table to enable visitor management actions.
              </Typography>
            )}
          </Box>
        </Box>
      </Paper>

      <Dialog
        fullWidth
        maxWidth="md"
        onClose={() => setIsDetailOpen(false)}
        open={Boolean(selectedCompany && isDetailOpen)}
      >
        {selectedCompany ? (
          <>
            <DialogTitle>
              <Typography color="primary.main" sx={{ fontWeight: 800 }} variant="h6">
                {selectedCompany.company_name || "Missing Company Name"}
              </Typography>
              <Typography color="text.secondary" variant="body2">
                Leadfeeder visitor details and review context.
              </Typography>
            </DialogTitle>
            <DialogContent dividers>
              <Stack spacing={3}>
                <Box
                  sx={{
                    display: "grid",
                    gap: 2,
                    gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", md: "repeat(3, minmax(0, 1fr))" },
                  }}
                >
                  <DetailField label="Company Name">{selectedCompany.company_name}</DetailField>
                  <DetailField label="Website">
                    {selectedCompany.website ? (
                      <Link href={getWebsiteHref(selectedCompany.website)} rel="noreferrer" target="_blank" underline="hover">
                        {selectedCompany.website}
                      </Link>
                    ) : (
                      "Missing"
                    )}
                  </DetailField>
                  <DetailField label="Country">{selectedCompany.country}</DetailField>
                  <DetailField label="State">{selectedCompany.state}</DetailField>
                  <DetailField label="City">{selectedCompany.city}</DetailField>
                  <DetailField label="Industry">{selectedCompany.industry}</DetailField>
                  <DetailField label="Visit Count">{numberFormatter.format(selectedCompany.visit_count)}</DetailField>
                  <DetailField label="First Visit Date">{formatDate(selectedCompany.first_visit_date)}</DetailField>
                  <DetailField label="Last Visit Date">{formatDate(selectedCompany.last_visit_date)}</DetailField>
                </Box>

                <Divider />

                <Box
                  sx={{
                    display: "grid",
                    gap: 2,
                    gridTemplateColumns: { xs: "1fr", md: "repeat(3, minmax(0, 1fr))" },
                  }}
                >
                  <Box>
                    <Typography color="text.secondary" variant="caption">
                      Intent Score
                    </Typography>
                    <Box sx={{ mt: 0.75 }}>
                      <IntentScoreBadge intentLevel={selectedCompany.intent_level} score={selectedCompany.intent_score} />
                    </Box>
                  </Box>
                  <Box>
                    <Typography color="text.secondary" variant="caption">
                      Review Status
                    </Typography>
                    <Box sx={{ mt: 0.75 }}>
                      <Chip
                        color={getReviewStatusColor(selectedCompany.review_status)}
                        label={selectedCompany.review_status}
                        size="small"
                        sx={{ fontWeight: 800 }}
                      />
                    </Box>
                  </Box>
                  <Box>
                    <Typography color="text.secondary" variant="caption">
                      Missing Fields
                    </Typography>
                    <Box sx={{ mt: 0.75 }}>
                      <MissingFieldChips fields={selectedCompany.missing_fields} maxVisible={selectedCompany.missing_fields.length} />
                    </Box>
                  </Box>
                </Box>

                <TextField
                  fullWidth
                  label="Notes"
                  minRows={4}
                  multiline
                  onChange={(event) => updateCompanyNotes(selectedCompany.companyKey, event.target.value)}
                  placeholder="Add review notes for this visitor company."
                  value={selectedCompany.notes}
                />

                <Box>
                  <Typography color="text.secondary" sx={{ fontWeight: 700, mb: 1 }} variant="body2">
                    Visitor Management
                  </Typography>
                  <Stack direction="row" flexWrap="wrap" gap={1}>
                    <Button
                      disabled={selectedCompany.review_status === "Reviewed"}
                      onClick={() => setCompanyReviewStatus(selectedCompany.companyKey, "Reviewed")}
                      size="small"
                      sx={{ fontWeight: 800, whiteSpace: "nowrap" }}
                      variant="contained"
                    >
                      {selectedCompany.review_status === "Reviewed" ? "Reviewed" : "Mark Reviewed"}
                    </Button>
                    <Button
                      disabled={selectedCompany.review_status === "Follow-Up Needed"}
                      onClick={() => setCompanyReviewStatus(selectedCompany.companyKey, "Follow-Up Needed")}
                      size="small"
                      sx={{ fontWeight: 800, whiteSpace: "nowrap" }}
                      variant="outlined"
                    >
                      Mark Follow-Up Needed
                    </Button>
                    <Button
                      disabled={selectedCompany.review_status === "Ignored"}
                      onClick={() => setCompanyReviewStatus(selectedCompany.companyKey, "Ignored")}
                      size="small"
                      sx={{ fontWeight: 800, whiteSpace: "nowrap" }}
                      variant="outlined"
                    >
                      Ignore Visitor
                    </Button>
                    <Button
                      disabled={!selectedCompany.website}
                      onClick={() => openCompanyWebsite(selectedCompany)}
                      size="small"
                      sx={{ fontWeight: 800, whiteSpace: "nowrap" }}
                      variant="outlined"
                    >
                      Open Website
                    </Button>
                    <FutureActionButton>Create Prospect</FutureActionButton>
                    <FutureActionButton>Match Existing Account</FutureActionButton>
                    <FutureActionButton>Send to AI Prospecting</FutureActionButton>
                  </Stack>
                </Box>

                <Divider />

                <Box
                  sx={{
                    display: "grid",
                    gap: 2,
                    gridTemplateColumns: { xs: "1fr", md: "repeat(3, minmax(0, 1fr))" },
                  }}
                >
                  <Box>
                    <Typography color="text.secondary" sx={{ fontWeight: 700 }} variant="body2">
                      Pages Visited
                    </Typography>
                    <Typography sx={{ mt: 0.5 }} variant="body2">
                      {selectedCompany.pages_visited
                        ? `${numberFormatter.format(selectedCompany.pages_visited)} page${selectedCompany.pages_visited === 1 ? "" : "s"}`
                        : "Not available"}
                    </Typography>
                    {selectedCompany.pages_visited_list.length ? (
                      <Stack spacing={0.5} sx={{ mt: 1 }}>
                        {selectedCompany.pages_visited_list.slice(0, 6).map((pageLabel) => (
                          <Typography key={pageLabel} sx={{ overflowWrap: "anywhere" }} variant="caption">
                            {pageLabel}
                          </Typography>
                        ))}
                      </Stack>
                    ) : null}
                  </Box>
                  <Box>
                    <Typography color="text.secondary" sx={{ fontWeight: 700 }} variant="body2">
                      Visit Timestamps
                    </Typography>
                    {selectedCompany.visit_timestamps.length ? (
                      <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                        {selectedCompany.visit_timestamps.slice(0, 8).map((timestamp) => (
                          <Typography key={timestamp} variant="caption">
                            {formatDateTime(timestamp)}
                          </Typography>
                        ))}
                      </Stack>
                    ) : (
                      <Typography sx={{ mt: 0.5 }} variant="body2">
                        Not available
                      </Typography>
                    )}
                  </Box>
                  <Box>
                    <Typography color="text.secondary" sx={{ fontWeight: 700 }} variant="body2">
                      Visit Duration
                    </Typography>
                    {selectedCompany.visit_durations.length ? (
                      <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                        {selectedCompany.visit_durations.slice(0, 8).map((duration) => (
                          <Typography key={duration} variant="caption">
                            {formatDuration(duration)}
                          </Typography>
                        ))}
                      </Stack>
                    ) : (
                      <Typography sx={{ mt: 0.5 }} variant="body2">
                        Not available
                      </Typography>
                    )}
                  </Box>
                </Box>
              </Stack>
            </DialogContent>
            <DialogActions sx={{ px: 3, py: 2 }}>
              <Button onClick={() => setIsDetailOpen(false)} sx={{ fontWeight: 800 }}>
                Close
              </Button>
              <Button
                disabled={selectedCompany.review_status === "Reviewed"}
                onClick={() => setCompanyReviewStatus(selectedCompany.companyKey, "Reviewed")}
                sx={{ fontWeight: 800 }}
                variant="contained"
              >
                {selectedCompany.review_status === "Reviewed" ? "Reviewed" : "Mark Reviewed"}
              </Button>
            </DialogActions>
          </>
        ) : null}
      </Dialog>
    </Stack>
  );
}
