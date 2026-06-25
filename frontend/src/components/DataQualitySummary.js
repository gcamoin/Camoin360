import React, { useState } from "react";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  IconButton,
  LinearProgress,
  Paper,
  Tooltip,
  Typography,
} from "@mui/material";
import { ModalTitle } from "./UiPrimitives";

function getSeverityColor(pct) {
  if (pct >= 50) return { accent: "#c62828", bg: "#fff5f5", barBg: "rgba(198,40,40,0.12)" };
  if (pct >= 25) return { accent: "#d84315", bg: "#fff8f5", barBg: "rgba(216,67,21,0.12)" };
  if (pct >= 10) return { accent: "#e65100", bg: "#fffaf5", barBg: "rgba(230,81,0,0.12)" };
  return { accent: "#2e7d32", bg: "#f5fbf5", barBg: "rgba(46,125,50,0.12)" };
}

export default function DataQualitySummary({ filteredAccountCount, missingCounts }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Paper
        elevation={0}
        sx={{
          alignItems: "center",
          border: "1px solid rgba(0, 51, 108, 0.12)",
          borderRadius: 2,
          display: "flex",
          gap: 2,
          px: 2.5,
          py: 1.5,
          width: "fit-content",
        }}
      >
        <Box>
          <Typography color="primary.main" sx={{ fontWeight: 700, lineHeight: 1.3 }} variant="body2">
            Missing data stats
          </Typography>
          <Typography color="text.secondary" variant="caption">
            {filteredAccountCount?.toLocaleString()} accounts
          </Typography>
        </Box>
        <Tooltip arrow title="View missing data breakdown">
          <IconButton
            aria-label="View missing data stats"
            onClick={() => setOpen(true)}
            sx={{
              bgcolor: "primary.main",
              borderRadius: 1.5,
              color: "common.white",
              fontSize: "0.85rem",
              fontStyle: "italic",
              fontWeight: 900,
              height: 32,
              width: 32,
              "&:hover": {
                bgcolor: "primary.dark",
                transform: "scale(1.08)",
              },
              transition: "all 0.15s ease",
            }}
          >
            i
          </IconButton>
        </Tooltip>
      </Paper>

      <Dialog fullWidth maxWidth="md" onClose={() => setOpen(false)} open={open}>
        <ModalTitle
          onClose={() => setOpen(false)}
          subtitle={`Across ${filteredAccountCount?.toLocaleString()} filtered accounts`}
        >
          Missing Data Breakdown
        </ModalTitle>
        <DialogContent dividers sx={{ pt: 2.5 }}>
          <Box
            sx={{
              display: "grid",
              gap: 2,
              gridTemplateColumns: {
                xs: "1fr",
                sm: "repeat(2, minmax(0, 1fr))",
                md: "repeat(3, minmax(0, 1fr))",
              },
            }}
          >
            {missingCounts.map((metric) => {
              const pct =
                filteredAccountCount > 0
                  ? Math.round((metric.missing / filteredAccountCount) * 100)
                  : 0;
              const { accent, bg, barBg } = getSeverityColor(pct);
              return (
                <Paper
                  elevation={0}
                  key={metric.key}
                  sx={{
                    bgcolor: bg,
                    border: `1px solid ${accent}28`,
                    borderRadius: 2,
                    borderTop: `3px solid ${accent}`,
                    minWidth: 0,
                    p: 2.5,
                    transition: "box-shadow 0.15s ease, transform 0.15s ease",
                    "&:hover": {
                      boxShadow: `0 4px 20px ${accent}20`,
                      transform: "translateY(-1px)",
                    },
                  }}
                >
                  <Typography
                    sx={{
                      color: "text.secondary",
                      fontSize: "0.68rem",
                      fontWeight: 700,
                      letterSpacing: "0.07em",
                      mb: 1.5,
                      textTransform: "uppercase",
                    }}
                  >
                    {metric.label}
                  </Typography>
                  <Box sx={{ alignItems: "baseline", display: "flex", gap: 1, mb: 1.5 }}>
                    <Typography
                      sx={{
                        color: accent,
                        fontSize: "2.25rem",
                        fontWeight: 800,
                        lineHeight: 1,
                      }}
                    >
                      {metric.missing.toLocaleString()}
                    </Typography>
                    <Box
                      sx={{
                        alignItems: "center",
                        bgcolor: `${accent}18`,
                        borderRadius: 1,
                        display: "flex",
                        px: 0.75,
                        py: 0.25,
                      }}
                    >
                      <Typography sx={{ color: accent, fontSize: "0.75rem", fontWeight: 700 }}>
                        {pct}%
                      </Typography>
                    </Box>
                  </Box>
                  <LinearProgress
                    sx={{
                      bgcolor: barBg,
                      borderRadius: 2,
                      height: 5,
                      mb: 1.25,
                      "& .MuiLinearProgress-bar": {
                        bgcolor: accent,
                        borderRadius: 2,
                      },
                    }}
                    value={Math.min(pct, 100)}
                    variant="determinate"
                  />
                  <Typography sx={{ color: "text.secondary", fontSize: "0.75rem" }}>
                    {metric.helperText || `of ${filteredAccountCount?.toLocaleString()} accounts`}
                  </Typography>
                </Paper>
              );
            })}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button
            onClick={() => setOpen(false)}
            sx={{ borderRadius: 1.5, fontWeight: 700, px: 3 }}
            variant="contained"
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
