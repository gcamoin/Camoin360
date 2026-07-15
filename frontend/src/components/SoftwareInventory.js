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
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";

import { API_BASE_URL, getApiErrorMessage, getAuthHeaders, handleUnauthorized } from "../auth";
import { AppIcon, subtleTableHeadCellSx } from "./UiPrimitives";

const API_URL = `${API_BASE_URL}/software-subscriptions`;
const ALL_FILTER_VALUE = "all";
const STATUS_OPTIONS = ["Active", "Pending Renewal", "Needs Review", "Cancelled"];
const EMPTY_FORM = {
  name: "",
  description: "",
  point_of_contact: "",
  assigned_users: "",
  current_monthly_cost: "",
  original_cost_2026_2027: "",
  cost_2024_2025: "",
  cost_2025_2026: "",
  cost_2026_2027: "",
  renewal_time_frame: "",
  vendor_rep: "",
  subscribed_since: "",
  status: "Active",
  notes: "",
};

const columns = [
  { key: "name", label: "Software / Data Subscription Name", minWidth: 240 },
  { key: "description", label: "Description", minWidth: 300 },
  { key: "point_of_contact", label: "Camoin Point of Contact", minWidth: 190 },
  { key: "assigned_users", label: "Access / Assigned Users", minWidth: 230 },
  { key: "current_monthly_cost", label: "Current Monthly Cost", align: "right", minWidth: 180 },
  { key: "renewal_time_frame", label: "Renewal Time Frame", minWidth: 180 },
  { key: "vendor_rep", label: "Vendor Rep", minWidth: 190 },
  { key: "subscribed_since", label: "Subscribed Since", minWidth: 150 },
  { key: "status", label: "Status", minWidth: 140 },
  { key: "notes", label: "Notes", minWidth: 300 },
];

const detailFields = [
  ["Description", "description"],
  ["Camoin Point of Contact", "point_of_contact"],
  ["Access / Assigned Users", "assigned_users"],
  ["Current Monthly Cost", "current_monthly_cost", "currency"],
  ["2024-2025 Yearly Cost", "cost_2024_2025", "currency"],
  ["2025-2026 Yearly Cost", "cost_2025_2026", "currency"],
  ["2026-2027 Yearly Cost", "cost_2026_2027", "currency"],
  ["Renewal Time Frame", "renewal_time_frame"],
  ["Vendor Rep", "vendor_rep"],
  ["Subscribed Since", "subscribed_since"],
  ["Status", "status"],
  ["Notes", "notes"],
];

const requiredFields = {
  name: "Subscription name is required.",
  point_of_contact: "Point of contact is required.",
  renewal_time_frame: "Renewal time frame is required.",
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

function toFormState(row) {
  if (!row) {
    return EMPTY_FORM;
  }

  return {
    name: row.name || "",
    description: row.description || "",
    point_of_contact: row.point_of_contact || "",
    assigned_users: row.assigned_users || "",
    current_monthly_cost:
      getCurrentMonthlyCost(row) === null ? "" : String(getCurrentMonthlyCost(row)),
    original_cost_2026_2027: row.cost_2026_2027 ?? "",
    cost_2024_2025: row.cost_2024_2025 ?? "",
    cost_2025_2026: row.cost_2025_2026 ?? "",
    cost_2026_2027: "",
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
  const currentMonthlyCost =
    currentMonthlyCostInput === "" ? null : Number(currentMonthlyCostInput);
  const originalMonthlyCost =
    originalCurrentYearlyCost === ""
      ? null
      : String(roundCurrencyValue(Number(originalCurrentYearlyCost) / 12));
  const currentYearlyCost =
    form.cost_2026_2027 === ""
      ? currentMonthlyCost === null
        ? null
        : currentMonthlyCostInput === originalMonthlyCost
          ? Number(originalCurrentYearlyCost)
          : roundCurrencyValue(currentMonthlyCost * 12)
      : Number(form.cost_2026_2027);

  return {
    ...payload,
    cost_2024_2025: form.cost_2024_2025 === "" ? null : Number(form.cost_2024_2025),
    cost_2025_2026: form.cost_2025_2026 === "" ? null : Number(form.cost_2025_2026),
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

  for (const field of ["current_monthly_cost", "cost_2024_2025", "cost_2025_2026", "cost_2026_2027"]) {
    if (form[field] !== "" && Number(form[field]) < 0) {
      errors[field] = "Cost must be zero or greater.";
    }
  }

  if (form.current_monthly_cost !== "" && form.cost_2026_2027 !== "") {
    errors.current_monthly_cost = "Enter either monthly or yearly current cost.";
    errors.cost_2026_2027 = "Enter either yearly or monthly current cost.";
  }

  return errors;
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
              error={Boolean(formErrors.name)}
              helperText={formErrors.name}
              label="Software / Data Subscription Name"
              onChange={(event) => onChange("name", event.target.value)}
              required
              value={form.name}
            />
            <TextField
              error={Boolean(formErrors.point_of_contact)}
              helperText={formErrors.point_of_contact}
              label="Camoin Point of Contact"
              onChange={(event) => onChange("point_of_contact", event.target.value)}
              required
              value={form.point_of_contact}
            />
            <TextField
              label="Access / Assigned Users"
              onChange={(event) => onChange("assigned_users", event.target.value)}
              value={form.assigned_users}
            />
            <FormControl error={Boolean(formErrors.status)} required>
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
              {formErrors.status ? (
                <Typography color="error" sx={{ ml: 1.75, mt: 0.5 }} variant="caption">
                  {formErrors.status}
                </Typography>
              ) : null}
            </FormControl>
            <TextField
              error={Boolean(formErrors.renewal_time_frame)}
              helperText={formErrors.renewal_time_frame}
              label="Renewal Time Frame"
              onChange={(event) => onChange("renewal_time_frame", event.target.value)}
              required
              value={form.renewal_time_frame}
            />
            <TextField
              label="Vendor Rep"
              onChange={(event) => onChange("vendor_rep", event.target.value)}
              value={form.vendor_rep}
            />
            <TextField
              label="Subscribed Since"
              onChange={(event) => onChange("subscribed_since", event.target.value)}
              value={form.subscribed_since}
            />
            <TextField
              error={Boolean(formErrors.current_monthly_cost)}
              helperText={formErrors.current_monthly_cost || "Enter this or current yearly cost."}
              label="Current Monthly Cost"
              onChange={(event) => onChange("current_monthly_cost", event.target.value)}
              type="number"
              value={form.current_monthly_cost}
            />
            <TextField
              error={Boolean(formErrors.cost_2026_2027)}
              helperText={formErrors.cost_2026_2027 || "Used to calculate monthly cost when monthly is blank."}
              label="Current Yearly Cost"
              onChange={(event) => onChange("cost_2026_2027", event.target.value)}
              type="number"
              value={form.cost_2026_2027}
            />
            <TextField
              error={Boolean(formErrors.cost_2024_2025)}
              helperText={formErrors.cost_2024_2025}
              label="2024-2025 Yearly Cost"
              onChange={(event) => onChange("cost_2024_2025", event.target.value)}
              type="number"
              value={form.cost_2024_2025}
            />
            <TextField
              error={Boolean(formErrors.cost_2025_2026)}
              helperText={formErrors.cost_2025_2026}
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
        <Button disabled={saving} onClick={onSubmit} variant="contained">
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
  const [contactFilter, setContactFilter] = useState(ALL_FILTER_VALUE);
  const [renewalFilter, setRenewalFilter] = useState(ALL_FILTER_VALUE);
  const [selectedSubscription, setSelectedSubscription] = useState(null);
  const [formDialogMode, setFormDialogMode] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
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

  const contactOptions = useMemo(
    () =>
      Array.from(new Set(subscriptions.map((row) => row.point_of_contact).filter(Boolean))).sort(),
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
      const matchesContact =
        contactFilter === ALL_FILTER_VALUE || row.point_of_contact === contactFilter;
      const matchesRenewal =
        renewalFilter === ALL_FILTER_VALUE || row.renewal_time_frame === renewalFilter;
      const searchableValues = [row.name, row.description, row.vendor_rep, row.notes];
      const matchesQuery =
        !normalizedQuery ||
        searchableValues.some((value) => normalize(value).includes(normalizedQuery));

      return matchesStatus && matchesContact && matchesRenewal && matchesQuery;
    });
  }, [contactFilter, query, renewalFilter, statusFilter, subscriptions]);

  const activeCount = subscriptions.filter((row) => row.status === "Active").length;
  const upcomingRenewalCount = subscriptions.filter(isUpcomingRenewal).length;
  const missingVendorOrContactCount = subscriptions.filter(
    (row) => !row.vendor_rep || !row.point_of_contact
  ).length;

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

    setIsDeleting(true);
    try {
      await axios.delete(`${API_URL}/${deleteTarget.id}`, { headers: getAuthHeaders() });
      setSubscriptions((current) => current.filter((row) => row.id !== deleteTarget.id));
      if (selectedSubscription?.id === deleteTarget.id) {
        setSelectedSubscription(null);
      }
      setDeleteTarget(null);
    } catch (deleteError) {
      if (handleUnauthorized(deleteError)) {
        return;
      }
      setError(getApiErrorMessage(deleteError, "Unable to delete subscription."));
    } finally {
      setIsDeleting(false);
    }
  }

  if (isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
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
            <Typography color="text.primary" fontWeight={800}>
              Subscription Inventory
            </Typography>
            <Typography color="text.secondary" variant="body2">
              Track ownership, access, cost history, renewals, vendor contacts, and notes.
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
            <FormControl size="small" sx={{ minWidth: { xs: "100%", md: 190 } }}>
              <InputLabel id="software-contact-filter-label">Point of Contact</InputLabel>
              <Select
                label="Point of Contact"
                labelId="software-contact-filter-label"
                onChange={(event) => setContactFilter(event.target.value)}
                value={contactFilter}
              >
                <MenuItem value={ALL_FILTER_VALUE}>All Contacts</MenuItem>
                {contactOptions.map((contact) => (
                  <MenuItem key={contact} value={contact}>
                    {contact}
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
            <Button disabled={isRefreshing} onClick={() => fetchSubscriptions({ silent: true })} variant="outlined">
              {isRefreshing ? "Refreshing" : "Refresh"}
            </Button>
            <Button onClick={openCreateDialog} variant="contained">
              Add Subscription
            </Button>
          </Stack>
        </Stack>

        <TableContainer sx={{ overflowX: "auto" }}>
          <Table stickyHeader sx={{ minWidth: 1800 }}>
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
                    {column.label}
                  </TableCell>
                ))}
                <TableCell sx={{ ...subtleTableHeadCellSx, minWidth: 140, top: 0 }}>
                  Actions
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visibleRows.map((row) => (
                <TableRow
                  hover
                  key={row.id}
                  onClick={() => setSelectedSubscription(row)}
                  sx={{ cursor: "pointer" }}
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
                      ) : column.key === "current_monthly_cost" ? (
                        <Typography color="text.primary" variant="body2">
                          {formatCurrency(getCurrentMonthlyCost(row))}
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
                    sx={{ minWidth: 140, verticalAlign: "top" }}
                  >
                    <Stack direction="row" spacing={0.75}>
                      <Button size="small" onClick={() => setSelectedSubscription(row)} variant="outlined">
                        View
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

        {visibleRows.length === 0 ? (
          <Box sx={{ px: 3, py: 5, textAlign: "center" }}>
            <Typography color="text.primary" fontWeight={800}>
              No subscriptions match the current filters.
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5 }} variant="body2">
              Adjust the search, status, contact, or renewal filter.
            </Typography>
          </Box>
        ) : null}
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
                  <StatusChip status={selectedSubscription.status} />
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
                  <Typography color="text.primary" sx={{ whiteSpace: "pre-wrap" }} variant="body2">
                    {format === "currency"
                      ? formatCurrency(
                          key === "current_monthly_cost"
                            ? getCurrentMonthlyCost(selectedSubscription)
                            : selectedSubscription[key]
                        )
                      : selectedSubscription[key] || "-"}
                  </Typography>
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
                onClick={() => setDeleteTarget(selectedSubscription)}
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
        onClose={isDeleting ? undefined : () => setDeleteTarget(null)}
        open={Boolean(deleteTarget)}
      >
        <DialogTitle>Delete Subscription</DialogTitle>
        <DialogContent dividers>
          <Typography color="text.secondary" variant="body2">
            Delete {deleteTarget?.name}? This removes the subscription inventory record.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button disabled={isDeleting} onClick={() => setDeleteTarget(null)} variant="outlined">
            Cancel
          </Button>
          <Button color="error" disabled={isDeleting} onClick={deleteSubscription} variant="contained">
            {isDeleting ? "Deleting" : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
