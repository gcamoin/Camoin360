import React from "react";
import {
  Autocomplete,
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
  onCityChange,
  onCountryChange,
  onSearchChange,
  onSectorChange,
  onStateChange,
  cities,
  countries,
  searchQuery,
  sectors,
  selectedCities,
  selectedCountry,
  selectedMissingField,
  selectedSector,
  selectedStates,
  stateOptionGroupBy,
  stateOptionHelperText,
  stateOptionLabel,
  showNeedsAttentionOnly,
  states,
}) {
  const compactControlSx = {
    flex: { lg: "0 1 190px" },
    maxWidth: { lg: 190 },
    minWidth: { lg: 0 },
    "& .MuiInputLabel-root": {
      maxWidth: "calc(100% - 42px)",
    },
  };
  const locationFilters = [
    {
      label: "Country",
      options: countries,
      value: selectedCountry,
      onChange: onCountryChange,
    },
    {
      label: "State/Province",
      options: states,
      sx: {
        flex: { lg: "0 1 220px" },
        maxWidth: { lg: 220 },
      },
      value: selectedStates,
      onChange: onStateChange,
      multiple: true,
      getOptionLabel: stateOptionLabel,
      groupBy: stateOptionGroupBy,
      helperText: stateOptionHelperText,
    },
    {
      label: "City",
      options: cities,
      value: selectedCities,
      onChange: onCityChange,
      disabled: !selectedStates.length,
      multiple: true,
    },
  ];

  return (
    <Stack
      direction={{ xs: "column", lg: "row" }}
      spacing={2}
      sx={{
        alignItems: { xs: "stretch", lg: "center" },
        borderBottom: "1px solid rgba(0, 51, 108, 0.10)",
        flexWrap: { lg: "wrap" },
        px: { xs: 2, md: 3 },
        py: 2,
        rowGap: 2,
      }}
      useFlexGap
    >
      <TextField
        label="Search accounts"
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder="Name, sector, website, state, country, city..."
        size="small"
        sx={{ flex: { lg: "0 1 260px" }, maxWidth: { lg: 260 }, minWidth: { lg: 0 } }}
        value={searchQuery}
      />
      {locationFilters.map((filter) => (
        <Autocomplete
          key={filter.label}
          disabled={filter.disabled}
          getOptionLabel={filter.getOptionLabel}
          groupBy={filter.groupBy}
          isOptionEqualToValue={(option, value) => option === value}
          multiple={filter.multiple}
          onChange={(_event, nextValue) => filter.onChange(filter.multiple ? nextValue : nextValue || "all")}
          options={filter.options}
          renderInput={(params) => (
            <TextField
              {...params}
              helperText={filter.helperText}
              label={filter.label}
              placeholder={filter.disabled ? "Select state first" : ""}
              size="small"
            />
          )}
          size="small"
          sx={{
            ...compactControlSx,
            ...filter.sx,
          }}
          value={filter.multiple ? filter.value : filter.value === "all" ? null : filter.value}
        />
      ))}
      <FormControl size="small" sx={compactControlSx}>
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
      <FormControl size="small" sx={compactControlSx}>
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
        sx={{ flex: { lg: "0 0 auto" }, m: 0, minHeight: 40, whiteSpace: "nowrap" }}
      />
      <Button
        disabled={!activeFilterCount}
        onClick={onResetFilters}
        size="small"
        sx={{
          borderRadius: 1,
          flex: { lg: "0 0 auto" },
          fontWeight: 800,
          minHeight: 40,
          whiteSpace: "nowrap",
        }}
        variant="outlined"
      >
        Clear filters
      </Button>
    </Stack>
  );
}
