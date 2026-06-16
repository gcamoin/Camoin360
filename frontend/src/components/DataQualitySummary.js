import React from "react";
import { Box, Chip, Paper, Stack, Typography } from "@mui/material";

const cardSx = {
  border: "1px solid rgba(0, 51, 108, 0.10)",
  borderRadius: 2,
  boxShadow: "0 10px 30px rgba(0, 51, 108, 0.06)",
  height: "100%",
  minWidth: 0,
  p: 2.5,
};

export default function DataQualitySummary({ filteredAccountCount, missingCounts, summary }) {
  const summaryMetrics = [
    {
      label: "Total Loaded Accounts",
      value: summary.totalAccounts,
      helperText: `${filteredAccountCount} shown after filters`,
    },
    {
      label: "Accounts Needing Attention",
      value: summary.accountsNeedingAttention,
      helperText: "Missing one or more quality fields",
    },
    {
      label: "Average Data Quality Score",
      value: `${summary.averageDataQualityScore}%`,
      helperText: "Across all loaded accounts",
    },
    {
      label: "Most Common Missing Field",
      value: summary.mostCommonMissingField,
      helperText: "Across all loaded accounts",
    },
  ];

  return (
    <Stack spacing={2}>
      <Box
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: {
            xs: "1fr",
            sm: "repeat(2, minmax(0, 1fr))",
            lg: "repeat(4, minmax(0, 1fr))",
          },
        }}
      >
        {summaryMetrics.map((metric) => (
          <Paper elevation={0} key={metric.label} sx={cardSx}>
            <Typography color="text.secondary" variant="overline">
              {metric.label}
            </Typography>
            <Typography
              color="primary.main"
              sx={{
                fontSize:
                  metric.label === "Most Common Missing Field"
                    ? { xs: "1.25rem", md: "1.45rem" }
                    : { xs: "2rem", md: "2.35rem" },
                fontWeight: 800,
                lineHeight: 1.1,
                mt: 0.75,
                overflowWrap: "anywhere",
              }}
            >
              {metric.value}
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 0.75 }} variant="body2">
              {metric.helperText}
            </Typography>
          </Paper>
        ))}
      </Box>

      <Box
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: {
            xs: "1fr",
            sm: "repeat(2, minmax(0, 1fr))",
            lg: "repeat(5, minmax(0, 1fr))",
          },
        }}
      >
        {missingCounts.map((metric) => (
          <Paper
            elevation={0}
            key={metric.key}
            sx={{
              border: "1px solid rgba(0, 51, 108, 0.10)",
              borderRadius: 2,
              minWidth: 0,
              p: 2,
            }}
          >
            <Stack alignItems="flex-start" spacing={0.75}>
              <Chip color="primary" label={metric.label} size="small" variant="outlined" />
              <Typography color="primary.main" sx={{ fontSize: "1.75rem", fontWeight: 800, lineHeight: 1.1 }}>
                {metric.missing}
              </Typography>
            </Stack>
            <Typography color="text.secondary" variant="body2">
              {metric.helperText || `of ${filteredAccountCount} accounts`}
            </Typography>
          </Paper>
        ))}
      </Box>
    </Stack>
  );
}
