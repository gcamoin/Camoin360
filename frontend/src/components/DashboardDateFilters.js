import {
  Alert,
  Box,
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";

const ALL = "all";
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export const EMPTY_DATE_FILTERS = {
  year: ALL,
  quarter: ALL,
  month: ALL,
  startDate: "",
  endDate: "",
};

export default function DashboardDateFilters({ value, onChange }) {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: currentYear - 1999 }, (_item, index) => currentYear - index);
  const hasInvalidRange =
    Boolean(value.startDate && value.endDate) && value.startDate > value.endDate;

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
    <Paper elevation={0} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: 2 }}>
      <Stack spacing={1.5}>
        <Box>
          <Typography fontWeight={800}>Reporting period</Typography>
          <Typography color="text.secondary" variant="body2">
            Filter every chart in this tab. Monthly, quarterly, and annual observations include the full period when it overlaps your selection.
          </Typography>
        </Box>
        <Box
          sx={{
            display: "grid",
            gap: 1.5,
            gridTemplateColumns: {
              xs: "minmax(0, 1fr)",
              sm: "repeat(2, minmax(0, 1fr))",
              lg: "repeat(5, minmax(0, 1fr))",
            },
            width: "100%",
          }}
        >
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
          <TextField fullWidth InputLabelProps={{ shrink: true }} label="Start date" onChange={(event) => update("startDate", event.target.value)} size="small" type="date" value={value.startDate} />
          <TextField fullWidth InputLabelProps={{ shrink: true }} inputProps={{ min: value.startDate || undefined }} label="End date" onChange={(event) => update("endDate", event.target.value)} size="small" type="date" value={value.endDate} />
        </Box>
        <Button onClick={() => onChange({ ...EMPTY_DATE_FILTERS })} size="small" sx={{ alignSelf: "flex-start" }}>Reset period</Button>
        {hasInvalidRange ? <Alert severity="error">End date must be on or after the start date.</Alert> : null}
      </Stack>
    </Paper>
  );
}
