import React, { useEffect, useState } from "react";
import axios from "axios";

import {
  Card,
  CardContent,
  Box,
  LinearProgress,
  Typography,
  useTheme,
  Button,
  CircularProgress,
  Snackbar,
  Alert,
  Divider,
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  OutlinedInput,
  FormHelperText,
  Autocomplete,
  TextField,
} from "@mui/material";

const API_URL = "http://localhost:8000/metrics";
const ENRICH_URL = "http://localhost:8000/accounts/enrich-all";
const SECTORS_URL = "http://localhost:8000/accounts/sectors";
const STATES_URL = "http://localhost:8000/accounts/states";

const valueSx = {
  fontSize: { xs: "2rem", md: "2.4rem" },
  fontWeight: 700,
  lineHeight: 1.1,
  mt: 1,
};

function MetricCard({ title, value, subtitle, children }) {
  const theme = useTheme();

  return (
    <Card
      sx={{
        width: "100%",
        display: "flex",
        borderRadius: 3,
        boxShadow: "0 10px 30px rgba(0, 51, 108, 0.08)",
        height: "100%",
        minHeight: 220,
        borderTop: `4px solid ${theme.palette.secondary.main}`,
      }}
    >
      <CardContent sx={{ p: 3, width: "100%" }}>
        <Typography color="text.secondary" variant="overline">
          {title}
        </Typography>

        <Typography sx={{ ...valueSx, color: "primary.main" }}>
          {value}
        </Typography>

        {subtitle ? (
          <Typography color="text.secondary" sx={{ mt: 1 }} variant="body2">
            {subtitle}
          </Typography>
        ) : null}

        {children}
      </CardContent>
    </Card>
  );
}

export default function MetricsDashboard() {
  const theme = useTheme();

  const [metrics, setMetrics] = useState({
    credits_used: 0,
    weekly_limit: 2000,
    remaining_credits: 2000,
    usage_percent: 0,
    accounts_processed: 0,
    accounts_updated: 0,
    updates_log: [],
  });

  const [loading, setLoading] = useState(false);

  const [successMsg, setSuccessMsg] = useState("");

  const [error, setError] = useState("");

  const [sectorOptions, setSectorOptions] = useState([]);

  const [selectedSectors, setSelectedSectors] = useState([]);

  const [sectorsLoading, setSectorsLoading] = useState(false);

  const [stateOptions, setStateOptions] = useState([]);

  const [selectedStates, setSelectedStates] = useState([]);

  const [statesLoading, setStatesLoading] = useState(false);

  // -----------------------------------
  // FETCH METRICS
  // -----------------------------------
  const fetchMetrics = async () => {
    try {
      const response = await axios.get(API_URL);

      const data = {
        ...response.data,
        updates_log: response.data.updates_log || [],
      };

      setMetrics(data);

      console.log("📊 Metrics loaded:", data);
    } catch (error) {
      console.error("❌ Failed to fetch metrics", error);
    }
  };

  const fetchSectors = async () => {
    setSectorsLoading(true);

    try {
      const response = await axios.get(SECTORS_URL);

      const options = response.data?.data || [];

      setSectorOptions(options);
    } catch (error) {
      console.error("❌ Failed to fetch sectors", error);

      setError("Failed to load sectors");
    } finally {
      setSectorsLoading(false);
    }
  };

  const fetchStates = async (sectors = []) => {
    setStatesLoading(true);

    try {
      const response = await axios.get(STATES_URL, {
        params: sectors.length > 0 ? { sectors } : {},
        paramsSerializer: {
          indexes: null,
        },
      });

      const options = response.data?.data || [];

      setStateOptions(options);

      setSelectedStates((currentStates) =>
        currentStates.filter((state) =>
          options.some((option) => option.value === state),
        ),
      );
    } catch (error) {
      console.error("❌ Failed to fetch states", error);

      setError("Failed to load states");
    } finally {
      setStatesLoading(false);
    }
  };

  // -----------------------------------
  // RUN ENRICHMENT
  // -----------------------------------
  const handleRunEnrichment = async () => {
    setLoading(true);

    setError("");

    setSuccessMsg("");

    if (selectedSectors.length === 0) {
      setLoading(false);

      setError("Select at least one sector");

      return;
    }

    try {
      const res = await axios.post(ENRICH_URL, {
        sectors: selectedSectors,
        states: selectedStates,
      });

      const processed = res.data?.processed || 0;

      const updated = res.data?.updated || 0;

      setSuccessMsg(
        `Enrichment complete: ${processed} processed, ${updated} updated`,
      );

      // refresh metrics immediately
      await fetchMetrics();
    } catch (err) {
      console.error(err);

      setError("Failed to run enrichment");
    } finally {
      setLoading(false);
    }
  };

  // -----------------------------------
  // AUTO REFRESH
  // -----------------------------------
  useEffect(() => {
    fetchMetrics();

    fetchSectors();

    const intervalId = setInterval(fetchMetrics, 10000);

    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    fetchStates(selectedSectors);
  }, [selectedSectors]);

  return (
    <>
      {/* ----------------------------------- */}
      {/* FILTERS + RUN BUTTON */}
      {/* ----------------------------------- */}
      <Box sx={{ mb: 3 }}>
        {/* SECTOR FILTER */}
        <FormControl
          fullWidth
          sx={{ mb: 2, maxWidth: 720 }}
          disabled={loading || sectorsLoading}
        >
          <Autocomplete
            multiple
            disableCloseOnSelect
            options={sectorOptions}
            value={sectorOptions.filter((option) =>
              selectedSectors.includes(option.value),
            )}
            onChange={(event, newValue) =>
              setSelectedSectors(newValue.map((option) => option.value))
            }
            getOptionLabel={(option) => option.label}
            isOptionEqualToValue={(option, value) =>
              option.value === value.value
            }
            renderInput={(params) => (
              <TextField
                {...params}
                label="Sectors"
                placeholder="Search sectors"
              />
            )}
            renderOption={(props, option, { selected }) => {
              const { key, ...optionProps } = props;

              return (
                <Box
                  component="li"
                  key={key}
                  {...optionProps}
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    width: "100%",
                    gap: 2,
                  }}
                >
                  <span>{option.label}</span>

                  <span>
                    {selected ? "Selected" : (option.account_count ?? "")}
                  </span>
                </Box>
              );
            }}
            renderTags={(value, getTagProps) =>
              value.map((option, index) => (
                <Chip
                  label={option.label}
                  size="small"
                  {...getTagProps({ index })}
                  key={option.value}
                />
              ))
            }
          />

          <FormHelperText>
            {sectorsLoading
              ? "Loading sectors from Dynamics..."
              : "Select one or more Dynamics sectors to enrich."}
          </FormHelperText>
        </FormControl>

        {/* STATE FILTER */}
        <FormControl
          fullWidth
          sx={{ mb: 2, maxWidth: 720 }}
          disabled={loading || statesLoading}
        >
          <InputLabel id="state-select-label">States</InputLabel>

          <Select
            labelId="state-select-label"
            multiple
            value={selectedStates}
            onChange={(event) => setSelectedStates(event.target.value)}
            input={<OutlinedInput label="States" />}
            renderValue={(selected) => (
              <Box
                sx={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 0.75,
                }}
              >
                {selected.map((state) => (
                  <Chip key={state} label={state} size="small" />
                ))}
              </Box>
            )}
          >
            {stateOptions.map((state) => (
              <MenuItem key={state.value} value={state.value}>
                {state.label} ({state.account_count})
              </MenuItem>
            ))}
          </Select>

          <FormHelperText>
            {statesLoading
              ? "Loading states from Dynamics..."
              : "Optional: narrow enrichment to one or more states."}
          </FormHelperText>
        </FormControl>

        {/* RUN ENRICHMENT BUTTON */}
        <Box
          sx={{
            display: "flex",
            justifyContent: "flex-start",
            maxWidth: 720,
          }}
        >
          <Button
            variant="contained"
            color="primary"
            onClick={handleRunEnrichment}
            disabled={
              loading ||
              sectorsLoading ||
              statesLoading ||
              selectedSectors.length === 0
            }
            sx={{
              mt: 1,
              minWidth: 220,
              height: 44,
              borderRadius: 2,
              fontWeight: 600,
            }}
          >
            {loading ? (
              <CircularProgress size={20} color="inherit" />
            ) : (
              "Run Enrichment"
            )}
          </Button>
        </Box>
      </Box>

      {/* ----------------------------------- */}
      {/* METRICS GRID */}
      {/* ----------------------------------- */}
      <Box
        sx={{
          display: "grid",
          gap: 3,
          gridTemplateColumns: {
            xs: "1fr",
            sm: "repeat(2, minmax(0, 1fr))",
            lg: "repeat(5, minmax(0, 1fr))",
          },
          alignItems: "stretch",
        }}
      >
        {/* CREDITS USED */}
        <Box sx={{ display: "flex" }}>
          <MetricCard
            title="Credits Used"
            value={metrics.credits_used}
            subtitle={`Weekly limit: ${metrics.weekly_limit}`}
          />
        </Box>

        {/* REMAINING CREDITS */}
        <Box sx={{ display: "flex" }}>
          <MetricCard
            title="Remaining Credits"
            value={metrics.remaining_credits}
            subtitle="Available before weekly reset"
          />
        </Box>

        {/* USAGE PERCENT */}
        <Box sx={{ display: "flex" }}>
          <MetricCard
            title="Usage %"
            value={`${Number(metrics.usage_percent || 0).toFixed(1)}%`}
            subtitle="Weekly credit consumption"
          >
            <LinearProgress
              sx={{
                height: 10,
                borderRadius: 999,
                mt: 2,
                backgroundColor: `${theme.palette.primary.main}22`,
                "& .MuiLinearProgress-bar": {
                  backgroundColor: theme.palette.secondary.main,
                },
              }}
              value={Math.min(metrics.usage_percent || 0, 100)}
              variant="determinate"
            />
          </MetricCard>
        </Box>

        {/* ACCOUNTS PROCESSED */}
        <Box sx={{ display: "flex" }}>
          <MetricCard
            title="Accounts Processed"
            value={metrics.accounts_processed}
            subtitle="Every enrichment attempt counted"
          />
        </Box>

        {/* ACCOUNTS UPDATED */}
        <Box sx={{ display: "flex" }}>
          <MetricCard
            title="Accounts Updated"
            value={metrics.accounts_updated}
            subtitle="Dynamics records updated successfully"
          />
        </Box>
      </Box>

      {/* ----------------------------------- */}
      {/* SUCCESS MESSAGE */}
      {/* ----------------------------------- */}
      <Snackbar
        open={!!successMsg}
        autoHideDuration={4000}
        onClose={() => setSuccessMsg("")}
      >
        <Alert severity="success">{successMsg}</Alert>
      </Snackbar>

      {/* ----------------------------------- */}
      {/* ERROR MESSAGE */}
      {/* ----------------------------------- */}
      <Snackbar
        open={!!error}
        autoHideDuration={4000}
        onClose={() => setError("")}
      >
        <Alert severity="error">{error}</Alert>
      </Snackbar>

      {/* ----------------------------------- */}
      {/* RECENT AUDIT HISTORY */}
      {/* ----------------------------------- */}
      <Box sx={{ mt: 5 }}>
        <Typography
          variant="h5"
          sx={{
            mb: 2,
            fontWeight: 700,
            color: "primary.main",
          }}
        >
          Recent Updates
        </Typography>

        {metrics.updates_log?.length === 0 ? (
          <Typography color="text.secondary">No updates yet</Typography>
        ) : (
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            {metrics.updates_log
              .slice()
              .reverse()
              .map((entry, index) => (
                <Card
                  key={index}
                  sx={{
                    borderRadius: 3,
                    boxShadow: "0 5px 20px rgba(0,0,0,0.06)",
                    borderLeft: `5px solid ${theme.palette.secondary.main}`,
                  }}
                >
                  <CardContent>
                    {/* COMPANY */}
                    <Typography
                      variant="h6"
                      sx={{
                        fontWeight: 700,
                        mb: 0.5,
                      }}
                    >
                      {entry.company}
                    </Typography>

                    {/* TIMESTAMP */}
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ mb: 2 }}
                    >
                      {entry.timestamp
                        ? new Date(entry.timestamp).toLocaleString()
                        : ""}
                    </Typography>

                    <Divider sx={{ mb: 2 }} />

                    {/* CHANGES */}
                    {entry.changes?.map((change, idx) => (
                      <Box
                        key={idx}
                        sx={{
                          mb: 1.5,
                          pl: 1,
                        }}
                      >
                        <Typography
                          sx={{
                            fontSize: "0.95rem",
                            lineHeight: 1.6,
                          }}
                        >
                          <strong>{change.field}</strong>:{" "}
                          <span
                            style={{
                              color: "#888",
                            }}
                          >
                            {change.old === null ||
                            change.old === undefined ||
                            change.old === ""
                              ? "null"
                              : String(change.old)}
                          </span>
                          {" → "}
                          <span
                            style={{
                              fontWeight: 600,
                              color: theme.palette.success.main,
                            }}
                          >
                            {change.new === null ||
                            change.new === undefined ||
                            change.new === ""
                              ? "null"
                              : String(change.new)}
                          </span>
                        </Typography>
                      </Box>
                    ))}
                  </CardContent>
                </Card>
              ))}
          </Box>
        )}
      </Box>
    </>
  );
}
