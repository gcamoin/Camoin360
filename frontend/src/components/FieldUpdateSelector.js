import React from "react";
import { Box, Checkbox, Chip, FormControlLabel, Stack, Typography } from "@mui/material";

export default function FieldUpdateSelector({
  fieldOptions,
  fieldsToUpdate,
  onToggleField,
  selectedFieldLabels,
}) {
  return (
    <Stack spacing={2}>
      <Box>
        <Typography color="text.secondary" variant="overline">
          Selected Fields
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.25 }} variant="body2">
          {selectedFieldLabels.length} selected
        </Typography>
        <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mt: 1 }}>
          {selectedFieldLabels.length ? (
            selectedFieldLabels.map((fieldLabel) => (
              <Chip color="primary" key={fieldLabel} label={fieldLabel} size="small" variant="outlined" />
            ))
          ) : (
            <Typography color="text.secondary" variant="body2">
              No fields selected
            </Typography>
          )}
        </Stack>
      </Box>
      <Box
        sx={{
          borderTop: "1px solid rgba(0, 51, 108, 0.10)",
          display: "grid",
          gap: 1,
          gridTemplateColumns: {
            xs: "1fr",
            sm: "repeat(2, minmax(0, 1fr))",
            md: "repeat(4, minmax(0, 1fr))",
          },
          mt: 2,
          pt: 2,
        }}
      >
        {fieldOptions.map((field) => (
          <FormControlLabel
            control={
              <Checkbox
                checked={fieldsToUpdate.has(field.key)}
                onChange={() => onToggleField(field.key)}
                size="small"
              />
            }
            key={field.key}
            label={field.label}
            sx={{ m: 0, minHeight: 32 }}
          />
        ))}
      </Box>
    </Stack>
  );
}
