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
import EconomicIndicators from "./components/EconomicIndicators";

const views = {
  overview: {
    label: "Overview",
    title: "Overview",
    description: "High-level summary of enrichment operations and team activity.",
  },
  economicIndicators: {
    label: "Economic Indicators",
    title: "Economic Indicators",
    description: "Key economic metrics and indicators across tracked accounts.",
  },
  companyFinancials: {
    label: "Company Financials",
    title: "Company Financials",
    description: "Financial performance data and trends across portfolio companies.",
  },
  marketingMetrics: {
    label: "Marketing Metrics",
    title: "Marketing Metrics",
    description: "Marketing performance and campaign metrics across accounts.",
  },
  productivityProjects: {
    label: "Productivity & Projects",
    title: "Productivity & Projects",
    description: "Project status, team productivity, and operational throughput.",
  },
};

export default function ManagementDashboard({ onLogout }) {
  const [activeView, setActiveView] = useState("overview");
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
          gridTemplateColumns: { xs: "1fr", md: "260px minmax(0, 1fr)" },
          minHeight: "100vh",
        }}
      >
        <Box
          component="aside"
          sx={{
            backgroundColor: "primary.main",
            color: "common.white",
            p: { xs: 2, md: 3 },
          }}
        >
          <Stack
            spacing={3}
            sx={{
              height: "100%",
              minHeight: { md: "calc(100vh - 48px)" },
            }}
          >
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
                      justifyContent: "flex-start",
                      borderRadius: 1,
                      color: isActive ? "primary.main" : "common.white",
                      backgroundColor: isActive ? "common.white" : "transparent",
                      fontWeight: 800,
                      px: 2,
                      py: 1.25,
                      "&:hover": {
                        backgroundColor: isActive
                          ? "common.white"
                          : "rgba(255,255,255,0.12)",
                      },
                    }}
                  >
                    {view.label}
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
                "&:hover": {
                  borderColor: "common.white",
                  backgroundColor: "rgba(255,255,255,0.10)",
                },
              }}
              variant="outlined"
            >
              Sign out
            </Button>
          </Stack>
        </Box>

        <Box component="main" sx={{ py: { xs: 3, md: 6 } }}>
          <Container maxWidth="lg">
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
            </Stack>
          </Container>
        </Box>
      </Box>
    </Box>
  );
}
