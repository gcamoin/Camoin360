import { Fragment, useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  FormControl,
  InputLabel,
  Link,
  MenuItem,
  Paper,
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

const API_URL = `${API_BASE_URL}/accounts/duplicates`;
const REVIEWED_GROUP_STORAGE_KEY = "sophie:reviewedDuplicateGroups";

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

function prepareDuplicateGroup(group) {
  const accounts = group.accounts || [];
  const names = uniqueValues(accounts.map((account) => account.name));
  const websites = uniqueValues(accounts.map((account) => account.websiteurl));
  const states = uniqueValues(accounts.map((account) => account.address1_stateorprovince));
  const countries = uniqueValues(accounts.map((account) => account.address1_country));

  return {
    ...group,
    names,
    websites,
    states,
    countries,
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
  const [expandedGroupIds, setExpandedGroupIds] = useState(() => new Set());
  const [confidenceFilter, setConfidenceFilter] = useState("all");
  const [countryFilter, setCountryFilter] = useState("all");
  const [stateFilter, setStateFilter] = useState("all");
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

  const filteredGroups = useMemo(
    () =>
      duplicateGroups.filter((group) => {
        const matchesConfidence = confidenceFilter === "all" || group.confidence === confidenceFilter;
        const matchesCountry = countryFilter === "all" || group.countries.includes(countryFilter);
        const matchesState = stateFilter === "all" || group.states.includes(stateFilter);
        const matchesName = groupMatchesText(group.names, accountNameQuery);
        const matchesWebsite = groupMatchesText(group.websites, websiteQuery);

        return matchesConfidence && matchesCountry && matchesState && matchesName && matchesWebsite;
      }),
    [accountNameQuery, confidenceFilter, countryFilter, duplicateGroups, stateFilter, websiteQuery]
  );

  const sortedGroups = useMemo(
    () => sortDuplicateGroups(filteredGroups, sortConfig),
    [filteredGroups, sortConfig]
  );

  const activeFilterCount = [
    confidenceFilter !== "all",
    countryFilter !== "all",
    stateFilter !== "all",
    Boolean(accountNameQuery.trim()),
    Boolean(websiteQuery.trim()),
  ].filter(Boolean).length;

  function updateSort(columnKey) {
    setSortConfig((currentSort) => ({
      key: columnKey,
      direction: getNextSortDirection(currentSort, columnKey),
    }));
  }

  function toggleExpandedGroup(groupId) {
    setExpandedGroupIds((currentGroupIds) => {
      const nextGroupIds = new Set(currentGroupIds);

      if (nextGroupIds.has(groupId)) {
        nextGroupIds.delete(groupId);
      } else {
        nextGroupIds.add(groupId);
      }

      return nextGroupIds;
    });
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
    setAccountNameQuery("");
    setWebsiteQuery("");
  }

  useEffect(() => {
    let isMounted = true;

    async function fetchDuplicateGroups() {
      setIsLoading(true);
      setError("");

      try {
        const response = await axios.get(API_URL, { headers: getAuthHeaders() });

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
                    backgroundColor: "primary.main",
                    color: "common.white",
                    fontWeight: 800,
                    py: 1.25,
                    width: column.width,
                  }}
                >
                  {column.sortable ? (
                    <TableSortLabel
                      active={sortConfig.key === column.key}
                      direction={sortConfig.key === column.key ? sortConfig.direction : "asc"}
                      onClick={() => updateSort(column.key)}
                      sx={{
                        color: "common.white",
                        "&.Mui-active": { color: "common.white" },
                        "& .MuiTableSortLabel-icon": { color: "common.white !important" },
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
                const isExpanded = expandedGroupIds.has(group.group_id);
                const isReviewed = reviewedGroupIds.has(group.group_id);

                return (
                  <Fragment key={group.group_id}>
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
                            onClick={() => toggleExpandedGroup(group.group_id)}
                            size="small"
                            sx={{ borderRadius: 1, fontWeight: 800 }}
                            variant="outlined"
                          >
                            {isExpanded ? "Collapse" : "Expand"}
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
                    <TableRow key={`${group.group_id}-details`}>
                      <TableCell colSpan={columns.length} sx={{ backgroundColor: "rgba(0, 51, 108, 0.03)", p: 0 }}>
                        <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                          <Box sx={{ px: { xs: 2, md: 3 }, py: 2 }}>
                            <TableContainer>
                              <Table size="small" sx={{ minWidth: 1120 }}>
                                <TableHead>
                                  <TableRow>
                                    <TableCell>Account ID</TableCell>
                                    <TableCell>Account Name</TableCell>
                                    <TableCell>Website</TableCell>
                                    <TableCell>Country</TableCell>
                                    <TableCell>State</TableCell>
                                    <TableCell>City</TableCell>
                                    <TableCell>Phone</TableCell>
                                    <TableCell>Sector</TableCell>
                                    <TableCell>Created Date</TableCell>
                                  </TableRow>
                                </TableHead>
                                <TableBody>
                                  {group.accounts.map((account) => (
                                    <TableRow key={account.accountid || account.name}>
                                      <TableCell sx={{ overflowWrap: "anywhere" }}>{account.accountid || "Missing"}</TableCell>
                                      <TableCell>{account.name || "Missing"}</TableCell>
                                      <TableCell>
                                        {account.websiteurl ? (
                                          <Link href={getWebsiteHref(account.websiteurl)} rel="noreferrer" target="_blank">
                                            {account.websiteurl}
                                          </Link>
                                        ) : (
                                          "Missing"
                                        )}
                                      </TableCell>
                                      <TableCell>{account.address1_country || "Missing"}</TableCell>
                                      <TableCell>{account.address1_stateorprovince || "Missing"}</TableCell>
                                      <TableCell>{account.address1_city || "Missing"}</TableCell>
                                      <TableCell>{account.telephone1 || "Missing"}</TableCell>
                                      <TableCell>{account.new_sector || "Missing"}</TableCell>
                                      <TableCell>{account.createdon || "Missing"}</TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </TableContainer>
                          </Box>
                        </Collapse>
                      </TableCell>
                    </TableRow>
                  </Fragment>
                );
              })
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} sx={{ py: 6, textAlign: "center" }}>
                  <Typography color="text.secondary">
                    {activeFilterCount ? "No duplicate groups match the selected filters." : "No potential duplicate accounts were found."}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}
