import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  Autocomplete, Box, Dialog, DialogTitle, DialogContent, DialogActions, Alert, Button, CircularProgress, MenuItem, Paper, Stack, Table, TableBody,
  TableCell, TableContainer, TableHead, TablePagination, TableRow,
  TableSortLabel, TextField, Typography,
} from "@mui/material";
import { API_BASE_URL, getApiErrorMessage, getAuthHeaders, handleUnauthorized } from "../auth";
import { ManagementSectionHeading, managementButtonSx, managementCardSx, subtleTableHeadCellSx } from "./UiPrimitives";

const columns = [
  { key: "status", label: "Service Status" },
  { key: "name", label: "Service" },
  { key: "description", label: "Service Description" },
  { key: "vendor", label: "Vendor" },
  { key: "service_type", label: "Service Type" },
  { key: "current_service_term", label: "Current Service Term" },
  { key: "primary_vendor_contact", label: "Primary Vendor Contact" },
  { key: "access_details", label: "Access Details" },
  { key: "primary_contact", label: "Camoin Primary Contact" },
  { key: "subscribed_since", label: "Subscribed Since" },
];

const statusColors = {
  success: { dot: "#278052", text: "#175b3c", background: "#edf7f1", border: "#c5e4d1" },
  warning: { dot: "#bb7419", text: "#80500f", background: "#fff6e8", border: "#f1dcba" },
  danger: { dot: "#bd4b4b", text: "#903636", background: "#fdf0f0", border: "#edcccc" },
  neutral: { dot: "#718096", text: "#455468", background: "#f4f6f8", border: "#dce2e8" },
};
const statusMarkers = [
  ["🟩", "success"], ["🟢", "success"], ["✅", "success"],
  ["🟧", "warning"], ["🟨", "warning"], ["🟠", "warning"], ["🟡", "warning"],
  ["🟥", "danger"], ["🔴", "danger"], ["❌", "danger"],
];

export function getInventoryStatusAppearance(value) {
  const raw = String(value ?? "").trim();
  const marker = statusMarkers.find(([symbol]) => raw.startsWith(symbol));
  const label = (marker ? raw.slice(marker[0].length) : raw).trim() || "Not set";
  const normalized = label.toLocaleLowerCase();
  const tone = marker?.[1]
    || (/expired|inactive|cancelled|canceled|discontinued|terminated|critical/.test(normalized) ? "danger" : null)
    || (/expiring|pending|at risk|renewal due|review|on hold|warning/.test(normalized) ? "warning" : null)
    || (/current|active|renewed|approved|good/.test(normalized) ? "success" : "neutral");
  return { label, ...statusColors[tone] };
}

const displayValue = (row, key) => key === "status"
  ? getInventoryStatusAppearance(row[key]).label
  : key === "subscribed_since" && /^\d{4}-\d{2}-\d{2}/.test(row[key])
    ? new Date(`${row[key].slice(0, 10)}T00:00:00`).toLocaleDateString()
    : String(row[key] || "");

export function filterAndSortInventory(rows, status, query, sort) {
  const search = query.toLowerCase();
  const matching = rows.filter(row =>
    (!status || row.status === status) && (!search || columns.some(column =>
      displayValue(row, column.key).toLowerCase().includes(search)
    ))
  );
  const direction = sort.direction === "asc" ? 1 : -1;
  return matching
    .map(row => ({ row, sortValue: displayValue(row, sort.key) }))
    .sort((a, b) => a.sortValue.localeCompare(b.sortValue, undefined, { numeric: true }) * direction)
    .map(({ row }) => row);
}

function InventoryStatus({ value }) {
  const status = getInventoryStatusAppearance(value);
  return <Box component="span" sx={{
    alignItems: "center", backgroundColor: status.background, border: "1px solid", borderColor: status.border,
    borderRadius: "999px", color: status.text, display: "inline-flex", fontSize: "0.78rem", fontWeight: 700,
    gap: 0.9, lineHeight: 1.35, maxWidth: "100%", px: 1.25, py: 0.7,
  }}>
    <Box aria-hidden="true" component="span" sx={{ backgroundColor: status.dot, borderRadius: "50%", flexShrink: 0, height: 8, width: 8 }} />
    <Box component="span" sx={{ overflowWrap: "anywhere" }}>{status.label}</Box>
  </Box>;
}

const INVENTORY_URL = `${API_BASE_URL}/software-subscriptions/inventory`;

function ServiceTermField({ value, label, disabled, required, onChange }) {
  const existing = typeof value === "string" ? (label || value) : "";
  const match = existing.match(/^\s*(\d+)\s*(months?|years?)\s*$/i);
  const [amount, setAmount] = useState(value?.duration ?? match?.[1] ?? "");
  const [unit, setUnit] = useState(value?.unit || (match?.[2]?.toLowerCase().startsWith("year") ? "years" : "months"));
  const invalid = amount !== "" && (!Number.isInteger(Number(amount)) || Number(amount) <= 0);
  function update(nextAmount, nextUnit) {
    setAmount(nextAmount);
    setUnit(nextUnit);
    onChange(nextAmount === "" ? null : { duration: Number(nextAmount), unit: nextUnit });
  }
  return <Stack spacing={1}>
    <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
      <TextField fullWidth label="Service Term" type="number" value={amount} disabled={disabled} required={required}
        error={invalid} helperText={invalid ? "Enter a positive whole number" : undefined}
        slotProps={{ htmlInput: { min: 1, step: 1 } }} onChange={event => update(event.target.value, unit)} />
      <TextField select label="Term Unit" value={unit} disabled={disabled} sx={{ minWidth: 160 }}
        onChange={event => update(amount, event.target.value)}>
        <MenuItem value="months">Months</MenuItem>
        <MenuItem value="years">Years</MenuItem>
      </TextField>
    </Stack>
    {existing && !match && <Typography variant="body2" color="text.secondary">Current term: {existing}. Enter a duration to replace it.</Typography>}
  </Stack>;
}

function LookupField({ column, value, label, onChange, disabled, required }) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      setBusy(true);
      setError("");
      try {
        const response = await axios.get(`${INVENTORY_URL}/lookups/${column.key}`, { headers: getAuthHeaders(), params: { q: query } });
        if (active) setOptions(response.data.data || []);
      } catch (err) {
        if (active && !handleUnauthorized(err)) setError("Unable to load options. Type to retry.");
      } finally { if (active) setBusy(false); }
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [column.key, query]);
  const selected = value ? options.find(option => option.value === value) || { value, label: label || value } : null;
  return <Autocomplete options={options} value={selected} loading={busy} disabled={disabled}
    getOptionLabel={option => option.label} isOptionEqualToValue={(a, b) => a.value === b.value}
    filterOptions={items => items}
    onInputChange={(_, text, reason) => { if (reason === "input") setQuery(text); if (reason === "clear") setQuery(""); }}
    onChange={(_, option) => onChange(option?.value || null, option?.label || "")}
    renderInput={params => <TextField {...params} label={column.label} required={required} error={Boolean(error)} helperText={error || "Search and select a Dynamics record"} />} />;
}

export default function SoftwareInventory() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState({ key: "name", direction: "asc" });
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [editor, setEditor] = useState(null);
  const [fields, setFields] = useState(null);
  const [values, setValues] = useState({});
  const [labels, setLabels] = useState({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [success, setSuccess] = useState("");
  async function openEditor(row = null) {
    setEditor({ row });
    setValues(row?.values || {});
    setLabels(row || {});
    setFields(null);
    setFormError("");
    try {
      const response = await axios.get(`${INVENTORY_URL}/editor`, { headers: getAuthHeaders() });
      setFields(response.data.fields);
    } catch (err) {
      if (!handleUnauthorized(err)) setFormError(getApiErrorMessage(err, "Unable to load the service form."));
    }
  }
  async function save() {
    setFormError("");
    if (!String(values.name || "").trim()) { setFormError("Service is required."); return; }
    const term = values.current_service_term;
    if (term && typeof term === "object" && (!Number.isInteger(term.duration) || term.duration <= 0)) {
      setFormError("Service Term must be a positive whole number."); return;
    }
    const creating = !editor.row;
    const changed = Object.fromEntries(Object.entries(values).filter(([key, value]) => {
      const field = fields[key];
      return field && field[creating ? "create" : "update"] && (creating || value !== editor.row.values[key]);
    }));
    if (!creating && !Object.keys(changed).length) { setEditor(null); return; }
    setSaving(true);
    try {
      const payload = { values: changed, etag: editor.row?.etag || null };
      if (creating) await axios.post(INVENTORY_URL, payload, { headers: getAuthHeaders() });
      else await axios.patch(`${INVENTORY_URL}/${editor.row.id}`, payload, { headers: getAuthHeaders() });
      setEditor(null);
      setSuccess(creating ? "Service created in Dynamics." : "Service updated in Dynamics.");
      await load();
    } catch (err) {
      if (!handleUnauthorized(err)) setFormError(getApiErrorMessage(err, "Unable to save the service to Dynamics."));
    } finally { setSaving(false); }
  }
  async function remove() {
    setSaving(true);
    setFormError("");
    try {
      await axios.delete(`${INVENTORY_URL}/${deleteTarget.id}`, { headers: getAuthHeaders(), params: { etag: deleteTarget.etag || undefined } });
      setDeleteTarget(null);
      setSuccess("Service deleted from Dynamics.");
      await load();
    } catch (err) {
      if (!handleUnauthorized(err)) setFormError(getApiErrorMessage(err, "Unable to delete the service from Dynamics."));
    } finally { setSaving(false); }
  }
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await axios.get(`${API_BASE_URL}/software-subscriptions/inventory`, {
        headers: getAuthHeaders(), params: { limit: 5000 },
      });
      setRows(response.data.data || []);
      setPage(0);
    } catch (err) {
      if (!handleUnauthorized(err)) setError(getApiErrorMessage(err, "Unable to load software inventory from Dynamics."));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const statuses = useMemo(() => [...new Set(rows.map(row => row.status).filter(Boolean))]
    .sort((first, second) => getInventoryStatusAppearance(first).label.localeCompare(getInventoryStatusAppearance(second).label)), [rows]);
  const filtered = useMemo(() => filterAndSortInventory(rows, status, query, sort), [rows, status, query, sort]);
  function exportCsv() {
    const escape = value => `"${String(value).replace(/"/g, '""')}"`;
    const csv = [columns.map(column => column.label), ...filtered.map(row => columns.map(column => displayValue(row, column.key)))]
      .map(row => row.map(value => escape(/^[=+\-@\t\r]/.test(String(value)) ? `'${value}` : value)).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "software-inventory.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }
  return <Stack spacing={3}>
    {success && <Alert severity="success" onClose={() => setSuccess("")}>{success}</Alert>}
    {error && <Alert severity="error">{error}</Alert>}
    <Paper elevation={0} sx={{ ...managementCardSx, p: { xs: 2.5, md: 3 } }}>
      <ManagementSectionHeading
        action={
          <Stack direction="row" flexWrap="wrap" gap={1}>
            <Button disabled={loading || saving} onClick={() => openEditor()} sx={managementButtonSx} variant="contained">Add Service</Button>
            <Button disabled={loading || saving} onClick={load} sx={managementButtonSx} variant="outlined">Refresh</Button>
            <Button disabled={!filtered.length} onClick={exportCsv} sx={managementButtonSx} variant="outlined">Export CSV</Button>
          </Stack>
        }
        description={`${rows.length.toLocaleString()} services available to review and maintain.`}
        eyebrow="Inventory actions"
        title="Subscription inventory"
      />
    </Paper>
    <Paper elevation={0} sx={{ ...managementCardSx, p: { xs: 2.5, md: 3 } }}>
      <Stack spacing={2}>
        <ManagementSectionHeading
          description={`${filtered.length.toLocaleString()} matching services. Search and status filters update the table below.`}
          title="Find services"
        />
        <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", md: "minmax(0, 2fr) minmax(220px, 1fr)" } }}>
          <TextField fullWidth size="small" label="Search inventory" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} />
          <TextField fullWidth select size="small" label="Service Status" value={status} onChange={event => { setStatus(event.target.value); setPage(0); }}>
            <MenuItem value="">All statuses</MenuItem>
            {statuses.map(value => <MenuItem key={value} value={value}>{getInventoryStatusAppearance(value).label}</MenuItem>)}
          </TextField>
        </Box>
      </Stack>
    </Paper>
    {loading && <Stack alignItems="center"><CircularProgress size={24} /></Stack>}
    <Paper elevation={0} sx={{ ...managementCardSx, overflow: "hidden" }}>
      <Box sx={{ borderBottom: "1px solid", borderColor: "divider", p: { xs: 2.5, md: 3 } }}>
        <ManagementSectionHeading
          description="Review services, sort the list, and open a record for details."
          title="Services"
        />
      </Box>
      <Stack direction="row" spacing={1} sx={{ display: { xs: "flex", md: "none" }, p: 2 }}>
        <TextField
          fullWidth
          label="Sort by"
          onChange={event => setSort(current => ({ ...current, key: event.target.value }))}
          select
          size="small"
          value={sort.key}
        >
          {columns.map(column => <MenuItem key={column.key} value={column.key}>{column.label}</MenuItem>)}
        </TextField>
        <Button aria-label={sort.direction === "asc" ? "Sort descending" : "Sort ascending"} onClick={() => setSort(current => ({ ...current, direction: current.direction === "asc" ? "desc" : "asc" }))} variant="outlined">
          {sort.direction === "asc" ? "Asc" : "Desc"}
        </Button>
      </Stack>
      <Stack spacing={1.5} sx={{ display: { xs: "flex", md: "none" }, px: 2, pb: 2 }}>
        {filtered.slice(page * pageSize, (page + 1) * pageSize).map(row => (
          <Paper elevation={0} key={row.id} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, minWidth: 0, p: 2 }}>
            <Stack spacing={1.5}>
              <Typography fontWeight={800} sx={{ overflowWrap: "anywhere" }}>{row.name || "Unnamed service"}</Typography>
              <InventoryStatus value={row.status} />
              <Box component="details">
                <Box component="summary" sx={{ color: "primary.main", cursor: "pointer", fontWeight: 700 }}>View service details</Box>
                <Stack spacing={1.25} sx={{ mt: 1.5 }}>
                  {columns.filter(column => column.key !== "name" && column.key !== "status").map(column => (
                    <Box key={column.key}>
                      <Typography color="text.secondary" variant="caption">{column.label}</Typography>
                      <Typography sx={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }} variant="body2">{displayValue(row, column.key) || "—"}</Typography>
                    </Box>
                  ))}
                </Stack>
              </Box>
              <Stack direction="row" spacing={1}>
                <Button disabled={saving} onClick={() => openEditor(row)} variant="outlined">Edit</Button>
                <Button color="error" disabled={saving} onClick={() => { setFormError(""); setDeleteTarget(row); }}>Delete</Button>
              </Stack>
            </Stack>
          </Paper>
        ))}
        {!loading && !filtered.length && <Typography color="text.secondary" sx={{ py: 2 }}>{error ? "Inventory unavailable. Use Refresh to retry." : "No services found."}</Typography>}
      </Stack>
      <TableContainer sx={{ display: { xs: "none", md: "block" }, maxWidth: "100%" }}>
        <Table size="small" sx={{ minWidth: 1800, "& tbody tr:nth-of-type(even)": { backgroundColor: "#f8fafb" } }}>
          <TableHead><TableRow>{columns.map(column => <TableCell key={column.key} sx={{ ...subtleTableHeadCellSx, minWidth: column.key === "description" ? 260 : 160 }}>
            <TableSortLabel active={sort.key === column.key} direction={sort.key === column.key ? sort.direction : "asc"} onClick={() => setSort({ key: column.key, direction: sort.key === column.key && sort.direction === "asc" ? "desc" : "asc" })}>{column.label}</TableSortLabel>
          </TableCell>)}<TableCell sx={subtleTableHeadCellSx}>Actions</TableCell></TableRow></TableHead>
          <TableBody>
            {filtered.slice(page * pageSize, (page + 1) * pageSize).map(row => <TableRow key={row.id} hover>{columns.map(column => <TableCell key={column.key} sx={{ verticalAlign: "top", whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxWidth: 340 }}>{column.key === "status" ? <InventoryStatus value={row.status} /> : displayValue(row, column.key) || "—"}</TableCell>)}<TableCell sx={{ whiteSpace: "nowrap" }}>
              <Button disabled={saving} onClick={() => openEditor(row)}>Edit</Button>
              <Button color="error" disabled={saving} onClick={() => { setFormError(""); setDeleteTarget(row); }}>Delete</Button>
            </TableCell></TableRow>)}
            {!loading && !filtered.length && <TableRow><TableCell colSpan={columns.length + 1} align="center">{error ? "Inventory unavailable. Use Refresh to retry." : "No services found."}</TableCell></TableRow>}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination component="div" count={filtered.length} page={page} rowsPerPage={pageSize} rowsPerPageOptions={[10, 25, 50, 100]} onPageChange={(_, value) => setPage(value)} onRowsPerPageChange={event => { setPageSize(Number(event.target.value)); setPage(0); }} sx={{ borderTop: "1px solid", borderColor: "divider", "& .MuiTablePagination-toolbar": { flexWrap: "wrap", justifyContent: "flex-end", rowGap: 1 } }} />
    </Paper>
    <Dialog open={Boolean(editor)} onClose={() => { if (!saving) setEditor(null); }} fullWidth maxWidth="md">
      <DialogTitle>{editor?.row ? "Edit Service" : "Add Service"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {formError && <Alert severity="error">{formError}</Alert>}
          {!fields && !formError && <CircularProgress size={24} />}
          {fields && columns.map(column => {
            const field = fields[column.key];
            const disabled = saving || !field[editor?.row ? "update" : "create"];
            const required = field.required || column.key === "name";
            const change = (value, label) => { setValues(current => ({ ...current, [column.key]: value })); if (label !== undefined) setLabels(current => ({ ...current, [column.key]: label })); };
            if (column.key === "current_service_term") return <ServiceTermField key={column.key}
              value={values[column.key]} label={labels[column.key]} disabled={disabled} required={required} onChange={change} />;
            if (!editor?.row && ["vendor", "primary_vendor_contact"].includes(column.key)) {
              const lookup = ["Lookup", "Customer", "Owner"].includes(field.type);
              return <TextField key={column.key} label={column.label} disabled={disabled} required={required}
                value={lookup ? values[column.key]?.name || "" : values[column.key] || ""}
                helperText={lookup ? "Enter the exact name of an existing Dynamics record" : undefined}
                onChange={event => change(lookup ? (event.target.value ? { name: event.target.value } : null) : event.target.value)} />;
            }
            if (["Lookup", "Customer", "Owner"].includes(field.type)) return <LookupField key={column.key} column={column} value={values[column.key]} label={labels[column.key]} onChange={change} disabled={disabled} required={required} />;
            const choice = field.type === "Picklist";
            const date = field.type === "DateTime";
            const value = values[column.key] ?? "";
            return <TextField key={column.key} label={column.label} disabled={disabled} required={required}
              select={choice} type={date ? "date" : "text"} slotProps={date ? { inputLabel: { shrink: true } } : undefined}
              multiline={["description", "access_details"].includes(column.key)} minRows={["description", "access_details"].includes(column.key) ? 3 : undefined}
              value={date ? String(value).slice(0, 10) : value}
              onChange={event => change(choice ? (event.target.value === "" ? null : Number(event.target.value)) : event.target.value)}>
              {choice && <MenuItem value="">None</MenuItem>}
              {choice && field.options.map(option => <MenuItem key={option.value} value={option.value}>{column.key === "status" ? getInventoryStatusAppearance(option.label).label : option.label}</MenuItem>)}
            </TextField>;
          })}
        </Stack>
      </DialogContent>
      <DialogActions><Button disabled={saving} onClick={() => setEditor(null)}>Cancel</Button><Button variant="contained" disabled={saving || !fields} onClick={save}>{saving ? "Saving…" : "Save to Dynamics"}</Button></DialogActions>
    </Dialog>
    <Dialog open={Boolean(deleteTarget)} onClose={() => { if (!saving) setDeleteTarget(null); }}>
      <DialogTitle>Delete Service</DialogTitle>
      <DialogContent><Stack spacing={2}>{formError && <Alert severity="error">{formError}</Alert>}<Typography>Delete {deleteTarget?.name} from Dynamics? This permanently deletes the service record.</Typography></Stack></DialogContent>
      <DialogActions><Button disabled={saving} onClick={() => setDeleteTarget(null)}>Cancel</Button><Button color="error" variant="contained" disabled={saving} onClick={remove}>{saving ? "Deleting…" : "Delete from Dynamics"}</Button></DialogActions>
    </Dialog>
  </Stack>;
}
