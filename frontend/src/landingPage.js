import { useEffect, useState } from "react";
import {
  Box,
  Button,
  Container,
  Divider,
  IconButton,
  SvgIcon,
  Stack,
  Tooltip,
  Typography,
  useTheme,
} from "@mui/material";

import DataQualityTable from "./components/DataQualityTable";
import DuplicateAccounts from "./components/DuplicateAccounts";
import MetricsDashboard from "./components/MetricsDashboard";
import SummaryAnalytics from "./components/SummaryAnalytics";
import { API_BASE_URL, getAuthHeaders } from "./auth";
import { prefetch } from "./apiClient";

const views = {
  seamless: {
    label: "Seamless",
    icon: "sync",
    route: "/dashboard",
    title: "Enrichment Operations",
    description:
      "Live view of weekly Seamless credit consumption and enrichment throughput across the Dynamics pipeline.",
  },
  dataQuality: {
    label: "Data Quality",
    icon: "checklist",
    route: "/dashboard/data-quality",
    title: "Data Quality",
    description:
      "Review Dynamics account fields used for enrichment quality: name, state or province, sector, description, and website.",
  },
  duplicateAccounts: {
    label: "Duplicate Accounts",
    icon: "duplicate",
    route: "/dashboard/duplicate-accounts",
    title: "Duplicate Accounts",
    description: "Find and review possible duplicate Dynamics account records before enrichment updates.",
  },
  summaryAnalytics: {
    label: "Summary Analytics",
    icon: "chart",
    route: "/dashboard/summary-analytics",
    title: "Summary Analytics",
    description: "See how many Dynamics accounts belong to each sector with cards, a bar chart, and a count table.",
  }
};

const iconPaths = {
  chart: "M5 19V9h3v10H5Zm5 0V5h3v14h-3Zm5 0v-7h3v7h-3Z",
  checklist: "M5.5 7.5 7 9l3-3 .9.9L7 10.8 4.6 8.4l.9-.9ZM13 8h7v2h-7V8ZM5.5 14.5 7 16l3-3 .9.9L7 17.8l-2.4-2.4.9-.9ZM13 15h7v2h-7v-2Z",
  collapse: "M15.5 5 8.5 12l7 7-1.4 1.4L5.7 12l8.4-8.4L15.5 5Zm4 0-7 7 7 7-1.4 1.4L9.7 12l8.4-8.4L19.5 5Z",
  duplicate: "M7 7V5c0-1.1.9-2 2-2h8c1.1 0 2 .9 2 2v10c0 1.1-.9 2-2 2h-2v2c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2V9c0-1.1.9-2 2-2h2Zm2 0h4c1.1 0 2 .9 2 2v6h2V5H9v2Zm-4 2v10h8V9H5Z",
  expand: "m8.5 5 7 7-7 7 1.4 1.4 8.4-8.4-8.4-8.4L8.5 5Zm-4 0 7 7-7 7 1.4 1.4 8.4-8.4-8.4-8.4L4.5 5Z",
  signout: "M10 17v-2h4V9h-4V7h6v10h-6Zm-1-1-5-4 5-4v3h6v2H9v3Z",
  sync: "M7 7h9.2l-2.6-2.6L15 3l5 5-5 5-1.4-1.4L16.2 9H7V7Zm10 10H7.8l2.6 2.6L9 21l-5-5 5-5 1.4 1.4L7.8 15H17v2Z",
};

const prefetchUrls = {
  seamless: `${API_BASE_URL}/metrics`,
  dataQuality: `${API_BASE_URL}/accounts/data-quality`,
  duplicateAccounts: `${API_BASE_URL}/accounts/duplicates`,
  summaryAnalytics: `${API_BASE_URL}/accounts/summary-analytics`,
};

function NavIcon({ name }) {
  return (
    <SvgIcon fontSize="small" viewBox="0 0 24 24">
      <path d={iconPaths[name]} />
    </SvgIcon>
  );
}

function getViewForPath(pathname) {
  const matchingView = Object.entries(views).find(([_viewKey, view]) => view.route === pathname);

  return matchingView?.[0] || "seamless";
}

export default function LandingPage({ onLogout }) {
  const [activeView, setActiveView] = useState(() => getViewForPath(window.location.pathname));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const theme = useTheme();
  const currentView = views[activeView];

  function navigateToView(viewKey) {
    setActiveView(viewKey);

    const nextRoute = views[viewKey].route;
    if (window.location.pathname !== nextRoute) {
      window.history.pushState({}, "", nextRoute);
    }
  }

  function prefetchView(viewKey) {
    prefetch(prefetchUrls[viewKey], {
      headers: getAuthHeaders(),
      params: viewKey === "dataQuality" ? { limit: 100000 } : undefined,
      timeout: viewKey === "dataQuality" ? 5 * 60 * 1000 : undefined,
      ttl: viewKey === "summaryAnalytics" ? 10 * 60 * 1000 : 5 * 60 * 1000,
    });
  }

  useEffect(() => {
    function handlePopState() {
      setActiveView(getViewForPath(window.location.pathname));
    }

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

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
            md: sidebarCollapsed ? "88px minmax(0, 1fr)" : "272px minmax(0, 1fr)",
          },
          minHeight: "100vh",
          transition: "grid-template-columns 180ms ease",
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
          <Stack
            spacing={{ xs: 1.5, md: 3 }}
            sx={{
              height: { md: "100%" },
              minHeight: 0,
            }}
          >
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
            >
              <Box
                sx={{
                  display: "flex",
                  justifyContent: sidebarCollapsed ? "center" : "space-between",
                  alignItems: "flex-start",
                  gap: 2,
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
                      Enrichment operations
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
              {Object.entries(views).map(([viewKey, view]) => {
                const isActive = activeView === viewKey;

                return (
                  <Tooltip arrow disableHoverListener={!sidebarCollapsed} key={viewKey} placement="right" title={view.label}>
                    <Button
                      fullWidth
                      onFocus={() => prefetchView(viewKey)}
                      onMouseEnter={() => prefetchView(viewKey)}
                      onClick={() => navigateToView(viewKey)}
                      startIcon={<NavIcon name={view.icon} />}
                      sx={{
                        justifyContent: sidebarCollapsed ? "center" : "flex-start",
                        borderRadius: 1,
                        color: isActive ? "primary.main" : "common.white",
                        backgroundColor: isActive
                          ? "common.white"
                          : "transparent",
                        fontWeight: 800,
                        minWidth: 0,
                        px: sidebarCollapsed ? 1 : 2,
                        py: 1.25,
                        whiteSpace: "nowrap",
                        width: { xs: "auto", md: "100%" },
                        "& .MuiButton-startIcon": {
                          m: sidebarCollapsed ? 0 : undefined,
                        },
                        "&:hover": {
                          backgroundColor: isActive
                            ? "common.white"
                            : "rgba(255,255,255,0.12)",
                        },
                      }}
                      title={view.label}
                    >
                      {!sidebarCollapsed && view.label}
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
                color: "common.white",
                borderRadius: 1,
                fontWeight: 800,
                minWidth: 0,
                justifyContent: sidebarCollapsed ? "center" : "flex-start",
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
                  borderColor: "common.white",
                  backgroundColor: "rgba(255,255,255,0.10)",
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
            maxWidth={["dataQuality", "duplicateAccounts"].includes(activeView) ? false : "lg"}
            sx={{
              px: {
                xs: 2,
                md: ["dataQuality", "duplicateAccounts"].includes(activeView) ? 3 : 4,
              },
            }}
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
                  {currentView.title}
                </Typography>
                <Typography
                  sx={{
                    color: "text.secondary",
                    fontSize: { xs: "1rem", md: "1.08rem" },
                    maxWidth: 760,
                  }}
                >
                  {currentView.description}
                </Typography>
              </Box>

              {activeView === "seamless" && <MetricsDashboard />}
              {activeView === "dataQuality" && <DataQualityTable />}
              {activeView === "duplicateAccounts" && <DuplicateAccounts />}
              {activeView === "summaryAnalytics" && <SummaryAnalytics />}
            </Stack>
          </Container>
        </Box>
      </Box>
    </Box>
  );
}
