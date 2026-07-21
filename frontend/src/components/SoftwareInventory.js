import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TableSortLabel,
  TextField,
  Typography,
} from "@mui/material";

import { API_BASE_URL, getApiErrorMessage, getAuthHeaders, handleUnauthorized } from "../auth";
import { AppIcon, EmptyState, subtleTableHeadCellSx } from "./UiPrimitives";

const API_URL = `${API_BASE_URL}/software-subscriptions`;
const ALL_FILTER_VALUE = "all";
const STATUS_OPTIONS = ["Active", "Pending Renewal", "Needs Review", "Cancelled"];
const BILLING_FREQUENCY_OPTIONS = ["Monthly", "Quarterly", "Annual", "One-Time", "Other"];
const DEFAULT_SORT_KEY = "name";
const DEFAULT_SORT_DIRECTION = "asc";
const ROWS_PER_PAGE_OPTIONS = [10, 25, 50, 100];
const COST_FIELD_KEYS = ["current_monthly_cost", "cost_2024_2025", "cost_2025_2026", "cost_2026_2027"];
const QUICK_FILTER_OPTIONS = [
  { value: "missing_renewal_date", label: "Missing Renewal Date" },
  { value: "missing_cost", label: "Missing Cost" },
  { value: "missing_owner", label: "Missing Owner" },
  { value: "missing_department", label: "Missing Department" },
  { value: "missing_vendor", label: "Missing Vendor" },
];
const CSV_EXPORT_COLUMNS = [
  { header: "Software name", getValue: (row) => row.name },
  { header: "Vendor", getValue: (row) => row.vendor_rep },
  { header: "Category", getValue: (row) => row.category },
  { header: "Department", getValue: (row) => row.department },
  { header: "Owner", getValue: (row) => row.point_of_contact },
  { header: "Status", getValue: (row) => row.status },
  { header: "Billing frequency", getValue: (row) => row.billing_frequency },
  { header: "Monthly cost", getValue: (row) => formatExportCurrency(getCurrentMonthlyCost(row)) },
  { header: "Annual cost", getValue: (row) => formatExportCurrency(getCurrentAnnualCost(row)) },
  { header: "Renewal date", getValue: (row) => formatExportDate(row.renewal_date) },
  { header: "Notes", getValue: (row) => row.notes },
  { header: "Created date", getValue: (row) => formatExportDate(row.created_at) },
  { header: "Last updated date", getValue: (row) => formatExportDate(row.updated_at) },
];
const EMPTY_FORM = {
  name: "",
  description: "",
  category: "",
  department: "",
  point_of_contact: "",
  assigned_users: "",
  current_monthly_cost: "",
  original_cost_2026_2027: "",
  cost_2024_2025: "",
  cost_2025_2026: "",
  cost_2026_2027: "",
  billing_frequency: "",
  renewal_date: "",
  renewal_time_frame: "",
  vendor_rep: "",
  subscribed_since: "",
  status: "Active",
  notes: "",
};

const columns = [
  { key: "name", label: "Software / Data Subscription Name", minWidth: 240, sortable: true },
  { key: "category", label: "Category", minWidth: 170, sortable: true },
  { key: "department", label: "Department", minWidth: 160, sortable: true },
  { key: "description", label: "Description", minWidth: 300 },
  { key: "point_of_contact", label: "Owner", minWidth: 190 },
  { key: "assigned_users", label: "Access / Assigned Users", minWidth: 230 },
  { key: "current_monthly_cost", label: "Current Monthly Cost", align: "right", minWidth: 180, sortable: true },
  { key: "cost_2026_2027", label: "Current Annual Cost", align: "right", minWidth: 170, sortable: true },
  { key: "billing_frequency", label: "Billing Frequency", minWidth: 170, sortable: true },
  { key: "renewal_date", label: "Renewal Date", minWidth: 160, sortable: true },
  { key: "renewal_time_frame", label: "Renewal Timeframe", minWidth: 180, sortable: true },
  { key: "renewal_risk", label: "Renewal Risk", minWidth: 150 },
  { key: "vendor_rep", label: "Vendor", minWidth: 190, sortable: true },
  { key: "subscribed_since", label: "Subscribed Since", minWidth: 150 },
  { key: "status", label: "Status", minWidth: 140, sortable: true },
  { key: "notes", label: "Notes", minWidth: 300 },
];

const detailFields = [
  ["Vendor", "vendor_rep"],
  ["Category", "category"],
  ["Department", "department"],
  ["Owner", "point_of_contact"],
  ["Status", "status"],
  ["Billing Frequency", "billing_frequency"],
  ["Monthly Cost", "current_monthly_cost", "monthly_currency"],
  ["Annualized Cost", "annualized_cost", "annual_currency"],
  ["Renewal Date", "renewal_date", "date"],
  ["Notes", "notes", "long_text"],
  ["Created Timestamp", "created_at", "timestamp"],
  ["Last Updated Timestamp", "updated_at", "timestamp"],
];

const requiredFields = {
  name: "Subscription name is required.",
  category: "Category is required.",
  department: "Department is required.",
  point_of_contact: "Point of contact is required.",
  billing_frequency: "Billing frequency is required.",
  renewal_date: "Renewal date is required.",
  renewal_time_frame: "Renewal time frame is required.",
  vendor_rep: "Vendor is required.",
  status: "Status is required.",
};

const statusChipProps = {
  Active: { color: "success", variant: "filled" },
  "Pending Renewal": { color: "info", variant: "outlined" },
  "Needs Review": { color: "warning", variant: "outlined" },
  Cancelled: { color: "default", variant: "outlined" },
};

const renewalMonthLookup = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  sept: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};

function normalize(value) {
  return String(value || "").toLowerCase();
}

function formatCurrency(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  return new Intl.NumberFormat(undefined, {
    currency: "USD",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(Number(value));
}

function formatDate(value) {
  if (!value) {
    return "-";
  }

  const parsedDate = parseDateValue(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(parsedDate);
}

function formatTimestamp(value) {
  if (!value) {
    return "-";
  }

  const parsedDate = parseDateValue(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsedDate);
}

function parseDateValue(value) {
  if (!value) {
    return new Date("");
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    return new Date(`${value}T00:00:00`);
  }

  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(String(value))) {
    return new Date(String(value).replace(" ", "T"));
  }

  return new Date(value);
}

function formatExportCurrency(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  return new Intl.NumberFormat(undefined, {
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(Number(value));
}

function formatExportDate(value) {
  if (!value) {
    return "";
  }

  const parsedDate = parseDateValue(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(parsedDate);
}

function escapeCsvValue(value) {
  const stringValue = String(value ?? "");

  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

function getExportDateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function downloadCsv(filename, rows) {
  const csvContent = rows.map((row) => row.map(escapeCsvValue).join(",")).join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const downloadLink = document.createElement("a");

  downloadLink.href = url;
  downloadLink.download = filename;
  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);
  URL.revokeObjectURL(url);
}

function roundCurrencyValue(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function getCurrentMonthlyCost(row) {
  if (row?.current_monthly_cost !== null && row?.current_monthly_cost !== undefined && row?.current_monthly_cost !== "") {
    return Number(row.current_monthly_cost);
  }

  if (row?.cost_2026_2027 !== null && row?.cost_2026_2027 !== undefined && row?.cost_2026_2027 !== "") {
    return roundCurrencyValue(Number(row.cost_2026_2027) / 12);
  }

  return null;
}

function getCurrentMonthlyCostTotal(rows) {
  return rows.reduce((sum, row) => sum + Number(getCurrentMonthlyCost(row) || 0), 0);
}

function getCurrentAnnualCost(row) {
  if (row?.cost_2026_2027 !== null && row?.cost_2026_2027 !== undefined && row?.cost_2026_2027 !== "") {
    return Number(row.cost_2026_2027);
  }

  const monthlyCost = getCurrentMonthlyCost(row);
  return monthlyCost === null ? null : roundCurrencyValue(monthlyCost * 12);
}

function getDetailFieldValue(row, key, format) {
  if (format === "monthly_currency") {
    return formatCurrency(getCurrentMonthlyCost(row));
  }

  if (format === "annual_currency") {
    return formatCurrency(getCurrentAnnualCost(row));
  }

  if (format === "date") {
    return formatDate(row[key]);
  }

  if (format === "timestamp") {
    return formatTimestamp(row[key]);
  }

  return row[key] || "-";
}

function getRenewalMonth(renewalTimeFrame) {
  const normalized = normalize(renewalTimeFrame);
  return Object.entries(renewalMonthLookup).find(([label]) =>
    normalized.includes(label)
  )?.[1];
}

function isUpcomingRenewal(row) {
  if (row.status === "Pending Renewal") {
    return true;
  }

  const renewalRisk = getRenewalRisk(row);
  if (renewalRisk && renewalRisk.daysUntilRenewal <= 90) {
    return true;
  }

  const renewalMonth = getRenewalMonth(row.renewal_time_frame);
  if (renewalMonth === undefined) {
    return false;
  }

  const today = new Date();
  const currentYearRenewal = new Date(today.getFullYear(), renewalMonth, 1);
  const renewalDate =
    currentYearRenewal < today
      ? new Date(today.getFullYear() + 1, renewalMonth, 1)
      : currentYearRenewal;
  const daysUntilRenewal = (renewalDate - today) / (1000 * 60 * 60 * 24);

  return daysUntilRenewal <= 90;
}

function getRenewalRisk(row) {
  if (!row?.renewal_date) {
    return null;
  }

  const renewalDate = new Date(`${row.renewal_date}T00:00:00`);
  if (Number.isNaN(renewalDate.getTime())) {
    return null;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysUntilRenewal = Math.ceil((renewalDate - today) / (1000 * 60 * 60 * 24));

  if (daysUntilRenewal < 0) {
    return { color: "error", label: "Expired", severity: "expired", daysUntilRenewal };
  }

  if (daysUntilRenewal <= 30) {
    return { color: "error", label: "Renews <=30d", severity: "30", daysUntilRenewal };
  }

  if (daysUntilRenewal <= 60) {
    return { color: "warning", label: "Renews <=60d", severity: "60", daysUntilRenewal };
  }

  if (daysUntilRenewal <= 90) {
    return { color: "info", label: "Renews <=90d", severity: "90", daysUntilRenewal };
  }

  return { color: "success", label: "On Track", severity: "clear", daysUntilRenewal };
}

function getRenewalRowSx(row) {
  const renewalRisk = getRenewalRisk(row);

  if (!renewalRisk) {
    return {};
  }

  if (renewalRisk.severity === "expired") {
    return { bgcolor: "rgba(211, 47, 47, 0.08)" };
  }

  if (renewalRisk.severity === "30") {
    return { bgcolor: "rgba(211, 47, 47, 0.08)" };
  }

  if (renewalRisk.severity === "60") {
    return { bgcolor: "rgba(237, 108, 2, 0.1)" };
  }

  if (renewalRisk.severity === "90") {
    return { bgcolor: "rgba(2, 136, 209, 0.08)" };
  }

  return {};
}

function getRenewalSortValue(row) {
  if (row.renewal_date) {
    const renewalDate = new Date(`${row.renewal_date}T00:00:00`);
    if (!Number.isNaN(renewalDate.getTime())) {
      return renewalDate.getTime();
    }
  }

  const renewalMonth = getRenewalMonth(row.renewal_time_frame);

  if (renewalMonth === undefined) {
    return normalize(row.renewal_time_frame);
  }

  const today = new Date();
  const currentYearRenewal = new Date(today.getFullYear(), renewalMonth, 1);
  const renewalDate =
    currentYearRenewal < today
      ? new Date(today.getFullYear() + 1, renewalMonth, 1)
      : currentYearRenewal;

  return renewalDate.getTime();
}

function getSortValue(row, sortKey) {
  if (sortKey === "current_monthly_cost") {
    return getCurrentMonthlyCost(row);
  }

  if (sortKey === "cost_2026_2027") {
    return getCurrentAnnualCost(row);
  }

  if (sortKey === "renewal_time_frame") {
    return getRenewalSortValue(row);
  }

  if (sortKey === "renewal_date") {
    return getRenewalSortValue(row);
  }

  if (sortKey === "status") {
    const statusIndex = STATUS_OPTIONS.indexOf(row.status);
    return statusIndex === -1 ? STATUS_OPTIONS.length : statusIndex;
  }

  return row[sortKey];
}

function compareSortValues(firstValue, secondValue) {
  const firstMissing = firstValue === null || firstValue === undefined || firstValue === "";
  const secondMissing = secondValue === null || secondValue === undefined || secondValue === "";

  if (firstMissing && secondMissing) {
    return 0;
  }

  if (firstMissing) {
    return 1;
  }

  if (secondMissing) {
    return -1;
  }

  if (typeof firstValue === "number" && typeof secondValue === "number") {
    return firstValue - secondValue;
  }

  return String(firstValue).localeCompare(String(secondValue), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function sortRows(rows, sortKey, sortDirection) {
  const directionMultiplier = sortDirection === "asc" ? 1 : -1;

  return rows
    .map((row, index) => ({ index, row }))
    .sort((first, second) => {
      const comparison = compareSortValues(
        getSortValue(first.row, sortKey),
        getSortValue(second.row, sortKey)
      );

      return comparison === 0
        ? first.index - second.index
        : comparison * directionMultiplier;
    })
    .map(({ row }) => row);
}

function toFormState(row) {
  if (!row) {
    return EMPTY_FORM;
  }

  return {
    name: row.name || "",
    description: row.description || "",
    category: row.category || "",
    department: row.department || "",
    point_of_contact: row.point_of_contact || "",
    assigned_users: row.assigned_users || "",
    current_monthly_cost:
      getCurrentMonthlyCost(row) === null ? "" : String(getCurrentMonthlyCost(row)),
    original_cost_2026_2027: row.cost_2026_2027 ?? "",
    cost_2024_2025: row.cost_2024_2025 ?? "",
    cost_2025_2026: row.cost_2025_2026 ?? "",
    cost_2026_2027: "",
    billing_frequency: row.billing_frequency || "",
    renewal_date: row.renewal_date || "",
    renewal_time_frame: row.renewal_time_frame || "",
    vendor_rep: row.vendor_rep || "",
    subscribed_since: row.subscribed_since || "",
    status: row.status || "Active",
    notes: row.notes || "",
  };
}

function toRequestPayload(form) {
  const {
    current_monthly_cost: currentMonthlyCostInput,
    original_cost_2026_2027: originalCurrentYearlyCost,
    ...payload
  } = form;
  const trimmedPayload = Object.fromEntries(
    Object.entries(payload).map(([key, value]) => [
      key,
      typeof value === "string" ? value.trim() : value,
    ])
  );
  const currentMonthlyCost =
    String(currentMonthlyCostInput).trim() === ""
      ? null
      : Number(currentMonthlyCostInput);
  const originalMonthlyCost =
    originalCurrentYearlyCost === ""
      ? null
      : String(roundCurrencyValue(Number(originalCurrentYearlyCost) / 12));
  const currentYearlyCost =
    String(form.cost_2026_2027).trim() === ""
      ? currentMonthlyCost === null
        ? null
        : currentMonthlyCostInput === originalMonthlyCost
          ? Number(originalCurrentYearlyCost)
          : roundCurrencyValue(currentMonthlyCost * 12)
      : Number(form.cost_2026_2027);

  return {
    ...trimmedPayload,
    cost_2024_2025: String(form.cost_2024_2025).trim() === "" ? null : Number(form.cost_2024_2025),
    cost_2025_2026: String(form.cost_2025_2026).trim() === "" ? null : Number(form.cost_2025_2026),
    cost_2026_2027: currentYearlyCost,
  };
}

function validateForm(form) {
  const errors = {};

  for (const [field, message] of Object.entries(requiredFields)) {
    if (!String(form[field] || "").trim()) {
      errors[field] = message;
    }
  }

  for (const field of COST_FIELD_KEYS) {
    const value = String(form[field] ?? "").trim();
    if (value === "") {
      continue;
    }

    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      errors[field] = "Enter a valid cost.";
    } else if (numericValue < 0) {
      errors[field] = "Cost must be zero or greater.";
    }
  }

  if (String(form.current_monthly_cost).trim() !== "" && String(form.cost_2026_2027).trim() !== "") {
    errors.current_monthly_cost = "Enter either monthly or yearly current cost.";
    errors.cost_2026_2027 = "Enter either yearly or monthly current cost.";
  }

  return errors;
}

function getAnnualizedMonthlyCost(form) {
  const monthlyCostValue = String(form.current_monthly_cost ?? "").trim();

  if (monthlyCostValue === "") {
    return null;
  }

  const monthlyCost = Number(monthlyCostValue);
  return Number.isFinite(monthlyCost) && monthlyCost >= 0
    ? roundCurrencyValue(monthlyCost * 12)
    : null;
}

function StatusChip({ status }) {
  const chipProps = statusChipProps[status] || statusChipProps["Needs Review"];

  return (
    <Chip
      color={chipProps.color}
      label={status || "Needs Review"}
      size="small"
      sx={{ fontWeight: 800, minWidth: 112 }}
      variant={chipProps.variant}
    />
  );
}

function RenewalRiskChip({ row }) {
  const renewalRisk = getRenewalRisk(row);

  if (!renewalRisk) {
    return (
      <Chip
        color="default"
        label="Missing Date"
        size="small"
        sx={{ fontWeight: 800, minWidth: 116 }}
        variant="outlined"
      />
    );
  }

  return (
    <Chip
      color={renewalRisk.color}
      label={renewalRisk.label}
      size="small"
      sx={{ fontWeight: 800, minWidth: 116 }}
      variant={renewalRisk.severity === "clear" ? "outlined" : "filled"}
    />
  );
}

function SummaryCard({ label, value, helper }) {
  return (
    <Paper
      elevation={0}
      sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: 2.5 }}
    >
      <Typography color="text.secondary" variant="overline">
        {label}
      </Typography>
      <Typography color="primary.main" sx={{ fontSize: "2rem", fontWeight: 800, lineHeight: 1.1, mt: 0.75 }}>
        {value}
      </Typography>
      <Typography color="text.secondary" sx={{ mt: 0.75 }} variant="body2">
        {helper}
      </Typography>
    </Paper>
  );
}

function SubscriptionFormDialog({
  error,
  form,
  formErrors,
  mode,
  onChange,
  onClose,
  onSubmit,
  open,
  saving,
}) {
  const liveFormErrors = validateForm(form);
  const displayFormErrors = { ...liveFormErrors, ...formErrors };
  const annualizedMonthlyCost = getAnnualizedMonthlyCost(form);
  const saveDisabled = saving || Object.keys(liveFormErrors).length > 0;

  return (
    <Dialog fullWidth maxWidth="md" onClose={saving ? undefined : onClose} open={open}>
      <DialogTitle>{mode === "edit" ? "Edit Subscription" : "Create Subscription"}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <Box
            sx={{
              display: "grid",
              gap: 2,
              gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" },
            }}
          >
            <TextField
              error={Boolean(displayFormErrors.name)}
              helperText={displayFormErrors.name}
              label="Software / Data Subscription Name"
              onChange={(event) => onChange("name", event.target.value)}
              required
              value={form.name}
            />
            <TextField
              error={Boolean(displayFormErrors.category)}
              helperText={displayFormErrors.category}
              label="Category"
              onChange={(event) => onChange("category", event.target.value)}
              required
              value={form.category}
            />
            <TextField
              error={Boolean(displayFormErrors.department)}
              helperText={displayFormErrors.department}
              label="Department"
              onChange={(event) => onChange("department", event.target.value)}
              required
              value={form.department}
            />
            <TextField
              error={Boolean(displayFormErrors.point_of_contact)}
              helperText={displayFormErrors.point_of_contact}
              label="Owner"
              onChange={(event) => onChange("point_of_contact", event.target.value)}
              required
              value={form.point_of_contact}
            />
            <TextField
              label="Access / Assigned Users"
              onChange={(event) => onChange("assigned_users", event.target.value)}
              value={form.assigned_users}
            />
            <FormControl error={Boolean(displayFormErrors.status)} required>
              <InputLabel id="software-status-label">Status</InputLabel>
              <Select
                label="Status"
                labelId="software-status-label"
                onChange={(event) => onChange("status", event.target.value)}
                value={form.status}
              >
                {STATUS_OPTIONS.map((status) => (
                  <MenuItem key={status} value={status}>
                    {status}
                  </MenuItem>
                ))}
              </Select>
              {displayFormErrors.status ? (
                <Typography color="error" sx={{ ml: 1.75, mt: 0.5 }} variant="caption">
                  {displayFormErrors.status}
                </Typography>
              ) : null}
            </FormControl>
            <TextField
              error={Boolean(displayFormErrors.renewal_time_frame)}
              helperText={displayFormErrors.renewal_time_frame}
              label="Renewal Time Frame"
              onChange={(event) => onChange("renewal_time_frame", event.target.value)}
              required
              value={form.renewal_time_frame}
            />
            <TextField
              InputLabelProps={{ shrink: true }}
              error={Boolean(displayFormErrors.renewal_date)}
              helperText={displayFormErrors.renewal_date}
              label="Renewal Date"
              onChange={(event) => onChange("renewal_date", event.target.value)}
              required
              type="date"
              value={form.renewal_date}
            />
            <FormControl error={Boolean(displayFormErrors.billing_frequency)} required>
              <InputLabel id="software-billing-frequency-label">Billing Frequency</InputLabel>
              <Select
                label="Billing Frequency"
                labelId="software-billing-frequency-label"
                onChange={(event) => onChange("billing_frequency", event.target.value)}
                value={form.billing_frequency}
              >
                <MenuItem value="">Unspecified</MenuItem>
                {BILLING_FREQUENCY_OPTIONS.map((frequency) => (
                  <MenuItem key={frequency} value={frequency}>
                    {frequency}
                  </MenuItem>
                ))}
              </Select>
              {displayFormErrors.billing_frequency ? (
                <Typography color="error" sx={{ ml: 1.75, mt: 0.5 }} variant="caption">
                  {displayFormErrors.billing_frequency}
                </Typography>
              ) : null}
            </FormControl>
            <TextField
              error={Boolean(displayFormErrors.vendor_rep)}
              helperText={displayFormErrors.vendor_rep}
              label="Vendor"
              onChange={(event) => onChange("vendor_rep", event.target.value)}
              required
              value={form.vendor_rep}
            />
            <TextField
              label="Subscribed Since"
              onChange={(event) => onChange("subscribed_since", event.target.value)}
              value={form.subscribed_since}
            />
            <TextField
              error={Boolean(displayFormErrors.current_monthly_cost)}
              helperText={
                displayFormErrors.current_monthly_cost ||
                (annualizedMonthlyCost === null
                  ? "Monthly billing amount. Annualized cost will be calculated."
                  : `Annualized cost: ${formatCurrency(annualizedMonthlyCost)}`)
              }
              inputProps={{ min: 0, step: "0.01" }}
              label="Monthly Billing Cost"
              onChange={(event) => onChange("current_monthly_cost", event.target.value)}
              type="number"
              value={form.current_monthly_cost}
            />
            <TextField
              error={Boolean(displayFormErrors.cost_2026_2027)}
              helperText={displayFormErrors.cost_2026_2027 || "Annual billing amount. Leave blank when entering monthly cost."}
              inputProps={{ min: 0, step: "0.01" }}
              label="Annual Billing Cost"
              onChange={(event) => onChange("cost_2026_2027", event.target.value)}
              type="number"
              value={form.cost_2026_2027}
            />
            <TextField
              error={Boolean(displayFormErrors.cost_2024_2025)}
              helperText={displayFormErrors.cost_2024_2025}
              inputProps={{ min: 0, step: "0.01" }}
              label="2024-2025 Yearly Cost"
              onChange={(event) => onChange("cost_2024_2025", event.target.value)}
              type="number"
              value={form.cost_2024_2025}
            />
            <TextField
              error={Boolean(displayFormErrors.cost_2025_2026)}
              helperText={displayFormErrors.cost_2025_2026}
              inputProps={{ min: 0, step: "0.01" }}
              label="2025-2026 Yearly Cost"
              onChange={(event) => onChange("cost_2025_2026", event.target.value)}
              type="number"
              value={form.cost_2025_2026}
            />
          </Box>
          <TextField
            label="Description"
            multiline
            onChange={(event) => onChange("description", event.target.value)}
            rows={3}
            value={form.description}
          />
          <TextField
            label="Notes"
            multiline
            onChange={(event) => onChange("notes", event.target.value)}
            rows={3}
            value={form.notes}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={saving} onClick={onClose} variant="outlined">
          Cancel
        </Button>
        <Button disabled={saveDisabled} onClick={onSubmit} variant="contained">
          {saving ? "Saving" : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function SoftwareInventory() {
  const isMountedRef = useRef(true);
  const [subscriptions, setSubscriptions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState(ALL_FILTER_VALUE);
  const [categoryFilter, setCategoryFilter] = useState(ALL_FILTER_VALUE);
  const [departmentFilter, setDepartmentFilter] = useState(ALL_FILTER_VALUE);
  const [billingFrequencyFilter, setBillingFrequencyFilter] = useState(ALL_FILTER_VALUE);
  const [renewalFilter, setRenewalFilter] = useState(ALL_FILTER_VALUE);
  const [quickFilter, setQuickFilter] = useState(ALL_FILTER_VALUE);
  const [sortKey, setSortKey] = useState(DEFAULT_SORT_KEY);
  const [sortDirection, setSortDirection] = useState(DEFAULT_SORT_DIRECTION);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(ROWS_PER_PAGE_OPTIONS[1]);
  const [selectedSubscription, setSelectedSubscription] = useState(null);
  const [formDialogMode, setFormDialogMode] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteError, setDeleteError] = useState("");
  const [deleteSuccessMessage, setDeleteSuccessMessage] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchSubscriptions = useCallback(async ({ silent = false } = {}) => {
    if (!isMountedRef.current) return;

    if (silent) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError("");

    try {
      const response = await axios.get(API_URL, { headers: getAuthHeaders() });
      if (!isMountedRef.current) return;

      setSubscriptions(response.data?.data || []);
    } catch (fetchError) {
      if (handleUnauthorized(fetchError)) {
        return;
      }

      if (!isMountedRef.current) return;
      setError(getApiErrorMessage(fetchError, "Unable to load software subscriptions."));
    } finally {
      if (!isMountedRef.current) return;
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    fetchSubscriptions();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchSubscriptions]);

  const categoryOptions = useMemo(
    () =>
      Array.from(new Set(subscriptions.map((row) => row.category).filter(Boolean))).sort(),
    [subscriptions]
  );
  const departmentOptions = useMemo(
    () =>
      Array.from(new Set(subscriptions.map((row) => row.department).filter(Boolean))).sort(),
    [subscriptions]
  );
  const billingFrequencyOptions = useMemo(
    () =>
      Array.from(
        new Set(
          [...BILLING_FREQUENCY_OPTIONS, ...subscriptions.map((row) => row.billing_frequency)]
            .filter(Boolean)
        )
      ).sort(),
    [subscriptions]
  );
  const renewalOptions = useMemo(
    () =>
      Array.from(new Set(subscriptions.map((row) => row.renewal_time_frame).filter(Boolean))).sort(),
    [subscriptions]
  );

  const visibleRows = useMemo(() => {
    const normalizedQuery = normalize(query);

    return subscriptions.filter((row) => {
      const matchesStatus = statusFilter === ALL_FILTER_VALUE || row.status === statusFilter;
      const matchesCategory =
        categoryFilter === ALL_FILTER_VALUE || row.category === categoryFilter;
      const matchesDepartment =
        departmentFilter === ALL_FILTER_VALUE || row.department === departmentFilter;
      const matchesBillingFrequency =
        billingFrequencyFilter === ALL_FILTER_VALUE ||
        row.billing_frequency === billingFrequencyFilter;
      const matchesRenewal =
        renewalFilter === ALL_FILTER_VALUE || row.renewal_time_frame === renewalFilter;
      const matchesQuickFilter =
        quickFilter === ALL_FILTER_VALUE ||
        (quickFilter === "missing_renewal_date" && !row.renewal_date) ||
        (quickFilter === "missing_cost" && getCurrentAnnualCost(row) === null) ||
        (quickFilter === "missing_owner" && !row.point_of_contact) ||
        (quickFilter === "missing_department" && !row.department) ||
        (quickFilter === "missing_vendor" && !row.vendor_rep);
      const searchableValues = [
        row.name,
        row.vendor_rep,
        row.category,
        row.department,
        row.notes,
      ];
      const matchesQuery =
        !normalizedQuery ||
        searchableValues.some((value) => normalize(value).includes(normalizedQuery));

      return (
        matchesStatus &&
        matchesCategory &&
        matchesDepartment &&
        matchesBillingFrequency &&
        matchesRenewal &&
        matchesQuickFilter &&
        matchesQuery
      );
    });
  }, [
    billingFrequencyFilter,
    categoryFilter,
    departmentFilter,
    query,
    quickFilter,
    renewalFilter,
    statusFilter,
    subscriptions,
  ]);

  const sortedRows = useMemo(
    () => sortRows(visibleRows, sortKey, sortDirection),
    [sortDirection, sortKey, visibleRows]
  );

  const paginatedRows = useMemo(
    () => sortedRows.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage),
    [page, rowsPerPage, sortedRows]
  );

  useEffect(() => {
    setPage(0);
  }, [
    billingFrequencyFilter,
    categoryFilter,
    departmentFilter,
    query,
    quickFilter,
    renewalFilter,
    statusFilter,
  ]);

  useEffect(() => {
    const lastPage = Math.max(0, Math.ceil(sortedRows.length / rowsPerPage) - 1);
    setPage((currentPage) => Math.min(currentPage, lastPage));
  }, [rowsPerPage, sortedRows.length]);

  const activeCount = subscriptions.filter((row) => row.status === "Active").length;
  const upcomingRenewalCount = subscriptions.filter(isUpcomingRenewal).length;
  const missingVendorOrContactCount = subscriptions.filter(
    (row) => !row.vendor_rep || !row.point_of_contact
  ).length;
  const hasActiveFilters =
    Boolean(query.trim()) ||
    statusFilter !== ALL_FILTER_VALUE ||
    categoryFilter !== ALL_FILTER_VALUE ||
    departmentFilter !== ALL_FILTER_VALUE ||
    billingFrequencyFilter !== ALL_FILTER_VALUE ||
    renewalFilter !== ALL_FILTER_VALUE ||
    quickFilter !== ALL_FILTER_VALUE;
  const hasSubscriptions = subscriptions.length > 0;

  function openCreateDialog() {
    setSelectedSubscription(null);
    setForm(EMPTY_FORM);
    setFormErrors({});
    setFormError("");
    setFormDialogMode("create");
  }

  function openEditDialog(row) {
    setForm(toFormState(row));
    setFormErrors({});
    setFormError("");
    setFormDialogMode("edit");
  }

  function closeFormDialog() {
    if (isSaving) return;
    setFormDialogMode(null);
    setFormErrors({});
    setFormError("");
  }

  function updateFormField(field, value) {
    if (COST_FIELD_KEYS.includes(field) && String(value).includes("-")) {
      return;
    }

    setForm((current) => ({ ...current, [field]: value }));
    setFormErrors((current) => {
      const next = { ...current, [field]: "" };
      if (field === "current_monthly_cost") {
        next.cost_2026_2027 = "";
      }
      if (field === "cost_2026_2027") {
        next.current_monthly_cost = "";
      }
      return next;
    });
  }

  function clearFilters() {
    setQuery("");
    setStatusFilter(ALL_FILTER_VALUE);
    setCategoryFilter(ALL_FILTER_VALUE);
    setDepartmentFilter(ALL_FILTER_VALUE);
    setBillingFrequencyFilter(ALL_FILTER_VALUE);
    setRenewalFilter(ALL_FILTER_VALUE);
    setQuickFilter(ALL_FILTER_VALUE);
  }

  function handleSort(columnKey) {
    setSortKey((currentKey) => {
      if (currentKey === columnKey) {
        setSortDirection((currentDirection) =>
          currentDirection === "asc" ? "desc" : "asc"
        );
        return currentKey;
      }

      setSortDirection(DEFAULT_SORT_DIRECTION);
      return columnKey;
    });
    setPage(0);
  }

  function exportInventoryCsv() {
    const csvRows = [
      CSV_EXPORT_COLUMNS.map((column) => column.header),
      ...sortedRows.map((row) =>
        CSV_EXPORT_COLUMNS.map((column) => column.getValue(row))
      ),
    ];

    downloadCsv(`software-inventory-export-${getExportDateStamp()}.csv`, csvRows);
  }

  async function saveSubscription() {
    const nextErrors = validateForm(form);
    setFormErrors(nextErrors);
    setFormError("");

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setIsSaving(true);
    try {
      const payload = toRequestPayload(form);
      const response =
        formDialogMode === "edit" && selectedSubscription
          ? await axios.put(`${API_URL}/${selectedSubscription.id}`, payload, {
              headers: getAuthHeaders(),
            })
          : await axios.post(API_URL, payload, { headers: getAuthHeaders() });

      const savedSubscription = response.data;
      setSubscriptions((current) => {
        if (formDialogMode === "edit") {
          return current.map((row) =>
            row.id === savedSubscription.id ? savedSubscription : row
          );
        }
        return [...current, savedSubscription].sort((a, b) =>
          a.name.localeCompare(b.name)
        );
      });
      setSelectedSubscription(savedSubscription);
      setFormDialogMode(null);
    } catch (saveError) {
      if (handleUnauthorized(saveError)) {
        return;
      }
      setFormError(getApiErrorMessage(saveError, "Unable to save subscription."));
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteSubscription() {
    if (!deleteTarget) return;

    const deletedName = deleteTarget.name;
    setDeleteError("");
    setIsDeleting(true);
    try {
      await axios.delete(`${API_URL}/${deleteTarget.id}`, { headers: getAuthHeaders() });
      setSubscriptions((current) => current.filter((row) => row.id !== deleteTarget.id));
      if (selectedSubscription?.id === deleteTarget.id) {
        setSelectedSubscription(null);
      }
      setDeleteTarget(null);
      setDeleteSuccessMessage(`${deletedName} was deleted.`);
    } catch (deleteError) {
      if (handleUnauthorized(deleteError)) {
        return;
      }
      setDeleteError(getApiErrorMessage(deleteError, "Unable to delete subscription."));
    } finally {
      setIsDeleting(false);
    }
  }

  if (isLoading) {
    return (
      <Stack alignItems="center" spacing={2} sx={{ py: 8 }}>
        <CircularProgress />
        <Typography color="text.secondary">Loading software subscriptions...</Typography>
      </Stack>
    );
  }

  if (error && !hasSubscriptions) {
    return (
      <Stack spacing={2.5}>
        <Alert severity="error">
          {error}
        </Alert>
        <EmptyState
          actionLabel="Retry"
          description="The software inventory could not be loaded. Check your connection and try again."
          icon="refresh"
          onAction={() => fetchSubscriptions()}
          title="Unable to load software inventory"
        />
      </Stack>
    );
  }

  return (
    <Stack spacing={2.5}>
      {error ? <Alert severity="error">{error}</Alert> : null}

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
        <SummaryCard
          helper="Subscriptions marked Active"
          label="Total Active Subscriptions"
          value={activeCount.toLocaleString()}
        />
        <SummaryCard
          helper="Across current subscriptions"
          label="Total Monthly Cost"
          value={formatCurrency(getCurrentMonthlyCostTotal(subscriptions))}
        />
        <SummaryCard
          helper="Pending renewal or due within 90 days"
          label="Upcoming Renewals"
          value={upcomingRenewalCount.toLocaleString()}
        />
        <SummaryCard
          helper="Missing vendor rep or point of contact"
          label="Missing Vendor / Contact"
          value={missingVendorOrContactCount.toLocaleString()}
        />
      </Box>

      <Paper
        elevation={0}
        sx={{
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <Stack
          alignItems={{ xs: "stretch", lg: "center" }}
          direction={{ xs: "column", lg: "row" }}
          justifyContent="space-between"
          spacing={2}
          sx={{ borderBottom: "1px solid", borderColor: "divider", p: 2 }}
        >
          <Box>
            <Stack alignItems="center" direction="row" spacing={1}>
              <Typography color="text.primary" fontWeight={800}>
                Subscription Inventory
              </Typography>
              {isRefreshing ? <CircularProgress size={16} /> : null}
            </Stack>
            <Typography color="text.secondary" variant="body2">
              {isRefreshing
                ? "Updating subscription records in the background."
                : "Track ownership, access, cost history, renewals, vendor contacts, and notes."}
            </Typography>
          </Box>
          <Stack
            alignItems={{ xs: "stretch", md: "center" }}
            direction={{ xs: "column", md: "row" }}
            flexWrap="wrap"
            gap={1.25}
          >
            <TextField
              label="Search"
              onChange={(event) => setQuery(event.target.value)}
              size="small"
              sx={{ minWidth: { xs: "100%", md: 240 } }}
              value={query}
            />
            <FormControl size="small" sx={{ minWidth: { xs: "100%", md: 160 } }}>
              <InputLabel id="software-status-filter-label">Status</InputLabel>
              <Select
                label="Status"
                labelId="software-status-filter-label"
                onChange={(event) => setStatusFilter(event.target.value)}
                value={statusFilter}
              >
                <MenuItem value={ALL_FILTER_VALUE}>All Statuses</MenuItem>
                {STATUS_OPTIONS.map((status) => (
                  <MenuItem key={status} value={status}>
                    {status}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: { xs: "100%", md: 170 } }}>
              <InputLabel id="software-category-filter-label">Category</InputLabel>
              <Select
                label="Category"
                labelId="software-category-filter-label"
                onChange={(event) => setCategoryFilter(event.target.value)}
                value={categoryFilter}
              >
                <MenuItem value={ALL_FILTER_VALUE}>All Categories</MenuItem>
                {categoryOptions.map((category) => (
                  <MenuItem key={category} value={category}>
                    {category}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: { xs: "100%", md: 170 } }}>
              <InputLabel id="software-department-filter-label">Department</InputLabel>
              <Select
                label="Department"
                labelId="software-department-filter-label"
                onChange={(event) => setDepartmentFilter(event.target.value)}
                value={departmentFilter}
              >
                <MenuItem value={ALL_FILTER_VALUE}>All Departments</MenuItem>
                {departmentOptions.map((department) => (
                  <MenuItem key={department} value={department}>
                    {department}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: { xs: "100%", md: 170 } }}>
              <InputLabel id="software-billing-filter-label">Billing</InputLabel>
              <Select
                label="Billing"
                labelId="software-billing-filter-label"
                onChange={(event) => setBillingFrequencyFilter(event.target.value)}
                value={billingFrequencyFilter}
              >
                <MenuItem value={ALL_FILTER_VALUE}>All Billing</MenuItem>
                {billingFrequencyOptions.map((frequency) => (
                  <MenuItem key={frequency} value={frequency}>
                    {frequency}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: { xs: "100%", md: 190 } }}>
              <InputLabel id="software-renewal-filter-label">Renewal Time Frame</InputLabel>
              <Select
                label="Renewal Time Frame"
                labelId="software-renewal-filter-label"
                onChange={(event) => setRenewalFilter(event.target.value)}
                value={renewalFilter}
              >
                <MenuItem value={ALL_FILTER_VALUE}>All Renewals</MenuItem>
                {renewalOptions.map((renewal) => (
                  <MenuItem key={renewal} value={renewal}>
                    {renewal}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: { xs: "100%", md: 190 } }}>
              <InputLabel id="software-quick-filter-label">Missing Info</InputLabel>
              <Select
                label="Missing Info"
                labelId="software-quick-filter-label"
                onChange={(event) => setQuickFilter(event.target.value)}
                value={quickFilter}
              >
                <MenuItem value={ALL_FILTER_VALUE}>All Records</MenuItem>
                {QUICK_FILTER_OPTIONS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Button disabled={isRefreshing} onClick={() => fetchSubscriptions({ silent: true })} variant="outlined">
              {isRefreshing ? "Refreshing" : "Refresh"}
            </Button>
            {hasActiveFilters ? (
              <Button onClick={clearFilters} variant="outlined">
                Clear Filters
              </Button>
            ) : null}
            <Button disabled={sortedRows.length === 0} onClick={exportInventoryCsv} variant="outlined">
              Export CSV
            </Button>
            <Button onClick={openCreateDialog} variant="contained">
              Add Subscription
            </Button>
          </Stack>
        </Stack>

        {!hasSubscriptions ? (
          <EmptyState
            actionLabel="Add Subscription"
            description="Create the first software subscription to start tracking ownership, billing, and renewals."
            icon="inbox"
            onAction={openCreateDialog}
            title="No software subscriptions yet"
          />
        ) : sortedRows.length === 0 ? (
          <EmptyState
            actionLabel={hasActiveFilters ? "Clear Filters" : undefined}
            description="No software subscriptions match the current search, filters, or missing-info quick filter."
            icon="search"
            onAction={hasActiveFilters ? clearFilters : undefined}
            title="No matching subscriptions"
          />
        ) : (
          <>
            <TableContainer sx={{ overflowX: "auto" }}>
              <Table stickyHeader sx={{ minWidth: 2300 }}>
                <TableHead>
                  <TableRow>
                    {columns.map((column) => (
                      <TableCell
                        align={column.align || "left"}
                        key={column.key}
                        sx={{
                          ...subtleTableHeadCellSx,
                          minWidth: column.minWidth,
                          top: 0,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {column.sortable ? (
                          <TableSortLabel
                            active={sortKey === column.key}
                            direction={sortKey === column.key ? sortDirection : DEFAULT_SORT_DIRECTION}
                            onClick={() => handleSort(column.key)}
                            sx={{
                              "& .MuiTableSortLabel-icon": { color: "primary.main !important" },
                            }}
                          >
                            {column.label}
                          </TableSortLabel>
                        ) : (
                          column.label
                        )}
                      </TableCell>
                    ))}
                    <TableCell sx={{ ...subtleTableHeadCellSx, minWidth: 220, top: 0 }}>
                      Actions
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {paginatedRows.map((row) => (
                    <TableRow
                      hover
                      key={row.id}
                      onClick={() => setSelectedSubscription(row)}
                      sx={{ cursor: "pointer", ...getRenewalRowSx(row) }}
                    >
                      {columns.map((column) => (
                        <TableCell
                          align={column.align || "left"}
                          key={column.key}
                          sx={{
                            minWidth: column.minWidth,
                            verticalAlign: "top",
                            whiteSpace: column.key.startsWith("cost") ? "nowrap" : "normal",
                          }}
                        >
                          {column.key === "status" ? (
                            <StatusChip status={row.status} />
                          ) : column.key === "renewal_risk" ? (
                            <RenewalRiskChip row={row} />
                          ) : column.key === "current_monthly_cost" ? (
                            <Typography color="text.primary" variant="body2">
                              {formatCurrency(getCurrentMonthlyCost(row))}
                            </Typography>
                          ) : column.key === "cost_2026_2027" ? (
                            <Typography color="text.primary" variant="body2">
                              {formatCurrency(getCurrentAnnualCost(row))}
                            </Typography>
                          ) : column.key === "renewal_date" ? (
                            <Typography
                              color={row.renewal_date ? "text.primary" : "text.disabled"}
                              variant="body2"
                            >
                              {formatDate(row.renewal_date)}
                            </Typography>
                          ) : (
                            <Typography
                              color={row[column.key] ? "text.primary" : "text.disabled"}
                              variant="body2"
                            >
                              {row[column.key] || "-"}
                            </Typography>
                          )}
                        </TableCell>
                      ))}
                      <TableCell
                        onClick={(event) => event.stopPropagation()}
                        sx={{ minWidth: 220, verticalAlign: "top" }}
                      >
                        <Stack direction="row" spacing={0.75}>
                          <Button size="small" onClick={() => setSelectedSubscription(row)} variant="outlined">
                            View
                          </Button>
                          <Button
                            size="small"
                            onClick={() => {
                              setDeleteError("");
                              setDeleteTarget(row);
                            }}
                            color="error"
                            variant="outlined"
                          >
                            Delete
                          </Button>
                          <Button
                            size="small"
                            onClick={() => {
                              setSelectedSubscription(row);
                              openEditDialog(row);
                            }}
                            variant="outlined"
                          >
                            Edit
                          </Button>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            <TablePagination
              component="div"
              count={sortedRows.length}
              onPageChange={(_event, nextPage) => setPage(nextPage)}
              onRowsPerPageChange={(event) => {
                setRowsPerPage(Number(event.target.value));
                setPage(0);
              }}
              page={page}
              rowsPerPage={rowsPerPage}
              rowsPerPageOptions={ROWS_PER_PAGE_OPTIONS}
            />
          </>
        )}
      </Paper>

      <Drawer
        anchor="right"
        onClose={() => setSelectedSubscription(null)}
        open={Boolean(selectedSubscription)}
        PaperProps={{
          sx: { maxWidth: "100%", width: { xs: "100%", sm: 520 } },
        }}
      >
        {selectedSubscription ? (
          <Stack sx={{ height: "100%" }}>
            <Stack
              alignItems="flex-start"
              direction="row"
              justifyContent="space-between"
              spacing={2}
              sx={{ borderBottom: "1px solid", borderColor: "divider", p: 3 }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography color="text.primary" component="h3" variant="h5">
                  {selectedSubscription.name}
                </Typography>
                <Box sx={{ mt: 1 }}>
                  <Stack direction="row" flexWrap="wrap" gap={1}>
                    <StatusChip status={selectedSubscription.status} />
                    <RenewalRiskChip row={selectedSubscription} />
                  </Stack>
                </Box>
              </Box>
              <IconButton aria-label="Close details" onClick={() => setSelectedSubscription(null)}>
                <AppIcon name="close" />
              </IconButton>
            </Stack>
            <Stack spacing={2} sx={{ flex: 1, overflowY: "auto", p: 3 }}>
              {detailFields.map(([label, key, format]) => (
                <Box key={key}>
                  <Typography color="text.secondary" variant="overline">
                    {label}
                  </Typography>
                  {format === "long_text" ? (
                    <Box
                      sx={{
                        bgcolor: "action.hover",
                        border: "1px solid",
                        borderColor: "divider",
                        borderRadius: 1,
                        mt: 0.5,
                        p: 1.5,
                      }}
                    >
                      <Typography
                        color={selectedSubscription[key] ? "text.primary" : "text.disabled"}
                        sx={{ lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                        variant="body2"
                      >
                        {selectedSubscription[key] || "-"}
                      </Typography>
                    </Box>
                  ) : (
                    <Typography color="text.primary" sx={{ whiteSpace: "pre-wrap" }} variant="body2">
                      {getDetailFieldValue(selectedSubscription, key, format)}
                    </Typography>
                  )}
                </Box>
              ))}
            </Stack>
            <Stack direction="row" spacing={1} sx={{ borderTop: "1px solid", borderColor: "divider", p: 2 }}>
              <Button fullWidth onClick={() => openEditDialog(selectedSubscription)} variant="contained">
                Edit
              </Button>
              <Button
                color="error"
                fullWidth
                onClick={() => {
                  setDeleteError("");
                  setDeleteTarget(selectedSubscription);
                }}
                variant="outlined"
              >
                Delete
              </Button>
            </Stack>
          </Stack>
        ) : null}
      </Drawer>

      <SubscriptionFormDialog
        error={formError}
        form={form}
        formErrors={formErrors}
        mode={formDialogMode}
        onChange={updateFormField}
        onClose={closeFormDialog}
        onSubmit={saveSubscription}
        open={Boolean(formDialogMode)}
        saving={isSaving}
      />

      <Dialog
        fullWidth
        maxWidth="xs"
        onClose={
          isDeleting
            ? undefined
            : () => {
                setDeleteError("");
                setDeleteTarget(null);
              }
        }
        open={Boolean(deleteTarget)}
      >
        <DialogTitle>Delete Subscription</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            {deleteError ? <Alert severity="error">{deleteError}</Alert> : null}
            <Typography color="text.primary" fontWeight={800}>
              {deleteTarget?.name || "Selected subscription"}
            </Typography>
            <Typography color="text.secondary" variant="body2">
              This will permanently delete the software subscription record from the inventory.
            </Typography>
            <Alert severity="warning">
              This action cannot be undone.
            </Alert>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            disabled={isDeleting}
            onClick={() => {
              setDeleteError("");
              setDeleteTarget(null);
            }}
            variant="outlined"
          >
            Cancel
          </Button>
          <Button color="error" disabled={isDeleting} onClick={deleteSubscription} variant="contained">
            {isDeleting ? "Deleting" : "Delete Subscription"}
          </Button>
        </DialogActions>
      </Dialog>
      <Snackbar
        autoHideDuration={4000}
        onClose={() => setDeleteSuccessMessage("")}
        open={Boolean(deleteSuccessMessage)}
      >
        <Alert
          onClose={() => setDeleteSuccessMessage("")}
          severity="success"
          sx={{ width: "100%" }}
        >
          {deleteSuccessMessage}
        </Alert>
      </Snackbar>
    </Stack>
  );
}
