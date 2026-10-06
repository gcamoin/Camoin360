import { useEffect, useRef, useState } from "react";
import axios from "axios";
import {
  Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, InputLabel, MenuItem, Paper, Select, Skeleton, Stack, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip, Typography,
} from "@mui/material";
import { API_BASE_URL, getAuthHeaders, handleUnauthorized } from "../auth";
import { getCached, invalidateApiCache } from "../apiClient";

const SEARCH_URL = `${API_BASE_URL}/accounts/data-quality/search`;
const RUN_URL = `${API_BASE_URL}/accounts/enrichment-run`;
export const enrichmentFields = [
  ["websiteurl", "Website"], ["telephone1", "Phone"], ["description", "Description"],
  ["numberofemployees", "Employees"], ["address1_city", "City"], ["address1_stateorprovince", "State"],
  ["address1_country", "Country"], ["address1_postalcode", "Postal Code"], ["cr73c_naicscode", "NAICS"],
];
const fieldLabels = Object.fromEntries(enrichmentFields);
const statusLabels = { updated: "Updated", no_updates_needed: "No fields added", no_match: "No usable match", skipped_credit_limit: "Credit limit", failed: "Failed" };
const panel = { p: { xs: 2, sm: 3 }, border: "1px solid", borderColor: "divider", borderRadius: 2, minWidth: 0 };
const number = (value) => typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("en-US") : "—";
const blank = (value) => value == null || (typeof value === "string" && !value.trim());

export default function EnrichmentWorkspace() {
  const [filters, setFilters] = useState({ search: "", missing: "all", country: "", state: "", city: "", sector: "" });
  const [query, setQuery] = useState(null);
  const [rows, setRows] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState([]);
  const [fields, setFields] = useState([]);
  const [detail, setDetail] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState("");
  const [result, setResult] = useState(null);
  const requestVersion = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    if (!query) return undefined;
    const version = ++requestVersion.current;
    setLoading(true); setError(""); setSelected([]); setRows([]); setHasMore(false);
    const { force, ...params } = query;
    getCached(SEARCH_URL, { headers: getAuthHeaders(), params, ttl: 60000, timeout: 300000, force: Boolean(force) })
      .then(({ data }) => { if (version === requestVersion.current) { setRows(data.data || []); setHasMore(Boolean(data.has_more)); } })
      .catch((err) => { if (version === requestVersion.current && !handleUnauthorized(err)) setError("Unable to search Accounts. Try again or narrow your filters."); })
      .finally(() => { if (version === requestVersion.current) setLoading(false); });
    return () => { requestVersion.current += 1; };
  }, [query]);

  function search(event) {
    event.preventDefault();
    setResult(null); setRunError("");
    setQuery({ enrichment_fields: true, search: filters.search.trim(), missing_field: filters.missing,
      needs_attention: filters.missing === "all", country: filters.country.trim() || "all",
      states: filters.state.trim(), cities: filters.city.trim(), sector: filters.sector.trim() || "all", page: 0, page_size: 25 });
  }
  function changeFilter(key) { return (event) => setFilters((previous) => ({ ...previous, [key]: event.target.value })); }
  function toggle(id) { setSelected((previous) => previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]); }
  async function run() {
    if (!selected.length || !fields.length || running) return;
    setRunning(true); setRunError("");
    try {
      const { data } = await axios.post(RUN_URL, { account_ids: selected, fields_to_update: fields }, { headers: getAuthHeaders(), timeout: 300000 });
      if (!mounted.current) return;
      setResult(data); setConfirm(false); setFields([]);
      invalidateApiCache(SEARCH_URL);
      setQuery((previous) => ({ ...previous, force: true }));
    } catch (err) {
      if (mounted.current && !handleUnauthorized(err)) setRunError("Unable to complete enrichment. Review the Accounts before retrying.");
    } finally { if (mounted.current) setRunning(false); }
  }
  const eligibleIds = rows.map((row) => row.accountid).filter(Boolean);
  const allSelected = eligibleIds.length > 0 && eligibleIds.every((id) => selected.includes(id));

  return <Stack spacing={3} sx={{ minWidth: 0 }}>
    <Paper elevation={0} sx={panel} component="section" aria-labelledby="accounts-to-enrich-title">
      <Typography id="accounts-to-enrich-title" component="h2" variant="h6">Accounts to Enrich</Typography>
      <Box component="form" onSubmit={search} sx={{ mt: 2 }}>
        <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: "repeat(2, minmax(0, 1fr))", lg: "minmax(160px, 2fr) minmax(150px, 1fr) minmax(120px, 1fr) auto" } }}>
          <TextField label="Search Accounts" size="small" value={filters.search} onChange={changeFilter("search")} disabled={running} />
          <TextField select label="Missing Information" size="small" SelectProps={{ renderValue: (value) => value === "all" ? "Any missing" : fieldLabels[value] }} value={filters.missing} onChange={changeFilter("missing")} disabled={running}>
            <MenuItem value="all">Any missing information</MenuItem>{enrichmentFields.map(([key, label]) => <MenuItem key={key} value={key}>{label}</MenuItem>)}
          </TextField>
          <TextField label="Country" placeholder="e.g. United States" size="small" value={filters.country} onChange={changeFilter("country")} disabled={running} />
          <Button type="submit" variant="contained" sx={{ minHeight: 44 }} disabled={running || loading}>Search Dynamics</Button>
        </Box>
        <Box component="details" sx={{ mt: 1.5 }}><Typography component="summary" variant="body2" color="primary.main" sx={{ cursor: "pointer", width: "fit-content" }}>More filters</Typography>
          <Box sx={{ display: "grid", gap: 1.5, mt: 1.5, gridTemplateColumns: { xs: "1fr", sm: "repeat(3, minmax(0, 1fr))" } }}>
            {[ ["state", "State / Province"], ["city", "City"], ["sector", "Sector"] ].map(([key, label]) => <TextField key={key} label={label} size="small" value={filters[key]} onChange={changeFilter(key)} disabled={running} />)}
          </Box>
        </Box>
      </Box>

      {selected.length > 0 && <Box sx={{ mt: 2, p: 2, bgcolor: "action.hover", borderRadius: 1 }} aria-label="Selected Account actions">
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ xs: "stretch", sm: "center" }}>
          <Typography variant="body2" fontWeight={650}>{selected.length} Accounts selected</Typography>
          <FormControl size="small" sx={{ flex: 1, minWidth: 0 }}><InputLabel id="manual-fields-label">Fields to enrich</InputLabel>
            <Select multiple label="Fields to enrich" labelId="manual-fields-label" value={fields} onChange={(event) => setFields(event.target.value)} disabled={running} renderValue={(values) => values.map((key) => fieldLabels[key]).join(", ")} sx={{ "& .MuiSelect-select": { whiteSpace: "normal" } }}>
              {enrichmentFields.map(([key, label]) => <MenuItem key={key} value={key}><Checkbox size="small" checked={fields.includes(key)} />{label}</MenuItem>)}
            </Select></FormControl>
          <Button variant="contained" sx={{ minHeight: 44 }} disabled={!fields.length || running} onClick={() => { setRunError(""); setConfirm(true); }}>Enrich Selected</Button>
        </Stack>
        {!fields.length && <Typography variant="caption" color="text.secondary">Choose at least one field to enrich.</Typography>}
      </Box>}
      {result && <Box sx={{ mt: 2 }} role="status">
        <Typography variant="subtitle2">Enrichment complete</Typography>
        <Typography variant="body2">{number(result.processed)} Accounts processed · {number(result.updated)} updated{Object.entries(statusLabels).filter(([key]) => key !== "updated").map(([key, label]) => {
          const count = (result.results || []).filter((item) => item.status === key).length;
          return count ? ` · ${count} ${label.toLowerCase()}` : "";
        })}</Typography>
        <Box component="details" sx={{ mt: 1 }}><Typography component="summary" variant="body2" sx={{ cursor: "pointer" }}>View Account outcomes</Typography>
          <TableContainer sx={{ mt: 1, overflowX: "auto" }}><Table size="small" aria-label="Manual enrichment outcomes"><TableHead><TableRow>{["Account", "Result", "Fields Added / Reason"].map((label) => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead>
            <TableBody>{(result.results || []).map((item, index) => <TableRow key={`${item.account_id}-${index}`}><TableCell>{item.account_name || item.account_id}</TableCell><TableCell>{item.completion_uncertain ? "Failed — update unconfirmed" : statusLabels[item.status] || "Outcome unavailable"}</TableCell><TableCell>{item.fields_updated?.length ? item.fields_updated.map((key) => fieldLabels[key] || key).join(", ") : item.reason || "No fields added"}</TableCell></TableRow>)}</TableBody>
          </Table></TableContainer>
        </Box>
      </Box>}
      {error && <Alert severity="error" sx={{ mt: 2 }} action={<Button onClick={() => setQuery((previous) => ({ ...previous, force: true }))}>Retry</Button>}>{error}</Alert>}
      <TableContainer component={Box} tabIndex={0} role="region" aria-label="Accounts to Enrich table" sx={{ mt: 2, overflowX: "auto" }}>
        <Table aria-label="Accounts to Enrich" sx={{ minWidth: 720 }}><TableHead><TableRow>
          <TableCell padding="checkbox"><Checkbox size="small" inputProps={{ "aria-label": "Select Accounts on this page" }} checked={allSelected} indeterminate={selected.length > 0 && !allSelected} disabled={running || !eligibleIds.length} onChange={() => setSelected(allSelected ? [] : eligibleIds)} /></TableCell>
          {["Account", "Location", "Missing Information", "Completeness", "Details"].map((label) => <TableCell key={label}>{label}</TableCell>)}
        </TableRow></TableHead><TableBody>
          {loading ? Array.from({ length: 4 }, (_, index) => <TableRow key={index}>{Array.from({ length: 6 }, (_, cell) => <TableCell key={cell}><Skeleton aria-label="Loading Account" /></TableCell>)}</TableRow>) : rows.map((row, index) => {
            const missing = enrichmentFields.filter(([key]) => blank(row[key])).map(([, label]) => label);
            return <TableRow key={row.accountid || index} hover>
              <TableCell padding="checkbox"><Checkbox size="small" inputProps={{ "aria-label": `Select ${row.name || "unnamed Account"}` }} checked={selected.includes(row.accountid)} disabled={running || !row.accountid} onChange={() => toggle(row.accountid)} /></TableCell>
              <TableCell sx={{ minWidth: 150, maxWidth: 230, overflowWrap: "anywhere", fontWeight: 650 }}>{row.name || "Unnamed Account"}</TableCell>
              <TableCell sx={{ minWidth: 140, maxWidth: 190, overflowWrap: "anywhere" }}>{[row.address1_city, row.address1_stateorprovince, row.address1_country].filter((value) => !blank(value)).join(", ") || "—"}</TableCell>
              <TableCell sx={{ minWidth: 180, maxWidth: 280, overflowWrap: "anywhere" }}>{missing.join(", ") || "Complete"}</TableCell>
              <TableCell><Tooltip title="Completeness of Website, Phone, Description, Employees and location. This is not enrichment eligibility or success."><Typography variant="body2">{typeof row.data_quality_score === "number" ? `${row.data_quality_score}%` : "—"}</Typography></Tooltip></TableCell>
              <TableCell><Button size="small" aria-label={`Details for ${row.name || "unnamed Account"}`} onClick={() => setDetail(row)}>Details</Button></TableCell>
            </TableRow>;
          })}
          {!loading && !rows.length && <TableRow><TableCell colSpan={6} sx={{ py: 5, textAlign: "center", color: "text.secondary" }}>{query ? error ? "Account search unavailable." : "No Accounts matched your search." : "Search Dynamics to find Accounts that need enrichment."}</TableCell></TableRow>}
        </TableBody></Table>
      </TableContainer>
      {query && !loading && !error && <Stack direction="row" spacing={2} alignItems="center" justifyContent="flex-end" sx={{ mt: 2 }}><Typography variant="caption" color="text.secondary">Page {query.page + 1} · {rows.length} Accounts</Typography><Button disabled={query.page === 0 || running} onClick={() => setQuery((previous) => ({ ...previous, page: previous.page - 1, force: false }))}>Previous</Button><Button disabled={!hasMore || running || query.page >= 199} onClick={() => setQuery((previous) => ({ ...previous, page: previous.page + 1, force: false }))}>Next</Button></Stack>}
    </Paper>

    <Dialog open={confirm} onClose={() => { if (!running) setConfirm(false); }} fullWidth maxWidth="sm"><DialogTitle>Confirm enrichment</DialogTitle><DialogContent>
      <Typography variant="body2">{selected.length} Accounts will be checked for: {fields.map((key) => fieldLabels[key]).join(", ")}.</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>Only blank Dynamics values will be filled. Existing values will not be overwritten.</Typography>
      {runError && <Alert severity="error" sx={{ mt: 2 }}>{runError}</Alert>}
    </DialogContent><DialogActions><Button disabled={running} onClick={() => setConfirm(false)}>Cancel</Button><Button variant="contained" disabled={running || !fields.length || !selected.length} onClick={run}>{running ? "Enriching…" : "Run Enrichment"}</Button></DialogActions></Dialog>
    <Dialog open={Boolean(detail)} onClose={() => setDetail(null)} fullWidth maxWidth="sm"><DialogTitle>{detail?.name || "Account details"}</DialogTitle><DialogContent><Stack spacing={1.5}>
      {detail && [...enrichmentFields, ["new_sector", "Sector"], ["new_subsector", "Subsector"]].map(([key, label]) => <Box key={key}><Typography variant="caption" color="text.secondary">{label}</Typography><Typography variant="body2" sx={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{blank(detail[key]) ? "Missing" : String(detail[key])}</Typography></Box>)}
    </Stack></DialogContent><DialogActions><Button onClick={() => setDetail(null)}>Close</Button></DialogActions></Dialog>
  </Stack>;
}
