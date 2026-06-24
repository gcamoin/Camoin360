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
  DialogTitle,
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

const API_URL = `${API_BASE_URL}/marketing-lists`;
const DEFAULT_ROWS_PER_PAGE = 25;

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
  const [error, setError] = useState("");
  const [sortConfig, setSortConfig] = useState({ key: "createdon", direction: "desc" });
  const [columnFilters, setColumnFilters] = useState(() => ({}));
  const [columnMenu, setColumnMenu] = useState({ anchorEl: null, columnKey: "" });
  const [activeMarketingList, setActiveMarketingList] = useState(null);
  const [listMembers, setListMembers] = useState({ accounts: [], contacts: [] });
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [memberError, setMemberError] = useState("");
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_ROWS_PER_PAGE);

  const filteredMarketingLists = useMemo(
    () => {
      const normalizedColumnFilters = Object.entries(columnFilters)
        .map(([columnKey, filterValue]) => [columnKey, normalizeSearch(filterValue)])
        .filter(([_columnKey, filterValue]) => filterValue);

      return marketingLists.filter((marketingList) =>
        normalizedColumnFilters.every(([columnKey, filterValue]) =>
          normalizeSearch(getColumnFilterValue(marketingList, columnKey)).includes(filterValue)
        )
      );
    },
    [columnFilters, marketingLists]
  );

  const sortedMarketingLists = useMemo(
    () => sortMarketingLists(filteredMarketingLists, sortConfig),
    [filteredMarketingLists, sortConfig]
  );
  const paginatedMarketingLists = useMemo(
    () => sortedMarketingLists.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage),
    [page, rowsPerPage, sortedMarketingLists]
  );

  const activeFilterCount = [
    ...Object.values(columnFilters).map((filterValue) => Boolean(String(filterValue || "").trim())),
  ].filter(Boolean).length;
  const activeColumnMenu = columns.find((column) => column.key === columnMenu.columnKey);

  function resetFilters() {
    setColumnFilters({});
    setPage(0);
  }

  function updateColumnFilter(columnKey, value) {
    setPage(0);
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

  async function openMemberModal(marketingList) {
    setActiveMarketingList(marketingList);
    setListMembers({ accounts: [], contacts: [] });
    setMemberError("");
    setIsLoadingMembers(true);

    try {
      const response = await axios.get(
        `${API_URL}/${marketingList.listid}/members`,
        { headers: getAuthHeaders() }
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
            Showing {paginatedMarketingLists.length} of {filteredMarketingLists.length} filtered marketing lists.
          </Typography>
        </Box>
        <Stack alignItems="center" direction="row" spacing={1}>
          {activeFilterCount ? (
            <Button
              onClick={resetFilters}
              size="small"
              sx={{ borderRadius: 1, fontWeight: 800, whiteSpace: "nowrap" }}
              variant="outlined"
            >
              Reset Filters
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
                    backgroundColor: "primary.main",
                    color: "common.white",
                    fontWeight: 800,
                    py: 1.25,
                    width: column.width,
                  }}
                >
                  <Box sx={{ alignItems: "center", display: "flex", gap: 1, justifyContent: "space-between" }}>
                    <Typography
                      component="span"
                      sx={{
                        color: "common.white",
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
                        borderColor: columnFilters[column.key] ? "common.white" : "rgba(255, 255, 255, 0.55)",
                        color: "common.white",
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

      <Dialog fullWidth maxWidth="lg" onClose={closeMemberModal} open={Boolean(activeMarketingList)}>
        <DialogTitle sx={{ fontWeight: 800 }}>
          {activeMarketingList?.marketing_list_name || "Marketing List Members"}
        </DialogTitle>
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
