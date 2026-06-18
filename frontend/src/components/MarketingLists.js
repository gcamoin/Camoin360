import { useEffect, useMemo, useState } from "react";
import axios from "axios";
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
  TableRow,
  TableSortLabel,
  TextField,
  Typography,
} from "@mui/material";

import { API_BASE_URL, getApiErrorMessage, getAuthHeaders, handleUnauthorized } from "../auth";

const API_URL = `${API_BASE_URL}/marketing-lists`;

const columns = [
  { key: "client_name", label: "Client Name", width: 190 },
  { key: "campaign", label: "Campaign", width: 190 },
  { key: "createdon", label: "Date Created", width: 170 },
  { key: "marketing_list_name", label: "Marketing List Name", width: 260 },
  { key: "created_by", label: "Created By", width: 180 },
  { key: "member_count", label: "Accounts / Contacts", width: 170 },
  { key: "list_member_type", label: "Account or Contact List", width: 190 },
];

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
  ).sort((a, b) => a.localeCompare(b));
}

function formatDate(value) {
  if (isMissingValue(value)) {
    return "Missing";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString();
}

function normalizeSearch(value) {
  return String(value || "").trim().toLowerCase();
}

function matchesQuery(value, query) {
  const normalizedQuery = normalizeSearch(query);

  return !normalizedQuery || normalizeSearch(value).includes(normalizedQuery);
}

function getSortValue(marketingList, key) {
  if (key === "member_count") {
    return Number(marketingList.member_count || 0);
  }

  if (key === "createdon") {
    return new Date(marketingList.createdon || 0).getTime() || 0;
  }

  return normalizeSearch(marketingList[key]);
}

function sortMarketingLists(marketingLists, sortConfig) {
  return [...marketingLists].sort((firstList, secondList) => {
    const firstValue = getSortValue(firstList, sortConfig.key);
    const secondValue = getSortValue(secondList, sortConfig.key);
    const directionMultiplier = sortConfig.direction === "asc" ? 1 : -1;

    if (firstValue === secondValue) {
      return normalizeSearch(firstList.marketing_list_name).localeCompare(normalizeSearch(secondList.marketing_list_name));
    }

    if (typeof firstValue === "number" && typeof secondValue === "number") {
      return (firstValue - secondValue) * directionMultiplier;
    }

    return String(firstValue || "").localeCompare(String(secondValue || "")) * directionMultiplier;
  });
}

function getNextSortDirection(currentSort, columnKey) {
  if (currentSort.key !== columnKey) {
    return "asc";
  }

  return currentSort.direction === "asc" ? "desc" : "asc";
}

export default function MarketingLists() {
  const [marketingLists, setMarketingLists] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [sortConfig, setSortConfig] = useState({ key: "createdon", direction: "desc" });
  const [clientFilter, setClientFilter] = useState("all");
  const [campaignFilter, setCampaignFilter] = useState("all");
  const [createdByFilter, setCreatedByFilter] = useState("all");
  const [memberTypeFilter, setMemberTypeFilter] = useState("all");
  const [createdDateQuery, setCreatedDateQuery] = useState("");
  const [nameQuery, setNameQuery] = useState("");

  const clients = useMemo(() => uniqueValues(marketingLists.map((list) => list.client_name)), [marketingLists]);
  const campaigns = useMemo(() => uniqueValues(marketingLists.map((list) => list.campaign)), [marketingLists]);
  const creators = useMemo(() => uniqueValues(marketingLists.map((list) => list.created_by)), [marketingLists]);
  const memberTypes = useMemo(() => uniqueValues(marketingLists.map((list) => list.list_member_type)), [marketingLists]);

  const filteredMarketingLists = useMemo(
    () =>
      marketingLists.filter((marketingList) => {
        const matchesClient = clientFilter === "all" || marketingList.client_name === clientFilter;
        const matchesCampaign = campaignFilter === "all" || marketingList.campaign === campaignFilter;
        const matchesCreator = createdByFilter === "all" || marketingList.created_by === createdByFilter;
        const matchesMemberType = memberTypeFilter === "all" || marketingList.list_member_type === memberTypeFilter;
        const matchesDate = matchesQuery(formatDate(marketingList.createdon), createdDateQuery);
        const matchesName = matchesQuery(marketingList.marketing_list_name, nameQuery);

        return matchesClient && matchesCampaign && matchesCreator && matchesMemberType && matchesDate && matchesName;
      }),
    [campaignFilter, clientFilter, createdByFilter, createdDateQuery, marketingLists, memberTypeFilter, nameQuery]
  );

  const sortedMarketingLists = useMemo(
    () => sortMarketingLists(filteredMarketingLists, sortConfig),
    [filteredMarketingLists, sortConfig]
  );

  const activeFilterCount = [
    clientFilter !== "all",
    campaignFilter !== "all",
    createdByFilter !== "all",
    memberTypeFilter !== "all",
    Boolean(createdDateQuery.trim()),
    Boolean(nameQuery.trim()),
  ].filter(Boolean).length;

  function updateSort(columnKey) {
    setSortConfig((currentSort) => ({
      key: columnKey,
      direction: getNextSortDirection(currentSort, columnKey),
    }));
  }

  function resetFilters() {
    setClientFilter("all");
    setCampaignFilter("all");
    setCreatedByFilter("all");
    setMemberTypeFilter("all");
    setCreatedDateQuery("");
    setNameQuery("");
  }

  useEffect(() => {
    let isMounted = true;

    async function fetchMarketingLists() {
      setIsLoading(true);
      setError("");

      try {
        const response = await axios.get(API_URL, { headers: getAuthHeaders() });

        if (isMounted) {
          setMarketingLists(response.data?.data || []);
        }
      } catch (fetchError) {
        if (handleUnauthorized(fetchError)) {
          return;
        }

        if (isMounted) {
          setError(getApiErrorMessage(fetchError, "Unable to load marketing lists."));
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    fetchMarketingLists();

    return () => {
      isMounted = false;
    };
  }, []);

  if (isLoading) {
    return (
      <Box sx={{ alignItems: "center", display: "flex", flexDirection: "column", gap: 2, justifyContent: "center", py: 8 }}>
        <CircularProgress />
        <Typography color="text.secondary" variant="body2">
          Loading marketing lists...
        </Typography>
      </Box>
    );
  }

  if (error) {
    return <Alert severity="error">We could not load marketing lists right now. {error}</Alert>;
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
            Marketing Lists
          </Typography>
          <Typography color="text.secondary" variant="body2">
            Showing {sortedMarketingLists.length} of {marketingLists.length} marketing lists.
          </Typography>
        </Box>
        <Chip label={`${marketingLists.length} total`} sx={{ fontWeight: 800 }} />
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
          <InputLabel id="marketing-client-filter-label">Client Name</InputLabel>
          <Select label="Client Name" labelId="marketing-client-filter-label" onChange={(event) => setClientFilter(event.target.value)} value={clientFilter}>
            <MenuItem value="all">All clients</MenuItem>
            {clients.map((client) => (
              <MenuItem key={client} value={client}>{client}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ flex: { lg: "0 1 190px" }, maxWidth: { lg: 190 }, minWidth: { lg: 0 } }}>
          <InputLabel id="marketing-campaign-filter-label">Campaign</InputLabel>
          <Select label="Campaign" labelId="marketing-campaign-filter-label" onChange={(event) => setCampaignFilter(event.target.value)} value={campaignFilter}>
            <MenuItem value="all">All campaigns</MenuItem>
            {campaigns.map((campaign) => (
              <MenuItem key={campaign} value={campaign}>{campaign}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <TextField
          label="Date Created"
          onChange={(event) => setCreatedDateQuery(event.target.value)}
          size="small"
          sx={{ flex: { lg: "0 1 150px" }, maxWidth: { lg: 150 }, minWidth: { lg: 0 } }}
          value={createdDateQuery}
        />
        <TextField
          label="Marketing List Name"
          onChange={(event) => setNameQuery(event.target.value)}
          size="small"
          sx={{ flex: { lg: "0 1 220px" }, maxWidth: { lg: 220 }, minWidth: { lg: 0 } }}
          value={nameQuery}
        />
        <FormControl size="small" sx={{ flex: { lg: "0 1 190px" }, maxWidth: { lg: 190 }, minWidth: { lg: 0 } }}>
          <InputLabel id="marketing-created-by-filter-label">Created By</InputLabel>
          <Select label="Created By" labelId="marketing-created-by-filter-label" onChange={(event) => setCreatedByFilter(event.target.value)} value={createdByFilter}>
            <MenuItem value="all">All creators</MenuItem>
            {creators.map((creator) => (
              <MenuItem key={creator} value={creator}>{creator}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ flex: { lg: "0 1 190px" }, maxWidth: { lg: 190 }, minWidth: { lg: 0 } }}>
          <InputLabel id="marketing-member-type-filter-label">List Type</InputLabel>
          <Select label="List Type" labelId="marketing-member-type-filter-label" onChange={(event) => setMemberTypeFilter(event.target.value)} value={memberTypeFilter}>
            <MenuItem value="all">All list types</MenuItem>
            {memberTypes.map((memberType) => (
              <MenuItem key={memberType} value={memberType}>{memberType}</MenuItem>
            ))}
          </Select>
        </FormControl>
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
        <Table size="small" sx={{ minWidth: 1350, tableLayout: "fixed" }}>
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
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedMarketingLists.length ? (
              sortedMarketingLists.map((marketingList) => (
                <TableRow hover key={marketingList.listid || marketingList.marketing_list_name}>
                  <TableCell>{marketingList.client_name || "Missing"}</TableCell>
                  <TableCell>{marketingList.campaign || "Missing"}</TableCell>
                  <TableCell>{formatDate(marketingList.createdon)}</TableCell>
                  <TableCell sx={{ overflowWrap: "anywhere" }}>{marketingList.marketing_list_name || "Missing"}</TableCell>
                  <TableCell>{marketingList.created_by || "Missing"}</TableCell>
                  <TableCell>
                    <Typography sx={{ fontWeight: 800 }} variant="body2">
                      {marketingList.member_count ?? "Missing"}
                    </Typography>
                  </TableCell>
                  <TableCell>{marketingList.list_member_type || "Missing"}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} sx={{ py: 6, textAlign: "center" }}>
                  <Typography color="text.secondary">
                    {activeFilterCount ? "No marketing lists match the selected filters." : "No marketing lists were found."}
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
