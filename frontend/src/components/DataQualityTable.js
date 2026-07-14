import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  Alert,
  Box,
  Button,
  Chip,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  LinearProgress,
  Link,
  Menu,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";

import { API_BASE_URL, getApiErrorMessage, getAuthHeaders, handleUnauthorized } from "../auth";
import { getCached, invalidateApiCache } from "../apiClient";
import DataQualityFilters from "./DataQualityFilters";
import DataQualitySummary from "./DataQualitySummary";
import FieldUpdateSelector from "./FieldUpdateSelector";
import { EmptyState, ModalTitle, subtleTableHeadCellSx } from "./UiPrimitives";

const API_URL = `${API_BASE_URL}/accounts/data-quality`;
const ENRICHMENT_RUN_URL = `${API_BASE_URL}/accounts/enrichment-run`;
const SEARCH_DEBOUNCE_MS = 200;
const DEFAULT_ROWS_PER_PAGE = 25;
const INITIAL_ACCOUNT_LIMIT = 100000;
const ACCOUNT_LIMIT_STEP = 100000;
const MAX_ACCOUNT_LIMIT = 100000;
const ACCOUNT_LOAD_TIMEOUT_MS = 5 * 60 * 1000;
const usStateNamesByAbbreviation = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
  DC: "District of Columbia",
};
const canadaProvinceNamesByAbbreviation = {
  AB: "Alberta",
  BC: "British Columbia",
  MB: "Manitoba",
  NB: "New Brunswick",
  NL: "Newfoundland and Labrador",
  NT: "Northwest Territories",
  NS: "Nova Scotia",
  NU: "Nunavut",
  ON: "Ontario",
  PE: "Prince Edward Island",
  QC: "Quebec",
  SK: "Saskatchewan",
  YT: "Yukon",
};

let dataQualityCache = null;

export function __resetDataQualityCacheForTests() {
  dataQualityCache = null;
  invalidateApiCache(API_URL);
}

const columns = [
  { key: "name", label: "Company Name", width: 220 },
  { key: "new_sector", label: "Sector", width: 180 },
  { key: "new_subsector", label: "Subsector", width: 180 },
  { key: "websiteurl", label: "Website", width: 190 },
  { key: "telephone1", label: "Business Phone", width: 170 },
  { key: "address1_country", label: "Country", width: 140 },
  { key: "address1_stateorprovince", label: "State/Province", width: 190 },
  { key: "address1_city", label: "City", width: 150 },
  { key: "new_employees", label: "Employee Count", width: 150 },
  { key: "new_naicstext", label: "NAICS Text", width: 190 },
  { key: "missing_fields_summary", label: "Missing Fields Summary", width: 220 },
  { key: "data_quality_score", label: "Quality", width: 140 },
];
const selectionColumnWidth = 56;
const tableMinWidth = columns.reduce((totalWidth, column) => totalWidth + column.width, selectionColumnWidth);

const qualityFields = [
  { key: "name", label: "Company Name" },
  { key: "new_sector", label: "Sector" },
  { key: "new_subsector", label: "Subsector" },
  { key: "websiteurl", label: "Website" },
  { key: "address1_country", label: "Country" },
  { key: "address1_stateorprovince", label: "State/Province" },
  { key: "address1_city", label: "City" },
  { key: "description", label: "Description" },
  { key: "telephone1", label: "Business Phone" },
  { key: "new_datasource", label: "Data Source" },
  { key: "new_employees", label: "Employee Count" },
  { key: "new_naicstext", label: "NAICS Text" },
];

const fieldUpdateOptions = [
  { key: "websiteurl", label: "Website" },
  { key: "telephone1", label: "Business Phone" },
  { key: "description", label: "Description" },
  { key: "new_employees", label: "Employee Count" },
  { key: "address1_country", label: "Country" },
  { key: "address1_stateorprovince", label: "State/Province" },
  { key: "address1_city", label: "City" },
  { key: "new_datasource", label: "Data Source" },
];

const scoreFields = [
  { key: "websiteurl", points: 20 },
  { key: "telephone1", points: 20 },
  { key: "description", points: 20 },
  { key: "new_employees", points: 20 },
];

const locationScoreFields = ["address1_city", "address1_stateorprovince", "address1_country"];
const keyMissingMetricFields = [
  { key: "new_sector", label: "Missing Sector" },
  { key: "new_subsector", label: "Missing Subsector" },
  { key: "websiteurl", label: "Missing Website" },
  { key: "telephone1", label: "Missing Business Phone" },
  { key: "description", label: "Missing Description" },
  { key: "new_employees", label: "Missing Employee Count" },
  { key: "new_datasource", label: "Missing Data Source" },
  { key: "new_naicstext", label: "Missing NAICS Text" },
];

function getAccountSelectionId(account) {
  return [
    account.accountid,
    account.name,
    account.websiteurl,
    account.telephone1,
  ]
    .filter((value) => !isMissingValue(value))
    .join("|");
}

function getRowSelectionId(account, index) {
  return getAccountSelectionId(account) || `${account.name || "account"}-${index}`;
}

function isMissingValue(value) {
  return value === null || value === undefined || String(value).trim() === "";
}

function normalizeValue(value) {
  return String(value || "").trim().toLowerCase();
}

function toLookupKey(value) {
  return String(value || "").trim().toUpperCase();
}

export function getCountryGroup(value) {
  const normalizedCountry = normalizeValue(value).replace(/[.\s]/g, "");

  if (["us", "usa", "unitedstates", "unitedstatesofamerica"].includes(normalizedCountry)) {
    return "us";
  }

  if (["ca", "can", "canada"].includes(normalizedCountry)) {
    return "canada";
  }

  return normalizedCountry;
}

export function countryMatches(accountCountry, selectedCountry) {
  if (selectedCountry === "all") {
    return true;
  }

  return getCountryGroup(accountCountry) === getCountryGroup(selectedCountry);
}

export function getStateProvinceDisplayValue(value, country) {
  if (isMissingValue(value)) {
    return value;
  }

  const lookupKey = toLookupKey(value);
  const countryGroup = getCountryGroup(country);

  if (countryGroup === "us") {
    return usStateNamesByAbbreviation[lookupKey] || value;
  }

  if (countryGroup === "canada") {
    return canadaProvinceNamesByAbbreviation[lookupKey] || value;
  }

  return usStateNamesByAbbreviation[lookupKey] || canadaProvinceNamesByAbbreviation[lookupKey] || value;
}

function getDisplayValue(account, columnKey) {
  if (columnKey === "address1_stateorprovince") {
    return getStateProvinceDisplayValue(account.address1_stateorprovince, account.address1_country);
  }

  return account[columnKey];
}

function getColumnFilterValue(account, columnKey) {
  if (columnKey === "missing_fields_summary") {
    return account.missingFieldsSummary;
  }

  if (columnKey === "data_quality_score") {
    return account.dataQualityScore;
  }

  return getDisplayValue(account, columnKey);
}

function getUniqueColumnOptions(accounts, columnKey) {
  return Array.from(
    new Set(
      accounts
        .map((account) => getDisplayValue(account, columnKey))
        .filter((value) => !isMissingValue(value))
        .map((value) => String(value).trim())
    )
  ).sort((a, b) => a.localeCompare(b));
}

export function getStateProvinceOptions(accounts, selectedCountry) {
  const optionSource =
    selectedCountry === "all"
      ? accounts
      : accounts.filter((account) => countryMatches(account.address1_country, selectedCountry));

  return getUniqueColumnOptions(optionSource, "address1_stateorprovince");
}

export function getCityOptions(accounts, selectedCountry, selectedStates) {
  if (!selectedStates.length) {
    return [];
  }

  const optionSource = accounts.filter((account) => {
    const matchesCountry = countryMatches(account.address1_country, selectedCountry);
    const accountState = String(getDisplayValue(account, "address1_stateorprovince") || "").trim();

    return matchesCountry && selectedStates.includes(accountState);
  });

  return getUniqueColumnOptions(optionSource, "address1_city");
}

function matchesSelectedValues(value, selectedValues) {
  return !selectedValues.length || selectedValues.includes(String(value || "").trim());
}

function sortAccounts(accounts, sortConfig) {
  if (!sortConfig.key) {
    return accounts;
  }

  const directionMultiplier = sortConfig.direction === "asc" ? 1 : -1;

  return [...accounts].sort((firstAccount, secondAccount) => {
    const firstValue = normalizeValue(getDisplayValue(firstAccount, sortConfig.key));
    const secondValue = normalizeValue(getDisplayValue(secondAccount, sortConfig.key));

    if (firstValue === secondValue) {
      return normalizeValue(firstAccount.name).localeCompare(normalizeValue(secondAccount.name));
    }

    if (isMissingValue(firstValue)) {
      return 1;
    }

    if (isMissingValue(secondValue)) {
      return -1;
    }

    return firstValue.localeCompare(secondValue) * directionMultiplier;
  });
}

function getMissingQualityFields(account) {
  return qualityFields.filter((field) => isMissingValue(account[field.key]));
}

function getDataQualityScore(account) {
  const fieldScore = scoreFields.reduce(
    (total, field) => total + (isMissingValue(account[field.key]) ? 0 : field.points),
    0
  );
  const locationScore = locationScoreFields.every((fieldKey) => !isMissingValue(account[fieldKey])) ? 20 : 0;

  return fieldScore + locationScore;
}

function hasMissingQualityField(account) {
  return account.hasMissingQualityField;
}

function getQualityDisplay(score) {
  if (score >= 80) {
    return { color: "success", label: "Good" };
  }

  if (score >= 50) {
    return { color: "warning", label: "Fair" };
  }

  return { color: "error", label: "Poor" };
}

function matchesSearch(account, query) {
  if (!query) {
    return true;
  }

  return account.searchText.includes(query);
}

function prepareAccountRows(accounts) {
  return accounts.map((account, index) => {
    const missingFields = getMissingQualityFields(account);
    const missingFieldKeys = new Set(missingFields.map((field) => field.key));
    const missingFieldLabels = missingFields.map((field) => field.label);
    const missingFieldsSummary = missingFieldLabels.length ? missingFieldLabels.join(", ") : "Complete";
    const selectionId = getRowSelectionId(account, index);
    const searchText = qualityFields.map((field) => normalizeValue(getDisplayValue(account, field.key))).join(" ");

    return {
      ...account,
      dataQualityScore: getDataQualityScore(account),
      hasMissingQualityField: missingFields.length > 0,
      missingFieldKeys,
      missingFieldLabels,
      missingFieldsSummary,
      searchText,
      selectionId,
    };
  });
}

function renderCell(account, columnKey, onCompanyPreview) {
  if (columnKey === "missing_fields_summary") {
    return (
      <Tooltip arrow title={account.missingFieldsSummary}>
        <Typography
          color={account.hasMissingQualityField ? "text.primary" : "success.main"}
          component="span"
          sx={{
            display: "block",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          variant="body2"
        >
          {account.missingFieldsSummary}
        </Typography>
      </Tooltip>
    );
  }

  if (columnKey === "data_quality_score") {
    const score = account.dataQualityScore;
    const qualityDisplay = getQualityDisplay(score);

    return (
      <Box
        sx={{
          display: "grid",
          gap: 0.75,
          minWidth: 82,
        }}
      >
        <Typography
          color={`${qualityDisplay.color}.main`}
          sx={{
            fontSize: "0.85rem",
            fontWeight: 800,
            lineHeight: 1,
          }}
          variant="body2"
        >
          {score}%
        </Typography>
        <LinearProgress
          color={qualityDisplay.color}
          sx={{ borderRadius: 999, height: 6 }}
          value={score}
          variant="determinate"
        />
      </Box>
    );
  }

  const value = getDisplayValue(account, columnKey);

  if (isMissingValue(value)) {
    return (
      <Typography color="text.secondary" variant="body2">
        Missing
      </Typography>
    );
  }

  if (columnKey === "name") {
    return (
      <Button
        onClick={(event) => {
          event.stopPropagation();
          onCompanyPreview(account);
        }}
        sx={{
          fontWeight: 700,
          justifyContent: "flex-start",
          minWidth: 0,
          overflow: "hidden",
          p: 0,
          textAlign: "left",
          textOverflow: "ellipsis",
          textTransform: "none",
          whiteSpace: "nowrap",
        }}
        variant="text"
      >
        {value}
      </Button>
    );
  }

  if (columnKey === "websiteurl") {
    const href = String(value).startsWith("http") ? value : `https://${value}`;

    return (
      <Link
        href={href}
        rel="noreferrer"
        sx={{
          display: "block",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        target="_blank"
        underline="hover"
      >
        {value}
      </Link>
    );
  }

  if (columnKey === "description") {
    return (
      <Tooltip arrow title={String(value)}>
        <Typography
          component="span"
          sx={{
            display: "-webkit-box",
            overflow: "hidden",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: 3,
          }}
          variant="body2"
        >
          {value}
        </Typography>
      </Tooltip>
    );
  }

  return value;
}

export default function DataQualityTable() {
  const [accounts, setAccounts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [facets, setFacets] = useState({
    cities: [],
    countries: [],
    missing_counts: [],
    sectors: [],
    states: [],
  });
  const [filteredAccountCount, setFilteredAccountCount] = useState(0);
  const [totalAccountCount, setTotalAccountCount] = useState(0);
  const [syncStatus, setSyncStatus] = useState(null);
  const [loadedAccountLimit, setLoadedAccountLimit] = useState(INITIAL_ACCOUNT_LIMIT);
  const [hasMoreAccounts, setHasMoreAccounts] = useState(false);
  const [selectedSector, setSelectedSector] = useState("all");
  const [selectedMissingField, setSelectedMissingField] = useState("all");
  const [selectedStates, setSelectedStates] = useState([]);
  const [selectedCountry, setSelectedCountry] = useState("all");
  const [selectedCities, setSelectedCities] = useState([]);
  const [columnFilters, setColumnFilters] = useState(() => ({}));
  const [sortConfig, setSortConfig] = useState({ key: "", direction: "asc" });
  const [columnMenu, setColumnMenu] = useState({ anchorEl: null, columnKey: "" });
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [showNeedsAttentionOnly, setShowNeedsAttentionOnly] = useState(false);
  const [selectedAccountIds, setSelectedAccountIds] = useState(() => new Set());
  const [fieldsToUpdate, setFieldsToUpdate] = useState(() => new Set());
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewAccount, setPreviewAccount] = useState(null);
  const [isEnriching, setIsEnriching] = useState(false);
  const [enrichmentError, setEnrichmentError] = useState("");
  const [enrichmentResult, setEnrichmentResult] = useState(null);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_ROWS_PER_PAGE);

  const sectors = facets.sectors;
  const countries = facets.countries;
  const states = facets.states;
  const cities = facets.cities;
  const filteredAccounts = accounts;
  const missingCounts = facets.missing_counts;

  const activeFilterCount = [
    selectedSector !== "all",
    selectedMissingField !== "all",
    selectedStates.length > 0,
    selectedCountry !== "all",
    selectedCities.length > 0,
    showNeedsAttentionOnly,
    Boolean(searchQuery.trim()),
    ...Object.values(columnFilters).map((filterValue) => Boolean(String(filterValue || "").trim())),
  ].filter(Boolean).length;

  const paginatedAccounts = accounts;
  const visibleAccountIds = useMemo(
    () => paginatedAccounts.map((account) => account.selectionId),
    [paginatedAccounts]
  );
  const selectedVisibleCount = visibleAccountIds.filter((accountId) => selectedAccountIds.has(accountId)).length;
  const areAllVisibleRowsSelected = visibleAccountIds.length > 0 && selectedVisibleCount === visibleAccountIds.length;
  const areSomeVisibleRowsSelected = selectedVisibleCount > 0 && selectedVisibleCount < visibleAccountIds.length;
  const selectedFieldLabels = fieldUpdateOptions
    .filter((field) => fieldsToUpdate.has(field.key))
    .map((field) => field.label);
  const selectedAccounts = useMemo(
    () => accounts.filter((account) => selectedAccountIds.has(account.selectionId)),
    [accounts, selectedAccountIds]
  );
  const selectedDynamicsAccountIds = useMemo(
    () => selectedAccounts.map((account) => account.accountid).filter(Boolean),
    [selectedAccounts]
  );
  const canPreviewEnrichment = selectedAccountIds.size > 0 && selectedFieldLabels.length > 0;
  const canRunEnrichment = selectedDynamicsAccountIds.length > 0 && selectedFieldLabels.length > 0 && !isEnriching;
  const activeColumnMenu = columns.find((column) => column.key === columnMenu.columnKey);

  function resetFilters() {
    setSelectedSector("all");
    setSelectedMissingField("all");
    setSelectedStates([]);
    setSelectedCountry("all");
    setSelectedCities([]);
    setColumnFilters({});
    setSearchQuery("");
    setDebouncedSearchQuery("");
    setShowNeedsAttentionOnly(false);
    setPage(0);
  }

  function updateColumnFilter(columnKey, value) {
    setColumnFilters((currentFilters) => {
      const nextFilters = { ...currentFilters };

      if (value.trim()) {
        nextFilters[columnKey] = value;
      } else {
        delete nextFilters[columnKey];
      }

      return nextFilters;
    });
  }

  function updateLocationFilter(setFilterValue) {
    return (nextValue) => {
      setFilterValue(nextValue || "all");
      setPage(0);
    };
  }

  function updateMultiLocationFilter(setFilterValue) {
    return (nextValues) => {
      setFilterValue(nextValues);
      setPage(0);
    };
  }

  function openColumnMenu(event, columnKey) {
    setColumnMenu({ anchorEl: event.currentTarget, columnKey });
  }

  function closeColumnMenu() {
    setColumnMenu({ anchorEl: null, columnKey: "" });
  }

  function handleSort(columnKey, direction) {
    setSortConfig((currentSort) => {
      if (currentSort.key === columnKey && currentSort.direction === direction) {
        return currentSort;
      }

      return { key: columnKey, direction };
    });
  }

  function clearSort(columnKey) {
    setSortConfig((currentSort) => {
      if (currentSort.key !== columnKey) {
        return currentSort;
      }

      return { key: "", direction: "asc" };
    });
  }

  function toggleAccountSelection(accountId) {
    setSelectedAccountIds((currentSelection) => {
      const nextSelection = new Set(currentSelection);

      if (nextSelection.has(accountId)) {
        nextSelection.delete(accountId);
      } else {
        nextSelection.add(accountId);
      }

      return nextSelection;
    });
  }

  function toggleVisibleAccountSelection(event) {
    const shouldSelectVisibleRows = event.target.checked;

    setSelectedAccountIds((currentSelection) => {
      const nextSelection = new Set(currentSelection);

      visibleAccountIds.forEach((accountId) => {
        if (shouldSelectVisibleRows) {
          nextSelection.add(accountId);
        } else {
          nextSelection.delete(accountId);
        }
      });

      return nextSelection;
    });
  }

  function updateFieldsToUpdate(fieldKeys) {
    setFieldsToUpdate(new Set(fieldKeys));
  }

  function buildAccountRequestParams({ nextPage = page, nextRowsPerPage = rowsPerPage, refresh = false } = {}) {
    return {
      cities: selectedCities.join("|"),
      column_filters: JSON.stringify(columnFilters),
      country: selectedCountry,
      limit: loadedAccountLimit,
      missing_field: selectedMissingField,
      needs_attention: showNeedsAttentionOnly,
      page: nextPage,
      page_size: nextRowsPerPage,
      refresh,
      search: debouncedSearchQuery,
      sector: selectedSector,
      sort_direction: sortConfig.direction,
      sort_key: sortConfig.key,
      states: selectedStates.join("|"),
    };
  }

  async function loadAccounts({ nextPage = page, nextRowsPerPage = rowsPerPage, refresh = false, showLoading = false } = {}) {
    if (showLoading) {
      setIsLoading(true);
    }

    setError("");

    const response = await getCached(API_URL, {
      force: refresh,
      headers: getAuthHeaders(),
      params: buildAccountRequestParams({ nextPage, nextRowsPerPage, refresh }),
      timeout: ACCOUNT_LOAD_TIMEOUT_MS,
      ttl: 60 * 1000,
    });
    const preparedRows = prepareAccountRows(response.data?.data || []);

    dataQualityCache = null;
    setAccounts(preparedRows);
    setFacets(response.data?.facets || {
      cities: [],
      countries: [],
      missing_counts: [],
      sectors: [],
      states: [],
    });
    setFilteredAccountCount(response.data?.filtered_count || 0);
    setTotalAccountCount(response.data?.total_count || 0);
    setSyncStatus(response.data?.sync || null);
    setHasMoreAccounts(Boolean(response.data?.has_more));

    if (showLoading) {
      setIsLoading(false);
    }
  }

  async function refreshAccounts() {
    invalidateApiCache(API_URL);

    try {
      await loadAccounts({ refresh: true, showLoading: false });
    } catch (fetchError) {
      if (!handleUnauthorized(fetchError)) {
        setError(getApiErrorMessage(fetchError, "Unable to refresh account data."));
      }
    }
  }

  async function runSelectedEnrichment() {
    setIsEnriching(true);
    setEnrichmentError("");
    setEnrichmentResult(null);

    try {
      const response = await axios.post(
        ENRICHMENT_RUN_URL,
        {
          account_ids: selectedDynamicsAccountIds,
          fields_to_update: Array.from(fieldsToUpdate),
        },
        { headers: getAuthHeaders() }
      );

      setEnrichmentResult(response.data);
      await refreshAccounts();
    } catch (runError) {
      if (handleUnauthorized(runError)) {
        return;
      }

      setEnrichmentError(getApiErrorMessage(runError, "Unable to enrich selected accounts."));
    } finally {
      setIsEnriching(false);
    }
  }

  function handleChangePage(_event, nextPage) {
    setPage(nextPage);
  }

  function handleChangeRowsPerPage(event) {
    const nextRowsPerPage = Number(event.target.value);
    setRowsPerPage(nextRowsPerPage);
    setPage(0);
  }

  useEffect(() => {
    const debounceTimer = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
      setPage(0);
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(debounceTimer);
    };
  }, [searchQuery]);

  useEffect(() => {
    setPage(0);
  }, [columnFilters, debouncedSearchQuery, selectedCities, selectedCountry, selectedMissingField, selectedSector, selectedStates, showNeedsAttentionOnly, sortConfig]);

  useEffect(() => {
    const validSelectedStates = selectedStates.filter((selectedState) => states.includes(selectedState));

    if (validSelectedStates.length !== selectedStates.length) {
      setSelectedStates(validSelectedStates);
    }
  }, [selectedStates, states]);

  useEffect(() => {
    const validSelectedCities = selectedCities.filter((selectedCity) => cities.includes(selectedCity));

    if (validSelectedCities.length !== selectedCities.length) {
      setSelectedCities(validSelectedCities);
    }
  }, [cities, selectedCities]);

  useEffect(() => {
    if (syncStatus?.status !== "syncing") {
      return undefined;
    }

    const pollTimer = window.setTimeout(() => {
      invalidateApiCache(API_URL);
      loadAccounts().catch((fetchError) => {
        if (!handleUnauthorized(fetchError)) {
          setError(getApiErrorMessage(fetchError, "Unable to refresh synced account data."));
        }
      });
    }, 5000);

    return () => {
      window.clearTimeout(pollTimer);
    };
  }, [syncStatus]);

  useEffect(() => {
    const lastPage = Math.max(0, Math.ceil(filteredAccountCount / rowsPerPage) - 1);

    if (page > lastPage) {
      setPage(lastPage);
    }
  }, [filteredAccountCount, page, rowsPerPage]);

  useEffect(() => {
    setSelectedAccountIds((currentSelection) => {
      const currentPageIds = new Set(accounts.map((account) => account.selectionId));
      const nextSelection = new Set(
        Array.from(currentSelection).filter((accountId) => currentPageIds.has(accountId))
      );

      return nextSelection.size === currentSelection.size ? currentSelection : nextSelection;
    });
  }, [accounts]);

  useEffect(() => {
    let isMounted = true;

    async function fetchAccounts() {
      setIsLoading(true);
      setError("");

      try {
        const response = await getCached(API_URL, {
          headers: getAuthHeaders(),
          params: buildAccountRequestParams(),
          timeout: ACCOUNT_LOAD_TIMEOUT_MS,
          ttl: 60 * 1000,
        });
        if (isMounted) {
          const preparedRows = prepareAccountRows(response.data?.data || []);
          setAccounts(preparedRows);
          setFacets(response.data?.facets || {
            cities: [],
            countries: [],
            missing_counts: [],
            sectors: [],
            states: [],
          });
          setFilteredAccountCount(response.data?.filtered_count || 0);
          setTotalAccountCount(response.data?.total_count || 0);
          setSyncStatus(response.data?.sync || null);
          setHasMoreAccounts(Boolean(response.data?.has_more));
        }
      } catch (fetchError) {
        if (handleUnauthorized(fetchError)) {
          return;
        }

        if (isMounted) {
          setError(getApiErrorMessage(fetchError, "Unable to load account data."));
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    fetchAccounts();

    return () => {
      isMounted = false;
    };
  }, [page, rowsPerPage, columnFilters, debouncedSearchQuery, selectedCities, selectedCountry, selectedMissingField, selectedSector, selectedStates, showNeedsAttentionOnly, sortConfig]);

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
      <DataQualitySummary
        filteredAccountCount={filteredAccountCount}
        missingCounts={missingCounts}
      />

      <Paper
        elevation={0}
        sx={{
          border: "1px solid rgba(0, 51, 108, 0.10)",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <DataQualityFilters
          activeFilterCount={activeFilterCount}
          cities={cities}
          countries={countries}
          missingFieldOptions={qualityFields}
          onCityChange={updateMultiLocationFilter(setSelectedCities)}
          onCountryChange={updateLocationFilter(setSelectedCountry)}
          onMissingFieldChange={setSelectedMissingField}
          onNeedsAttentionChange={setShowNeedsAttentionOnly}
          onResetFilters={resetFilters}
          onSearchChange={setSearchQuery}
          onSectorChange={setSelectedSector}
          onStateChange={updateMultiLocationFilter(setSelectedStates)}
          searchQuery={searchQuery}
          sectors={sectors}
          selectedCities={selectedCities}
          selectedCountry={selectedCountry}
          selectedMissingField={selectedMissingField}
          selectedSector={selectedSector}
          selectedStates={selectedStates}
          showNeedsAttentionOnly={showNeedsAttentionOnly}
          states={states}
        />
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
          <Stack alignItems={{ xs: "flex-start", sm: "center" }} direction={{ xs: "column", sm: "row" }} spacing={1.5}>
            <Typography color="text.secondary" variant="body2">
              Showing {paginatedAccounts.length} of {filteredAccountCount.toLocaleString()} filtered accounts
              {totalAccountCount ? ` from ${totalAccountCount.toLocaleString()} cached accounts` : ""}
            </Typography>
            {syncStatus?.status === "syncing" ? (
              <Typography color="text.secondary" variant="body2">
                Syncing Dynamics data...
              </Typography>
            ) : null}
            {syncStatus?.last_completed_at ? (
              <Typography color="text.secondary" variant="body2">
                Synced {new Intl.DateTimeFormat(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(syncStatus.last_completed_at))}
              </Typography>
            ) : null}
          </Stack>
          <Stack direction="row" spacing={2}>
            <Typography color="text.secondary" variant="body2">
              {selectedVisibleCount} visible selected
            </Typography>
            {activeFilterCount > 0 ? (
              <Typography color="text.secondary" variant="body2">
                {activeFilterCount} active filter{activeFilterCount === 1 ? "" : "s"}
              </Typography>
            ) : null}
          </Stack>
        </Box>
        <TableContainer sx={{ maxHeight: "calc(100vh - 360px)", overflowX: "auto" }}>
          <Table size="small" stickyHeader sx={{ minWidth: tableMinWidth, tableLayout: "fixed" }}>
            <TableHead>
              <TableRow>
                <TableCell
                  padding="none"
                  sx={{
                    ...subtleTableHeadCellSx,
                    minWidth: selectionColumnWidth,
                    px: 0,
                    py: 1,
                    textAlign: "center",
                    verticalAlign: "middle",
                    width: selectionColumnWidth,
                  }}
                >
                  <Checkbox
                    checked={areAllVisibleRowsSelected}
                    disabled={!visibleAccountIds.length}
                    indeterminate={areSomeVisibleRowsSelected}
                    inputProps={{ "aria-label": "Select all visible accounts" }}
                    onChange={toggleVisibleAccountSelection}
                    size="small"
                    sx={{ color: "primary.main", p: 0.5, "&.Mui-checked": { color: "primary.main" } }}
                  />
                </TableCell>
                {columns.map((column) => (
                  <TableCell
                    key={column.key}
                    sx={{
                      ...subtleTableHeadCellSx,
                      px: 1,
                      top: 0,
                      width: column.width,
                      zIndex: 3,
                    }}
                  >
                    <Box sx={{ alignItems: "center", display: "flex", gap: 0.75, justifyContent: "space-between" }}>
                      <Typography
                        component="span"
                        sx={{
                          color: "inherit",
                          flex: "1 1 auto",
                          fontSize: "0.875rem",
                          fontWeight: 800,
                          lineHeight: 1.15,
                          minWidth: 0,
                          overflow: "visible",
                          textOverflow: "clip",
                          whiteSpace: "normal",
                          wordBreak: "normal",
                        }}
                      >
                        {column.label}
                      </Typography>
                      <Button
                        aria-label={`${column.label} filter and sort options`}
                        onClick={(event) => openColumnMenu(event, column.key)}
                        size="small"
                        sx={{
                          borderColor: "rgba(18, 59, 100, 0.26)",
                          color: "primary.main",
                          flex: "0 0 28px",
                          fontSize: "0.7rem",
                          height: 28,
                          lineHeight: 1,
                          ml: 0.25,
                          minWidth: 28,
                          px: 0.5,
                          py: 0.25,
                        }}
                        variant="outlined"
                      >
                        <Box
                          aria-hidden="true"
                          sx={{
                            borderLeft: "6px solid transparent",
                            borderRight: "6px solid transparent",
                            borderTop: "8px solid currentColor",
                            height: 0,
                            position: "relative",
                            width: 0,
                            "&::after": {
                              backgroundColor: "currentColor",
                              borderRadius: 999,
                              content: '""',
                              height: 5,
                              left: -1,
                              position: "absolute",
                              top: -1,
                              width: 2,
                            },
                          }}
                        />
                      </Button>
                    </Box>
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredAccounts.length ? (
                paginatedAccounts.map((account) => {
                  const accountId = account.selectionId;
                  const isSelected = selectedAccountIds.has(accountId);

                  return (
                    <TableRow key={accountId} hover selected={isSelected}>
                      <TableCell
                        padding="none"
                        sx={{
                          minWidth: selectionColumnWidth,
                          px: 0,
                          py: 1,
                          textAlign: "center",
                          verticalAlign: "middle",
                          width: selectionColumnWidth,
                        }}
                      >
                        <Checkbox
                          checked={isSelected}
                          inputProps={{ "aria-label": `Select ${account.name || "account"}` }}
                          onChange={() => toggleAccountSelection(accountId)}
                          size="small"
                          sx={{ p: 0.5 }}
                        />
                      </TableCell>
                      {columns.map((column) => (
                        <TableCell
                          key={column.key}
                          sx={{
                            overflow: "hidden",
                            px: 1.5,
                            py: 1.25,
                            textOverflow: "ellipsis",
                            verticalAlign: "middle",
                            width: column.width,
                            whiteSpace: column.key === "description" ? "normal" : "nowrap",
                            wordBreak: column.key === "description" ? "break-word" : "normal",
                          }}
                        >
                          {renderCell(account, column.key, setPreviewAccount)}
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={columns.length + 1} sx={{ p: 0 }}>
                    <EmptyState
                      compact
                      description="Try adjusting your filters, or refresh after Dynamics data becomes available."
                      icon="search"
                      title="No account records found"
                    />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <Menu
          anchorEl={columnMenu.anchorEl}
          onClose={closeColumnMenu}
          open={Boolean(columnMenu.anchorEl)}
        >
          <Box sx={{ p: 1.5, width: 240 }}>
            <Typography color="text.secondary" sx={{ mb: 1 }} variant="overline">
              {activeColumnMenu?.label || "Column"} Options
            </Typography>
            <TextField
              autoFocus
              fullWidth
              inputProps={{ "aria-label": `Filter ${activeColumnMenu?.label || "column"}` }}
              label="Filter"
              onChange={(event) => updateColumnFilter(columnMenu.columnKey, event.target.value)}
              size="small"
              value={columnFilters[columnMenu.columnKey] || ""}
            />
          </Box>
          <MenuItem
            onClick={() => {
              handleSort(columnMenu.columnKey, "asc");
              closeColumnMenu();
            }}
          >
            Sort ascending
          </MenuItem>
          <MenuItem
            onClick={() => {
              handleSort(columnMenu.columnKey, "desc");
              closeColumnMenu();
            }}
          >
            Sort descending
          </MenuItem>
          <MenuItem
            disabled={sortConfig.key !== columnMenu.columnKey}
            onClick={() => {
              clearSort(columnMenu.columnKey);
              closeColumnMenu();
            }}
          >
            Clear sort
          </MenuItem>
          <MenuItem
            disabled={!columnFilters[columnMenu.columnKey]}
            onClick={() => {
              updateColumnFilter(columnMenu.columnKey, "");
              closeColumnMenu();
            }}
          >
            Clear filter
          </MenuItem>
        </Menu>
        <TablePagination
          component="div"
          count={filteredAccountCount}
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
              Review selected accounts and fields before enrichment.
            </Typography>
          </Box>
          <Button
            disabled={!canPreviewEnrichment}
            onClick={() => {
              setEnrichmentError("");
              setEnrichmentResult(null);
              setIsPreviewOpen(true);
            }}
            size="large"
            sx={{ borderRadius: 1, fontWeight: 800, minWidth: 190 }}
            variant="contained"
          >
            Preview Enrichment
          </Button>
        </Stack>
        <Box
          sx={{
            display: "grid",
            gap: 2,
            gridTemplateColumns: {
              xs: "1fr",
              md: "220px minmax(0, 1fr)",
            },
          }}
        >
          <Box>
            <Typography color="text.secondary" variant="overline">
              Selected Accounts
            </Typography>
            <Typography color="primary.main" sx={{ fontSize: "1.75rem", fontWeight: 800, lineHeight: 1.15 }}>
              {selectedAccountIds.size} Account{selectedAccountIds.size === 1 ? "" : "s"} Selected
            </Typography>
          </Box>
          <FieldUpdateSelector
            fieldOptions={fieldUpdateOptions}
            fieldsToUpdate={fieldsToUpdate}
            onFieldsChange={updateFieldsToUpdate}
            selectedFieldLabels={selectedFieldLabels}
          />
        </Box>
      </Paper>

      <Dialog fullWidth maxWidth="sm" onClose={() => setIsPreviewOpen(false)} open={isPreviewOpen}>
        <ModalTitle
          onClose={() => setIsPreviewOpen(false)}
          subtitle="Confirm the selected accounts and fields before running the update."
        >
          Preview Enrichment
        </ModalTitle>
        <DialogContent dividers>
          <Box sx={{ display: "grid", gap: 2 }}>
            <Box>
              <Typography color="text.secondary" variant="overline">
                Selected Accounts
              </Typography>
              <Typography color="primary.main" sx={{ fontSize: "1.75rem", fontWeight: 800, lineHeight: 1.15 }}>
                {selectedAccountIds.size} Account{selectedAccountIds.size === 1 ? "" : "s"} Selected
              </Typography>
              {selectedDynamicsAccountIds.length !== selectedAccountIds.size ? (
                <Alert severity="warning" sx={{ mt: 1 }}>
                  Some selected rows do not have a Dynamics account ID and cannot be enriched.
                </Alert>
              ) : null}
            </Box>
            <Box>
              <Typography color="text.secondary" variant="overline">
                Selected Fields
              </Typography>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mt: 0.5 }}>
                {selectedFieldLabels.map((fieldLabel) => (
                  <Chip color="primary" key={fieldLabel} label={fieldLabel} size="small" />
                ))}
              </Box>
            </Box>
            <Alert severity="info">
              Updates require at least 3 of 5 matches: website, phone, country, state, and account name. Matches below 60% are skipped.
            </Alert>
            {enrichmentError ? <Alert severity="error">{enrichmentError}</Alert> : null}
            {enrichmentResult ? (
              <Alert severity="success">
                Seamless enrichment complete: {enrichmentResult.updated} of {enrichmentResult.processed} account
                {enrichmentResult.processed === 1 ? "" : "s"} updated. {enrichmentResult.skipped || 0} skipped below 60% confidence.
              </Alert>
            ) : null}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIsPreviewOpen(false)} sx={{ borderRadius: 1, fontWeight: 800 }}>
            Close
          </Button>
          <Button
            disabled={!canRunEnrichment}
            onClick={runSelectedEnrichment}
            sx={{ borderRadius: 1, fontWeight: 800, minWidth: 190 }}
            variant="contained"
          >
            {isEnriching ? "Enriching..." : "Enrich with Seamless"}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog fullWidth maxWidth="md" onClose={() => setPreviewAccount(null)} open={Boolean(previewAccount)}>
        <ModalTitle onClose={() => setPreviewAccount(null)} subtitle="Review the current Dynamics account details.">
          Company Preview
        </ModalTitle>
        <DialogContent dividers>
          {previewAccount ? (
            <Stack spacing={2.5}>
              <Box>
                <Typography color="text.secondary" variant="overline">
                  Company
                </Typography>
                <Typography color="primary.main" sx={{ fontWeight: 800 }} variant="h5">
                  {previewAccount.name || "Missing"}
                </Typography>
              </Box>
              <Box
                sx={{
                  display: "grid",
                  gap: 2,
                  gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))" },
                }}
              >
                {[
                  ["Sector", previewAccount.new_sector],
                  ["Subsector", previewAccount.new_subsector],
                  ["Country", previewAccount.address1_country],
                  ["State/Province", getDisplayValue(previewAccount, "address1_stateorprovince")],
                  ["City", previewAccount.address1_city],
                  ["Employee Count", previewAccount.new_employees],
                  ["NAICS Text", previewAccount.new_naicstext],
                  ["Website", previewAccount.websiteurl],
                  ["Business Phone", previewAccount.telephone1],
                  ["Data Source", previewAccount.new_datasource],
                  ["Quality", `${previewAccount.dataQualityScore}%`],
                ].map(([label, fieldValue]) => (
                  <Box key={label}>
                    <Typography color="text.secondary" variant="overline">
                      {label}
                    </Typography>
                    <Typography sx={{ overflowWrap: "anywhere" }} variant="body1">
                      {isMissingValue(fieldValue) ? "Missing" : fieldValue}
                    </Typography>
                  </Box>
                ))}
              </Box>
              <Box>
                <Typography color="text.secondary" variant="overline">
                  Description
                </Typography>
                <Typography sx={{ whiteSpace: "pre-wrap" }} variant="body1">
                  {isMissingValue(previewAccount.description) ? "Missing" : previewAccount.description}
                </Typography>
              </Box>
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPreviewAccount(null)} sx={{ borderRadius: 1, fontWeight: 800 }} variant="contained">
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
