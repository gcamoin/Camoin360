import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
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
  Typography,
} from "@mui/material";

import { API_BASE_URL, getApiErrorMessage, getAuthHeaders, handleUnauthorized } from "../auth";
import { getCached } from "../apiClient";
import { EmptyState, ModalTitle, subtleTableHeadCellSx } from "./UiPrimitives";

const API_URL = `${API_BASE_URL}/marketing-lists`;
const DEFAULT_ROWS_PER_PAGE = 25;
const INITIAL_LIST_LIMIT = 500;
const LIST_LIMIT_STEP = 500;
const MAX_LIST_LIMIT = 5000;

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

function getSortValue(marketingList, key) {
  if (!key) {
    return "";
  }

  if (key === "member_count") {
    return Number(marketingList.member_count || 0);
  }

  if (key === "createdon") {
    return new Date(marketingList.createdon || 0).getTime() || 0;
  }

  return normalizeSearch(marketingList[key]);
}

function sortMarketingLists(marketingLists, sortConfig) {
  if (!sortConfig.key) {
    return marketingLists;
  }

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

function getColumnFilterValue(marketingList, columnKey) {
  if (columnKey === "createdon") {
    return formatDate(marketingList.createdon);
  }

  if (columnKey === "member_count") {
    return marketingList.member_count ?? "";
  }

  return marketingList[columnKey];
}

function getFormattedDynamicsValue(record, fieldName) {
  return record?.[`${fieldName}@OData.Community.Display.V1.FormattedValue`] || record?.[fieldName];
}

export default function MarketingLists() {
  const [marketingLists, setMarketingLists] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [loadedListLimit, setLoadedListLimit] = useState(INITIAL_LIST_LIMIT);
  const [hasMoreLists, setHasMoreLists] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: "createdon", direction: "desc" });
  const [searchQuery, setSearchQuery] = useState("");
  const [columnMenu, setColumnMenu] = useState({ anchorEl: null, columnKey: "" });
  const [activeMarketingList, setActiveMarketingList] = useState(null);
  const [listMembers, setListMembers] = useState({ accounts: [], contacts: [] });
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [memberError, setMemberError] = useState("");
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_ROWS_PER_PAGE);

  const filteredMarketingLists = useMemo(
    () => {
      const normalizedSearchQuery = normalizeSearch(searchQuery);

      if (!normalizedSearchQuery) {
        return marketingLists;
      }

      return marketingLists.filter((marketingList) =>
        columns.some((column) =>
          normalizeSearch(getColumnFilterValue(marketingList, column.key)).includes(normalizedSearchQuery)
        )
      );
    },
    [marketingLists, searchQuery]
  );

  const sortedMarketingLists = useMemo(
    () => sortMarketingLists(filteredMarketingLists, sortConfig),
    [filteredMarketingLists, sortConfig]
  );
  const paginatedMarketingLists = useMemo(
    () => sortedMarketingLists.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage),
    [page, rowsPerPage, sortedMarketingLists]
  );

  const hasActiveSearch = Boolean(searchQuery.trim());
  const activeColumnMenu = columns.find((column) => column.key === columnMenu.columnKey);

  function clearSearch() {
    setSearchQuery("");
    setPage(0);
  }

  function updateSearch(value) {
    setPage(0);
    setSearchQuery(value);
  }

  function openColumnMenu(event, columnKey) {
    setColumnMenu({ anchorEl: event.currentTarget, columnKey });
  }

  function closeColumnMenu() {
    setColumnMenu({ anchorEl: null, columnKey: "" });
  }

  function handleSort(columnKey, direction) {
    setPage(0);
    setSortConfig((currentSort) => {
      if (currentSort.key === columnKey && currentSort.direction === direction) {
        return currentSort;
      }

      return { key: columnKey, direction };
    });
  }

  function clearSort(columnKey) {
    setPage(0);
    setSortConfig((currentSort) => {
      if (currentSort.key !== columnKey) {
        return currentSort;
      }

      return { key: "", direction: "asc" };
    });
  }

  function handleChangePage(_event, nextPage) {
    setPage(nextPage);
  }

  function handleChangeRowsPerPage(event) {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  }

  async function loadMoreMarketingLists() {
    const nextLimit = Math.min(loadedListLimit + LIST_LIMIT_STEP, MAX_LIST_LIMIT);
    setIsLoadingMore(true);
    setError("");

    try {
      const response = await getCached(API_URL, {
        force: true,
        headers: getAuthHeaders(),
        params: { limit: nextLimit },
        timeout: 30 * 1000,
        ttl: 5 * 60 * 1000,
      });
      setMarketingLists(response.data?.data || []);
      setLoadedListLimit(response.data?.limit || nextLimit);
      setHasMoreLists((response.data?.count || 0) >= nextLimit && nextLimit < MAX_LIST_LIMIT);
    } catch (fetchError) {
      if (!handleUnauthorized(fetchError)) {
        setError(getApiErrorMessage(fetchError, "Unable to load more marketing lists."));
      }
    } finally {
      setIsLoadingMore(false);
    }
  }

  async function openMemberModal(marketingList) {
    setActiveMarketingList(marketingList);
    setListMembers({ accounts: [], contacts: [] });
    setMemberError("");
    setIsLoadingMembers(true);

    try {
      const response = await getCached(
        `${API_URL}/${marketingList.listid}/members`,
        { headers: getAuthHeaders(), ttl: 5 * 60 * 1000 }
      );
      setListMembers({
        accounts: response.data?.accounts || [],
        contacts: response.data?.contacts || [],
      });
    } catch (fetchError) {
      if (handleUnauthorized(fetchError)) return;
      setMemberError(getApiErrorMessage(fetchError, "Unable to load marketing list members."));
    } finally {
      setIsLoadingMembers(false);
    }
  }

  function closeMemberModal() {
    setActiveMarketingList(null);
    setListMembers({ accounts: [], contacts: [] });
    setMemberError("");
  }

  useEffect(() => {
    const lastPage = Math.max(0, Math.ceil(filteredMarketingLists.length / rowsPerPage) - 1);

    if (page > lastPage) {
      setPage(lastPage);
    }
  }, [filteredMarketingLists.length, page, rowsPerPage]);

  useEffect(() => {
    let isMounted = true;

    async function fetchMarketingLists() {
      setIsLoading(true);
      setError("");

      try {
        const response = await getCached(API_URL, {
          headers: getAuthHeaders(),
          params: { limit: INITIAL_LIST_LIMIT },
          ttl: 5 * 60 * 1000,
        });

        if (isMounted) {
          setMarketingLists(response.data?.data || []);
          setLoadedListLimit(response.data?.limit || INITIAL_LIST_LIMIT);
          setHasMoreLists((response.data?.count || 0) >= INITIAL_LIST_LIMIT);
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
        <Box
          sx={{
            alignItems: { xs: "stretch", md: "center" },
            display: "flex",
            flexDirection: { xs: "column", md: "row" },
            gap: 2,
          }}
        >
          <Box>
            <Typography color="primary.main" sx={{ fontWeight: 800 }} variant="h6">
              Marketing Lists
            </Typography>
            <Typography color="text.secondary" variant="body2">
              Showing {paginatedMarketingLists.length} of {filteredMarketingLists.length} filtered marketing lists.
            </Typography>
          </Box>
          <TextField
            inputProps={{ "aria-label": "Search marketing lists" }}
            label="Search marketing lists"
            onChange={(event) => updateSearch(event.target.value)}
            size="small"
            sx={{ minWidth: { sm: 280 } }}
            value={searchQuery}
          />
        </Box>
        <Stack alignItems="center" direction="row" spacing={1}>
          {hasMoreLists ? (
            <Button disabled={isLoadingMore} onClick={loadMoreMarketingLists} size="small" variant="outlined">
              {isLoadingMore ? "Loading more..." : `Load next ${LIST_LIMIT_STEP}`}
            </Button>
          ) : null}
          {hasActiveSearch ? (
            <Button
              onClick={clearSearch}
              size="small"
              sx={{ borderRadius: 1, fontWeight: 800, whiteSpace: "nowrap" }}
              variant="outlined"
            >
              Clear Search
            </Button>
          ) : null}
          <Chip label={`${marketingLists.length} total`} sx={{ fontWeight: 800 }} />
        </Stack>
      </Box>

      <TableContainer sx={{ overflowX: "auto" }}>
        <Table size="small" sx={{ minWidth: 1350, tableLayout: "fixed" }}>
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
                  <Box sx={{ alignItems: "center", display: "flex", gap: 1, justifyContent: "space-between" }}>
                    <Typography
                      component="span"
                      sx={{
                        color: "inherit",
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
                      aria-label={`${column.label} sort options`}
                      onClick={(event) => openColumnMenu(event, column.key)}
                      size="small"
                      sx={{
                        borderColor: "rgba(18, 59, 100, 0.26)",
                        color: "primary.main",
                        flex: "0 0 auto",
                        fontSize: "0.7rem",
                        lineHeight: 1,
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
            {paginatedMarketingLists.length ? (
              paginatedMarketingLists.map((marketingList) => (
                <TableRow hover key={marketingList.listid || marketingList.marketing_list_name}>
                  <TableCell>{marketingList.client_name || "Missing"}</TableCell>
                  <TableCell>{marketingList.campaign || "Missing"}</TableCell>
                  <TableCell>{formatDate(marketingList.createdon)}</TableCell>
                  <TableCell sx={{ overflowWrap: "anywhere" }}>
                    {marketingList.listid && marketingList.marketing_list_name ? (
                      <Button
                        onClick={() => openMemberModal(marketingList)}
                        size="small"
                        sx={{ fontWeight: 800, justifyContent: "flex-start", p: 0, textAlign: "left", textTransform: "none" }}
                        variant="text"
                      >
                        {marketingList.marketing_list_name}
                      </Button>
                    ) : (
                      marketingList.marketing_list_name || "Missing"
                    )}
                  </TableCell>
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
                <TableCell colSpan={columns.length} sx={{ p: 0 }}>
                  <EmptyState
                    actionLabel={hasActiveSearch ? "Clear search" : undefined}
                    compact
                    description={
                      hasActiveSearch
                        ? "Clear or adjust the search to broaden the results."
                        : "Marketing lists will appear here after they are available from Dynamics."
                    }
                    icon={hasActiveSearch ? "search" : "database"}
                    onAction={hasActiveSearch ? clearSearch : undefined}
                    title={hasActiveSearch ? "No matching marketing lists" : "No marketing lists found"}
                  />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination
        component="div"
        count={filteredMarketingLists.length}
        onPageChange={handleChangePage}
        onRowsPerPageChange={handleChangeRowsPerPage}
        page={page}
        rowsPerPage={rowsPerPage}
        rowsPerPageOptions={[25, 50, 100]}
      />
      <Menu
        anchorEl={columnMenu.anchorEl}
        onClose={closeColumnMenu}
        open={Boolean(columnMenu.anchorEl)}
      >
        <Box sx={{ p: 1.5, width: 240 }}>
          <Typography color="text.secondary" sx={{ mb: 1 }} variant="overline">
            {activeColumnMenu?.label || "Column"} Sort
          </Typography>
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
      </Menu>

      <Dialog fullWidth maxWidth="lg" onClose={closeMemberModal} open={Boolean(activeMarketingList)}>
        <ModalTitle onClose={closeMemberModal} subtitle="Accounts and contacts included in this Dynamics marketing list.">
          {activeMarketingList?.marketing_list_name || "Marketing List Members"}
        </ModalTitle>
        <DialogContent dividers>
          {isLoadingMembers ? (
            <Box sx={{ alignItems: "center", display: "flex", flexDirection: "column", gap: 2, py: 6 }}>
              <CircularProgress />
              <Typography color="text.secondary">Loading accounts and contacts...</Typography>
            </Box>
          ) : memberError ? (
            <Alert severity="error">{memberError}</Alert>
          ) : (
            <Stack spacing={4}>
              <Box>
                <Stack alignItems="center" direction="row" justifyContent="space-between" sx={{ mb: 1.5 }}>
                  <Typography color="primary.main" sx={{ fontWeight: 800 }} variant="h6">Accounts</Typography>
                  <Chip label={`${listMembers.accounts.length} account${listMembers.accounts.length === 1 ? "" : "s"}`} size="small" />
                </Stack>
                {listMembers.accounts.length ? (
                  <TableContainer sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 800 }}>Account Name</TableCell>
                          <TableCell sx={{ fontWeight: 800 }}>Sector</TableCell>
                          <TableCell sx={{ fontWeight: 800 }}>Website</TableCell>
                          <TableCell sx={{ fontWeight: 800 }}>Phone</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {listMembers.accounts.map((account) => (
                          <TableRow key={account.accountid || account.name}>
                            <TableCell>{account.name || "Missing"}</TableCell>
                            <TableCell>{getFormattedDynamicsValue(account, "new_sector") || "Missing"}</TableCell>
                            <TableCell sx={{ overflowWrap: "anywhere" }}>{account.websiteurl || "Missing"}</TableCell>
                            <TableCell>{account.telephone1 || "Missing"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                ) : (
                  <Typography color="text.secondary">No accounts belong to this marketing list.</Typography>
                )}
              </Box>

              <Box>
                <Stack alignItems="center" direction="row" justifyContent="space-between" sx={{ mb: 1.5 }}>
                  <Typography color="primary.main" sx={{ fontWeight: 800 }} variant="h6">Contacts</Typography>
                  <Chip label={`${listMembers.contacts.length} contact${listMembers.contacts.length === 1 ? "" : "s"}`} size="small" />
                </Stack>
                {listMembers.contacts.length ? (
                  <TableContainer sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 800 }}>Contact Name</TableCell>
                          <TableCell sx={{ fontWeight: 800 }}>Job Title</TableCell>
                          <TableCell sx={{ fontWeight: 800 }}>Phone</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {listMembers.contacts.map((contact) => (
                          <TableRow key={contact.contactid || contact.fullname}>
                            <TableCell>{contact.fullname || "Missing"}</TableCell>
                            <TableCell>{contact.jobtitle || "Missing"}</TableCell>
                            <TableCell>{contact.telephone1 || "Missing"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                ) : (
                  <Typography color="text.secondary">No contacts belong to this marketing list.</Typography>
                )}
              </Box>
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={closeMemberModal}>Close</Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
