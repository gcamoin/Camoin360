import { useState } from "react";
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
import EconomicIndicators from "./components/EconomicIndicators";
import EmployeeProductivity from "./components/EmployeeProductivity";
import MarketingMetrics from "./components/MarketingMetrics";
import ProductivityProjects from "./components/ProductivityProjects";

const views = {
  overview: {
    label: "Overview",
    icon: "overview",
    title: "Overview",
    description:
      "High-level summary of enrichment operations and team activity.",
  },
  economicIndicators: {
    label: "Economic Indicators",
    icon: "trending",
    title: "Economic Indicators",
    description: "Key economic metrics and indicators across tracked accounts.",
  },
  companyFinancials: {
    label: "Company Financials",
    icon: "finance",
    title: "Company Financials",
    description:
      "Financial performance data and trends across portfolio companies.",
  },
  marketingMetrics: {
    label: "Marketing Metrics",
    icon: "campaign",
    title: "Marketing Metrics",
    description: "Marketing performance and campaign metrics across accounts.",
  },
  productivityProjects: {
    label: "Service Lines & Projects",
    icon: "projects",
    title: "Productivity & Projects",
    description:
      "Project status, team productivity, and operational throughput.",
  },
  employeeProductivity: {
    label: "Employee Productivity",
    icon: "projects",
    title: "Employee Productivity",
    description: "Employee-level productivity metrics and workload trends.",
    parent: "productivityProjects",
  },
};

const iconPaths = {
  campaign:
    "M4 10v4h3l5 4V6l-5 4H4Zm10.5 4.8 1.4 1.4A6 6 0 0 0 18 12a6 6 0 0 0-2.1-4.2l-1.4 1.4A4 4 0 0 1 16 12a4 4 0 0 1-1.5 2.8Z",
  collapse:
    "M15.5 5 8.5 12l7 7-1.4 1.4L5.7 12l8.4-8.4L15.5 5Zm4 0-7 7 7 7-1.4 1.4L9.7 12l8.4-8.4L19.5 5Z",
  expand:
    "m8.5 5 7 7-7 7 1.4 1.4 8.4-8.4-8.4-8.4L8.5 5Zm-4 0 7 7-7 7 1.4 1.4 8.4-8.4-8.4-8.4L4.5 5Z",
  finance: "M5 19V9h3v10H5Zm5 0V5h3v14h-3Zm5 0v-7h3v7h-3Z",
  overview: "M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z",
  projects: "M5 5h14v4H5V5Zm0 6h9v4H5v-4Zm0 6h14v2H5v-2Zm11-6h3v4h-3v-4Z",
  signout: "M10 17v-2h4V9h-4V7h6v10h-6Zm-1-1-5-4 5-4v3h6v2H9v3Z",
  trending:
    "M4 17h16v2H4v-2Zm1-3 5-5 4 4 5-7 1.6 1.2-6.4 8.9-4.1-4.1-3.7 3.7L5 14Z",
};

function NavIcon({ name }) {
  return (
    <SvgIcon fontSize="small" viewBox="0 0 24 24">
      <path d={iconPaths[name]} />
    </SvgIcon>
  );
}

export default function ManagementDashboard({ onLogout }) {
  const [activeView, setActiveView] = useState("overview");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const theme = useTheme();
  const currentView = views[activeView];

  return (
    <Box
      sx={{
        minHeight: "100vh",
        background: `radial-gradient(circle at top left, ${theme.palette.secondary.main}22, transparent 32%), linear-gradient(180deg, #f8fbf5 0%, #edf3e3 100%)`,
      }}
    >
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr",
            md: sidebarCollapsed
              ? "88px minmax(0, 1fr)"
              : "260px minmax(0, 1fr)",
          },
          minHeight: "100vh",
          transition: "grid-template-columns 180ms ease",
        }}
      >
        <Box
          component="aside"
          sx={{
            backgroundColor: "primary.main",
            color: "common.white",
            p: { xs: 2, md: 3 },
            transition: "padding 180ms ease",
          }}
        >
          <Stack
            spacing={3}
            sx={{
              height: "100%",
              minHeight: { md: "calc(100vh - 48px)" },
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
                  <Typography
                    sx={{ color: "rgba(255,255,255,0.72)", mt: 0.75 }}
                    variant="body2"
                  >
                    Management
                  </Typography>
                </Box>
              )}

              <IconButton
                aria-label={
                  sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
                }
                onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
                size="small"
                sx={{
                  borderColor: "rgba(255,255,255,0.32)",
                  borderStyle: "solid",
                  borderWidth: 1,
                  color: "common.white",
                  height: 36,
                  width: 36,
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

            <Stack component="nav" spacing={1}>
              {Object.entries(views).map(([viewKey, view]) => {
                const isActive = activeView === viewKey;
                const isChild = Boolean(view.parent);

                return (
                  <Tooltip
                    arrow
                    disableHoverListener={!sidebarCollapsed}
                    key={viewKey}
                    placement="right"
                    title={view.label}
                  >
                    <Button
                      fullWidth
                      onClick={() => setActiveView(viewKey)}
                      startIcon={<NavIcon name={view.icon} />}
                      sx={{
                        justifyContent: sidebarCollapsed
                          ? "center"
                          : "flex-start",
                        borderRadius: 1,
                        color: isActive ? "primary.main" : "common.white",
                        backgroundColor: isActive
                          ? "common.white"
                          : "transparent",
                        fontWeight: 800,
                        minWidth: 0,
                        px: sidebarCollapsed ? 1 : isChild ? 3.5 : 2,
                        py: 1.25,
                        ml: !sidebarCollapsed && isChild ? 2 : 0,
                        width:
                          !sidebarCollapsed && isChild
                            ? "calc(100% - 16px)"
                            : "100%",
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

            <Box sx={{ flex: 1 }} />

            <Button
              fullWidth
              onClick={onLogout}
              startIcon={<NavIcon name="signout" />}
              sx={{
                borderColor: "rgba(255,255,255,0.42)",
                color: "common.white",
                borderRadius: 1,
                fontWeight: 800,
                justifyContent: sidebarCollapsed ? "center" : "flex-start",
                minWidth: 0,
                px: sidebarCollapsed ? 1 : 2,
                "& .MuiButton-startIcon": {
                  m: sidebarCollapsed ? 0 : undefined,
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

        <Box component="main" sx={{ py: { xs: 3, md: 6 } }}>
          <Container maxWidth="xl">
            <Stack spacing={3}>
              <Box>
                <Typography
                  component="h2"
                  sx={{
                    color: "primary.main",
                    fontSize: { xs: "2rem", md: "2.65rem" },
                    fontWeight: 800,
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

              {activeView === "economicIndicators" && <EconomicIndicators />}
              {activeView === "marketingMetrics" && <MarketingMetrics />}
              {activeView === "productivityProjects" && (
                <ProductivityProjects />
              )}
              {activeView === "employeeProductivity" && (
                <EmployeeProductivity />
              )}
            </Stack>
          </Container>
        </Box>
      </Box>
    </Box>
  );
}
