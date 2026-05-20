import { useState } from "react";
import {
  Box,
  Button,
  Container,
  Link,
  Paper,
  Stack,
  TextField,
  Typography,
  useTheme,
} from "@mui/material";

export default function SignUp({ onSignup, onShowLogin }) {
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const theme = useTheme();
    const passwordMismatch = confirmPassword.length > 0 && password !== confirmPassword;

    function handleSubmit(event) {
        event.preventDefault();
        if (passwordMismatch) {
            return;
        }
        onSignup();
    }

    return (
        <Box
            component="main"
            sx={{
                minHeight: "100vh",
                display: "flex",
                alignItems: "center",
                background:
                    `radial-gradient(circle at 15% 20%, ${theme.palette.secondary.main}22, transparent 28%), linear-gradient(135deg, #f8fbf5 0%, #edf3e3 45%, #ffffff 100%)`,
                py: { xs: 4, md: 8 },
            }}
        >
            <Container maxWidth="lg">
                <Box
                    sx={{
                        display: "grid",
                        gridTemplateColumns: { xs: "1fr", md: "1.05fr 0.95fr" },
                        gap: { xs: 4, md: 8 },
                        alignItems: "center",
                    }}
                >
                    <Stack spacing={3} sx={{ maxWidth: 560 }}>
                        <Box>
                            <Typography
                                component="p"
                                variant="overline"
                                sx={{
                                    color: "secondary.main",
                                    fontWeight: 800,
                                    letterSpacing: "0.12em",
                                }}
                            >
                                Enrichment Dashboard
                            </Typography>
                            <Typography
                                component="h1"
                                sx={{
                                    color: "primary.main",
                                    fontSize: { xs: "2.4rem", md: "3.8rem" },
                                    fontWeight: 800,
                                    lineHeight: 1,
                                    mt: 1,
                                }}
                            >
                                Sophie
                            </Typography>
                        </Box>
                        <Typography
                            sx={{
                                color: "text.secondary",
                                fontSize: { xs: "1rem", md: "1.15rem" },
                                lineHeight: 1.7,
                            }}
                        >
                            Request access to Seamless credit usage, Dynamics update
                            activity, and enrichment throughput in one operational view.
                        </Typography>
                        <Box
                            sx={{
                                display: "grid",
                                gridTemplateColumns: { xs: "1fr", sm: "repeat(3, 1fr)" },
                                gap: 2,
                                maxWidth: 520,
                            }}
                        >
                            {["Live metrics", "Credit tracking", "Dynamics sync"].map((item) => (
                                <Box
                                    key={item}
                                    sx={{
                                        borderLeft: `3px solid ${theme.palette.secondary.main}`,
                                        color: "primary.main",
                                        fontWeight: 700,
                                        pl: 1.5,
                                    }}
                                >
                                    {item}
                                </Box>
                            ))}
                        </Box>
                    </Stack>

                    <Paper
                        elevation={0}
                        sx={{
                            width: "100%",
                            maxWidth: 440,
                            justifySelf: { xs: "stretch", md: "end" },
                            p: { xs: 3, sm: 4 },
                            border: "1px solid rgba(0, 51, 108, 0.10)",
                            borderRadius: 3,
                            boxShadow: "0 24px 70px rgba(0, 51, 108, 0.14)",
                        }}
                    >
                        <Stack component="form" spacing={2.5} onSubmit={handleSubmit}>
                            <Box>
                                <Typography
                                    component="h2"
                                    sx={{
                                        color: "primary.main",
                                        fontSize: "1.75rem",
                                        fontWeight: 800,
                                        mb: 0.75,
                                    }}
                                >
                                    Create account
                                </Typography>
                                <Typography color="text.secondary">
                                    Set up access for a new operations user.
                                </Typography>
                            </Box>

                            <TextField
                                autoComplete="name"
                                fullWidth
                                label="Full name"
                                onChange={(event) => setName(event.target.value)}
                                required
                                value={name}
                            />
                            <TextField
                                autoComplete="email"
                                fullWidth
                                label="Email"
                                onChange={(event) => setEmail(event.target.value)}
                                required
                                type="email"
                                value={email}
                            />
                            <TextField
                                autoComplete="new-password"
                                fullWidth
                                label="Password"
                                onChange={(event) => setPassword(event.target.value)}
                                required
                                type="password"
                                value={password}
                            />
                            <TextField
                                autoComplete="new-password"
                                error={passwordMismatch}
                                fullWidth
                                helperText={passwordMismatch ? "Passwords do not match." : " "}
                                label="Confirm password"
                                onChange={(event) => setConfirmPassword(event.target.value)}
                                required
                                type="password"
                                value={confirmPassword}
                            />
                            <Button
                                fullWidth
                                disabled={passwordMismatch}
                                size="large"
                                type="submit"
                                variant="contained"
                                sx={{
                                    py: 1.4,
                                    fontWeight: 800,
                                    boxShadow: "0 12px 24px rgba(0, 51, 108, 0.20)",
                                }}
                            >
                                Create account
                            </Button>
                            <Typography
                                color="text.secondary"
                                sx={{ textAlign: "center" }}
                                variant="body2"
                            >
                                Already have access?{" "}
                                <Link
                                    component="button"
                                    onClick={onShowLogin}
                                    sx={{ fontWeight: 800 }}
                                    type="button"
                                    underline="hover"
                                >
                                    Sign in
                                </Link>
                            </Typography>
                        </Stack>
                    </Paper>
                </Box>
            </Container>
        </Box>
    );
}
