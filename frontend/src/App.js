import { useState } from "react";
import { Box, Button, Container, Stack, Typography, useTheme } from "@mui/material";

import { clearAuthToken, getAuthToken, loginUser, signupUser } from "./auth";
import MetricsDashboard from "./components/MetricsDashboard";
import Login from "./login";
import SignUp from "./signup";

function Dashboard({ onLogout }) {
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
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          sx={{ alignItems: { xs: "flex-start", sm: "center" }, mb: 4 }}
        >
          <Box sx={{ flex: 1 }}>
            <Typography
              component="h1"
              sx={{
                color: "primary.main",
                fontSize: { xs: "2rem", md: "3rem" },
                fontWeight: 800,
                mb: 1,
              }}
            >
              Sophie - Seamless AI Updates Dashboard
            </Typography>
            <Typography
              sx={{
                color: "text.secondary",
                fontSize: { xs: "1rem", md: "1.1rem" },
                maxWidth: 720,
              }}
            >
              Live view of weekly Seamless credit consumption and enrichment
              throughput across the Dynamics pipeline.
            </Typography>
          </Box>
          <Button onClick={onLogout} variant="outlined">
            Sign out
          </Button>
        </Stack>
        <MetricsDashboard />
      </Container>
    </Box>
  );
}

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(() => Boolean(getAuthToken()));
  const [authView, setAuthView] = useState("login");

  async function handleLogin(credentials) {
    await loginUser(credentials);
    setIsLoggedIn(true);
  }

  async function handleSignup(credentials) {
    await signupUser(credentials);
    setIsLoggedIn(true);
  }

  function handleLogout() {
    clearAuthToken();
    setIsLoggedIn(false);
    setAuthView("login");
  }

  if (isLoggedIn) {
    return <Dashboard onLogout={handleLogout} />;
  }

  if (authView === "signup") {
    return (
      <SignUp
        onShowLogin={() => setAuthView("login")}
        onSignup={handleSignup}
      />
    );
  }

  return (
    <Login
      onLogin={handleLogin}
      onShowSignup={() => setAuthView("signup")}
    />
  );
}
