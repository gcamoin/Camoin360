import React from "react";
import {
  Box,
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
} from "@mui/material";

export default function DataQualityFilters({
  activeFilterCount,
  missingFieldOptions,
  onMissingFieldChange,
  onNeedsAttentionChange,
  onResetFilters,
  onSearchChange,
  onSectorChange,
  searchQuery,
  sectors,
  selectedMissingField,
  selectedSector,
  showNeedsAttentionOnly,
}) {
  return (
    <Stack
      direction={{ xs: "column", lg: "row" }}
      spacing={2}
      sx={{
        alignItems: { xs: "stretch", lg: "center" },
        borderBottom: "1px solid rgba(0, 51, 108, 0.10)",
        px: { xs: 2, md: 3 },
        py: 2,
      }}
    >
      <TextField
        label="Search accounts"
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder="Name, sector, website, state, country, city..."
        size="small"
        sx={{ flex: 1, minWidth: { lg: 260 } }}
        value={searchQuery}
      />
      <FormControl size="small" sx={{ minWidth: { lg: 190 } }}>
        <InputLabel id="sector-filter-label">Sector</InputLabel>
        <Select
          label="Sector"
          labelId="sector-filter-label"
          onChange={(event) => onSectorChange(event.target.value)}
          value={selectedSector}
        >
          <MenuItem value="all">All sectors</MenuItem>
          {sectors.map((sector) => (
            <MenuItem key={sector} value={sector}>
              {sector}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <FormControl size="small" sx={{ minWidth: { lg: 220 } }}>
        <InputLabel id="missing-field-filter-label">Missing Field</InputLabel>
        <Select
          label="Missing Field"
          labelId="missing-field-filter-label"
          onChange={(event) => onMissingFieldChange(event.target.value)}
          value={selectedMissingField}
        >
          <MenuItem value="all">Any missing field</MenuItem>
          {missingFieldOptions.map((field) => (
            <MenuItem key={field.key} value={field.key}>
              {field.label}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <FormControlLabel
        control={
          <Checkbox
            checked={showNeedsAttentionOnly}
            onChange={(event) => onNeedsAttentionChange(event.target.checked)}
            size="small"
          />
        }
        label="Needs attention"
        sx={{ m: 0, minHeight: 40, whiteSpace: "nowrap" }}
      />
      <Button
        disabled={!activeFilterCount}
        onClick={onResetFilters}
        size="small"
        sx={{ borderRadius: 1, fontWeight: 800, minHeight: 40, whiteSpace: "nowrap" }}
        variant="outlined"
      >
        Clear filters
      </Button>
    </Stack>
  );
}
