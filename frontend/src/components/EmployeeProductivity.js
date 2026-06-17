import { Paper, Stack, Typography } from "@mui/material";

export default function EmployeeProductivity() {
  return (
    <Paper
      elevation={0}
      sx={{
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 2,
        p: { xs: 2, md: 2.5 },
        backgroundColor: "common.white",
      }}
    >
      <Stack spacing={0.75}>
        <Typography color="text.primary" fontWeight={800}>
          Employee Productivity
        </Typography>
        <Typography color="text.secondary" variant="body2">
          Employee productivity metrics are ready to be configured.
        </Typography>
      </Stack>
    </Paper>
  );
}
