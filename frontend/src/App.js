import { useState } from "react";
import {
  Box,
  Button,
  Container,
  Paper,
  Typography,
  useTheme,
} from "@mui/material";

import MetricsDashboard from "./components/MetricsDashboard";

function UseStateExample() {
  // useState lets this component remember a value between renders.
  // It returns the current state value and a function used to update that value.
  const [count, setCount] = useState(0);

  return (
    <Paper
      elevation={4}
      sx={{
        width: "100%",
        maxWidth: 420,
        p: 4,
        borderRadius: 4,
        boxShadow: "0 12px 30px rgba(0, 51, 108, 0.12)",
        textAlign: "center",
      }}
    >
      <Typography
        variant="h5"
        sx={{ fontWeight: 700, color: "primary.main", mb: 2 }}
      >
        React useState Example
      </Typography>

      <Typography sx={{ color: "text.secondary", mb: 1 }}>
        Current Count
      </Typography>

      {/* count is the current piece of state.
          It starts at 0 and React shows the latest value here in the UI. */}
      <Typography
        variant="h3"
        sx={{ fontWeight: 800, color: "primary.main", mb: 3 }}
      >
        {count}
      </Typography>

      <Button
        variant="contained"
        size="large"
        onClick={() => {
          // setCount updates the count state value.
          // When this button is clicked, we add 1 to the previous count.
          // React then rerenders the component so the updated number appears on screen.
          setCount((previousCount) => previousCount + 1);
        }}
      >
        Increase Count
      </Button>
    </Paper>
  );
}

export default function App() {
  const theme = useTheme();

  return (
    <Box
      sx={{
        minHeight: "100vh",
        background: `radial-gradient(circle at top left, ${theme.palette.secondary.main}22, transparent 32%), linear-gradient(180deg, #f8fbf5 0%, #edf3e3 100%)`,
        py: { xs: 4, md: 8 },
        pb: { xs: 36, md: 42 },
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

        <Box sx={{ height: { xs: 320, md: 420 } }} />
      </Container>

      <Box
        component="section"
        sx={{
          position: "fixed",
          left: "50%",
          bottom: { xs: 20, md: 28 },
          transform: "translateX(-50%)",
          width: "100%",
          px: 2,
          display: "flex",
          justifyContent: "center",
          pointerEvents: "none",
        }}
      >
        <Box sx={{ width: "100%", display: "flex", justifyContent: "center" }}>
          <Box sx={{ pointerEvents: "auto", width: "100%", maxWidth: 420 }}>
            <UseStateExample />
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
