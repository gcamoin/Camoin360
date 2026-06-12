import React, { useEffect, useState } from "react";
import axios from "axios";
import {
  Alert,
  Box,
  Card,
  CardContent,
  CircularProgress,
  FormControl,
  InputLabel,
  Link,
  MenuItem,
  Paper,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";

import { API_BASE_URL, getApiErrorMessage, getAuthHeaders, handleUnauthorized } from "../auth";

const API_URL = `${API_BASE_URL}/accounts/data-quality`;

const columns = [
  { key: "name", label: "Account Name", width: "17%" },
  { key: "address1_stateorprovince", label: "Address", width: "9%" },
  { key: "new_sector", label: "Sector", width: "14%" },
  { key: "description", label: "Description", width: "25%" },
  { key: "websiteurl", label: "Website", width: "12%" },
  { key: "telephone1", label: "Telephone", width: "8%" },
  { key: "new_datasource", label: "Data Source", width: "7%" },
  { key: "new_employees", label: "Employees", width: "8%" },
];

function isMissingValue(value) {
  return value === null || value === undefined || String(value).trim() === "";
}

function renderCell(account, columnKey) {
  const value = account[columnKey];

  if (isMissingValue(value)) {
    return (
      <Typography color="text.secondary" variant="body2">
        Missing
      </Typography>
    );
  }

  if (columnKey === "websiteurl") {
    const href = String(value).startsWith("http") ? value : `https://${value}`;

    return (
      <Link
        href={href}
        rel="noreferrer"
        sx={{
          display: "block",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        target="_blank"
        underline="hover"
      >
        {value}
      </Link>
    );
  }

  if (columnKey === "description") {
    return (
      <Tooltip arrow title={String(value)}>
        <Typography
          component="span"
          sx={{
            display: "-webkit-box",
            overflow: "hidden",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: 3,
          }}
          variant="body2"
        >
          {value}
        </Typography>
      </Tooltip>
    );
  }

  return value;
}

export default function DataQualityTable() {
  const [accounts, setAccounts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedSector, setSelectedSector] = useState("all");

  const sectors = Array.from(
    new Set(
      accounts
        .map((account) => account.new_sector)
        .filter((sector) => !isMissingValue(sector))
        .map((sector) => String(sector).trim())
    )
  ).sort((a, b) => a.localeCompare(b));

  const filteredAccounts =
    selectedSector === "all"
      ? accounts
      : accounts.filter((account) => String(account.new_sector || "").trim() === selectedSector);

  const missingCounts = columns.map((column) => ({
    ...column,
    missing: filteredAccounts.filter((account) => isMissingValue(account[column.key])).length,
  }));

  useEffect(() => {
    let isMounted = true;

    async function fetchAccounts() {
      setIsLoading(true);
      setError("");

      try {
        const response = await axios.get(API_URL, { headers: getAuthHeaders() });
        if (isMounted) {
          setAccounts(response.data?.data || []);
        }
      } catch (fetchError) {
        if (handleUnauthorized(fetchError)) {
          return;
        }

        if (isMounted) {
          setError(getApiErrorMessage(fetchError, "Unable to load account data."));
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    fetchAccounts();

    return () => {
      isMounted = false;
    };
  }, []);

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
      <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
        <FormControl sx={{ minWidth: { xs: "100%", sm: 280 } }} size="small">
          <InputLabel id="sector-filter-label">Sector</InputLabel>
          <Select
            label="Sector"
            labelId="sector-filter-label"
            onChange={(event) => setSelectedSector(event.target.value)}
            value={selectedSector}
          >
            <MenuItem value="all">All sectors</MenuItem>
            {sectors.map((sector) => (
              <MenuItem key={sector} value={sector}>
                {sector}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

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
        {missingCounts.map((column) => (
          <Card
            key={column.key}
            elevation={0}
            sx={{
              border: "1px solid rgba(0, 51, 108, 0.10)",
              borderRadius: 2,
              boxShadow: "0 10px 30px rgba(0, 51, 108, 0.06)",
            }}
          >
            <CardContent sx={{ p: 2.5, "&:last-child": { pb: 2.5 } }}>
              <Typography color="text.secondary" variant="overline">
                Missing {column.label}
              </Typography>
              <Typography color="primary.main" sx={{ fontSize: "2rem", fontWeight: 800, lineHeight: 1.1 }}>
                {column.missing}
              </Typography>
              <Typography color="text.secondary" variant="body2">
                of {filteredAccounts.length} accounts
              </Typography>
            </CardContent>
          </Card>
        ))}
      </Box>

      <Paper
        elevation={0}
        sx={{
          border: "1px solid rgba(0, 51, 108, 0.10)",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <TableContainer sx={{ maxHeight: "calc(100vh - 360px)" }}>
          <Table stickyHeader sx={{ tableLayout: "fixed", width: "100%" }}>
            <TableHead>
              <TableRow>
                {columns.map((column) => (
                  <TableCell
                    key={column.key}
                    sx={{
                      backgroundColor: "primary.main",
                      color: "common.white",
                      fontWeight: 800,
                      whiteSpace: "nowrap",
                      width: column.width,
                    }}
                  >
                    {column.label}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredAccounts.length ? (
                filteredAccounts.map((account, index) => (
                  <TableRow key={account.accountid || `${account.name}-${index}`} hover>
                    {columns.map((column) => (
                      <TableCell
                        key={column.key}
                        sx={{
                          overflow: "hidden",
                          px: 1.5,
                          textOverflow: "ellipsis",
                          verticalAlign: "top",
                          whiteSpace: column.key === "description" ? "normal" : "nowrap",
                          wordBreak: column.key === "description" ? "break-word" : "normal",
                        }}
                      >
                        {renderCell(account, column.key)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={columns.length}>
                    <Typography color="text.secondary" sx={{ py: 3, textAlign: "center" }}>
                      No account records found.
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
