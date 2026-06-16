import React, { useState } from "react";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Tooltip,
  Typography,
} from "@mui/material";

export default function DataQualitySummary({ filteredAccountCount, missingCounts }) {
  const [isStatsDialogOpen, setIsStatsDialogOpen] = useState(false);

  return (
    <>
      <Paper
        elevation={0}
        sx={{
          alignItems: "center",
          border: "1px solid rgba(0, 51, 108, 0.10)",
          borderRadius: 2,
          display: "flex",
          gap: 1.5,
          justifyContent: "space-between",
          justifySelf: "end",
          maxWidth: "100%",
          width: "fit-content",
          px: 2,
          py: 1,
        }}
      >
        <Box>
          <Typography color="primary.main" sx={{ fontWeight: 800 }} variant="body2">
            Missing data stats
          </Typography>
          <Typography color="text.secondary" variant="caption">
            {filteredAccountCount} filtered accounts
          </Typography>
        </Box>
        <Tooltip arrow title="View missing data stats">
          <IconButton
            aria-label="View missing data stats"
            onClick={() => setIsStatsDialogOpen(true)}
            sx={{
              bgcolor: "primary.main",
              color: "common.white",
              height: 34,
              width: 34,
              "&:hover": { bgcolor: "primary.dark" },
            }}
          >
            i
          </IconButton>
        </Tooltip>
      </Paper>

      <Dialog
        fullWidth
        maxWidth="md"
        onClose={() => setIsStatsDialogOpen(false)}
        open={isStatsDialogOpen}
      >
        <DialogTitle sx={{ color: "primary.main", fontWeight: 800 }}>
          Missing Data Stats
        </DialogTitle>
        <DialogContent dividers>
          <Box
            sx={{
              display: "grid",
              gap: 2,
              gridTemplateColumns: {
                xs: "1fr",
                sm: "repeat(2, minmax(0, 1fr))",
                md: "repeat(5, minmax(0, 1fr))",
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
                <Typography color="text.secondary" variant="overline">
                  {metric.label}
                </Typography>
                <Typography color="primary.main" sx={{ fontSize: "2rem", fontWeight: 800, lineHeight: 1.1 }}>
                  {metric.missing}
                </Typography>
                <Typography color="text.secondary" variant="body2">
                  {metric.helperText || `of ${filteredAccountCount} accounts`}
                </Typography>
              </Paper>
            ))}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setIsStatsDialogOpen(false)}
            sx={{ borderRadius: 1, fontWeight: 800 }}
            variant="contained"
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
