import React, { useEffect, useState } from "react";
import axios from "axios";
import {
  Card,
  CardContent,
  Box,
  LinearProgress,
  Typography,
  useTheme,
} from "@mui/material";

import { API_BASE_URL, getAuthHeaders } from "../auth";

const API_URL = `${API_BASE_URL}/metrics`;

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
        <Typography sx={{ ...valueSx, color: "primary.main" }}>{value}</Typography>
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
  });

  useEffect(() => {
    let isMounted = true;

    const fetchMetrics = async () => {
      try {
        const response = await axios.get(API_URL, { headers: getAuthHeaders() });
        if (isMounted) {
          setMetrics(response.data);
        }
      } catch (error) {
        console.error("Failed to fetch metrics", error);
      }
    };

    fetchMetrics();
    const intervalId = setInterval(fetchMetrics, 10000);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, []);

  return (
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
      <Box sx={{ display: "flex" }}>
        <MetricCard
          title="Credits Used"
          value={metrics.credits_used}
          subtitle={`Weekly limit: ${metrics.weekly_limit}`}
        />
      </Box>
      <Box sx={{ display: "flex" }}>
        <MetricCard
          title="Remaining Credits"
          value={metrics.remaining_credits}
          subtitle="Available before weekly reset"
        />
      </Box>
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
      <Box sx={{ display: "flex" }}>
        <MetricCard
          title="Accounts Processed"
          value={metrics.accounts_processed}
          subtitle="Every enrichment attempt counted"
        />
      </Box>
      <Box sx={{ display: "flex" }}>
        <MetricCard
          title="Accounts Updated"
          value={metrics.accounts_updated}
          subtitle="Dynamics records changed successfully"
        />
      </Box>
    </Box>
  );
}
