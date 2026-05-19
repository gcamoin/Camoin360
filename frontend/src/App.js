import { useState } from "react";
import { Box, Button, Container, Paper, Typography, useTheme, Stack } from "@mui/material";
import MetricsDashboard from "./components/MetricsDashboard";

function UseStateExample() {
  const [count, setCount] = useState(0);
 
  return (
    <Paper
      elevation={3} sx={{maxWidth: 400, mx: "auto", mt: 4, p: 3, borderRadius: 3, }}>
        
      <Stack spacing={2} alignItems="center">
        <Typography variant="h5" component="h2" fontWeight="bold">
          React useState Example
        </Typography>

        <Typography color="text.secondary">
          Current count
        </Typography>

        <Typography variant="h3" fontWeight="bold">
          {count}
        </Typography>

        <Stack direction="row" spacing={1} flexWrap="wrap" justifyContent="center">
          <Button variant="contained" onClick={() => setCount(prev => prev + 1)}>
            +1
          </Button>

          <Button variant="contained" onClick={() => setCount(prev => prev + 5)}>
            +5
          </Button>

          <Button variant="outlined" color="error" onClick={() => setCount(0)}>
            Reset
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}


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
        <Box>
          <UseStateExample />
        </Box>
      </Container>
    </Box>
  );
}
