import { useEffect, useMemo, useState } from "react";
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
  FormControl,
  InputLabel,
  Link,
  MenuItem,
  Paper,
  Radio,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  TextField,
  Typography,
} from "@mui/material";

import { API_BASE_URL, getApiErrorMessage, getAuthHeaders, handleUnauthorized } from "../auth";
import { getCached, invalidateApiCache } from "../apiClient";
import { EmptyState, ModalTitle, subtleTableHeadCellSx } from "./UiPrimitives";

const API_URL = `${API_BASE_URL}/accounts/duplicates`;
const REVIEWED_GROUP_STORAGE_KEY = "sophie:reviewedDuplicateGroups";

const comparisonFields = [
  { key: "accountid", label: "Account ID", scored: false },
  { key: "name", label: "Account Name" },
  { key: "websiteurl", label: "Website", type: "website" },
  { key: "emailaddress1", label: "Email" },
  { key: "telephone1", label: "Phone" },
  { key: "address1_line1", label: "Street Address" },
  { key: "address1_city", label: "City" },
  { key: "address1_stateorprovince", label: "State / Province" },
  { key: "address1_postalcode", label: "Postal Code" },
  { key: "address1_country", label: "Country" },
  { key: "new_sector", label: "Sector" },
  { key: "new_datasource", label: "Data Source" },
  { key: "new_employees", label: "Employees" },
  { key: "description", label: "Description" },
  { key: "createdon", label: "Created Date", scored: false },
];

const scoredComparisonFields = comparisonFields.filter((field) => field.scored !== false);

const columns = [
  { key: "confidence_score", label: "Confidence", sortable: true, width: 150 },
  { key: "reasons", label: "Match Reasons", sortable: false, width: 240 },
  { key: "names", label: "Account Names", sortable: true, width: 280 },
  { key: "websites", label: "Website", sortable: true, width: 220 },
  { key: "states", label: "State", sortable: true, width: 150 },
  { key: "countries", label: "Country", sortable: true, width: 150 },
  { key: "record_count", label: "Number of Records", sortable: true, width: 160 },
  { key: "actions", label: "Actions", sortable: false, width: 230 },
];

const confidenceColors = {
  high: "success",
  medium: "warning",
  low: "default",
};

function isMissingValue(value) {
  return value === null || value === undefined || String(value).trim() === "";
}

function uniqueValues(values) {
  return Array.from(
    new Set(
      values
        .filter((value) => !isMissingValue(value))
        .map((value) => String(value).trim())
    )
  );
}

function getWebsiteHref(value) {
  if (isMissingValue(value)) {
    return "";
  }

  return String(value).startsWith("http") ? value : `https://${value}`;
}

export function getAccountCompleteness(account) {
  const filledFieldCount = scoredComparisonFields.filter((field) => !isMissingValue(account?.[field.key])).length;

  return {
    filledFieldCount,
    totalFieldCount: scoredComparisonFields.length,
    score: Math.round((filledFieldCount / scoredComparisonFields.length) * 100),
  };
}

function ComparisonValue({ field, value }) {
  if (isMissingValue(value)) {
    return <Typography color="text.secondary" variant="body2">Missing</Typography>;
  }

  if (field.type === "website") {
    return (
      <Link href={getWebsiteHref(value)} rel="noreferrer" sx={{ overflowWrap: "anywhere" }} target="_blank">
        {String(value)}
      </Link>
    );
  }

  return <Typography sx={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }} variant="body2">{String(value)}</Typography>;
}

function prepareDuplicateGroup(group) {
  const accounts = group.accounts || [];
  const names = uniqueValues(accounts.map((account) => account.name));
  const websites = uniqueValues(accounts.map((account) => account.websiteurl));
  const states = uniqueValues(accounts.map((account) => account.address1_stateorprovince));
  const countries = uniqueValues(accounts.map((account) => account.address1_country));
  const sectors = uniqueValues(accounts.map((account) => account.new_sector));

  return {
    ...group,
    names,
    websites,
    states,
    countries,
    sectors,
    record_count: accounts.length,
    sortValues: {
      confidence_score: Number(group.confidence_score || 0),
      names: names.join(" ").toLowerCase(),
      websites: websites.join(" ").toLowerCase(),
      states: states.join(" ").toLowerCase(),
      countries: countries.join(" ").toLowerCase(),
      record_count: accounts.length,
    },
  };
}

function getNextSortDirection(currentSort, columnKey) {
  if (currentSort.key !== columnKey) {
    return "asc";
  }

  return currentSort.direction === "asc" ? "desc" : "asc";
}

function sortDuplicateGroups(groups, sortConfig) {
  return [...groups].sort((firstGroup, secondGroup) => {
    const firstValue = firstGroup.sortValues[sortConfig.key];
    const secondValue = secondGroup.sortValues[sortConfig.key];
    const directionMultiplier = sortConfig.direction === "asc" ? 1 : -1;

    if (firstValue === secondValue) {
      return secondGroup.confidence_score - firstGroup.confidence_score;
    }

    if (typeof firstValue === "number" && typeof secondValue === "number") {
      return (firstValue - secondValue) * directionMultiplier;
    }

    return String(firstValue || "").localeCompare(String(secondValue || "")) * directionMultiplier;
  });
}

function groupMatchesText(values, query) {
  const normalizedQuery = String(query || "").trim().toLowerCase();

  return !normalizedQuery || values.some((value) => String(value || "").toLowerCase().includes(normalizedQuery));
}

function loadReviewedGroupIds() {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(REVIEWED_GROUP_STORAGE_KEY) || "[]"));
  } catch (_error) {
    return new Set();
  }
}

function saveReviewedGroupIds(groupIds) {
  window.localStorage.setItem(REVIEWED_GROUP_STORAGE_KEY, JSON.stringify(Array.from(groupIds)));
}

function ValueList({ values, emptyLabel = "Missing", maxVisible = 3 }) {
  if (!values.length) {
    return <Typography color="text.secondary" variant="body2">{emptyLabel}</Typography>;
  }

  const visibleValues = values.slice(0, maxVisible);
  const hiddenCount = values.length - visibleValues.length;

  return (
    <Stack spacing={0.5}>
      {visibleValues.map((value) => (
        <Typography key={value} sx={{ overflowWrap: "anywhere" }} variant="body2">
          {value}
        </Typography>
      ))}
      {hiddenCount > 0 ? (
        <Typography color="text.secondary" variant="caption">
          +{hiddenCount} more
        </Typography>
      ) : null}
    </Stack>
  );
}

function WebsiteList({ websites }) {
  if (!websites.length) {
    return <Typography color="text.secondary" variant="body2">Missing</Typography>;
  }

  return (
    <Stack spacing={0.5}>
      {websites.slice(0, 2).map((website) => (
        <Link
          href={getWebsiteHref(website)}
          key={website}
          rel="noreferrer"
          sx={{ overflowWrap: "anywhere" }}
          target="_blank"
          underline="hover"
          variant="body2"
        >
          {website}
        </Link>
      ))}
      {websites.length > 2 ? (
        <Typography color="text.secondary" variant="caption">
          +{websites.length - 2} more
        </Typography>
      ) : null}
    </Stack>
  );
}

export default function DuplicateAccounts() {
  const [duplicateGroups, setDuplicateGroups] = useState([]);
  const [accountCount, setAccountCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [sortConfig, setSortConfig] = useState({ key: "confidence_score", direction: "desc" });
  const [activeGroup, setActiveGroup] = useState(null);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [isDeleteConfirmationOpen, setIsDeleteConfirmationOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [confidenceFilter, setConfidenceFilter] = useState("all");
  const [countryFilter, setCountryFilter] = useState("all");
  const [stateFilter, setStateFilter] = useState("all");
  const [sectorFilter, setSectorFilter] = useState("all");
  const [accountNameQuery, setAccountNameQuery] = useState("");
  const [websiteQuery, setWebsiteQuery] = useState("");
  const [reviewedGroupIds, setReviewedGroupIds] = useState(loadReviewedGroupIds);

  const countries = useMemo(
    () => uniqueValues(duplicateGroups.flatMap((group) => group.countries)).sort((a, b) => a.localeCompare(b)),
    [duplicateGroups]
  );
  const states = useMemo(
    () => uniqueValues(duplicateGroups.flatMap((group) => group.states)).sort((a, b) => a.localeCompare(b)),
    [duplicateGroups]
  );
  const sectors = useMemo(
    () => uniqueValues(duplicateGroups.flatMap((group) => group.sectors)).sort((a, b) => a.localeCompare(b)),
    [duplicateGroups]
  );

  const filteredGroups = useMemo(
    () =>
      duplicateGroups.filter((group) => {
        const matchesConfidence = confidenceFilter === "all" || group.confidence === confidenceFilter;
        const matchesCountry = countryFilter === "all" || group.countries.includes(countryFilter);
        const matchesState = stateFilter === "all" || group.states.includes(stateFilter);
        const matchesSector = sectorFilter === "all" || group.sectors.includes(sectorFilter);
        const matchesName = groupMatchesText(group.names, accountNameQuery);
        const matchesWebsite = groupMatchesText(group.websites, websiteQuery);

        return matchesConfidence && matchesCountry && matchesState && matchesSector && matchesName && matchesWebsite;
      }),
    [accountNameQuery, confidenceFilter, countryFilter, duplicateGroups, sectorFilter, stateFilter, websiteQuery]
  );

  const sortedGroups = useMemo(
    () => sortDuplicateGroups(filteredGroups, sortConfig),
    [filteredGroups, sortConfig]
  );

  const activeFilterCount = [
    confidenceFilter !== "all",
    countryFilter !== "all",
    stateFilter !== "all",
    sectorFilter !== "all",
    Boolean(accountNameQuery.trim()),
    Boolean(websiteQuery.trim()),
  ].filter(Boolean).length;

  function updateSort(columnKey) {
    setSortConfig((currentSort) => ({
      key: columnKey,
      direction: getNextSortDirection(currentSort, columnKey),
    }));
  }

  function openComparison(group) {
    const scoredAccounts = group.accounts.map((account) => ({
      account,
      completeness: getAccountCompleteness(account),
    }));
    const suggestedAccount = [...scoredAccounts].sort(
      (first, second) => first.completeness.score - second.completeness.score
    )[0]?.account;

    setActiveGroup(group);
    setSelectedAccountId(suggestedAccount?.accountid || "");
    setDeleteError("");
  }

  function closeComparison() {
    if (isDeleting) return;
    setActiveGroup(null);
    setSelectedAccountId("");
    setDeleteError("");
  }

  async function deleteSelectedAccount() {
    if (!selectedAccountId) return;

    setIsDeleting(true);
    setDeleteError("");

    try {
      await axios.delete(`${API_BASE_URL}/accounts/${selectedAccountId}`, { headers: getAuthHeaders() });
      invalidateApiCache(API_URL);
      setDuplicateGroups((currentGroups) =>
        currentGroups
          .map((group) => {
            if (group.group_id !== activeGroup.group_id) return group;
            return prepareDuplicateGroup({
              ...group,
              accounts: group.accounts.filter((account) => account.accountid !== selectedAccountId),
            });
          })
          .filter((group) => group.accounts.length > 1)
      );
      setAccountCount((currentCount) => Math.max(0, currentCount - 1));
      setIsDeleteConfirmationOpen(false);
      setActiveGroup(null);
      setSelectedAccountId("");
    } catch (deleteRequestError) {
      if (handleUnauthorized(deleteRequestError)) return;
      setDeleteError(getApiErrorMessage(deleteRequestError, "Unable to delete the selected account."));
      setIsDeleteConfirmationOpen(false);
    } finally {
      setIsDeleting(false);
    }
  }

  function markGroupReviewed(groupId) {
    setReviewedGroupIds((currentGroupIds) => {
      const nextGroupIds = new Set(currentGroupIds);
      nextGroupIds.add(groupId);
      saveReviewedGroupIds(nextGroupIds);

      return nextGroupIds;
    });
  }

  function resetFilters() {
    setConfidenceFilter("all");
    setCountryFilter("all");
    setStateFilter("all");
    setSectorFilter("all");
    setAccountNameQuery("");
    setWebsiteQuery("");
  }

  useEffect(() => {
    let isMounted = true;

    async function fetchDuplicateGroups() {
      setIsLoading(true);
      setError("");

      try {
        const response = await getCached(API_URL, { headers: getAuthHeaders() });

        if (isMounted) {
          setAccountCount(response.data?.account_count || 0);
          setDuplicateGroups((response.data?.groups || []).map(prepareDuplicateGroup));
        }
      } catch (fetchError) {
        if (handleUnauthorized(fetchError)) {
          return;
        }

        if (isMounted) {
          setError(getApiErrorMessage(fetchError, "Unable to load duplicate accounts."));
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    fetchDuplicateGroups();

    return () => {
      isMounted = false;
    };
  }, []);

  if (isLoading) {
    return (
      <Box
        sx={{
          alignItems: "center",
          display: "flex",
          flexDirection: "column",
          gap: 2,
          justifyContent: "center",
          py: 8,
        }}
      >
        <CircularProgress />
        <Typography color="text.secondary" variant="body2">
          Processing duplicate account records...
        </Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error">
        We could not load duplicate account results right now. {error}
      </Alert>
    );
  }

  return (
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
            Duplicate Account Groups
          </Typography>
          <Typography color="text.secondary" variant="body2">
            Showing {duplicateGroups.length} possible duplicate groups from {accountCount} scanned accounts.
          </Typography>
        </Box>
        <Chip
          color={duplicateGroups.length ? "warning" : "success"}
          label={`${duplicateGroups.length} group${duplicateGroups.length === 1 ? "" : "s"}`}
          sx={{ fontWeight: 800 }}
        />
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
        <FormControl size="small" sx={{ flex: { lg: "0 1 190px" }, maxWidth: { lg: 190 }, minWidth: { lg: 0 } }}>
          <InputLabel id="duplicate-confidence-filter-label">Confidence Level</InputLabel>
          <Select
            label="Confidence Level"
            labelId="duplicate-confidence-filter-label"
            onChange={(event) => setConfidenceFilter(event.target.value)}
            value={confidenceFilter}
          >
            <MenuItem value="all">All</MenuItem>
            <MenuItem value="high">High Confidence</MenuItem>
            <MenuItem value="medium">Medium Confidence</MenuItem>
            <MenuItem value="low">Low Confidence</MenuItem>
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ flex: { lg: "0 1 190px" }, maxWidth: { lg: 190 }, minWidth: { lg: 0 } }}>
          <InputLabel id="duplicate-country-filter-label">Country</InputLabel>
          <Select
            label="Country"
            labelId="duplicate-country-filter-label"
            onChange={(event) => setCountryFilter(event.target.value)}
            value={countryFilter}
          >
            <MenuItem value="all">All countries</MenuItem>
            {countries.map((country) => (
              <MenuItem key={country} value={country}>
                {country}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ flex: { lg: "0 1 190px" }, maxWidth: { lg: 190 }, minWidth: { lg: 0 } }}>
          <InputLabel id="duplicate-state-filter-label">State</InputLabel>
          <Select
            label="State"
            labelId="duplicate-state-filter-label"
            onChange={(event) => setStateFilter(event.target.value)}
            value={stateFilter}
          >
            <MenuItem value="all">All states</MenuItem>
            {states.map((state) => (
              <MenuItem key={state} value={state}>
                {state}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ flex: { lg: "0 1 190px" }, maxWidth: { lg: 190 }, minWidth: { lg: 0 } }}>
          <InputLabel id="duplicate-sector-filter-label">Sector</InputLabel>
          <Select
            label="Sector"
            labelId="duplicate-sector-filter-label"
            onChange={(event) => setSectorFilter(event.target.value)}
            value={sectorFilter}
          >
            <MenuItem value="all">All sectors</MenuItem>
            {sectors.map((sector) => (
              <MenuItem key={sector} value={sector}>
                {sector}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <TextField
          label="Search by Account Name"
          onChange={(event) => setAccountNameQuery(event.target.value)}
          size="small"
          sx={{ flex: { lg: "0 1 240px" }, maxWidth: { lg: 240 }, minWidth: { lg: 0 } }}
          value={accountNameQuery}
        />
        <TextField
          label="Search by Website"
          onChange={(event) => setWebsiteQuery(event.target.value)}
          size="small"
          sx={{ flex: { lg: "0 1 220px" }, maxWidth: { lg: 220 }, minWidth: { lg: 0 } }}
          value={websiteQuery}
        />
        <Button
          disabled={!activeFilterCount}
          onClick={resetFilters}
          size="small"
          sx={{ borderRadius: 1, flex: { lg: "0 0 auto" }, fontWeight: 800, minHeight: 40, whiteSpace: "nowrap" }}
          variant="outlined"
        >
          Reset Filters
        </Button>
      </Stack>

      <TableContainer sx={{ overflowX: "auto" }}>
        <Table size="small" sx={{ minWidth: 1420, tableLayout: "fixed" }}>
          <TableHead>
            <TableRow>
              {columns.map((column) => (
                <TableCell
                  key={column.key}
                  sx={{
                    ...subtleTableHeadCellSx,
                    width: column.width,
                  }}
                >
                  {column.sortable ? (
                    <TableSortLabel
                      active={sortConfig.key === column.key}
                      direction={sortConfig.key === column.key ? sortConfig.direction : "asc"}
                      onClick={() => updateSort(column.key)}
                      sx={{
                        color: "inherit",
                        "&.Mui-active": { color: "primary.main" },
                        "& .MuiTableSortLabel-icon": { color: "primary.main !important" },
                      }}
                    >
                      {column.label}
                    </TableSortLabel>
                  ) : (
                    column.label
                  )}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedGroups.length ? (
              sortedGroups.map((group) => {
                const isReviewed = reviewedGroupIds.has(group.group_id);

                return (
                    <TableRow
                      hover
                      key={group.group_id}
                      sx={{
                        backgroundColor: isReviewed ? "rgba(46, 125, 50, 0.08)" : "inherit",
                        "&:hover": {
                          backgroundColor: isReviewed ? "rgba(46, 125, 50, 0.12)" : undefined,
                        },
                      }}
                    >
                      <TableCell>
                        <Stack spacing={0.5}>
                          <Chip
                            color={confidenceColors[group.confidence] || "default"}
                            label={`${group.confidence_score}%`}
                            size="small"
                            sx={{ fontWeight: 800, width: "fit-content" }}
                          />
                          <Typography color="text.secondary" sx={{ textTransform: "capitalize" }} variant="caption">
                            {group.confidence} confidence
                          </Typography>
                          {isReviewed ? (
                            <Chip color="success" label="Reviewed" size="small" sx={{ fontWeight: 800, width: "fit-content" }} />
                          ) : null}
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" flexWrap="wrap" gap={0.75}>
                          {group.reasons.map((reason) => (
                            <Chip key={reason} label={reason} size="small" variant="outlined" />
                          ))}
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <ValueList values={group.names} />
                      </TableCell>
                      <TableCell>
                        <WebsiteList websites={group.websites} />
                      </TableCell>
                      <TableCell>
                        <ValueList values={group.states} />
                      </TableCell>
                      <TableCell>
                        <ValueList values={group.countries} />
                      </TableCell>
                      <TableCell>
                        <Typography sx={{ fontWeight: 800 }} variant="body2">
                          {group.record_count}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={1}>
                          <Button
                            onClick={() => openComparison(group)}
                            size="small"
                            sx={{ borderRadius: 1, fontWeight: 800 }}
                            variant="outlined"
                          >
                            Compare
                          </Button>
                          <Button
                            disabled={isReviewed}
                            onClick={() => markGroupReviewed(group.group_id)}
                            size="small"
                            sx={{ borderRadius: 1, fontWeight: 800, whiteSpace: "nowrap" }}
                            variant="contained"
                          >
                            {isReviewed ? "Reviewed" : "Mark Reviewed"}
                          </Button>
                        </Stack>
                      </TableCell>
                    </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} sx={{ p: 0 }}>
                  <EmptyState
                    actionLabel={activeFilterCount ? "Clear filters" : undefined}
                    compact
                    description={
                      activeFilterCount
                        ? "Clear or adjust the active filters to broaden the results."
                        : "No likely duplicate records were identified in the scanned accounts."
                    }
                    icon={activeFilterCount ? "search" : "database"}
                    onAction={activeFilterCount ? resetFilters : undefined}
                    title={activeFilterCount ? "No matching duplicate groups" : "No duplicate accounts found"}
                  />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog fullWidth maxWidth="lg" onClose={closeComparison} open={Boolean(activeGroup)}>
        <ModalTitle
          onClose={closeComparison}
          subtitle="Compare completeness and choose the record that should be removed."
        >
          Compare Duplicate Accounts
        </ModalTitle>
        <DialogContent dividers>
          {deleteError ? <Alert severity="error" sx={{ mb: 2 }}>{deleteError}</Alert> : null}
          <Typography color="text.secondary" sx={{ mb: 2 }} variant="body2">
            Select the account to delete. The account with the lower completeness score is selected by default.
          </Typography>
          {activeGroup ? (
            <TableContainer sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
              <Table sx={{ minWidth: 760, tableLayout: "fixed" }}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 800, width: 180 }}>Field</TableCell>
                    {activeGroup.accounts.map((account) => {
                      const completeness = getAccountCompleteness(account);
                      return (
                        <TableCell key={account.accountid} sx={{ verticalAlign: "top" }}>
                          <Stack spacing={1}>
                            <Stack alignItems="center" direction="row" spacing={1}>
                              <Radio
                                checked={selectedAccountId === account.accountid}
                                inputProps={{ "aria-label": `Select ${account.name || account.accountid} for deletion` }}
                                onChange={() => setSelectedAccountId(account.accountid)}
                                value={account.accountid}
                              />
                              <Typography sx={{ fontWeight: 800 }}>{account.name || "Unnamed account"}</Typography>
                            </Stack>
                            <Chip
                              color={completeness.score === Math.max(...activeGroup.accounts.map((item) => getAccountCompleteness(item).score)) ? "success" : "warning"}
                              label={`${completeness.score}% complete (${completeness.filledFieldCount}/${completeness.totalFieldCount} fields)`}
                              size="small"
                              sx={{ fontWeight: 800, width: "fit-content" }}
                            />
                          </Stack>
                        </TableCell>
                      );
                    })}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {comparisonFields.map((field) => (
                    <TableRow key={field.key}>
                      <TableCell component="th" scope="row" sx={{ fontWeight: 800 }}>{field.label}</TableCell>
                      {activeGroup.accounts.map((account) => (
                        <TableCell
                          key={`${account.accountid}-${field.key}`}
                          sx={{ backgroundColor: isMissingValue(account[field.key]) ? "rgba(211, 47, 47, 0.05)" : "inherit", verticalAlign: "top" }}
                        >
                          <ComparisonValue field={field} value={account[field.key]} />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          ) : null}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button disabled={isDeleting} onClick={closeComparison}>Cancel</Button>
          <Button
            color="error"
            disabled={!selectedAccountId || isDeleting}
            onClick={() => setIsDeleteConfirmationOpen(true)}
            variant="contained"
          >
            Delete Selected Account
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog onClose={() => !isDeleting && setIsDeleteConfirmationOpen(false)} open={isDeleteConfirmationOpen}>
        <ModalTitle
          onClose={isDeleting ? undefined : () => setIsDeleteConfirmationOpen(false)}
          subtitle="This action permanently removes the selected Dynamics record."
        >
          Delete this account?
        </ModalTitle>
        <DialogContent>
          <Typography>
            This permanently deletes {activeGroup?.accounts.find((account) => account.accountid === selectedAccountId)?.name || "the selected account"} from Dynamics. This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button disabled={isDeleting} onClick={() => setIsDeleteConfirmationOpen(false)}>Cancel</Button>
          <Button color="error" disabled={isDeleting} onClick={deleteSelectedAccount} variant="contained">
            {isDeleting ? "Deleting..." : "Delete Account"}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
