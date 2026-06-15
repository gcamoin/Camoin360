import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  CircularProgress,
  FormControl,
  FormControlLabel,
  InputLabel,
  Link,
  MenuItem,
  Paper,
  Select,
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

const API_URL = `${API_BASE_URL}/accounts/data-quality`;
const SEARCH_DEBOUNCE_MS = 200;
const DEFAULT_ROWS_PER_PAGE = 100;

let dataQualityCache = null;

const columns = [
  { key: "name", label: "Company Name", width: "20%" },
  { key: "new_sector", label: "Sector", width: "14%" },
  { key: "websiteurl", label: "Website", width: "15%" },
  { key: "address1_stateorprovince", label: "State", width: "8%" },
  { key: "address1_country", label: "Country", width: "10%" },
  { key: "address1_city", label: "City", width: "10%" },
  { key: "missing_fields_summary", label: "Missing Fields Summary", width: "15%" },
  { key: "data_quality_score", label: "Data Quality Score", width: "8%" },
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

    return (
      <Typography
        color={score >= 80 ? "success.main" : score >= 50 ? "warning.main" : "error.main"}
        sx={{ fontWeight: 800 }}
        variant="body2"
      >
        {score}%
      </Typography>
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

  const missingCounts = useMemo(() => {
    const missingByField = qualityFields.reduce((counts, field) => {
      counts[field.key] = 0;
      return counts;
    }, {});

    filteredAccounts.forEach((account) => {
      account.missingFieldKeys.forEach((fieldKey) => {
        if (fieldKey in missingByField) {
          missingByField[fieldKey] += 1;
        }
      });
    });

    return qualityFields.map((field) => ({
      ...field,
      missing: missingByField[field.key],
    }));
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
    <Box sx={{ display: "grid", gap: 3 }}>
      <Box
        sx={{
          alignItems: { xs: "stretch", lg: "center" },
          display: "grid",
          gap: 2,
          gridTemplateColumns: {
            xs: "1fr",
            md: "minmax(220px, 1fr) minmax(180px, 240px) minmax(200px, 260px)",
            lg: "minmax(260px, 1fr) minmax(180px, 240px) minmax(200px, 260px) auto auto",
          },
        }}
      >
        <TextField
          label="Search accounts"
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Name, sector, website, state, country, city..."
          size="small"
          value={searchQuery}
        />
        <FormControl size="small">
          <InputLabel id="sector-filter-label">Sector</InputLabel>
          <Select
            label="Sector"
            labelId="sector-filter-label"
            onChange={(event) => setSelectedSector(event.target.value)}
            value={selectedSector}
          >
            <MenuItem value="all">All sectors</MenuItem>
            {sectors.map((sector) => (
              <MenuItem key={sector} value={sector}>
                {sector}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small">
          <InputLabel id="missing-field-filter-label">Missing Field</InputLabel>
          <Select
            label="Missing Field"
            labelId="missing-field-filter-label"
            onChange={(event) => setSelectedMissingField(event.target.value)}
            value={selectedMissingField}
          >
            <MenuItem value="all">Any missing field</MenuItem>
            {qualityFields.map((field) => (
              <MenuItem key={field.key} value={field.key}>
                {field.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControlLabel
          control={
            <Checkbox
              checked={showNeedsAttentionOnly}
              onChange={(event) => setShowNeedsAttentionOnly(event.target.checked)}
              size="small"
            />
          }
          label="Needs attention"
          sx={{ m: 0, whiteSpace: "nowrap" }}
        />
        <Button disabled={!activeFilterCount} onClick={resetFilters} size="small" variant="outlined">
          Clear filters
        </Button>
      </Box>

      <Box
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: {
            xs: "1fr",
            sm: "repeat(2, minmax(0, 1fr))",
            lg: "repeat(4, minmax(0, 1fr))",
          },
        }}
      >
        {missingCounts.map((column) => (
          <Card
            key={column.key}
            elevation={0}
            sx={{
              border: "1px solid rgba(0, 51, 108, 0.10)",
              borderRadius: 2,
              boxShadow: "0 10px 30px rgba(0, 51, 108, 0.06)",
            }}
          >
            <CardContent sx={{ p: 2.5, "&:last-child": { pb: 2.5 } }}>
              <Typography color="text.secondary" variant="overline">
                Missing {column.label}
              </Typography>
              <Typography color="primary.main" sx={{ fontSize: "2rem", fontWeight: 800, lineHeight: 1.1 }}>
                {column.missing}
              </Typography>
              <Typography color="text.secondary" variant="body2">
                of {filteredAccounts.length} accounts
              </Typography>
            </CardContent>
          </Card>
        ))}
      </Box>

      <Paper
        elevation={0}
        sx={{
          border: "1px solid rgba(0, 51, 108, 0.10)",
          borderRadius: 2,
          p: 2,
        }}
      >
        <Box
          sx={{
            alignItems: { xs: "flex-start", sm: "center" },
            display: "flex",
            flexDirection: { xs: "column", sm: "row" },
            gap: 1,
            justifyContent: "space-between",
            mb: 1.5,
          }}
        >
          <Typography color="primary.main" sx={{ fontWeight: 800 }} variant="h6">
            Fields To Update
          </Typography>
          <Typography color="text.secondary" variant="body2">
            {fieldsToUpdate.size} selected
          </Typography>
        </Box>
        <Box
          sx={{
            display: "grid",
            gap: 1,
            gridTemplateColumns: {
              xs: "1fr",
              sm: "repeat(2, minmax(0, 1fr))",
              md: "repeat(4, minmax(0, 1fr))",
            },
          }}
        >
          {fieldUpdateOptions.map((field) => (
            <FormControlLabel
              control={
                <Checkbox
                  checked={fieldsToUpdate.has(field.key)}
                  onChange={() => toggleFieldToUpdate(field.key)}
                  size="small"
                />
              }
              key={field.key}
              label={field.label}
              sx={{ m: 0 }}
            />
          ))}
        </Box>
      </Paper>

      <Paper
        elevation={0}
        sx={{
          border: "1px solid rgba(0, 51, 108, 0.10)",
          borderRadius: 2,
          p: 2,
        }}
      >
        <Typography color="primary.main" sx={{ fontWeight: 800, mb: 1.5 }} variant="h6">
          Selection Review
        </Typography>
        <Box
          sx={{
            display: "grid",
            gap: 2,
            gridTemplateColumns: { xs: "1fr", md: "220px 1fr" },
          }}
        >
          <Box>
            <Typography color="text.secondary" variant="overline">
              Selected Account Count
            </Typography>
            <Typography color="primary.main" sx={{ fontSize: "2rem", fontWeight: 800, lineHeight: 1.1 }}>
              {selectedAccountIds.size}
            </Typography>
          </Box>
          <Box>
            <Typography color="text.secondary" variant="overline">
              Fields To Update
            </Typography>
            <Typography color="text.primary" variant="body2">
              {selectedFieldLabels.length ? selectedFieldLabels.join(", ") : "No fields selected"}
            </Typography>
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
            alignItems: "center",
            borderBottom: "1px solid rgba(0, 51, 108, 0.10)",
            display: "flex",
            justifyContent: "space-between",
            px: 2,
            py: 1.5,
          }}
        >
          <Typography color="text.secondary" variant="body2">
            Showing {filteredAccounts.length} of {accounts.length} loaded accounts
          </Typography>
          <Box sx={{ display: "flex", gap: 2 }}>
            <Typography color="text.secondary" variant="body2">
              {selectedVisibleCount} visible selected
            </Typography>
            {activeFilterCount > 0 ? (
              <Typography color="text.secondary" variant="body2">
                {activeFilterCount} active filter{activeFilterCount === 1 ? "" : "s"}
              </Typography>
            ) : null}
          </Box>
        </Box>
        <TableContainer sx={{ maxHeight: "calc(100vh - 360px)" }}>
          <Table stickyHeader sx={{ tableLayout: "fixed", width: "100%" }}>
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
          rowsPerPageOptions={[50, 100, 250]}
        />
      </Paper>
    </Box>
  );
}
