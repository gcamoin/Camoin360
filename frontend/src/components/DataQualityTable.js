import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  Alert,
  Badge,
  Box,
  Button,
  Chip,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Link,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";

import { API_BASE_URL, getApiErrorMessage, getAuthHeaders, handleUnauthorized } from "../auth";
import DataQualityFilters from "./DataQualityFilters";
import DataQualitySummary from "./DataQualitySummary";
import FieldUpdateSelector from "./FieldUpdateSelector";

const API_URL = `${API_BASE_URL}/accounts/data-quality`;
const SEARCH_DEBOUNCE_MS = 200;
const DEFAULT_ROWS_PER_PAGE = 25;

let dataQualityCache = null;

const columns = [
  { key: "name", label: "Company Name", width: "20%" },
  { key: "new_sector", label: "Sector", width: "14%" },
  { key: "websiteurl", label: "Website", width: "15%" },
  { key: "address1_stateorprovince", label: "State", width: "8%" },
  { key: "address1_country", label: "Country", width: "10%" },
  { key: "address1_city", label: "City", width: "10%" },
  { key: "missing_fields_summary", label: "Missing Fields Summary", width: "15%" },
  { key: "data_quality_score", label: "Quality", width: "8%" },
];

const qualityFields = [
  { key: "name", label: "Company Name" },
  { key: "new_sector", label: "Sector" },
  { key: "websiteurl", label: "Website" },
  { key: "address1_stateorprovince", label: "State" },
  { key: "address1_country", label: "Country" },
  { key: "address1_city", label: "City" },
  { key: "description", label: "Description" },
  { key: "telephone1", label: "Phone" },
  { key: "new_datasource", label: "Data Source" },
  { key: "new_employees", label: "Employee Count" },
];

const fieldUpdateOptions = [
  { key: "websiteurl", label: "Website" },
  { key: "telephone1", label: "Phone" },
  { key: "description", label: "Description" },
  { key: "new_employees", label: "Employee Count" },
  { key: "address1_stateorprovince", label: "State" },
  { key: "address1_country", label: "Country" },
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
  { key: "websiteurl", label: "Missing Website" },
  { key: "telephone1", label: "Missing Phone" },
  { key: "description", label: "Missing Description" },
  { key: "new_employees", label: "Missing Employee Count" },
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
    const searchText = qualityFields.map((field) => normalizeValue(account[field.key])).join(" ");

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

function renderCell(account, columnKey) {
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
        <Badge
          badgeContent={`${score}%`}
          color={qualityDisplay.color}
          sx={{
            justifySelf: "start",
            "& .MuiBadge-badge": {
              fontSize: "0.65rem",
              fontWeight: 800,
              minWidth: 30,
              right: -12,
            },
          }}
        >
          <Chip color={qualityDisplay.color} label={qualityDisplay.label} size="small" />
        </Badge>
        <LinearProgress
          color={qualityDisplay.color}
          sx={{ borderRadius: 999, height: 6 }}
          value={score}
          variant="determinate"
        />
      </Box>
    );
  }

  const value = account[columnKey];

  if (isMissingValue(value)) {
    return (
      <Typography color="text.secondary" variant="body2">
        Missing
      </Typography>
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
  const [error, setError] = useState("");
  const [selectedSector, setSelectedSector] = useState("all");
  const [selectedMissingField, setSelectedMissingField] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [showNeedsAttentionOnly, setShowNeedsAttentionOnly] = useState(false);
  const [selectedAccountIds, setSelectedAccountIds] = useState(() => new Set());
  const [fieldsToUpdate, setFieldsToUpdate] = useState(() => new Set());
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_ROWS_PER_PAGE);

  const sectors = useMemo(
    () =>
      Array.from(
        new Set(
          accounts
            .map((account) => account.new_sector)
            .filter((sector) => !isMissingValue(sector))
            .map((sector) => String(sector).trim())
        )
      ).sort((a, b) => a.localeCompare(b)),
    [accounts]
  );

  const filteredAccounts = useMemo(() => {
    const normalizedQuery = normalizeValue(debouncedSearchQuery);

    return accounts.filter((account) => {
      const matchesSector =
        selectedSector === "all" || String(account.new_sector || "").trim() === selectedSector;
      const matchesMissingField =
        selectedMissingField === "all" || account.missingFieldKeys.has(selectedMissingField);
      const matchesAttentionFilter = !showNeedsAttentionOnly || hasMissingQualityField(account);

      return (
        matchesSector &&
        matchesMissingField &&
        matchesAttentionFilter &&
        matchesSearch(account, normalizedQuery)
      );
    });
  }, [accounts, debouncedSearchQuery, selectedMissingField, selectedSector, showNeedsAttentionOnly]);

  const dataQualitySummary = useMemo(() => {
    const totalAccounts = accounts.length;
    const accountsNeedingAttention = accounts.filter(hasMissingQualityField).length;
    const averageDataQualityScore = totalAccounts
      ? Math.round(
          accounts.reduce((total, account) => total + account.dataQualityScore, 0) / totalAccounts
        )
      : 0;

    const missingByField = qualityFields
      .map((field) => ({
        ...field,
        missing: accounts.filter((account) => account.missingFieldKeys.has(field.key)).length,
      }))
      .filter((field) => field.missing > 0)
      .sort((firstField, secondField) => secondField.missing - firstField.missing);

    return {
      accountsNeedingAttention,
      averageDataQualityScore,
      mostCommonMissingField: missingByField[0]?.label || "None",
      totalAccounts,
    };
  }, [accounts]);

  const missingCounts = useMemo(() => {
    const keyFieldMetrics = keyMissingMetricFields.map((field) => ({
      ...field,
      missing: filteredAccounts.filter((account) => account.missingFieldKeys.has(field.key)).length,
    }));
    const incompleteLocationCount = filteredAccounts.filter((account) =>
      locationScoreFields.some((fieldKey) => account.missingFieldKeys.has(fieldKey))
    ).length;

    return [
      ...keyFieldMetrics,
      {
        key: "incomplete_location",
        label: "Incomplete Location",
        missing: incompleteLocationCount,
        helperText: "Missing city, state, or country",
      },
    ];
  }, [filteredAccounts]);

  const activeFilterCount = [
    selectedSector !== "all",
    selectedMissingField !== "all",
    showNeedsAttentionOnly,
    Boolean(searchQuery.trim()),
  ].filter(Boolean).length;

  const paginatedAccounts = useMemo(
    () => filteredAccounts.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage),
    [filteredAccounts, page, rowsPerPage]
  );
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
  const canPreviewEnrichment = selectedAccountIds.size > 0 && selectedFieldLabels.length > 0;

  function resetFilters() {
    setSelectedSector("all");
    setSelectedMissingField("all");
    setSearchQuery("");
    setDebouncedSearchQuery("");
    setShowNeedsAttentionOnly(false);
    setPage(0);
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

  function toggleFieldToUpdate(fieldKey) {
    setFieldsToUpdate((currentFields) => {
      const nextFields = new Set(currentFields);

      if (nextFields.has(fieldKey)) {
        nextFields.delete(fieldKey);
      } else {
        nextFields.add(fieldKey);
      }

      return nextFields;
    });
  }

  function handleChangePage(_event, nextPage) {
    setPage(nextPage);
  }

  function handleChangeRowsPerPage(event) {
    setRowsPerPage(Number(event.target.value));
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
  }, [selectedMissingField, selectedSector, showNeedsAttentionOnly]);

  useEffect(() => {
    const lastPage = Math.max(0, Math.ceil(filteredAccounts.length / rowsPerPage) - 1);

    if (page > lastPage) {
      setPage(lastPage);
    }
  }, [filteredAccounts.length, page, rowsPerPage]);

  useEffect(() => {
    let isMounted = true;

    async function fetchAccounts() {
      if (dataQualityCache) {
        setAccounts(dataQualityCache);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError("");

      try {
        const response = await axios.get(API_URL, { headers: getAuthHeaders() });
        if (isMounted) {
          const preparedRows = prepareAccountRows(response.data?.data || []);
          dataQualityCache = preparedRows;
          setAccounts(preparedRows);
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
  }, []);

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
        filteredAccountCount={filteredAccounts.length}
        missingCounts={missingCounts}
        summary={dataQualitySummary}
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
          missingFieldOptions={qualityFields}
          onMissingFieldChange={setSelectedMissingField}
          onNeedsAttentionChange={setShowNeedsAttentionOnly}
          onResetFilters={resetFilters}
          onSearchChange={setSearchQuery}
          onSectorChange={setSelectedSector}
          searchQuery={searchQuery}
          sectors={sectors}
          selectedMissingField={selectedMissingField}
          selectedSector={selectedSector}
          showNeedsAttentionOnly={showNeedsAttentionOnly}
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
          <Typography color="text.secondary" variant="body2">
            Showing {paginatedAccounts.length} of {filteredAccounts.length} Accounts
          </Typography>
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
        <TableContainer sx={{ maxHeight: "calc(100vh - 360px)" }}>
          <Table size="small" stickyHeader sx={{ tableLayout: "fixed", width: "100%" }}>
            <TableHead>
              <TableRow>
                <TableCell
                  padding="checkbox"
                  sx={{
                    backgroundColor: "primary.main",
                    color: "common.white",
                    width: 52,
                  }}
                >
                  <Checkbox
                    checked={areAllVisibleRowsSelected}
                    disabled={!visibleAccountIds.length}
                    indeterminate={areSomeVisibleRowsSelected}
                    inputProps={{ "aria-label": "Select all visible accounts" }}
                    onChange={toggleVisibleAccountSelection}
                    sx={{ color: "common.white", "&.Mui-checked": { color: "common.white" } }}
                  />
                </TableCell>
                {columns.map((column) => (
                  <TableCell
                    key={column.key}
                    sx={{
                      backgroundColor: "primary.main",
                      color: "common.white",
                      fontWeight: 800,
                      py: 1.25,
                      whiteSpace: "nowrap",
                      width: column.width,
                    }}
                  >
                    {column.label}
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
                      <TableCell padding="checkbox">
                        <Checkbox
                          checked={isSelected}
                          inputProps={{ "aria-label": `Select ${account.name || "account"}` }}
                          onChange={() => toggleAccountSelection(accountId)}
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
                            verticalAlign: "top",
                            whiteSpace: column.key === "description" ? "normal" : "nowrap",
                            wordBreak: column.key === "description" ? "break-word" : "normal",
                          }}
                        >
                          {renderCell(account, column.key)}
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={columns.length + 1}>
                    <Typography color="text.secondary" sx={{ py: 3, textAlign: "center" }}>
                      No account records found.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          component="div"
          count={filteredAccounts.length}
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
            onClick={() => setIsPreviewOpen(true)}
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
            onToggleField={toggleFieldToUpdate}
            selectedFieldLabels={selectedFieldLabels}
          />
        </Box>
      </Paper>

      <Dialog fullWidth maxWidth="sm" onClose={() => setIsPreviewOpen(false)} open={isPreviewOpen}>
        <DialogTitle sx={{ color: "primary.main", fontWeight: 800 }}>
          Preview Enrichment
        </DialogTitle>
        <DialogContent dividers>
          <Box sx={{ display: "grid", gap: 2 }}>
            <Box>
              <Typography color="text.secondary" variant="overline">
                Selected Accounts
              </Typography>
              <Typography color="primary.main" sx={{ fontSize: "1.75rem", fontWeight: 800, lineHeight: 1.15 }}>
                {selectedAccountIds.size} Account{selectedAccountIds.size === 1 ? "" : "s"} Selected
              </Typography>
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
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIsPreviewOpen(false)} sx={{ borderRadius: 1, fontWeight: 800 }} variant="contained">
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
