import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  Autocomplete, Dialog, DialogTitle, DialogContent, DialogActions, Alert, Button, CircularProgress, MenuItem, Paper, Stack, Table, TableBody,
  TableCell, TableContainer, TableHead, TablePagination, TableRow,
  TableSortLabel, TextField, Typography,
} from "@mui/material";
import { API_BASE_URL, getApiErrorMessage, getAuthHeaders, handleUnauthorized } from "../auth";
import { subtleTableHeadCellSx } from "./UiPrimitives";

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
const displayValue = (row, key) => key === "subscribed_since" && /^\d{4}-\d{2}-\d{2}/.test(row[key])
  ? new Date(`${row[key].slice(0, 10)}T00:00:00`).toLocaleDateString()
  : String(row[key] || "");

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
  const statuses = useMemo(() => [...new Set(rows.map(row => row.status).filter(Boolean))].sort(), [rows]);
  const filtered = useMemo(() => rows.filter(row =>
    (!status || row.status === status) && columns.some(column =>
      displayValue(row, column.key).toLowerCase().includes(query.toLowerCase())
    )
  ).sort((a, b) => String(a[sort.key] || "").localeCompare(String(b[sort.key] || ""), undefined, { numeric: true }) * (sort.direction === "asc" ? 1 : -1)), [rows, status, query, sort]);
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
  return <Stack spacing={2}>
    {success && <Alert severity="success" onClose={() => setSuccess("")}>{success}</Alert>}
    {error && <Alert severity="error">{error}</Alert>}
    <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems="center">
      <Typography fontWeight={800} sx={{ flexGrow: 1 }}>Software Inventory · {rows.length} services</Typography>
      <Button variant="contained" disabled={loading || saving} onClick={() => openEditor()}>Add Service</Button>
      <Button variant="outlined" disabled={loading || saving} onClick={load}>Refresh</Button>
      <Button variant="outlined" disabled={!filtered.length} onClick={exportCsv}>Export CSV</Button>
    </Stack>
    <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
      <TextField fullWidth size="small" label="Search inventory" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} />
      <TextField select size="small" label="Service Status" sx={{ minWidth: 220 }} value={status} onChange={event => { setStatus(event.target.value); setPage(0); }}>
        <MenuItem value="">All statuses</MenuItem>
        {statuses.map(value => <MenuItem key={value} value={value}>{value}</MenuItem>)}
      </TextField>
    </Stack>
    {loading && <Stack alignItems="center"><CircularProgress size={24} /></Stack>}
    <Paper variant="outlined">
      <TableContainer>
        <Table size="small" sx={{ minWidth: 1800 }}>
          <TableHead><TableRow>{columns.map(column => <TableCell key={column.key} sx={{ ...subtleTableHeadCellSx, minWidth: column.key === "description" ? 260 : 160 }}>
            <TableSortLabel active={sort.key === column.key} direction={sort.key === column.key ? sort.direction : "asc"} onClick={() => setSort({ key: column.key, direction: sort.key === column.key && sort.direction === "asc" ? "desc" : "asc" })}>{column.label}</TableSortLabel>
          </TableCell>)}<TableCell sx={subtleTableHeadCellSx}>Actions</TableCell></TableRow></TableHead>
          <TableBody>
            {filtered.slice(page * pageSize, (page + 1) * pageSize).map(row => <TableRow key={row.id} hover>{columns.map(column => <TableCell key={column.key} sx={{ verticalAlign: "top", whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxWidth: 340 }}>{displayValue(row, column.key) || "—"}</TableCell>)}<TableCell sx={{ whiteSpace: "nowrap" }}>
              <Button disabled={saving} onClick={() => openEditor(row)}>Edit</Button>
              <Button color="error" disabled={saving} onClick={() => { setFormError(""); setDeleteTarget(row); }}>Delete</Button>
            </TableCell></TableRow>)}
            {!loading && !filtered.length && <TableRow><TableCell colSpan={columns.length + 1} align="center">{error ? "Inventory unavailable. Use Refresh to retry." : "No services found."}</TableCell></TableRow>}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination component="div" count={filtered.length} page={page} rowsPerPage={pageSize} rowsPerPageOptions={[10, 25, 50, 100]} onPageChange={(_, value) => setPage(value)} onRowsPerPageChange={event => { setPageSize(Number(event.target.value)); setPage(0); }} />
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
              {choice && field.options.map(option => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
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
