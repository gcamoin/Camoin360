import React from "react";
import {
  Box,
  Checkbox,
  Chip,
  FormControl,
  InputLabel,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  Typography,
} from "@mui/material";

export default function FieldUpdateSelector({
  fieldOptions,
  fieldsToUpdate,
  onFieldsChange,
  selectedFieldLabels,
}) {
  const selectedFieldKeys = Array.from(fieldsToUpdate);

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
      <FormControl fullWidth size="small" sx={{ maxWidth: 420 }}>
        <InputLabel id="fields-to-update-label">Fields To Update</InputLabel>
        <Select
          label="Fields To Update"
          labelId="fields-to-update-label"
          multiple
          onChange={(event) => onFieldsChange(event.target.value)}
          renderValue={(selectedKeys) =>
            selectedKeys.length
              ? fieldOptions
                  .filter((field) => selectedKeys.includes(field.key))
                  .map((field) => field.label)
                  .join(", ")
              : "No fields selected"
          }
          value={selectedFieldKeys}
        >
          {fieldOptions.map((field) => (
            <MenuItem key={field.key} value={field.key}>
              <Checkbox checked={fieldsToUpdate.has(field.key)} size="small" />
              <ListItemText primary={field.label} />
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    </Stack>
  );
}
