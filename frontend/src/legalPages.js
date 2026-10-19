import {
  Box,
  Container,
  Divider,
  Link,
  Paper,
  Stack,
  Typography,
  useTheme,
} from "@mui/material";

const effectiveDate = "August 31, 2026";

const termsSections = [
  {
    title: "Acceptance of Terms",
    body:
      "By accessing or using Camoin 360, you agree to these Terms of Use. If you do not agree, do not access or use the service.",
  },
  {
    title: "Authorized Use",
    body:
      "Camoin 360 is provided for authorized business users only. You may use the service only for lawful business purposes and only in accordance with the permissions assigned to your account.",
  },
  {
    title: "Accounts and Security",
    body:
      "You are responsible for maintaining the confidentiality of your account credentials and for all activity under your account. Notify Camoin Associates promptly if you believe your account has been compromised.",
  },
  {
    title: "Third-Party Services",
    body:
      "Camoin 360 may connect to third-party services, including QuickBooks, to provide authorized reporting and operational functionality. Your use of third-party services may also be governed by their own terms and policies.",
  },
  {
    title: "Data and Content",
    body:
      "You remain responsible for the accuracy, legality, and appropriateness of data you submit or make available through Camoin 360. Camoin Associates may process data as needed to provide, maintain, and improve the service.",
  },
  {
    title: "Restrictions",
    body:
      "You may not misuse the service, attempt unauthorized access, interfere with service operation, reverse engineer the service, or use the service in violation of applicable law or assigned access permissions.",
  },
  {
    title: "Availability and Changes",
    body:
      "Camoin Associates may update, suspend, or discontinue portions of Camoin 360 from time to time. The service is provided without a guarantee of uninterrupted availability.",
  },
  {
    title: "Disclaimer",
    body:
      "Camoin 360 is provided on an as-is and as-available basis. To the maximum extent permitted by law, Camoin Associates disclaims warranties of merchantability, fitness for a particular purpose, and non-infringement.",
  },
  {
    title: "Limitation of Liability",
    body:
      "To the maximum extent permitted by law, Camoin Associates will not be liable for indirect, incidental, special, consequential, or punitive damages arising from your use of Camoin 360.",
  },
  {
    title: "Contact",
    body:
      "Questions about these Terms of Use may be directed to Camoin Associates at garrett@camoinassociates.com.",
  },
];

const privacySections = [
  {
    title: "Overview",
    body:
      "This Privacy Policy explains how Camoin Associates collects, uses, and protects information in connection with Camoin 360.",
  },
  {
    title: "Information We Collect",
    body:
      "We may collect account information, business contact information, usage information, and data that authorized users or connected services make available to Camoin 360.",
  },
  {
    title: "How We Use Information",
    body:
      "We use information to provide Camoin 360, authenticate users, manage access, generate authorized reports, maintain security, troubleshoot issues, and improve the service.",
  },
  {
    title: "QuickBooks Data",
    body:
      "When authorized, Camoin 360 may access QuickBooks data to provide financial reporting features. QuickBooks data is used only for authorized application functionality and is not sold.",
  },
  {
    title: "Sharing of Information",
    body:
      "We do not sell personal information. We may share information with service providers, connected platforms, or as required to comply with law, protect rights, or operate Camoin 360.",
  },
  {
    title: "Data Security",
    body:
      "We use reasonable administrative, technical, and organizational measures designed to protect information. No method of transmission or storage is completely secure.",
  },
  {
    title: "Data Retention",
    body:
      "We retain information for as long as needed to provide Camoin 360, comply with legal obligations, resolve disputes, and enforce agreements.",
  },
  {
    title: "User Choices",
    body:
      "Authorized users may request updates to account information or access permissions through Camoin Associates. Access to connected third-party data may also be managed through the applicable third-party service.",
  },
  {
    title: "Policy Updates",
    body:
      "We may update this Privacy Policy from time to time. The effective date identifies the latest version.",
  },
  {
    title: "Contact",
    body:
      "Questions about this Privacy Policy may be directed to Camoin Associates at garrett@camoinassociates.com.",
  },
];

function LegalHeader() {
  return (
    <Box
      component="header"
      sx={{
        borderBottom: "1px solid",
        borderColor: "divider",
        backgroundColor: "background.paper",
      }}
    >
      <Container maxWidth="lg" sx={{ py: 2.25 }}>
        <Typography component="a" href="/" sx={{ color: "primary.main", fontSize: "1.35rem", fontWeight: 800, textDecoration: "none" }}>
          Camoin 360
        </Typography>
      </Container>
    </Box>
  );
}

function LegalFooter() {
  return (
    <Box component="footer" sx={{ borderTop: "1px solid", borderColor: "divider", mt: 5 }}>
      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
          <Link href="/terms" underline="hover">
            Terms of Use
          </Link>
          <Link href="/privacy" underline="hover">
            Privacy Policy
          </Link>
        </Stack>
      </Container>
    </Box>
  );
}

export function LegalFooterLinks() {
  return (
    <Stack direction="row" justifyContent="center" spacing={2} sx={{ pt: 1 }}>
      <Link href="/terms" underline="hover" variant="body2">
        Terms of Use
      </Link>
      <Link href="/privacy" underline="hover" variant="body2">
        Privacy Policy
      </Link>
    </Stack>
  );
}

export default function LegalPage({ type }) {
  const theme = useTheme();
  const isPrivacy = type === "privacy";
  const title = isPrivacy ? "Privacy Policy" : "Terms of Use";
  const sections = isPrivacy ? privacySections : termsSections;

  return (
    <Box
      sx={{
        minHeight: "100vh",
        background: `radial-gradient(circle at 15% 12%, ${theme.palette.secondary.main}12, transparent 30%), ${theme.palette.background.default}`,
        color: "text.primary",
      }}
    >
      <LegalHeader />
      <Box component="main" sx={{ py: { xs: 4, md: 7 } }}>
        <Container maxWidth="md">
          <Paper
            elevation={0}
            sx={{
              border: "1px solid",
              borderColor: "divider",
              borderRadius: 2,
              p: { xs: 2.5, sm: 4, md: 5 },
            }}
          >
            <Typography
              component="h1"
              sx={{
                color: "primary.main",
                fontSize: { xs: "2rem", md: "2.6rem" },
                fontWeight: 800,
                lineHeight: 1.1,
                mb: 1,
              }}
            >
              {title}
            </Typography>
            <Typography color="text.secondary" sx={{ mb: 4 }}>
              Effective date: {effectiveDate}
            </Typography>

            <Stack divider={<Divider />} spacing={3}>
              {sections.map((section, index) => (
                <Box key={section.title}>
                  <Typography
                    component="h2"
                    sx={{
                      color: "primary.main",
                      fontSize: { xs: "1.15rem", md: "1.3rem" },
                      fontWeight: 800,
                      mb: 1,
                    }}
                  >
                    {index + 1}. {section.title}
                  </Typography>
                  <Typography sx={{ color: "text.primary", lineHeight: 1.75 }}>
                    {section.body}
                  </Typography>
                </Box>
              ))}
            </Stack>
          </Paper>
        </Container>
      </Box>
      <LegalFooter />
    </Box>
  );
}
