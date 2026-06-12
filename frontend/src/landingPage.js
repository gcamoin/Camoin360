import { useState } from "react";
import {
  Box,
  Button,
  Container,
  Divider,
  Stack,
  Typography,
  useTheme,
} from "@mui/material";

import DataQualityTable from "./components/DataQualityTable";
import MetricsDashboard from "./components/MetricsDashboard";
import SummaryAnalytics from "./components/SummaryAnalytics";

const views = {
  seamless: {
    label: "Seamless",
    title: "Sophie - Seamless AI Updates Dashboard",
    description:
      "Live view of weekly Seamless credit consumption and enrichment throughput across the Dynamics pipeline.",
  },
  dataQuality: {
    label: "Data Quality",
    title: "Data Quality",
    description:
      "Review Dynamics account fields used for enrichment quality: name, state or province, sector, description, and website.",
  },
  summaryAnalytics: {
    label: "Summary Analytics",
    title: "Summary Analytics",
    description: "See how many Dynamics accounts belong to each sector with cards, a bar chart, and a count table.",
  }
};

export default function LandingPage({ onLogout }) {
  const [activeView, setActiveView] = useState("seamless");
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
            md: sidebarCollapsed ? "88px minmax(0, 1fr)" : "260px minmax(0, 1fr)",
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

                <Button
                  aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                  onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
                  sx={{
                    borderColor: "rgba(255,255,255,0.32)",
                    color: "common.white",
                    minWidth: 0,
                    px: sidebarCollapsed ? 1 : 1.25,
                    py: 0.75,
                    "&:hover": {
                      borderColor: "common.white",
                      backgroundColor: "rgba(255,255,255,0.10)",
                    },
                  }}
                  title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                  variant="outlined"
                >
                  {sidebarCollapsed ? ">" : "<"}
                </Button>
              </Box>
            </Box>

            <Divider sx={{ borderColor: "rgba(255,255,255,0.18)" }} />

            <Stack component="nav" spacing={1}>
              {Object.entries(views).map(([viewKey, view]) => {
                const isActive = activeView === viewKey;

                return (
                  <Button
                    key={viewKey}
                    fullWidth
                    onClick={() => setActiveView(viewKey)}
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
                      "&:hover": {
                        backgroundColor: isActive
                          ? "common.white"
                          : "rgba(255,255,255,0.12)",
                      },
                    }}
                    title={view.label}
                  >
                    {sidebarCollapsed ? view.label.charAt(0) : view.label}
                  </Button>
                );
              })}
            </Stack>

            <Box sx={{ flex: 1 }} />

            <Button
              fullWidth
              onClick={onLogout}
              sx={{
                borderColor: "rgba(255,255,255,0.42)",
                color: "common.white",
                borderRadius: 1,
                fontWeight: 800,
                minWidth: 0,
                px: sidebarCollapsed ? 1 : 2,
                "&:hover": {
                  borderColor: "common.white",
                  backgroundColor: "rgba(255,255,255,0.10)",
                },
              }}
              title="Sign out"
              variant="outlined"
            >
              {sidebarCollapsed ? "Out" : "Sign out"}
            </Button>
          </Stack>
        </Box>

        <Box component="main" sx={{ py: { xs: 3, md: 6 } }}>
          <Container
            maxWidth={activeView === "dataQuality" ? false : "lg"}
            sx={{ px: { xs: 2, md: activeView === "dataQuality" ? 3 : 4 } }}
          >
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

              {activeView === "seamless" && <MetricsDashboard />}
              {activeView === "dataQuality" && <DataQualityTable />}
              {activeView === "summaryAnalytics" && <SummaryAnalytics />}
            </Stack>
          </Container>
        </Box>
      </Box>
    </Box>
  );
}
