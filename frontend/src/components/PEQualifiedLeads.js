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

export default function PEQualifiedLeads() {
  const isMountedRef = useRef(true);
  const [selectedYear, setSelectedYear] = useState(ALL_TIME_YEAR_VALUE);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [leads, setLeads] = useState([]);
  const [rollups, setRollups] = useState([]);
  const [statusLabel, setStatusLabel] = useState("Qualified");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchLeads = useCallback(async () => {
    if (!isMountedRef.current) return;

    setIsLoading(true);
    setError("");

    try {
      const params = {};
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

      if (!isMountedRef.current) return;

      setLeads(response.data?.data || []);
      setRollups(response.data?.rollups || []);
      setStatusLabel(response.data?.status || "Qualified");
    } catch (fetchError) {
      if (handleUnauthorized(fetchError)) {
        return;
      }

      if (!isMountedRef.current) return;

      setError(getApiErrorMessage(fetchError, "Unable to load Prospect Engage qualified leads."));
      setLeads([]);
      setRollups([]);
    } finally {
      if (!isMountedRef.current) return;

      setIsLoading(false);
    }
  }, [selectedMonth, selectedYear]);

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
  }, [selectedMonth, selectedYear]);

  const periodLabel = useMemo(() => {
    if (selectedYear === ALL_TIME_YEAR_VALUE) {
      return "all time";
    }

    const month = MONTH_OPTIONS.find((option) => option.value === selectedMonth);
    return selectedMonth ? `${month?.label || ""} ${selectedYear}` : selectedYear;
  }, [selectedMonth, selectedYear]);
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
  const chartHeight = leadsByClient.length > 18 ? 420 : 360;

  return (
    <Stack spacing={2.5}>
      {error ? <Alert severity="error">{error}</Alert> : null}

      <Paper
        elevation={0}
        sx={{
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 2,
          p: { xs: 2, md: 2.5 },
          backgroundColor: "common.white",
        }}
      >
        <Stack spacing={0.5} sx={{ mb: 2 }}>
          <Typography fontWeight={800} color="text.primary">
            Prospect Engage Qualified Leads
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
          <Box sx={{ height: chartHeight, minWidth: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={leadsByClient} margin={{ top: 12, right: 16, bottom: 72, left: 0 }}>
                <CartesianGrid vertical={false} stroke="#f1f5f9" strokeDasharray="3 3" />
                <XAxis
                  dataKey="client_name"
                  interval={0}
                  tick={{ fontSize: 10 }}
                  tickFormatter={(value) => (value.length > 18 ? `${value.slice(0, 18)}...` : value)}
                  angle={-45}
                  textAnchor="end"
                  height={74}
                />
                <YAxis allowDecimals={false} tick={{ fontSize: 10 }} type="number" />
                <Tooltip
                  {...tooltipStyle}
                  formatter={(value) => [Number(value).toLocaleString(), "Qualified Leads"]}
                />
                <Bar
                  dataKey="qualified_leads"
                  fill="#0d9488"
                  fillOpacity={0.86}
                  maxBarSize={46}
                  name="Qualified Leads"
                  radius={[3, 3, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </Box>
        ) : (
          <Typography color="text.secondary" variant="body2">
            No qualified leads match this period.
          </Typography>
        )}
      </Paper>
    </Stack>
  );
}
