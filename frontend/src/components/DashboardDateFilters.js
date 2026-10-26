import {
  Alert, Box, Button, FormControl, InputLabel, MenuItem, Paper,
  Select, Stack, TextField, Typography,
} from "@mui/material";

const ALL = "all";
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export const EMPTY_DATE_FILTERS = {
  mode: ALL,
  year: ALL,
  quarter: ALL,
  month: ALL,
  startDate: "",
  endDate: "",
};

export default function DashboardDateFilters({ value, onChange }) {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: currentYear - 1999 }, (_item, index) => currentYear - index);
  const mode = value.mode || (value.startDate || value.endDate ? "dates" :
    value.year !== ALL || value.quarter !== ALL || value.month !== ALL ? "calendar" : ALL);
  const hasInvalidRange = Boolean(value.startDate && value.endDate) && value.startDate > value.endDate;

  function update(field, nextValue) {
    const next = { ...value, [field]: nextValue };
    if (field === "month" && nextValue !== ALL) {
      next.quarter = String(Math.ceil(Number(nextValue) / 3));
    }
    if (field === "quarter" && nextValue !== ALL && next.month !== ALL &&
        Math.ceil(Number(next.month) / 3) !== Number(nextValue)) {
      next.month = ALL;
    }
    onChange(next);
  }

  return (
    <Paper elevation={0} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, minWidth: 0, p: 2, width: "100%" }}>
      <Stack spacing={1.5}>
        <Stack alignItems={{ xs: "stretch", sm: "center" }} direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={1}>
          <Box>
            <Typography fontWeight={800}>Reporting period</Typography>
            <Typography color="text.secondary" variant="body2">Applies to the charts and totals on this page.</Typography>
          </Box>
          {mode !== ALL && (
            <Button onClick={() => onChange({ ...EMPTY_DATE_FILTERS })} size="small" sx={{ alignSelf: { xs: "flex-start", sm: "auto" } }}>
              Clear period
            </Button>
          )}
        </Stack>
        <FormControl fullWidth size="small" sx={{ maxWidth: 320 }}>
          <InputLabel id="dashboard-period-mode-label">Period</InputLabel>
          <Select
            label="Period"
            labelId="dashboard-period-mode-label"
            onChange={(event) => onChange({ ...EMPTY_DATE_FILTERS, mode: event.target.value })}
            value={mode}
          >
            <MenuItem value={ALL}>All dates</MenuItem>
            <MenuItem value="calendar">Year, quarter, or month</MenuItem>
            <MenuItem value="dates">Custom date range</MenuItem>
          </Select>
        </FormControl>
        {mode === "calendar" && (
          <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", sm: "repeat(3, minmax(0, 1fr))" } }}>
            <FormControl fullWidth size="small">
              <InputLabel id="dashboard-year-filter-label">Year</InputLabel>
              <Select label="Year" labelId="dashboard-year-filter-label" onChange={(event) => update("year", event.target.value)} value={value.year}>
                <MenuItem value={ALL}>All years</MenuItem>
                {years.map((year) => <MenuItem key={year} value={String(year)}>{year}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel id="dashboard-quarter-filter-label">Quarter</InputLabel>
              <Select label="Quarter" labelId="dashboard-quarter-filter-label" onChange={(event) => update("quarter", event.target.value)} value={value.quarter}>
                <MenuItem value={ALL}>All quarters</MenuItem>
                {[1, 2, 3, 4].map((quarter) => <MenuItem key={quarter} value={String(quarter)}>Q{quarter}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel id="dashboard-month-filter-label">Month</InputLabel>
              <Select label="Month" labelId="dashboard-month-filter-label" onChange={(event) => update("month", event.target.value)} value={value.month}>
                <MenuItem value={ALL}>All months</MenuItem>
                {MONTHS.map((month, index) => <MenuItem key={month} value={String(index + 1)}>{month}</MenuItem>)}
              </Select>
            </FormControl>
          </Box>
        )}
        {mode === "dates" && (
          <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))" } }}>
            <TextField fullWidth InputLabelProps={{ shrink: true }} label="Start date" onChange={(event) => update("startDate", event.target.value)} size="small" type="date" value={value.startDate} />
            <TextField fullWidth InputLabelProps={{ shrink: true }} inputProps={{ min: value.startDate || undefined }} label="End date" onChange={(event) => update("endDate", event.target.value)} size="small" type="date" value={value.endDate} />
          </Box>
        )}
        {hasInvalidRange && <Alert severity="error">End date must be on or after the start date.</Alert>}
      </Stack>
    </Paper>
  );
}
