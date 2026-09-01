import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Divider,
  Paper,
  Stack,
  Typography,
  useTheme,
} from "@mui/material";

import { getApiErrorMessage, getCurrentUser } from "./auth";
import {
  disconnectQuickBooks,
  getQuickBooksConnectUrl,
  getQuickBooksStatus,
} from "./quickbooksApi";

function formatDate(value) {
  if (!value) {
    return "Not available";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Not available";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function DetailRow({ label, value }) {
  return (
    <Box
      sx={{
        display: "grid",
        gap: 0.5,
        gridTemplateColumns: { xs: "1fr", sm: "220px minmax(0, 1fr)" },
        py: 1.25,
      }}
    >
      <Typography color="text.secondary" sx={{ fontWeight: 700 }}>
        {label}
      </Typography>
      <Typography sx={{ overflowWrap: "anywhere" }}>{value || "Not available"}</Typography>
    </Box>
  );
}

export default function QuickBooksSettings({ onLogout }) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const theme = useTheme();
  const canManageIntegration = useMemo(() => {
    const currentUser = getCurrentUser();
    const userModules = Array.isArray(currentUser?.modules) ? currentUser.modules : [];
    return currentUser?.role === "admin" || userModules.includes("admin");
  }, []);

  const isConnected = Boolean(status?.connected);
  const requiresReconnect = Boolean(status?.requires_reconnect);
  const statusLabel = useMemo(() => {
    if (requiresReconnect) {
      return "Authorization needs renewal";
    }
    return isConnected ? "Connected" : "Not Connected";
  }, [isConnected, requiresReconnect]);

  async function loadStatus({ showLoading = true } = {}) {
    setError("");
    if (showLoading) {
      setIsLoading(true);
    }

    try {
      setStatus(await getQuickBooksStatus());
    } catch (loadError) {
      setError(getApiErrorMessage(loadError, "Unable to load QuickBooks connection status."));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected") === "true") {
      setSuccess("QuickBooks Online is connected.");
      params.delete("connected");
      const nextQuery = params.toString();
      window.history.replaceState(
        {},
        "",
        `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}`,
      );
    } else if (params.get("error")) {
      setError("QuickBooks authorization was not completed.");
      params.delete("error");
      const nextQuery = params.toString();
      window.history.replaceState(
        {},
        "",
        `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}`,
      );
    }

    loadStatus();
  }, []);

  async function handleConnect() {
    setError("");
    setSuccess("");
    setIsConnecting(true);

    try {
      window.location.assign(await getQuickBooksConnectUrl());
    } catch (connectError) {
      setIsConnecting(false);
      setError(
        connectError.userMessage ||
          getApiErrorMessage(connectError, connectError.message || "Unable to start QuickBooks authorization."),
      );
    }
  }

  async function handleDisconnect() {
    if (!window.confirm("Disconnect QuickBooks Online from Camoin 360?")) {
      return;
    }

    setError("");
    setSuccess("");
    setIsDisconnecting(true);

    try {
      const disconnectedStatus = await disconnectQuickBooks();
      setStatus(disconnectedStatus);
      setSuccess(
        disconnectedStatus?.revoke_error
          ? "QuickBooks Online has been disconnected. Intuit token revocation could not be confirmed."
          : "QuickBooks Online has been disconnected.",
      );
      await loadStatus({ showLoading: false });
    } catch (disconnectError) {
      setError(getApiErrorMessage(disconnectError, "Unable to disconnect QuickBooks."));
    } finally {
      setIsDisconnecting(false);
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
                Settings
              </Typography>
            </Box>

            <Divider sx={{ borderColor: "rgba(255,255,255,0.18)" }} />

            <Button
              fullWidth
              sx={{
                backgroundColor: "common.white",
                color: "primary.main",
                fontWeight: 800,
                justifyContent: "flex-start",
              }}
            >
              QuickBooks Online
            </Button>

            <Box sx={{ flex: 1 }} />

            <Button
              fullWidth
              onClick={onLogout}
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
          <Container maxWidth="lg" sx={{ px: { xs: 2, md: 4 } }}>
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
                  QuickBooks Online
                </Typography>
                <Typography color="text.secondary">
                  Manage the QuickBooks Online company authorized for Camoin 360 financial reporting.
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
                  overflow: "hidden",
                }}
              >
                <Box
                  sx={{
                    alignItems: { xs: "flex-start", sm: "center" },
                    borderBottom: "1px solid",
                    borderColor: "divider",
                    display: "flex",
                    flexDirection: { xs: "column", sm: "row" },
                    gap: 2,
                    justifyContent: "space-between",
                    px: { xs: 2, md: 3 },
                    py: 2,
                  }}
                >
                  <Box>
                    <Typography color="primary.main" sx={{ fontWeight: 800 }} variant="h6">
                      Connection Status
                    </Typography>
                    <Typography color="text.secondary" variant="body2">
                      OAuth credentials are stored on the backend only.
                    </Typography>
                  </Box>
                  <Chip
                    color={isConnected ? "success" : requiresReconnect ? "warning" : "default"}
                    label={statusLabel}
                    sx={{ fontWeight: 800 }}
                  />
                </Box>

                <Box sx={{ p: { xs: 2, md: 3 } }}>
                  {isLoading ? (
                    <Stack alignItems="center" direction="row" spacing={1.5}>
                      <CircularProgress size={22} />
                      <Typography color="text.secondary">Loading QuickBooks status...</Typography>
                    </Stack>
                  ) : (
                    <Stack spacing={2.5}>
                      <Box>
                        <DetailRow label="State" value={statusLabel} />
                        <Divider />
                        <DetailRow label="QuickBooks company" value={status?.company_name} />
                        <Divider />
                        <DetailRow label="Realm ID" value={status?.realm_id} />
                        <Divider />
                        <DetailRow label="Environment" value={status?.environment} />
                        <Divider />
                        <DetailRow label="Date connected" value={formatDate(status?.connected_at)} />
                        <Divider />
                        <DetailRow label="Last updated" value={formatDate(status?.updated_at)} />
                      </Box>

                      {!canManageIntegration ? (
                        <Alert severity="info">
                          QuickBooks Online is managed by a Camoin 360 administrator.
                        </Alert>
                      ) : null}

                      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                        {canManageIntegration && (!isConnected || requiresReconnect) ? (
                          <Button
                            disabled={isConnecting}
                            onClick={handleConnect}
                            variant="contained"
                          >
                            {isConnecting
                              ? "Starting..."
                              : requiresReconnect
                                ? "Reconnect QuickBooks"
                                : "Connect QuickBooks"}
                          </Button>
                        ) : null}

                        {canManageIntegration && isConnected ? (
                          <Button
                            color="error"
                            disabled={isDisconnecting}
                            onClick={handleDisconnect}
                            variant="outlined"
                          >
                            {isDisconnecting ? "Disconnecting..." : "Disconnect QuickBooks"}
                          </Button>
                        ) : null}

                        <Button disabled={isLoading} onClick={() => loadStatus()} variant="outlined">
                          Refresh
                        </Button>
                      </Stack>
                    </Stack>
                  )}
                </Box>
              </Paper>
            </Stack>
          </Container>
        </Box>
      </Box>
    </Box>
  );
}
