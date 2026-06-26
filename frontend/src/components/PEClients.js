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
  Menu,
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
  TextField,
  Typography,
} from "@mui/material";

import { getCached, invalidateApiCache } from "../apiClient";
import { API_BASE_URL, getApiErrorMessage, getAuthHeaders, handleUnauthorized } from "../auth";
import { EmptyState, ModalTitle, subtleTableHeadCellSx } from "./UiPrimitives";

const API_URL = `${API_BASE_URL}/organizations`;
const USER_API_URL = `${API_BASE_URL}/users`;
const DEFAULT_ROWS_PER_PAGE = 25;
const DEFAULT_USER_ROWS_PER_PAGE = 10;

const initialOrganizationFormValues = {
  organization_name: "",
  city: "",
  state: "",
  contract_expiration: "",
};
const initialEditOrganizationFormValues = {
  id: "",
  ...initialOrganizationFormValues,
};
const initialUserFormValues = {
  organization_id: "",
  name: "",
  username: "",
  password: "",
  role: "user",
};
const initialEditUserFormValues = {
  id: "",
  organization_id: "",
  name: "",
  username: "",
  role: "user",
};
const initialResetPasswordValues = {
  id: "",
  name: "",
  password: "",
};

const columns = [
  { key: "organization_name", label: "Organization Name", width: 280 },
  { key: "city", label: "City", width: 200 },
  { key: "state", label: "State", width: 160 },
  { key: "user_count", label: "Users", width: 120 },
  { key: "contract_expiration", label: "Contract Expiration", width: 190 },
  { key: "actions", label: "Actions", width: 180 },
];

const detailUserColumns = [
  { key: "name", label: "Name", width: 220 },
  { key: "username", label: "Username", width: 240 },
  { key: "role", label: "Role", width: 150 },
  { key: "reset_password", label: "Reset Password", width: 180 },
  { key: "actions", label: "Actions", width: 180 },
];

const actionFieldsOptions = [
  { key: "organization", label: "Add Organization" },
  { key: "export", label: "Export" },
];

const tableMinWidth = columns.reduce((totalWidth, column) => totalWidth + column.width, 0);
const userTableMinWidth = detailUserColumns.reduce((totalWidth, column) => totalWidth + column.width, 0);

function formatDate(value) {
  if (!value) {
    return "Not set";
  }

  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function getDateInputValue(value) {
  return value ? String(value).slice(0, 10) : "";
}

function escapeCsvValue(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function SummaryMetricCard({ label, value, description }) {
  return (
    <Paper
      elevation={0}
      sx={{
        border: "1px solid rgba(0, 51, 108, 0.12)",
        borderRadius: 2,
        minWidth: 0,
        p: 2.5,
      }}
    >
      <Typography
        color="text.secondary"
        sx={{ fontSize: "0.72rem", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }}
      >
        {label}
      </Typography>
      <Typography color="primary.main" sx={{ fontSize: "2rem", fontWeight: 800, lineHeight: 1.2, my: 0.5 }}>
        {value.toLocaleString()}
      </Typography>
      <Typography color="text.secondary" variant="body2">
        {description}
      </Typography>
    </Paper>
  );
}

export default function PEClients() {
  const [clients, setClients] = useState([]);
  const [users, setUsers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUsersLoading, setIsUsersLoading] = useState(true);
  const [error, setError] = useState("");
  const [usersError, setUsersError] = useState("");
  const [actionsAnchor, setActionsAnchor] = useState(null);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditOrganizationDialogOpen, setIsEditOrganizationDialogOpen] = useState(false);
  const [isUserDialogOpen, setIsUserDialogOpen] = useState(false);
  const [isEditUserDialogOpen, setIsEditUserDialogOpen] = useState(false);
  const [isResetPasswordDialogOpen, setIsResetPasswordDialogOpen] = useState(false);
  const [organizationFormValues, setOrganizationFormValues] = useState(initialOrganizationFormValues);
  const [editOrganizationFormValues, setEditOrganizationFormValues] = useState(initialEditOrganizationFormValues);
  const [userFormValues, setUserFormValues] = useState(initialUserFormValues);
  const [editUserFormValues, setEditUserFormValues] = useState(initialEditUserFormValues);
  const [resetPasswordValues, setResetPasswordValues] = useState(initialResetPasswordValues);
  const [formError, setFormError] = useState("");
  const [editOrganizationFormError, setEditOrganizationFormError] = useState("");
  const [userFormError, setUserFormError] = useState("");
  const [editUserFormError, setEditUserFormError] = useState("");
  const [resetPasswordError, setResetPasswordError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_ROWS_PER_PAGE);
  const [usersPage, setUsersPage] = useState(0);
  const [userRowsPerPage, setUserRowsPerPage] = useState(DEFAULT_USER_ROWS_PER_PAGE);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState("");

  const selectedOrganization = useMemo(
    () => clients.find((client) => String(client.id) === String(selectedOrganizationId)),
    [clients, selectedOrganizationId]
  );
  const selectedOrganizationUsers = selectedOrganizationId
    ? users.filter((user) => String(user.organization_id) === String(selectedOrganizationId))
    : [];
  const paginatedClients = clients.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);
  const paginatedUsers = selectedOrganizationUsers.slice(
    usersPage * userRowsPerPage,
    usersPage * userRowsPerPage + userRowsPerPage
  );

  async function loadClients({ force = false } = {}) {
    setIsLoading(true);
    setError("");

    try {
      const response = await getCached(API_URL, {
        force,
        headers: getAuthHeaders(),
        timeout: 60000,
      });
      setClients(response.data?.data || []);
    } catch (fetchError) {
      if (!handleUnauthorized(fetchError)) {
        setError(getApiErrorMessage(fetchError, "Unable to load organizations."));
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function loadUsers() {
    setIsUsersLoading(true);
    setUsersError("");

    try {
      const response = await axios.get(USER_API_URL, {
        headers: getAuthHeaders(),
        timeout: 60000,
      });
      setUsers(response.data?.data || []);
    } catch (fetchError) {
      if (!handleUnauthorized(fetchError)) {
        setUsersError(getApiErrorMessage(fetchError, "Unable to load users."));
      }
    } finally {
      setIsUsersLoading(false);
    }
  }

  useEffect(() => {
    loadClients();
    loadUsers();
  }, []);

  useEffect(() => {
    const lastPage = Math.max(0, Math.ceil(clients.length / rowsPerPage) - 1);

    if (page > lastPage) {
      setPage(lastPage);
    }
  }, [clients.length, page, rowsPerPage]);

  useEffect(() => {
    const lastPage = Math.max(0, Math.ceil(selectedOrganizationUsers.length / userRowsPerPage) - 1);

    if (usersPage > lastPage) {
      setUsersPage(lastPage);
    }
  }, [selectedOrganizationUsers.length, userRowsPerPage, usersPage]);

  function handleChangePage(_event, nextPage) {
    setPage(nextPage);
  }

  function handleChangeRowsPerPage(event) {
    setRowsPerPage(Number(event.target.value));
    setPage(0);
  }

  function handleChangeUsersPage(_event, nextPage) {
    setUsersPage(nextPage);
  }

  function handleChangeUserRowsPerPage(event) {
    setUserRowsPerPage(Number(event.target.value));
    setUsersPage(0);
  }

  function openAddDialog() {
    setActionsAnchor(null);
    setOrganizationFormValues(initialOrganizationFormValues);
    setFormError("");
    setIsAddDialogOpen(true);
  }

  function closeAddDialog() {
    if (!isSaving) {
      setIsAddDialogOpen(false);
    }
  }

  function openEditOrganizationDialog(client) {
    setEditOrganizationFormValues({
      id: client.id,
      organization_name: client.organization_name || "",
      city: client.city || "",
      state: client.state || "",
      contract_expiration: getDateInputValue(client.contract_expiration),
    });
    setEditOrganizationFormError("");
    setIsEditOrganizationDialogOpen(true);
  }

  function closeEditOrganizationDialog() {
    if (!isSaving) {
      setIsEditOrganizationDialogOpen(false);
    }
  }

  function openUserDialog() {
    setActionsAnchor(null);
    setUserFormValues({
      ...initialUserFormValues,
      organization_id: selectedOrganization?.id || (clients.length === 1 ? clients[0].id : ""),
    });
    setUserFormError("");
    setIsUserDialogOpen(true);
  }

  function closeUserDialog() {
    if (!isSaving) {
      setIsUserDialogOpen(false);
    }
  }

  function openEditUserDialog(user) {
    setEditUserFormValues({
      id: user.id,
      organization_id: user.organization_id,
      name: user.name,
      username: user.username,
      role: user.role,
    });
    setEditUserFormError("");
    setIsEditUserDialogOpen(true);
  }

  function closeEditUserDialog() {
    if (!isSaving) {
      setIsEditUserDialogOpen(false);
    }
  }

  function openResetPasswordDialog(user) {
    setResetPasswordValues({
      id: user.id,
      name: user.name,
      password: "",
    });
    setResetPasswordError("");
    setIsResetPasswordDialogOpen(true);
  }

  function closeResetPasswordDialog() {
    if (!isSaving) {
      setIsResetPasswordDialogOpen(false);
    }
  }

  function updateOrganizationFormValue(field, value) {
    setOrganizationFormValues((currentValues) => ({ ...currentValues, [field]: value }));
  }

  function updateEditOrganizationFormValue(field, value) {
    setEditOrganizationFormValues((currentValues) => ({ ...currentValues, [field]: value }));
  }

  function updateUserFormValue(field, value) {
    setUserFormValues((currentValues) => ({ ...currentValues, [field]: value }));
  }

  function updateEditUserFormValue(field, value) {
    setEditUserFormValues((currentValues) => ({ ...currentValues, [field]: value }));
  }

  function updateResetPasswordValue(field, value) {
    setResetPasswordValues((currentValues) => ({ ...currentValues, [field]: value }));
  }

  async function submitOrganization(event) {
    event.preventDefault();
    const organizationName = organizationFormValues.organization_name.trim();

    if (!organizationName) {
      setFormError("Organization name is required.");
      return;
    }

    setIsSaving(true);
    setFormError("");

    try {
      const response = await axios.post(
        API_URL,
        {
          ...organizationFormValues,
          organization_name: organizationName,
          city: organizationFormValues.city.trim(),
          state: organizationFormValues.state.trim(),
          contract_expiration: organizationFormValues.contract_expiration || null,
        },
        { headers: getAuthHeaders(), timeout: 60000 }
      );
      const createdClient = response.data;

      invalidateApiCache(API_URL);
      if (createdClient) {
        setClients((currentClients) =>
          [...currentClients, createdClient].sort((firstClient, secondClient) =>
            firstClient.organization_name.localeCompare(secondClient.organization_name)
          )
        );
      } else {
        await loadClients({ force: true });
      }
      setIsAddDialogOpen(false);
    } catch (saveError) {
      if (!handleUnauthorized(saveError)) {
        setFormError(getApiErrorMessage(saveError, "Unable to create the organization."));
      }
    } finally {
      setIsSaving(false);
    }
  }

  async function submitOrganizationEdit(event) {
    event.preventDefault();
    const organizationName = editOrganizationFormValues.organization_name.trim();

    if (!organizationName) {
      setEditOrganizationFormError("Organization name is required.");
      return;
    }

    setIsSaving(true);
    setEditOrganizationFormError("");

    try {
      const response = await axios.patch(
        `${API_URL}/${editOrganizationFormValues.id}`,
        {
          organization_name: organizationName,
          city: editOrganizationFormValues.city.trim(),
          state: editOrganizationFormValues.state.trim(),
          contract_expiration: editOrganizationFormValues.contract_expiration || null,
        },
        { headers: getAuthHeaders(), timeout: 60000 }
      );
      const updatedClient = response.data;

      invalidateApiCache(API_URL);
      setClients((currentClients) =>
        currentClients
          .map((client) => (client.id === updatedClient.id ? updatedClient : client))
          .sort((firstClient, secondClient) =>
            firstClient.organization_name.localeCompare(secondClient.organization_name)
          )
      );
      setUsers((currentUsers) =>
        currentUsers.map((user) =>
          user.organization_id === updatedClient.id
            ? { ...user, organization_name: updatedClient.organization_name }
            : user
        )
      );
      setIsEditOrganizationDialogOpen(false);
    } catch (saveError) {
      if (!handleUnauthorized(saveError)) {
        setEditOrganizationFormError(getApiErrorMessage(saveError, "Unable to update the organization."));
      }
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteOrganization(clientToDelete) {
    const shouldDelete = window.confirm(
      `Delete ${clientToDelete.organization_name}? This will also delete users linked to this organization.`
    );

    if (!shouldDelete) {
      return;
    }

    setIsSaving(true);
    setError("");

    try {
      await axios.delete(`${API_URL}/${clientToDelete.id}`, {
        headers: getAuthHeaders(),
        timeout: 60000,
      });

      invalidateApiCache(API_URL);
      setClients((currentClients) => currentClients.filter((client) => client.id !== clientToDelete.id));
      setUsers((currentUsers) => currentUsers.filter((user) => user.organization_id !== clientToDelete.id));
      if (String(selectedOrganizationId) === String(clientToDelete.id)) {
        setSelectedOrganizationId("");
        setUsersPage(0);
      }
    } catch (deleteError) {
      if (!handleUnauthorized(deleteError)) {
        setError(getApiErrorMessage(deleteError, "Unable to delete the organization."));
      }
    } finally {
      setIsSaving(false);
    }
  }

  async function submitUser(event) {
    event.preventDefault();

    if (!userFormValues.organization_id) {
      setUserFormError("Organization is required.");
      return;
    }

    if (!userFormValues.name.trim()) {
      setUserFormError("Name is required.");
      return;
    }

    if (!userFormValues.username.trim()) {
      setUserFormError("Username is required.");
      return;
    }

    if (userFormValues.password.length < 8) {
      setUserFormError("Password must be at least 8 characters.");
      return;
    }

    setIsSaving(true);
    setUserFormError("");

    try {
      const response = await axios.post(
        `${API_URL}/${userFormValues.organization_id}/users`,
        {
          name: userFormValues.name.trim(),
          username: userFormValues.username.trim(),
          password: userFormValues.password,
          role: userFormValues.role.trim() || "user",
        },
        { headers: getAuthHeaders(), timeout: 60000 }
      );
      const createdUser = response.data;
      invalidateApiCache(API_URL);
      setUsers((currentUsers) =>
        [...currentUsers, createdUser].sort((firstUser, secondUser) =>
          firstUser.name.localeCompare(secondUser.name)
        )
      );
      setClients((currentClients) =>
        currentClients.map((client) =>
          String(client.id) === String(userFormValues.organization_id)
            ? { ...client, user_count: Number(client.user_count || 0) + 1 }
            : client
        )
      );
      setIsUserDialogOpen(false);
    } catch (saveError) {
      if (!handleUnauthorized(saveError)) {
        setUserFormError(getApiErrorMessage(saveError, "Unable to create the user."));
      }
    } finally {
      setIsSaving(false);
    }
  }

  async function submitUserEdit(event) {
    event.preventDefault();

    if (!editUserFormValues.organization_id || !editUserFormValues.name.trim() || !editUserFormValues.username.trim()) {
      setEditUserFormError("Organization, name, and username are required.");
      return;
    }

    setIsSaving(true);
    setEditUserFormError("");

    try {
      const previousUser = users.find((user) => user.id === editUserFormValues.id);
      const response = await axios.patch(
        `${USER_API_URL}/${editUserFormValues.id}`,
        {
          organization_id: Number(editUserFormValues.organization_id),
          name: editUserFormValues.name.trim(),
          username: editUserFormValues.username.trim(),
          role: editUserFormValues.role.trim() || "user",
        },
        { headers: getAuthHeaders(), timeout: 60000 }
      );
      const updatedUser = response.data;

      setUsers((currentUsers) => currentUsers.map((user) => (user.id === updatedUser.id ? updatedUser : user)));

      if (previousUser && String(previousUser.organization_id) !== String(updatedUser.organization_id)) {
        setClients((currentClients) =>
          currentClients.map((client) => {
            if (String(client.id) === String(previousUser.organization_id)) {
              return { ...client, user_count: Math.max(0, Number(client.user_count || 0) - 1) };
            }
            if (String(client.id) === String(updatedUser.organization_id)) {
              return { ...client, user_count: Number(client.user_count || 0) + 1 };
            }
            return client;
          })
        );
      }

      setIsEditUserDialogOpen(false);
    } catch (saveError) {
      if (!handleUnauthorized(saveError)) {
        setEditUserFormError(getApiErrorMessage(saveError, "Unable to update the user."));
      }
    } finally {
      setIsSaving(false);
    }
  }

  async function submitPasswordReset(event) {
    event.preventDefault();

    if (resetPasswordValues.password.length < 8) {
      setResetPasswordError("Password must be at least 8 characters.");
      return;
    }

    setIsSaving(true);
    setResetPasswordError("");

    try {
      const response = await axios.post(
        `${USER_API_URL}/${resetPasswordValues.id}/reset-password`,
        { password: resetPasswordValues.password },
        { headers: getAuthHeaders(), timeout: 60000 }
      );
      const updatedUser = response.data;

      setUsers((currentUsers) => currentUsers.map((user) => (user.id === updatedUser.id ? updatedUser : user)));
      setIsResetPasswordDialogOpen(false);
    } catch (saveError) {
      if (!handleUnauthorized(saveError)) {
        setResetPasswordError(getApiErrorMessage(saveError, "Unable to reset the password."));
      }
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteUser(userToDelete) {
    const shouldDelete = window.confirm(`Delete ${userToDelete.name}?`);

    if (!shouldDelete) {
      return;
    }

    setIsSaving(true);
    setUsersError("");

    try {
      await axios.delete(`${USER_API_URL}/${userToDelete.id}`, {
        headers: getAuthHeaders(),
        timeout: 60000,
      });

      setUsers((currentUsers) => currentUsers.filter((user) => user.id !== userToDelete.id));
      setClients((currentClients) =>
        currentClients.map((client) =>
          String(client.id) === String(userToDelete.organization_id)
            ? { ...client, user_count: Math.max(0, Number(client.user_count || 0) - 1) }
            : client
        )
      );
    } catch (deleteError) {
      if (!handleUnauthorized(deleteError)) {
        setUsersError(getApiErrorMessage(deleteError, "Unable to delete the user."));
      }
    } finally {
      setIsSaving(false);
    }
  }

  function handleAction(optionKey) {
    if (optionKey === "organization") {
      openAddDialog();
    } else {
      exportClients();
    }
  }

  function exportClients() {
    setActionsAnchor(null);

    if (!clients.length) {
      return;
    }

    const exportColumns = columns.filter((column) => column.key !== "actions");
    const rows = [
      exportColumns.map((column) => escapeCsvValue(column.label)).join(","),
      ...clients.map((client) =>
        exportColumns.map((column) => escapeCsvValue(client[column.key])).join(",")
      ),
    ];
    const downloadUrl = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = "organizations.csv";
    link.click();
    URL.revokeObjectURL(downloadUrl);
  }

  function openOrganizationDetail(client) {
    setSelectedOrganizationId(client.id);
    setUsersPage(0);
  }

  function renderOrganizationTable() {
    return (
      <>
        <TableContainer sx={{ overflowX: "auto" }}>
          <Table size="small" sx={{ minWidth: tableMinWidth, tableLayout: "fixed" }}>
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
                    {column.label}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell align="center" colSpan={columns.length} sx={{ py: 6 }}>
                    <CircularProgress size={28} />
                  </TableCell>
                </TableRow>
              ) : paginatedClients.length ? (
                paginatedClients.map((client) => (
                  <TableRow
                    hover
                    key={client.id || client.dynamics_account_id}
                    onClick={() => openOrganizationDetail(client)}
                    sx={{ cursor: "pointer" }}
                  >
                    <TableCell sx={{ fontWeight: 700 }}>{client.organization_name || "Missing"}</TableCell>
                    <TableCell>{client.city || "Missing"}</TableCell>
                    <TableCell>{client.state || "Missing"}</TableCell>
                    <TableCell>{client.user_count ?? 0}</TableCell>
                    <TableCell>{formatDate(client.contract_expiration)}</TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={1}>
                        <Button
                          disabled={isSaving}
                          onClick={(event) => {
                            event.stopPropagation();
                            openEditOrganizationDialog(client);
                          }}
                          size="small"
                        >
                          Edit
                        </Button>
                        <Button
                          color="error"
                          disabled={isSaving}
                          onClick={(event) => {
                            event.stopPropagation();
                            deleteOrganization(client);
                          }}
                          size="small"
                        >
                          Delete
                        </Button>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={columns.length} sx={{ p: 0 }}>
                    <EmptyState
                      actionLabel="Add organization"
                      description="Create a client organization to begin tracking access."
                      icon="database"
                      onAction={openAddDialog}
                      title="No organizations available"
                    />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          component="div"
          count={clients.length}
          onPageChange={handleChangePage}
          onRowsPerPageChange={handleChangeRowsPerPage}
          page={page}
          rowsPerPage={rowsPerPage}
          rowsPerPageOptions={[10, 25, 50, 100]}
        />
      </>
    );
  }

  function renderOrganizationDetail() {
    if (!selectedOrganization) {
      return null;
    }

    return (
      <>
        <Box sx={{ px: { xs: 2, md: 3 }, py: 2.5 }}>
          <Stack
            alignItems={{ xs: "stretch", sm: "center" }}
            direction={{ xs: "column", sm: "row" }}
            justifyContent="space-between"
            spacing={1.5}
          >
            <Box>
              <Button onClick={() => setSelectedOrganizationId("")} size="small" sx={{ mb: 1 }}>
                Back to Organizations
              </Button>
              <Typography color="primary.main" sx={{ fontWeight: 800 }} variant="h6">
                {selectedOrganization.organization_name || "Missing"}
              </Typography>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={{ xs: 0.5, sm: 2 }} sx={{ mt: 0.5 }}>
                <Typography color="text.secondary" variant="body2">
                  City: {selectedOrganization.city || "Missing"}
                </Typography>
                <Typography color="text.secondary" variant="body2">
                  State: {selectedOrganization.state || "Missing"}
                </Typography>
              </Stack>
            </Box>
            <Stack alignItems={{ xs: "stretch", sm: "center" }} direction={{ xs: "column", sm: "row" }} spacing={1}>
              <Button disabled={isSaving} onClick={() => openEditOrganizationDialog(selectedOrganization)}>
                Edit Organization
              </Button>
              <Button disabled={!clients.length || isSaving} onClick={openUserDialog} variant="contained">
                Create User
              </Button>
            </Stack>
          </Stack>
        </Box>

        {usersError ? <Alert severity="error">{usersError}</Alert> : null}

        <TableContainer sx={{ overflowX: "auto" }}>
          <Table size="small" sx={{ minWidth: userTableMinWidth, tableLayout: "fixed" }}>
            <TableHead>
              <TableRow>
                {detailUserColumns.map((column) => (
                  <TableCell
                    key={column.key}
                    sx={{
                      ...subtleTableHeadCellSx,
                      width: column.width,
                    }}
                  >
                    {column.label}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {isUsersLoading ? (
                <TableRow>
                  <TableCell align="center" colSpan={detailUserColumns.length} sx={{ py: 6 }}>
                    <CircularProgress size={28} />
                  </TableCell>
                </TableRow>
              ) : paginatedUsers.length ? (
                paginatedUsers.map((user) => (
                  <TableRow hover key={user.id}>
                    <TableCell sx={{ fontWeight: 700 }}>{user.name}</TableCell>
                    <TableCell>{user.username}</TableCell>
                    <TableCell>{user.role}</TableCell>
                    <TableCell>
                      <Button disabled={isSaving} onClick={() => openResetPasswordDialog(user)} size="small">
                        Reset Password
                      </Button>
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={1}>
                        <Button disabled={isSaving} onClick={() => openEditUserDialog(user)} size="small">
                          Edit
                        </Button>
                        <Button color="error" disabled={isSaving} onClick={() => deleteUser(user)} size="small">
                          Delete
                        </Button>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={detailUserColumns.length} sx={{ p: 0 }}>
                    <EmptyState
                      actionLabel="Create user"
                      description="Create a user linked to this organization."
                      icon="database"
                      onAction={openUserDialog}
                      title="No users linked to this organization"
                    />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          component="div"
          count={selectedOrganizationUsers.length}
          onPageChange={handleChangeUsersPage}
          onRowsPerPageChange={handleChangeUserRowsPerPage}
          page={usersPage}
          rowsPerPage={userRowsPerPage}
          rowsPerPageOptions={[10, 25, 50, 100]}
        />
      </>
    );
  }

  return (
    <Stack spacing={2.5}>
      <Box
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))" },
        }}
      >
        <SummaryMetricCard
          description="Client organizations in the management database"
          label="Total Organizations"
          value={clients.length}
        />
        <SummaryMetricCard
          description="Portal users linked to client organizations"
          label="Total Users"
          value={users.length}
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
              Client Management
            </Typography>
            <Typography color="text.secondary" variant="body2">
              Organizations and linked portal users.
            </Typography>
          </Box>
          <Stack alignItems="center" direction="row" spacing={1}>
            <Button
              aria-controls={actionsAnchor ? "pe-client-actions" : undefined}
              aria-expanded={actionsAnchor ? "true" : undefined}
              aria-haspopup="menu"
              onClick={(event) => setActionsAnchor(event.currentTarget)}
              variant="outlined"
            >
              Actions
            </Button>
            <Chip label={`${clients.length} total`} sx={{ fontWeight: 800 }} />
          </Stack>
        </Box>

        {error ? <Alert severity="error">{error}</Alert> : null}
        {selectedOrganization ? renderOrganizationDetail() : renderOrganizationTable()}

        <Menu
          anchorEl={actionsAnchor}
          id="pe-client-actions"
          onClose={() => setActionsAnchor(null)}
          open={Boolean(actionsAnchor)}
        >
          {actionFieldsOptions.map((option) => (
            <MenuItem
              disabled={option.key === "export" && !clients.length}
              key={option.key}
              onClick={() => handleAction(option.key)}
            >
              {option.label}
            </MenuItem>
          ))}
        </Menu>
      </Paper>

      <Dialog fullWidth maxWidth="sm" onClose={closeAddDialog} open={isAddDialogOpen}>
        <Box component="form" onSubmit={submitOrganization}>
          <ModalTitle onClose={closeAddDialog} subtitle="Creates a client account in Dynamics.">
            Add Organization
          </ModalTitle>
          <DialogContent dividers>
            <Stack spacing={2}>
              {formError ? <Alert severity="error">{formError}</Alert> : null}
              <TextField
                autoFocus
                disabled={isSaving}
                label="Organization name"
                onChange={(event) => updateOrganizationFormValue("organization_name", event.target.value)}
                required
                value={organizationFormValues.organization_name}
              />
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField
                  disabled={isSaving}
                  fullWidth
                  label="City"
                  onChange={(event) => updateOrganizationFormValue("city", event.target.value)}
                  value={organizationFormValues.city}
                />
                <TextField
                  disabled={isSaving}
                  fullWidth
                  label="State"
                  onChange={(event) => updateOrganizationFormValue("state", event.target.value)}
                  value={organizationFormValues.state}
                />
              </Stack>
              <TextField
                disabled={isSaving}
                InputLabelProps={{ shrink: true }}
                label="Contract expiration"
                onChange={(event) => updateOrganizationFormValue("contract_expiration", event.target.value)}
                type="date"
                value={organizationFormValues.contract_expiration}
              />
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, py: 2 }}>
            <Button disabled={isSaving} onClick={closeAddDialog}>
              Cancel
            </Button>
            <Button disabled={isSaving} type="submit" variant="contained">
              {isSaving ? "Creating..." : "Create Organization"}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      <Dialog fullWidth maxWidth="sm" onClose={closeEditOrganizationDialog} open={isEditOrganizationDialogOpen}>
        <Box component="form" onSubmit={submitOrganizationEdit}>
          <ModalTitle onClose={closeEditOrganizationDialog} subtitle="Updates the organization row.">
            Edit Organization
          </ModalTitle>
          <DialogContent dividers>
            <Stack spacing={2}>
              {editOrganizationFormError ? <Alert severity="error">{editOrganizationFormError}</Alert> : null}
              <TextField
                autoFocus
                disabled={isSaving}
                label="Organization name"
                onChange={(event) => updateEditOrganizationFormValue("organization_name", event.target.value)}
                required
                value={editOrganizationFormValues.organization_name}
              />
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField
                  disabled={isSaving}
                  fullWidth
                  label="City"
                  onChange={(event) => updateEditOrganizationFormValue("city", event.target.value)}
                  value={editOrganizationFormValues.city}
                />
                <TextField
                  disabled={isSaving}
                  fullWidth
                  label="State"
                  onChange={(event) => updateEditOrganizationFormValue("state", event.target.value)}
                  value={editOrganizationFormValues.state}
                />
              </Stack>
              <TextField
                disabled={isSaving}
                InputLabelProps={{ shrink: true }}
                label="Contract expiration"
                onChange={(event) => updateEditOrganizationFormValue("contract_expiration", event.target.value)}
                type="date"
                value={editOrganizationFormValues.contract_expiration}
              />
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, py: 2 }}>
            <Button disabled={isSaving} onClick={closeEditOrganizationDialog}>
              Cancel
            </Button>
            <Button disabled={isSaving} type="submit" variant="contained">
              {isSaving ? "Saving..." : "Save Organization"}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      <Dialog fullWidth maxWidth="sm" onClose={closeUserDialog} open={isUserDialogOpen}>
        <Box component="form" onSubmit={submitUser}>
          <ModalTitle onClose={closeUserDialog} subtitle="Creates an internal user linked to an organization.">
            Create User
          </ModalTitle>
          <DialogContent dividers>
            <Stack spacing={2}>
              {userFormError ? <Alert severity="error">{userFormError}</Alert> : null}
              <FormControl required>
                <InputLabel id="pe-client-user-organization-label">Organization</InputLabel>
                <Select
                  disabled={isSaving || Boolean(selectedOrganization)}
                  label="Organization"
                  labelId="pe-client-user-organization-label"
                  onChange={(event) => updateUserFormValue("organization_id", event.target.value)}
                  value={userFormValues.organization_id}
                >
                  {clients.map((client) => (
                    <MenuItem key={client.id} value={client.id}>
                      {client.organization_name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField
                autoFocus
                disabled={isSaving}
                label="Name"
                onChange={(event) => updateUserFormValue("name", event.target.value)}
                required
                value={userFormValues.name}
              />
              <TextField
                disabled={isSaving}
                label="Username"
                onChange={(event) => updateUserFormValue("username", event.target.value)}
                required
                value={userFormValues.username}
              />
              <TextField
                disabled={isSaving}
                label="Role"
                onChange={(event) => updateUserFormValue("role", event.target.value)}
                required
                value={userFormValues.role}
              />
              <TextField
                autoComplete="new-password"
                disabled={isSaving}
                label="Password"
                onChange={(event) => updateUserFormValue("password", event.target.value)}
                required
                type="password"
                value={userFormValues.password}
              />
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, py: 2 }}>
            <Button disabled={isSaving} onClick={closeUserDialog}>
              Cancel
            </Button>
            <Button disabled={isSaving} type="submit" variant="contained">
              {isSaving ? "Creating..." : "Create User"}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      <Dialog fullWidth maxWidth="sm" onClose={closeEditUserDialog} open={isEditUserDialogOpen}>
        <Box component="form" onSubmit={submitUserEdit}>
          <ModalTitle onClose={closeEditUserDialog} subtitle="Updates the user record linked to an organization.">
            Edit User
          </ModalTitle>
          <DialogContent dividers>
            <Stack spacing={2}>
              {editUserFormError ? <Alert severity="error">{editUserFormError}</Alert> : null}
              <FormControl required>
                <InputLabel id="edit-user-organization-label">Organization</InputLabel>
                <Select
                  disabled={isSaving}
                  label="Organization"
                  labelId="edit-user-organization-label"
                  onChange={(event) => updateEditUserFormValue("organization_id", event.target.value)}
                  value={editUserFormValues.organization_id}
                >
                  {clients.map((client) => (
                    <MenuItem key={client.id} value={client.id}>
                      {client.organization_name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField
                autoFocus
                disabled={isSaving}
                label="Name"
                onChange={(event) => updateEditUserFormValue("name", event.target.value)}
                required
                value={editUserFormValues.name}
              />
              <TextField
                disabled={isSaving}
                label="Username"
                onChange={(event) => updateEditUserFormValue("username", event.target.value)}
                required
                value={editUserFormValues.username}
              />
              <TextField
                disabled={isSaving}
                label="Role"
                onChange={(event) => updateEditUserFormValue("role", event.target.value)}
                required
                value={editUserFormValues.role}
              />
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, py: 2 }}>
            <Button disabled={isSaving} onClick={closeEditUserDialog}>
              Cancel
            </Button>
            <Button disabled={isSaving} type="submit" variant="contained">
              {isSaving ? "Saving..." : "Save User"}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      <Dialog fullWidth maxWidth="sm" onClose={closeResetPasswordDialog} open={isResetPasswordDialogOpen}>
        <Box component="form" onSubmit={submitPasswordReset}>
          <ModalTitle onClose={closeResetPasswordDialog} subtitle="Stores only a new password hash.">
            Reset Password
          </ModalTitle>
          <DialogContent dividers>
            <Stack spacing={2}>
              {resetPasswordError ? <Alert severity="error">{resetPasswordError}</Alert> : null}
              <Typography color="text.secondary" variant="body2">
                Reset password for {resetPasswordValues.name || "this user"}.
              </Typography>
              <TextField
                autoComplete="new-password"
                autoFocus
                disabled={isSaving}
                label="New password"
                onChange={(event) => updateResetPasswordValue("password", event.target.value)}
                required
                type="password"
                value={resetPasswordValues.password}
              />
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, py: 2 }}>
            <Button disabled={isSaving} onClick={closeResetPasswordDialog}>
              Cancel
            </Button>
            <Button disabled={isSaving} type="submit" variant="contained">
              {isSaving ? "Resetting..." : "Reset Password"}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>
    </Stack>
  );
}
