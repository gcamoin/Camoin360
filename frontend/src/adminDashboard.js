import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Container,
  Divider,
  FormControlLabel,
  Paper,
  Stack,
  SvgIcon,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
  useTheme,
} from "@mui/material";

import {
  MODULE_OPTIONS,
  createAppUser,
  deleteAppUser,
  getApiErrorMessage,
  listAppUsers,
  updateAppUser,
} from "./auth";

const emptyForm = {
  name: "",
  email: "",
  password: "",
  confirmPassword: "",
  modules: ["main"],
};

const iconPaths = {
  signout: "M10 17v-2h4V9h-4V7h6v10h-6Zm-1-1-5-4 5-4v3h6v2H9v3Z",
  users: "M7 11a4 4 0 1 1 8 0 4 4 0 0 1-8 0Zm-4 9c.7-3.1 3.9-5 8-5s7.3 1.9 8 5H3Zm14.5-7a3 3 0 1 0 0-6 4.8 4.8 0 0 1 0 6Zm.6 2.1c1.7.6 2.9 1.8 3.4 3.9h-3.2a7 7 0 0 0-1.9-3.5c.6-.2 1.1-.3 1.7-.4Z",
};

function AdminIcon({ name }) {
  return (
    <SvgIcon fontSize="small" viewBox="0 0 24 24">
      <path d={iconPaths[name]} />
    </SvgIcon>
  );
}

function normalizeModules(modules) {
  return MODULE_OPTIONS.filter((option) => modules.includes(option.value)).map((option) => option.value);
}

function ModuleCheckboxes({ disabledModules = [], onChange, value }) {
  const selectedModules = new Set(value);

  function toggleModule(moduleValue) {
    const nextModules = new Set(selectedModules);

    if (nextModules.has(moduleValue)) {
      nextModules.delete(moduleValue);
    } else {
      nextModules.add(moduleValue);
    }

    onChange(normalizeModules([...nextModules]));
  }

  return (
    <Box
      sx={{
        display: "grid",
        gap: 0.5,
        gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))" },
      }}
    >
      {MODULE_OPTIONS.map((moduleOption) => (
        <FormControlLabel
          control={
            <Checkbox
              checked={selectedModules.has(moduleOption.value)}
              disabled={disabledModules.includes(moduleOption.value)}
              onChange={() => toggleModule(moduleOption.value)}
            />
          }
          key={moduleOption.value}
          label={moduleOption.label}
          sx={{ m: 0 }}
        />
      ))}
    </Box>
  );
}

export default function AdminDashboard({ onLogout }) {
  const [users, setUsers] = useState([]);
  const [formValues, setFormValues] = useState(emptyForm);
  const [draftModulesByEmail, setDraftModulesByEmail] = useState({});
  const [draftPasswordByEmail, setDraftPasswordByEmail] = useState({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const theme = useTheme();
  const createPassword = formValues.password || "";
  const createConfirmPassword = formValues.confirmPassword || "";
  const createPasswordMismatch =
    createConfirmPassword.length > 0 && createPassword !== createConfirmPassword;

  const sortedUsers = useMemo(
    () =>
      [...users].sort((firstUser, secondUser) => {
        if (firstUser.role === "admin") return -1;
        if (secondUser.role === "admin") return 1;
        return firstUser.email.localeCompare(secondUser.email);
      }),
    [users]
  );

  async function loadUsers() {
    setError("");
    setIsLoading(true);

    try {
      const loadedUsers = await listAppUsers();
      setUsers(loadedUsers);
      setDraftModulesByEmail(
        Object.fromEntries(loadedUsers.map((user) => [user.email, normalizeModules(user.modules || [])]))
      );
    } catch (loadError) {
      setError(getApiErrorMessage(loadError, "Unable to load users."));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  function updateFormValue(field, value) {
    setFormValues((currentValues) => ({
      ...currentValues,
      [field]: value,
    }));
  }

  async function handleCreateUser(event) {
    event.preventDefault();

    if (createPassword !== createConfirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setError("");
    setSuccess("");
    setIsCreating(true);

    try {
      const createdUser = await createAppUser({
        name: formValues.name.trim(),
        email: formValues.email.trim(),
        password: createPassword,
        modules: formValues.modules,
      });
      setUsers((currentUsers) => [...currentUsers, createdUser]);
      setDraftModulesByEmail((currentModules) => ({
        ...currentModules,
        [createdUser.email]: createdUser.modules,
      }));
      setFormValues(emptyForm);
      setSuccess(`Created ${createdUser.email}.`);
    } catch (createError) {
      setError(getApiErrorMessage(createError, "Unable to create user."));
    } finally {
      setIsCreating(false);
    }
  }

  async function handleSaveUser(user) {
    setError("");
    setSuccess("");

    try {
      const payload = {
        modules: draftModulesByEmail[user.email] || [],
      };

      if (draftPasswordByEmail[user.email]) {
        payload.password = draftPasswordByEmail[user.email];
      }

      const updatedUser = await updateAppUser(user.email, payload);
      setUsers((currentUsers) =>
        currentUsers.map((currentUser) => (currentUser.email === updatedUser.email ? updatedUser : currentUser))
      );
      setDraftModulesByEmail((currentModules) => ({
        ...currentModules,
        [updatedUser.email]: updatedUser.modules,
      }));
      setDraftPasswordByEmail((currentPasswords) => ({
        ...currentPasswords,
        [updatedUser.email]: "",
      }));
      setSuccess(`Updated ${updatedUser.email}.`);
    } catch (saveError) {
      setError(getApiErrorMessage(saveError, "Unable to update user."));
    }
  }

  async function handleDeleteUser(user) {
    setError("");
    setSuccess("");

    try {
      await deleteAppUser(user.email);
      setUsers((currentUsers) => currentUsers.filter((currentUser) => currentUser.email !== user.email));
      setSuccess(`Deleted ${user.email}.`);
    } catch (deleteError) {
      setError(getApiErrorMessage(deleteError, "Unable to delete user."));
    }
  }

  return (
    <Box
      sx={{
        minHeight: "100vh",
        background: `radial-gradient(circle at top left, ${theme.palette.secondary.main}12, transparent 30%), ${theme.palette.background.default}`,
      }}
    >
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "280px minmax(0, 1fr)" },
          minHeight: "100vh",
        }}
      >
        <Box
          component="aside"
          sx={{
            backgroundColor: "primary.main",
            color: "common.white",
            height: { md: "100vh" },
            p: { xs: 2, md: 3 },
            position: { xs: "relative", md: "sticky" },
            top: { md: 0 },
          }}
        >
          <Stack spacing={3} sx={{ height: "100%" }}>
            <Box>
              <Typography component="h1" sx={{ fontSize: "1.55rem", fontWeight: 800, lineHeight: 1.1 }}>
                Camoin 360
              </Typography>
              <Typography sx={{ color: "rgba(255,255,255,0.72)", mt: 0.75 }} variant="body2">
                User Admin
              </Typography>
            </Box>

            <Divider sx={{ borderColor: "rgba(255,255,255,0.18)" }} />

            <Button
              fullWidth
              startIcon={<AdminIcon name="users" />}
              sx={{
                backgroundColor: "common.white",
                color: "primary.main",
                fontWeight: 800,
                justifyContent: "flex-start",
              }}
            >
              Users
            </Button>

            <Box sx={{ flex: 1 }} />

            <Button
              fullWidth
              onClick={onLogout}
              startIcon={<AdminIcon name="signout" />}
              sx={{
                borderColor: "rgba(255,255,255,0.42)",
                color: "common.white",
                fontWeight: 800,
                justifyContent: "flex-start",
                "&:hover": {
                  backgroundColor: "rgba(255,255,255,0.10)",
                  borderColor: "common.white",
                },
              }}
              title="Sign out"
              variant="outlined"
            >
              Sign out
            </Button>
          </Stack>
        </Box>

        <Box component="main" sx={{ py: { xs: 3, md: 5 } }}>
          <Container maxWidth="xl" sx={{ px: { xs: 2, md: 4 } }}>
            <Stack spacing={3}>
              <Box>
                <Typography
                  component="h2"
                  sx={{
                    color: "primary.main",
                    fontSize: { xs: "2rem", md: "2.35rem" },
                    fontWeight: 750,
                    lineHeight: 1.1,
                    mb: 1,
                  }}
                >
                  User Admin
                </Typography>
                <Typography color="text.secondary">
                  Create Camoin 360 users and assign the modules they can open.
                </Typography>
              </Box>

              {error ? <Alert severity="error">{error}</Alert> : null}
              {success ? <Alert severity="success">{success}</Alert> : null}

              <Paper
                elevation={0}
                sx={{
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: 2,
                  p: { xs: 2, md: 3 },
                }}
              >
                <Stack component="form" spacing={2.25} onSubmit={handleCreateUser}>
                  <Typography color="primary.main" sx={{ fontWeight: 800 }} variant="h6">
                    Create User
                  </Typography>
                  <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" } }}>
                    <TextField
                      autoComplete="name"
                      fullWidth
                      label="Full name"
                      onChange={(event) => updateFormValue("name", event.target.value)}
                      required
                      value={formValues.name}
                    />
                    <TextField
                      autoComplete="email"
                      fullWidth
                      label="Email"
                      onChange={(event) => updateFormValue("email", event.target.value)}
                      required
                      type="email"
                      value={formValues.email}
                    />
                    <TextField
                      autoComplete="new-password"
                      fullWidth
                      inputProps={{ minLength: 8 }}
                      label="Password"
                      onChange={(event) => updateFormValue("password", event.target.value)}
                      required
                      type="password"
                      value={createPassword}
                    />
                    <TextField
                      autoComplete="new-password"
                      error={createPasswordMismatch}
                      fullWidth
                      helperText={createPasswordMismatch ? "Passwords do not match." : " "}
                      inputProps={{ minLength: 8 }}
                      label="Confirm password"
                      onChange={(event) => updateFormValue("confirmPassword", event.target.value)}
                      required
                      type="password"
                      value={createConfirmPassword}
                    />
                  </Box>
                  <ModuleCheckboxes
                    onChange={(modules) => updateFormValue("modules", modules)}
                    value={formValues.modules}
                  />
                  <Box>
                    <Button disabled={createPasswordMismatch || isCreating} type="submit" variant="contained">
                      {isCreating ? "Creating..." : "Create user"}
                    </Button>
                  </Box>
                </Stack>
              </Paper>

              <Paper
                elevation={0}
                sx={{
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: 2,
                  overflow: "hidden",
                }}
              >
                <Box
                  sx={{
                    alignItems: "center",
                    borderBottom: "1px solid",
                    borderColor: "divider",
                    display: "flex",
                    gap: 2,
                    justifyContent: "space-between",
                    px: { xs: 2, md: 3 },
                    py: 2,
                  }}
                >
                  <Typography color="primary.main" sx={{ fontWeight: 800 }} variant="h6">
                    Existing Users
                  </Typography>
                  <Button disabled={isLoading} onClick={loadUsers} variant="outlined">
                    Refresh
                  </Button>
                </Box>

                <Box sx={{ overflowX: "auto" }}>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell>User</TableCell>
                        <TableCell>Role</TableCell>
                        <TableCell sx={{ minWidth: 360 }}>Module Access</TableCell>
                        <TableCell sx={{ minWidth: 220 }}>Reset Password</TableCell>
                        <TableCell align="right">Actions</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {sortedUsers.map((user) => {
                        const isAdmin = user.role === "admin";

                        return (
                          <TableRow key={user.email}>
                            <TableCell>
                              <Typography sx={{ fontWeight: 800 }}>{user.name}</Typography>
                              <Typography color="text.secondary" variant="body2">
                                {user.email}
                              </Typography>
                            </TableCell>
                            <TableCell sx={{ textTransform: "capitalize" }}>{user.role}</TableCell>
                            <TableCell>
                              <ModuleCheckboxes
                                disabledModules={isAdmin ? MODULE_OPTIONS.map((option) => option.value) : []}
                                onChange={(modules) =>
                                  setDraftModulesByEmail((currentModules) => ({
                                    ...currentModules,
                                    [user.email]: modules,
                                  }))
                                }
                                value={draftModulesByEmail[user.email] || user.modules || []}
                              />
                            </TableCell>
                            <TableCell>
                              <TextField
                                autoComplete="new-password"
                                disabled={isAdmin}
                                fullWidth
                                inputProps={{ minLength: 8 }}
                                label="New password"
                                onChange={(event) =>
                                  setDraftPasswordByEmail((currentPasswords) => ({
                                    ...currentPasswords,
                                    [user.email]: event.target.value,
                                  }))
                                }
                                size="small"
                                type="password"
                                value={draftPasswordByEmail[user.email] || ""}
                              />
                            </TableCell>
                            <TableCell align="right">
                              <Stack direction="row" justifyContent="flex-end" spacing={1}>
                                <Button disabled={isAdmin} onClick={() => handleSaveUser(user)} variant="contained">
                                  Save
                                </Button>
                                <Button color="error" disabled={isAdmin} onClick={() => handleDeleteUser(user)} variant="outlined">
                                  Delete
                                </Button>
                              </Stack>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </Box>
              </Paper>
            </Stack>
          </Container>
        </Box>
      </Box>
    </Box>
  );
}
