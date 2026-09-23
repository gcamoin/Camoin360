import { filterReportingRows, reportingParams } from "../reportingPeriod";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import {
  Alert,
  Box,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Typography,
} from "@mui/material";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { API_BASE_URL, getApiErrorMessage, getAuthHeaders, handleUnauthorized } from "../auth";

const API_URL = `${API_BASE_URL}/pe-qualified-leads`;
const CURRENT_YEAR = new Date().getFullYear();
const ALL_TIME_YEAR_VALUE = "all_time";
const YEAR_OPTIONS = [
  { label: "All Time", value: ALL_TIME_YEAR_VALUE },
  ...Array.from({ length: 6 }, (_, index) => {
    const year = CURRENT_YEAR - index;
    return { label: String(year), value: year };
  }),
];
const MONTH_OPTIONS = [
  { label: "All Months", value: "" },
  { label: "January", value: 1 },
  { label: "February", value: 2 },
  { label: "March", value: 3 },
  { label: "April", value: 4 },
  { label: "May", value: 5 },
  { label: "June", value: 6 },
  { label: "July", value: 7 },
  { label: "August", value: 8 },
  { label: "September", value: 9 },
  { label: "October", value: 10 },
  { label: "November", value: 11 },
  { label: "December", value: 12 },
];

const tooltipStyle = {
  contentStyle: {
    borderRadius: 8,
    border: "1px solid #e2e8f0",
    fontSize: 12,
    boxShadow: "0 4px 6px -1px rgba(0,0,0,0.08)",
  },
};

export default function PEQualifiedLeads({ filters } = {}) {
  const isMountedRef = useRef(true);
  const latestRequestIdRef = useRef(0);
  const [selectedYear, setSelectedYear] = useState(ALL_TIME_YEAR_VALUE);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [leads, setLeads] = useState([]);
  const [rollups, setRollups] = useState([]);
  const [yearlyRollups, setYearlyRollups] = useState([]);
  const [statusLabel, setStatusLabel] = useState("Qualified");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchLeads = useCallback(async () => {
    if (!isMountedRef.current) return;

    const requestId = ++latestRequestIdRef.current;
    setIsLoading(true);
    setError("");

    try {
      const params = reportingParams(filters);
      if (selectedYear !== ALL_TIME_YEAR_VALUE) {
        params.year = selectedYear;
      }
      if (selectedYear !== ALL_TIME_YEAR_VALUE && selectedMonth) {
        params.month = selectedMonth;
      }

      const response = await axios.get(API_URL, {
        headers: getAuthHeaders(),
        params,
      });

      if (!isMountedRef.current || requestId !== latestRequestIdRef.current) return;

      setLeads(response.data?.data || []);
      setRollups(response.data?.rollups || []);
      setYearlyRollups(filterReportingRows(response.data?.yearly_rollups, filters));
      setStatusLabel(response.data?.status || "Qualified");
    } catch (fetchError) {
      if (handleUnauthorized(fetchError)) {
        return;
      }

      if (!isMountedRef.current || requestId !== latestRequestIdRef.current) return;

      setError(getApiErrorMessage(fetchError, "Unable to load ProspectEngage qualified leads."));
      setLeads([]);
      setRollups([]);
      setYearlyRollups([]);
    } finally {
      if (!isMountedRef.current || requestId !== latestRequestIdRef.current) return;

      setIsLoading(false);
    }
  }, [selectedMonth, selectedYear, filters]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchLeads();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchLeads]);

  useEffect(() => {
    if (selectedYear === ALL_TIME_YEAR_VALUE && selectedMonth) {
      setSelectedMonth("");
    }
  }, [selectedMonth, selectedYear, filters]);

  const periodLabel = useMemo(() => {
    if (filters && Object.keys(reportingParams(filters)).length) return "the selected reporting period";
    if (selectedYear === ALL_TIME_YEAR_VALUE) {
      return "all time";
    }

    const month = MONTH_OPTIONS.find((option) => option.value === selectedMonth);
    return selectedMonth ? `${month?.label || ""} ${selectedYear}` : selectedYear;
  }, [selectedMonth, selectedYear, filters]);
  const leadsByClient = useMemo(() => {
    if (rollups.length) {
      return rollups;
    }

    const counts = new Map();

    for (const lead of leads) {
      const clientName = String(lead.client_name || "").trim();
      if (!clientName) {
        continue;
      }

      counts.set(clientName, (counts.get(clientName) || 0) + 1);
    }

    return Array.from(counts.entries())
      .map(([client_name, qualified_leads]) => ({ client_name, qualified_leads }))
      .sort((a, b) => b.qualified_leads - a.qualified_leads || a.client_name.localeCompare(b.client_name));
  }, [leads, rollups]);
  const chartHeight = Math.max(360, leadsByClient.length * 34 + 48);

  return (
    <Stack spacing={2.5}>
      {error ? <Alert severity="error">{error}</Alert> : null}

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "minmax(0, 1fr)", lg: "repeat(2, minmax(0, 1fr))" }, gap: 2.5 }}>
        <Paper
          elevation={0}
          sx={{
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 2,
            p: { xs: 2, md: 2.5 },
            backgroundColor: "common.white",
            minWidth: 0,
          }}
        >
          <Stack spacing={0.5} sx={{ mb: 2 }}>
            <Typography fontWeight={800} color="text.primary">
              ProspectEngage Qualified Leads
            </Typography>
            <Typography color="text.secondary" variant="body2">
              Prospects with the {statusLabel} dropdown option for {periodLabel}.
            </Typography>
          </Stack>

          {isLoading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
              <CircularProgress />
            </Box>
          ) : leadsByClient.length ? (
            <Box sx={{ height: 420, overflowY: "auto" }}>
            <Box sx={{ height: chartHeight, minWidth: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={leadsByClient} layout="vertical" margin={{ top: 12, right: 24, bottom: 12, left: 0 }}>
                  <CartesianGrid horizontal={false} stroke="#f1f5f9" strokeDasharray="3 3" />
                  <XAxis allowDecimals={false} tick={{ fontSize: 11 }} type="number" />
                  <YAxis
                    dataKey="client_name"
                    type="category"
                    interval={0}
                    width={170}
                    tick={{ fontSize: 11 }}
                    tickFormatter={(value) => (value.length > 25 ? `${value.slice(0, 25)}...` : value)}
                  />
                  <Tooltip
                    {...tooltipStyle}
                    formatter={(value) => [Number(value).toLocaleString(), "Qualified Leads"]}
                  />
                  <Bar
                    dataKey="qualified_leads"
                    fill="#073469"
                    fillOpacity={0.86}
                    maxBarSize={24}
                    name="Qualified Leads"
                    radius={[0, 3, 3, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </Box>
            </Box>
          ) : (
            <Typography color="text.secondary" variant="body2">
              No qualified leads match this period.
            </Typography>
          )}
        </Paper>
        <Paper
          elevation={0}
          sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: { xs: 2, md: 2.5 }, backgroundColor: "common.white", minWidth: 0 }}
        >
          <Stack spacing={0.5} sx={{ mb: 2 }}>
            <Typography fontWeight={800} color="text.primary">
              PE Leads: Year to Year
            </Typography>
            <Typography color="text.secondary" variant="body2">
              ProspectEngage qualified leads by creation year. Current year is year to date.
            </Typography>
          </Stack>
          {isLoading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
              <CircularProgress />
            </Box>
          ) : yearlyRollups.length ? (
            <Box sx={{ height: 420, minWidth: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={yearlyRollups} margin={{ top: 12, right: 24, bottom: 12, left: 0 }}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                  <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} domain={[0, "auto"]} tick={{ fontSize: 11 }} />
                  <Tooltip {...tooltipStyle} formatter={(value) => [Number(value).toLocaleString(), "Qualified Leads"]} />
                  <Line type="linear" dataKey="qualified_leads" name="Qualified Leads" stroke="#073469" strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </Box>
          ) : (
            <Typography color="text.secondary" variant="body2">
              No qualified leads with creation dates are available.
            </Typography>
          )}
        </Paper>
      </Box>
    </Stack>
  );
}
