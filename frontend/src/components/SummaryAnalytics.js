import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  Alert,
  Box,
  Card,
  CardContent,
  CircularProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  useTheme,
} from "@mui/material";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { API_BASE_URL, getApiErrorMessage, getAuthHeaders, handleUnauthorized } from "../auth";

const API_URL = `${API_BASE_URL}/accounts/summary-analytics`;

const numberFormatter = new Intl.NumberFormat();
let summaryAnalyticsCache = null;

function SummaryCard({ title, value, subtitle, valueSx }) {
  return (
    <Card
      elevation={0}
      sx={{
        border: "1px solid rgba(0, 51, 108, 0.10)",
        borderRadius: 2,
        boxShadow: "0 10px 30px rgba(0, 51, 108, 0.06)",
        height: "100%",
      }}
    >
      <CardContent sx={{ minWidth: 0, p: 2.5, "&:last-child": { pb: 2.5 } }}>
        <Typography color="text.secondary" variant="overline">
          {title}
        </Typography>
        <Typography
          color="primary.main"
          sx={{
            fontSize: { xs: "2rem", md: "2.35rem" },
            fontWeight: 800,
            lineHeight: 1.1,
            mt: 0.75,
            ...valueSx,
          }}
        >
          {value}
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.75 }} variant="body2">
          {subtitle}
        </Typography>
      </CardContent>
    </Card>
  );
}

export default function SummaryAnalytics() {
  const theme = useTheme();
  const [summary, setSummary] = useState({
    total_accounts: 0,
    sector_count: 0,
    sectors: [],
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function fetchSummary() {
      if (summaryAnalyticsCache) {
        setSummary(summaryAnalyticsCache);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError("");

      try {
        const response = await axios.get(API_URL, { headers: getAuthHeaders() });
        if (isMounted) {
          const nextSummary = {
            total_accounts: response.data?.total_accounts || 0,
            sector_count: response.data?.sector_count || 0,
            sectors: response.data?.sectors || [],
          };
          summaryAnalyticsCache = nextSummary;
          setSummary(nextSummary);
        }
      } catch (fetchError) {
        if (handleUnauthorized(fetchError)) {
          return;
        }

        if (isMounted) {
          setError(getApiErrorMessage(fetchError, "Unable to load sector summary."));
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    fetchSummary();

    return () => {
      isMounted = false;
    };
  }, []);

  const chartData = useMemo(
    () =>
      summary.sectors.map((sector) => ({
        ...sector,
        short_sector: sector.sector.length > 24 ? `${sector.sector.slice(0, 24)}...` : sector.sector,
      })),
    [summary.sectors]
  );
  const visibleChartData = chartData.slice(0, 12);

  const topSector = summary.sectors[0];
  const averageAccountsPerSector = summary.sector_count
    ? Math.round(summary.total_accounts / summary.sector_count)
    : 0;

  if (isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return <Alert severity="error">{error}</Alert>;
  }

  return (
    <Box sx={{ display: "grid", gap: 3 }}>
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
          subtitle="Dynamics accounts included in this summary"
          title="Total Accounts"
          value={numberFormatter.format(summary.total_accounts)}
        />
        <SummaryCard
          subtitle="Unique sector values, including unspecified"
          title="Sectors"
          value={numberFormatter.format(summary.sector_count)}
        />
        <SummaryCard
          subtitle={topSector ? `${numberFormatter.format(topSector.account_count)} accounts` : "No sector data found"}
          title="Largest Sector"
          value={topSector?.sector || "None"}
          valueSx={{
            fontSize: { xs: "1.35rem", md: "1.55rem" },
            overflowWrap: "anywhere",
            wordBreak: "break-word",
          }}
        />
        <SummaryCard
          subtitle="Rounded across all sectors"
          title="Avg. Accounts"
          value={numberFormatter.format(averageAccountsPerSector)}
        />
      </Box>

      <Paper
        elevation={0}
        sx={{
          border: "1px solid rgba(0, 51, 108, 0.10)",
          borderRadius: 2,
          p: { xs: 2, md: 3 },
        }}
      >
        <Typography color="primary.main" sx={{ fontWeight: 800, mb: 2 }} variant="h6">
          Accounts by Sector
        </Typography>
        <Box sx={{ height: { xs: 420, md: 520 }, width: "100%" }}>
          {visibleChartData.length ? (
            <ResponsiveContainer height="100%" width="100%">
              <BarChart
                data={visibleChartData}
                layout="vertical"
                margin={{ top: 10, right: 52, left: 24, bottom: 10 }}
              >
                <CartesianGrid horizontal={false} stroke="rgba(0, 51, 108, 0.12)" strokeDasharray="3 3" />
                <XAxis
                  allowDecimals={false}
                  tick={{ fill: theme.palette.text.secondary, fontSize: 12 }}
                  type="number"
                />
                <YAxis
                  dataKey="short_sector"
                  tick={{ fill: theme.palette.text.secondary, fontSize: 12 }}
                  type="category"
                  width={170}
                />
                <Tooltip
                  formatter={(value) => [numberFormatter.format(value), "Accounts"]}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.sector || ""}
                />
                <Bar dataKey="account_count" fill={theme.palette.secondary.main} name="Accounts" radius={[0, 4, 4, 0]}>
                  <LabelList
                    dataKey="account_count"
                    formatter={(value) => numberFormatter.format(value)}
                    position="right"
                    style={{ fill: theme.palette.text.primary, fontSize: 12, fontWeight: 700 }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <Box sx={{ alignItems: "center", display: "flex", height: "100%", justifyContent: "center" }}>
              <Typography color="text.secondary">No sector data found.</Typography>
            </Box>
          )}
        </Box>
      </Paper>

      <Paper
        elevation={0}
        sx={{
          border: "1px solid rgba(0, 51, 108, 0.10)",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <TableContainer sx={{ maxHeight: "calc(100vh - 360px)" }}>
          <Table stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell
                  sx={{
                    backgroundColor: "primary.main",
                    color: "common.white",
                    fontWeight: 800,
                  }}
                >
                  Sector
                </TableCell>
                <TableCell
                  align="right"
                  sx={{
                    backgroundColor: "primary.main",
                    color: "common.white",
                    fontWeight: 800,
                    whiteSpace: "nowrap",
                  }}
                >
                  Account Count
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {summary.sectors.length ? (
                summary.sectors.map((sector) => (
                  <TableRow key={sector.sector} hover>
                    <TableCell>{sector.sector}</TableCell>
                    <TableCell align="right">{numberFormatter.format(sector.account_count)}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={2}>
                    <Typography color="text.secondary" sx={{ py: 3, textAlign: "center" }}>
                      No sector data found.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Box>
  );
}
