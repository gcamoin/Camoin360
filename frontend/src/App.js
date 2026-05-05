import { Box, Container, Typography, useTheme } from "@mui/material";

import MetricsDashboard from "./components/MetricsDashboard";

export default function App() {
  const theme = useTheme();

  return (
    <Box
      sx={{
        minHeight: "100vh",
        background:
          `radial-gradient(circle at top left, ${theme.palette.secondary.main}22, transparent 32%), linear-gradient(180deg, #f8fbf5 0%, #edf3e3 100%)`,
        py: { xs: 4, md: 8 },
      }}
    >
      <Container maxWidth="lg">
        <Typography
          component="h1"
          sx={{
            color: "primary.main",
            fontSize: { xs: "2rem", md: "3rem" },
            fontWeight: 800,
            letterSpacing: "-0.04em",
            mb: 1,
          }}
        >
          Sophie - Seamless AI Updates Dashboard
        </Typography>
        <Typography
          sx={{
            color: "text.secondary",
            fontSize: { xs: "1rem", md: "1.1rem" },
            mb: 4,
            maxWidth: 720,
          }}
        >
          Live view of weekly Seamless credit consumption and enrichment
          throughput across the Dynamics pipeline.
        </Typography>
        <MetricsDashboard />
      </Container>
    </Box>
  );
}
