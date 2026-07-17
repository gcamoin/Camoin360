import { useState } from "react";
import {
  Box,
  Button,
  Container,
  Divider,
  IconButton,
  SvgIcon,
  Stack,
  Typography,
  useTheme,
} from "@mui/material";

const iconPaths = {
  collapse:
    "M15.5 5 8.5 12l7 7-1.4 1.4L5.7 12l8.4-8.4L15.5 5Zm4 0-7 7 7 7-1.4 1.4L9.7 12l8.4-8.4L19.5 5Z",
  expand:
    "m8.5 5 7 7-7 7 1.4 1.4 8.4-8.4-8.4-8.4L8.5 5Zm-4 0 7 7-7 7 1.4 1.4 8.4-8.4-8.4-8.4L4.5 5Z",
  signout: "M10 17v-2h4V9h-4V7h6v10h-6Zm-1-1-5-4 5-4v3h6v2H9v3Z",
};

function NavIcon({ name }) {
  return (
    <SvgIcon fontSize="small" viewBox="0 0 24 24">
      <path d={iconPaths[name]} />
    </SvgIcon>
  );
}

export default function ConsultingDashboard({ onLogout }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const theme = useTheme();

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
                    Consulting
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

            <Box sx={{ flex: { md: 1 } }} />

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
          <Container maxWidth="lg" sx={{ px: { xs: 2, md: 4 } }}>
            <Typography
              component="h2"
              sx={{
                color: "primary.main",
                fontSize: { xs: "2rem", md: "2.35rem" },
                fontWeight: 750,
                lineHeight: 1.1,
              }}
            >
              Consulting
            </Typography>
          </Container>
        </Box>
      </Box>
    </Box>
  );
}
