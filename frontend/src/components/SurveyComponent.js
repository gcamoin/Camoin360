import { useEffect, useMemo, useState } from "react";
import {
  Alert, Box, CircularProgress, FormControl, InputLabel, MenuItem, Paper,
  Select, Stack, Table, TableBody, TableCell, TableContainer, TableHead,
  TablePagination, TableRow, TextField, Typography,
} from "@mui/material";

import { API_BASE_URL, getApiErrorMessage, getAuthHeaders, handleUnauthorized } from "../auth";
import { getCached } from "../apiClient";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { FullWidthFilterRow } from "./UiPrimitives";

const API_URL = `${API_BASE_URL}/surveys/completed`;
const ALL = "all";
const UNKNOWN_MANAGER = "unknown_project_manager";
const START_YEAR = 2019;
const END_YEAR = 2026;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthlyCounts(rows) {
  const counts = new Map();
  rows.forEach((row) => {
    const key = row.survey_date?.slice(0, 7);
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  });
  const points = [];
  for (let year = START_YEAR; year <= END_YEAR; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      const key = `${year}-${String(month).padStart(2, "0")}`;
      points.push({ key, year, quarter: Math.ceil(month / 3), month, count: counts.get(key) || 0 });
    }
  }
  return points;
}

function MonthTick({ x, y, payload }) {
  const [year, monthText] = payload.value.split("-");
  const month = Number(monthText);
  return <g transform={`translate(${x},${y})`}>
    <text y={13} textAnchor="middle" fill="#64748b" fontSize={10}>{MONTHS[month - 1]}</text>
    {month % 3 === 1 && <text y={30} textAnchor="middle" fill="#475569" fontSize={11}>Q{Math.ceil(month / 3)}</text>}
    {month === 1 && <text y={47} textAnchor="middle" fill="#334155" fontSize={11} fontWeight="bold">{year}</text>}
  </g>;
}

function optionsFor(rows, key) {
  return [...new Set(rows.map((row) => row[key]).filter(Boolean))]
    .sort((a, b) => String(a).localeCompare(String(b)));
}

function managerName(row) {
  return row.project_manager && row.project_manager !== row.project_manager_id
    ? row.project_manager
    : "";
}

export default function SurveyComponent() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [manager, setManager] = useState(ALL);
  const [principal, setPrincipal] = useState(ALL);
  const [serviceLine, setServiceLine] = useState(ALL);
  const [year, setYear] = useState(ALL);
  const [surveyDate, setSurveyDate] = useState("");
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  useEffect(() => {
    let active = true;
    getCached(API_URL, { headers: getAuthHeaders(), timeout: 60000, ttl: 5 * 60 * 1000 })
      .then((response) => {
        if (active) setRows(response.data?.rows || []);
      })
      .catch((fetchError) => {
        if (handleUnauthorized(fetchError) || !active) return;
        setError(getApiErrorMessage(fetchError, "Unable to load completed surveys."));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const managers = useMemo(() => {
    const byId = new Map();
    let hasUnnamedManager = false;
    rows.forEach((row) => {
      const id = String(row.project_manager_id || "").trim();
      const name = managerName(row);
      if (id && name && !byId.has(id)) {
        byId.set(id, name);
      } else if (id && !name) {
        hasUnnamedManager = true;
      }
    });
    const namedManagers = [...byId.entries()]
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return hasUnnamedManager
      ? [...namedManagers, { id: UNKNOWN_MANAGER, label: "Name unavailable" }]
      : namedManagers;
  }, [rows]);
  const principals = useMemo(() => optionsFor(rows, "principal"), [rows]);
  const serviceLines = useMemo(() => optionsFor(rows, "service_line"), [rows]);
  const years = useMemo(() => optionsFor(rows, "survey_year").reverse(), [rows]);
  const filteredRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return rows.filter((row) => (
      (!query || [row.project, row.client, row.comments, managerName(row), row.principal, row.service_line]
        .some((value) => String(value || "").toLocaleLowerCase().includes(query))) &&
      (manager === ALL || (manager === UNKNOWN_MANAGER
        ? Boolean(row.project_manager_id) && !managerName(row)
        : String(row.project_manager_id || "") === manager)) &&
      (principal === ALL || row.principal === principal) &&
      (serviceLine === ALL || row.service_line === serviceLine) &&
      (year === ALL || row.survey_year === Number(year)) &&
      (!surveyDate || row.survey_date?.slice(0, 10) === surveyDate)
    ));
  }, [rows, search, manager, principal, serviceLine, year, surveyDate]);
  const chartData = useMemo(() => monthlyCounts(filteredRows), [filteredRows]);

  function updateFilter(setter) {
    return (event) => { setter(event.target.value); setPage(0); };
  }

  return (
    <Stack spacing={2.5}>
      {error && <Alert severity="error">{error}</Alert>}
      <Paper elevation={0} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: 3 }}>
        <Typography color="text.secondary" variant="overline">Surveys Completed</Typography>
        <Typography color="primary.main" sx={{ fontSize: { xs: "2.6rem", md: "3.4rem" }, fontWeight: 800, lineHeight: 1.15, mt: 0.5 }}>
          {loading ? <CircularProgress size={34} /> : filteredRows.length.toLocaleString()}
        </Typography>
        <Typography color="text.secondary" variant="body2">
          {filteredRows.length === rows.length ? "All completed client surveys" : "Matching the selected filters"}
        </Typography>
      </Paper>

      <Paper elevation={0} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: { xs: 2, md: 3 } }}>
        <TextField
          fullWidth
          label="Search surveys"
          onChange={updateFilter(setSearch)}
          placeholder="Search projects, clients, comments, or managers"
          size="small"
          value={search}
        />
      </Paper>

      <Paper elevation={0} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: { xs: 2, md: 3 } }}>
        <Typography fontWeight={800} sx={{ mb: 2 }}>Filters</Typography>
        <FullWidthFilterRow>
          <FormControl size="small">
            <InputLabel id="survey-manager-filter-label">Project Manager</InputLabel>
            <Select label="Project Manager" labelId="survey-manager-filter-label" onChange={updateFilter(setManager)} value={manager}>
              <MenuItem value={ALL}>All project managers</MenuItem>
              {managers.map((option) => <MenuItem key={option.id} value={option.id}>{option.label}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small">
            <InputLabel>Principal</InputLabel>
            <Select label="Principal" onChange={updateFilter(setPrincipal)} value={principal}>
              <MenuItem value={ALL}>All principals</MenuItem>
              {principals.map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small">
            <InputLabel>Primary Service Line</InputLabel>
            <Select label="Primary Service Line" onChange={updateFilter(setServiceLine)} value={serviceLine}>
              <MenuItem value={ALL}>All service lines</MenuItem>
              {serviceLines.map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small">
            <InputLabel>Survey Year</InputLabel>
            <Select label="Survey Year" onChange={updateFilter(setYear)} value={year}>
              <MenuItem value={ALL}>All years</MenuItem>
              {years.map((value) => <MenuItem key={value} value={String(value)}>{value}</MenuItem>)}
            </Select>
          </FormControl>
          <TextField label="Client Survey Date" onChange={updateFilter(setSurveyDate)} size="small" slotProps={{ inputLabel: { shrink: true } }} type="date" value={surveyDate} />
        </FullWidthFilterRow>
      </Paper>

      <Paper elevation={0} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, overflow: "hidden" }}>
        <Box sx={{ p: { xs: 2, md: 3 }, pb: 1 }}>
          <Typography fontWeight={800}>Surveys Completed</Typography>
        </Box>
        {loading ? <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}><CircularProgress /></Box> : (
          <>
            <Stack spacing={1.5} sx={{ display: { xs: "flex", md: "none" }, px: 2, pb: 2 }}>
              {filteredRows.slice(page * rowsPerPage, (page + 1) * rowsPerPage).map((row, index) => (
                <Paper elevation={0} key={row.id || `${row.project}-${index}`} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: 2 }}>
                  <Stack spacing={1}>
                    <Typography fontWeight={800} sx={{ overflowWrap: "anywhere" }}>{row.project || "Unnamed project"}</Typography>
                    <Typography variant="body2"><strong>Client:</strong> {row.client || "—"}</Typography>
                    <Typography variant="body2"><strong>Project Manager:</strong> {managerName(row) || "—"}</Typography>
                    <Typography sx={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }} variant="body2">{row.comments || "No comments"}</Typography>
                  </Stack>
                </Paper>
              ))}
              {!filteredRows.length && <Typography color="text.secondary">No completed surveys match this search and filters.</Typography>}
            </Stack>
            <TableContainer sx={{ display: { xs: "none", md: "block" }, maxHeight: 620 }}>
              <Table stickyHeader size="small" sx={{ minWidth: 900 }}>
                <TableHead><TableRow>
                  <TableCell sx={{ fontWeight: 800 }}>Project</TableCell>
                  <TableCell sx={{ fontWeight: 800 }}>Client</TableCell>
                  <TableCell sx={{ fontWeight: 800 }}>Project Manager</TableCell>
                  <TableCell sx={{ fontWeight: 800 }}>Client Survey Comments</TableCell>
                </TableRow></TableHead>
                <TableBody>
                  {filteredRows.slice(page * rowsPerPage, (page + 1) * rowsPerPage).map((row, index) => (
                    <TableRow key={row.id || `${row.project}-${index}`} hover>
                      <TableCell>{row.project || "—"}</TableCell>
                      <TableCell>{row.client || "—"}</TableCell>
                      <TableCell>
                        <Typography variant="body2">{managerName(row) || "—"}</Typography>
                      </TableCell>
                      <TableCell sx={{ whiteSpace: "pre-wrap", minWidth: 280 }}>{row.comments || "—"}</TableCell>
                    </TableRow>
                  ))}
                  {!filteredRows.length && <TableRow><TableCell align="center" colSpan={4}>No completed surveys match this search and filters.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </TableContainer>
            <TablePagination component="div" count={filteredRows.length} onPageChange={(_event, value) => setPage(value)}
              onRowsPerPageChange={(event) => { setRowsPerPage(Number(event.target.value)); setPage(0); }}
              page={page} rowsPerPage={rowsPerPage} rowsPerPageOptions={[10, 25, 50, 100]}
              sx={{ "& .MuiTablePagination-toolbar": { flexWrap: "wrap", justifyContent: "flex-end", rowGap: 1 } }} />
          </>
        )}
      </Paper>

      <Paper elevation={0} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: { xs: 2, md: 3 } }}>
        <Typography fontWeight={800}>Surveys Completed</Typography>
        <Typography color="text.secondary" variant="body2" sx={{ mb: 2 }}>Monthly totals from January 2019, grouped by quarter and year. Scroll to view the full history.</Typography>
        <Box sx={{ overflowX: "auto", width: "100%" }}>
          <Box sx={{ height: 330, width: Math.max(780, chartData.length * 48) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 20, bottom: 48, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="key" interval={0} tick={<MonthTick />} tickLine={false} height={60} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip labelFormatter={(key) => {
                  const [pointYear, pointMonth] = String(key).split("-");
                  return `${MONTHS[Number(pointMonth) - 1]} ${pointYear} · Q${Math.ceil(Number(pointMonth) / 3)}`;
                }} formatter={(value) => [value, "Completed surveys"]} />
                <Bar dataKey="count" fill="#2b82a8" fillOpacity={0.86} radius={[3, 3, 0, 0]} maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
          </Box>
        </Box>
      </Paper>

      <Paper elevation={0} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: { xs: 2, md: 3 } }}>
        <Typography fontWeight={800}>Survey Averages by Quarter</Typography>
        <Typography color="text.secondary" variant="body2" sx={{ mt: 1 }}>
          The numeric survey score field is needed to calculate quarterly averages for 2019–2026.
        </Typography>
      </Paper>
    </Stack>
  );
}
