import { useState } from "react";
import {
  Box,
  Button,
  Chip,
  Container,
  Divider,
  IconButton,
  Paper,
  Stack,
  SvgIcon,
  Tooltip,
  Typography,
  useTheme,
} from "@mui/material";

import LeadfeederVisits from "./components/LeadfeederVisits";
import MarketingListConversionAnalysis from "./components/MarketingListConversionAnalysis";
import MarketingLists from "./components/MarketingLists";
import PEClients from "./components/PEClients";
import { EmptyState } from "./components/UiPrimitives";
import { API_BASE_URL, getAuthHeaders } from "./auth";
import { prefetch } from "./apiClient";
import { SidebarResizeHandle, useResizableSidebar } from "./useResizableSidebar";

const tabs = {
  marketing: {
    label: "Marketing",
    icon: "campaign",
    title: "Marketing",
    description: "Dynamics marketing lists and campaign audiences.",
  },
  marketingConversion: {
    label: "Conversion Analysis",
    icon: "campaign",
    title: "Marketing-List Conversion",
    description:
      "Prospect conversion rates for account marketing lists, rolled up by lead-generation channel and client.",
    parent: "marketing",
  },
  prospects: {
    label: "Prospects",
    icon: "prospects",
    title: "Prospects",
    description: "Prospecting pipeline records staged for review.",
  },
  leadfeeder: {
    label: "Leadfeeder Visits",
    icon: "leadfeeder",
    title: "Leadfeeder Visits",
    description: "Website visitor intent records queued for qualification and review.",
  },
  peClients: {
    label: "PE Clients",
    icon: "clients",
    title: "PE Clients",
    description: "Private equity client locations, users, and contract expiration dates.",
    parent: "leadfeeder",
  },
};

const iconPaths = {
  campaign: "M4 10v4h3l5 4V6l-5 4H4Zm10.5 4.8 1.4 1.4A6 6 0 0 0 18 12a6 6 0 0 0-2.1-4.2l-1.4 1.4A4 4 0 0 1 16 12a4 4 0 0 1-1.5 2.8Z",
  clients: "M7 11a4 4 0 1 1 8 0 4 4 0 0 1-8 0Zm-4 9c.7-3.1 3.9-5 8-5s7.3 1.9 8 5H3Zm14.5-7a3 3 0 1 0 0-6 4.8 4.8 0 0 1 0 6Zm.6 2.1c1.7.6 2.9 1.8 3.4 3.9h-3.2a7 7 0 0 0-1.9-3.5c.6-.2 1.1-.3 1.7-.4Z",
  collapse: "M15.5 5 8.5 12l7 7-1.4 1.4L5.7 12l8.4-8.4L15.5 5Zm4 0-7 7 7 7-1.4 1.4L9.7 12l8.4-8.4L19.5 5Z",
  expand: "m8.5 5 7 7-7 7 1.4 1.4 8.4-8.4-8.4-8.4L8.5 5Zm-4 0 7 7-7 7 1.4 1.4 8.4-8.4-8.4-8.4L4.5 5Z",
  leadfeeder: "M4 5h16v3H4V5Zm2 5h12v3H6v-3Zm3 5h6v4H9v-4Z",
  prospects: "M8 11a4 4 0 1 1 8 0 4 4 0 0 1-8 0Zm-4 9c.7-3.1 3.9-5 8-5s7.3 1.9 8 5H4Z",
  signout: "M10 17v-2h4V9h-4V7h6v10h-6Zm-1-1-5-4 5-4v3h6v2H9v3Z",
};

const prefetchUrls = {
  marketing: `${API_BASE_URL}/marketing-lists`,
  marketingConversion: `${API_BASE_URL}/marketing-lists/conversion-analysis/summary`,
  leadfeeder: `${API_BASE_URL}/leadfeeder-visits`,
};

function NavIcon({ name }) {
  return (
    <SvgIcon fontSize="small" viewBox="0 0 24 24">
      <path d={iconPaths[name]} />
    </SvgIcon>
  );
}

function EmptyProspectingPanel({ title }) {
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
            {title}
          </Typography>
          <Typography color="text.secondary" variant="body2">
            No records are available yet.
          </Typography>
        </Box>
        <Chip label="0 total" sx={{ fontWeight: 800 }} />
      </Box>
      <EmptyState
        actionLabel="Refresh"
        description="Connect the prospecting source to begin reviewing and qualifying records here."
        icon="database"
        onAction={() => window.location.reload()}
        title="No prospect records yet"
      />
    </Paper>
  );
}

export default function ProspectingDashboard({ onLogout }) {
  const [activeTab, setActiveTab] = useState("marketing");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const sidebarResize = useResizableSidebar("prospecting");
  const theme = useTheme();
  const currentTab = tabs[activeTab];

  function prefetchTab(tabKey) {
    const url = prefetchUrls[tabKey];
    if (url) {
      prefetch(url, {
        headers: getAuthHeaders(),
        params: tabKey === "marketing" ? { limit: 500 } : undefined,
        ttl: 5 * 60 * 1000,
      });
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
          gridTemplateColumns: {
            xs: "1fr",
            md: sidebarCollapsed ? "88px minmax(0, 1fr)" : `${sidebarResize.width}px minmax(0, 1fr)`,
          },
          minHeight: "100vh",
          transition: sidebarResize.isResizing ? "none" : "grid-template-columns 180ms ease",
        }}
      >
        <Box
          component="aside"
          sx={{
            alignSelf: { md: "start" },
            backgroundColor: "primary.main",
            color: "common.white",
            height: { md: "100vh" },
            overflow: { md: "hidden" },
            p: { xs: 2, md: 3 },
            position: { xs: "relative", md: "sticky" },
            top: { md: 0 },
            transition: "padding 180ms ease",
          }}
        >
          {!sidebarCollapsed && (
            <SidebarResizeHandle
              isResizing={sidebarResize.isResizing}
              onReset={sidebarResize.resetWidth}
              onResizeStart={sidebarResize.startResize}
            />
          )}
          <Stack
            spacing={{ xs: 1.5, md: 3 }}
            sx={{
              height: { md: "100%" },
              minHeight: 0,
            }}
          >
            <Box
              sx={{
                alignItems: "flex-start",
                display: "flex",
                gap: 2,
                justifyContent: sidebarCollapsed ? "center" : "space-between",
              }}
            >
              {!sidebarCollapsed && (
                <Box>
                  <Typography
                    component="h1"
                    sx={{
                      fontSize: "1.55rem",
                      fontWeight: 800,
                      lineHeight: 1.1,
                    }}
                  >
                    Camoin 360
                  </Typography>
                  <Typography sx={{ color: "rgba(255,255,255,0.72)", mt: 0.75 }} variant="body2">
                    Prospecting
                  </Typography>
                </Box>
              )}

              <IconButton
                aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
                size="small"
                sx={{
                  borderColor: "rgba(255,255,255,0.32)",
                  borderStyle: "solid",
                  borderWidth: 1,
                  color: "common.white",
                  height: 36,
                  width: 36,
                  display: { xs: "none", md: "inline-flex" },
                  "&:hover": {
                    borderColor: "common.white",
                    backgroundColor: "rgba(255,255,255,0.10)",
                  },
                }}
                title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                <NavIcon name={sidebarCollapsed ? "expand" : "collapse"} />
              </IconButton>
            </Box>

            <Divider sx={{ borderColor: "rgba(255,255,255,0.18)" }} />

            <Stack
              component="nav"
              direction={{ xs: "row", md: "column" }}
              spacing={1}
              sx={{
                flex: { md: 1 },
                minHeight: 0,
                overflowX: { xs: "auto", md: "visible" },
                overflowY: { md: "auto" },
                pb: { xs: 0.5, md: 0 },
              }}
            >
              {Object.entries(tabs).map(([tabKey, tab]) => {
                const isActive = activeTab === tabKey;

                return (
                  <Tooltip arrow disableHoverListener={!sidebarCollapsed} key={tabKey} placement="right" title={tab.label}>
                    <Button
                      fullWidth
                      onFocus={() => prefetchTab(tabKey)}
                      onMouseEnter={() => prefetchTab(tabKey)}
                      onClick={() => setActiveTab(tabKey)}
                      startIcon={<NavIcon name={tab.icon} />}
                      sx={{
                        justifyContent: sidebarCollapsed ? "center" : "flex-start",
                        borderRadius: 1,
                        color: isActive ? "primary.main" : "common.white",
                        backgroundColor: isActive ? "common.white" : "transparent",
                        fontWeight: 800,
                        minWidth: 0,
                        ml: !sidebarCollapsed && tab.parent ? 2 : 0,
                        px: sidebarCollapsed ? 1 : 2,
                        py: 1.25,
                        width: {
                          xs: "auto",
                          md: !sidebarCollapsed && tab.parent ? "calc(100% - 16px)" : "100%",
                        },
                        minWidth: { xs: "max-content", md: 0 },
                        whiteSpace: sidebarCollapsed ? "nowrap" : "normal",
                        "& .MuiButton-startIcon": {
                          m: sidebarCollapsed ? 0 : undefined,
                        },
                        "&:hover": {
                          backgroundColor: isActive
                            ? "common.white"
                            : "rgba(255,255,255,0.12)",
                        },
                      }}
                      title={tab.label}
                    >
                      {!sidebarCollapsed && tab.label}
                    </Button>
                  </Tooltip>
                );
              })}
            </Stack>

            <Button
              fullWidth
              onClick={onLogout}
              startIcon={<NavIcon name="signout" />}
              sx={{
                borderColor: "rgba(255,255,255,0.42)",
                borderRadius: 1,
                color: "common.white",
                fontWeight: 800,
                justifyContent: sidebarCollapsed ? "center" : "flex-start",
                minWidth: 0,
                px: sidebarCollapsed ? 1 : 2,
                alignSelf: { xs: "flex-start", md: "stretch" },
                fontSize: { xs: 0, md: "0.875rem" },
                position: { xs: "absolute", md: "static" },
                right: { xs: 16, md: "auto" },
                top: { xs: 16, md: "auto" },
                width: { xs: 40, md: "100%" },
                "& .MuiButton-startIcon": {
                  m: { xs: 0, md: sidebarCollapsed ? 0 : undefined },
                },
                "&:hover": {
                  backgroundColor: "rgba(255,255,255,0.10)",
                  borderColor: "common.white",
                },
              }}
              title="Sign out"
              variant="outlined"
            >
              {!sidebarCollapsed && "Sign out"}
            </Button>
          </Stack>
        </Box>

        <Box component="main" sx={{ py: { xs: 3, md: 5 } }}>
          <Container
            maxWidth={["marketing", "marketingConversion", "leadfeeder", "peClients"].includes(activeTab) ? false : "lg"}
            sx={{ px: { xs: 2, md: ["marketing", "marketingConversion", "leadfeeder", "peClients"].includes(activeTab) ? 3 : 4 } }}
          >
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
                  {currentTab.title}
                </Typography>
                <Typography
                  sx={{
                    color: "text.secondary",
                    fontSize: { xs: "1rem", md: "1.08rem" },
                    maxWidth: 760,
                  }}
                >
                  {currentTab.description}
                </Typography>
              </Box>

              {activeTab === "marketing" && <MarketingLists />}
              {activeTab === "marketingConversion" && <MarketingListConversionAnalysis />}
              {activeTab === "prospects" && <EmptyProspectingPanel title="Prospects" />}
              {activeTab === "leadfeeder" && <LeadfeederVisits />}
              {activeTab === "peClients" && <PEClients />}
            </Stack>
          </Container>
        </Box>
      </Box>
    </Box>
  );
}
