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

import { getApiErrorMessage } from "./auth";

export default function SignUp({ onSignup, onShowLogin }) {
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [error, setError] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const theme = useTheme();
    const passwordMismatch = confirmPassword.length > 0 && password !== confirmPassword;

    async function handleSubmit(event) {
        event.preventDefault();
        if (passwordMismatch) {
            return;
        }

        const formData = new FormData(event.currentTarget);
        const signupCredentials = {
            name: String(formData.get("name") || "").trim(),
            email: String(formData.get("email") || "").trim(),
            password: String(formData.get("password") || ""),
        };

        setError("");
        setIsSubmitting(true);

        try {
            await onSignup(signupCredentials);
        } catch (signupError) {
            setError(getApiErrorMessage(signupError, "Unable to create account."));
        } finally {
            setIsSubmitting(false);
        }
    }

    return (
        <Box
            component="main"
            sx={{
                minHeight: "100vh",
                display: "flex",
                alignItems: "center",
                background:
                    `radial-gradient(circle at 15% 20%, ${theme.palette.secondary.main}14, transparent 28%), linear-gradient(135deg, #F5F7F8 0%, #F0F4F1 48%, #FFFFFF 100%)`,
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
                                    fontSize: { xs: "2.4rem", md: "3.5rem" },
                                    fontWeight: 750,
                                    lineHeight: 1,
                                    mt: 1,
                                }}
                            >
                                Camoin 360
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
                                        fontWeight: 650,
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
                            borderRadius: 2,
                            boxShadow: "0 24px 64px rgba(24, 50, 74, 0.12)",
                        }}
                    >
                        <Stack component="form" spacing={2.5} onSubmit={handleSubmit}>
                            <Box>
                                <Typography
                                    component="h2"
                                    sx={{
                                        color: "primary.main",
                                        fontSize: "1.75rem",
                                        fontWeight: 750,
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
                                id="signup-name"
                                label="Full name"
                                name="name"
                                onChange={(event) => setName(event.target.value)}
                                required
                                value={name}
                            />
                            <TextField
                                autoComplete="email"
                                fullWidth
                                id="signup-email"
                                label="Email"
                                name="email"
                                onChange={(event) => setEmail(event.target.value)}
                                required
                                type="email"
                                value={email}
                            />
                            <TextField
                                autoComplete="new-password"
                                fullWidth
                                helperText="Use at least 8 characters."
                                id="signup-password"
                                label="Password"
                                inputProps={{ minLength: 8 }}
                                name="password"
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
                                id="signup-confirm-password"
                                label="Confirm password"
                                name="confirmPassword"
                                onChange={(event) => setConfirmPassword(event.target.value)}
                                required
                                type="password"
                                value={confirmPassword}
                            />
                            {error ? (
                                <Typography color="error" variant="body2">
                                    {error}
                                </Typography>
                            ) : null}
                            <Button
                                fullWidth
                                disabled={passwordMismatch || isSubmitting}
                                size="large"
                                type="submit"
                                variant="contained"
                                sx={{
                                    py: 1.4,
                                    fontWeight: 700,
                                    boxShadow: "0 8px 18px rgba(18, 59, 100, 0.18)",
                                }}
                            >
                                {isSubmitting ? "Creating account..." : "Create account"}
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
