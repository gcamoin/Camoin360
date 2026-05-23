import React, { useEffect, useState } from "react";
import axios from "axios";
import {
  Alert,
  Box,
  CircularProgress,
  Link,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";

import { API_BASE_URL, getApiErrorMessage, getAuthHeaders } from "../auth";

const API_URL = `${API_BASE_URL}/accounts/data-quality`;

const columns = [
  { key: "name", label: "Account Name" },
  { key: "address1_stateorprovince", label: "Address" },
  { key: "new_sector", label: "Sector" },
  { key: "description", label: "Description" },
  { key: "websiteurl", label: "Website" },
];

function renderCell(account, columnKey) {
  const value = account[columnKey];

  if (!value) {
    return (
      <Typography color="text.secondary" variant="body2">
        Missing
      </Typography>
    );
  }

  if (columnKey === "websiteurl") {
    const href = String(value).startsWith("http") ? value : `https://${value}`;

    return (
      <Link href={href} rel="noreferrer" target="_blank" underline="hover">
        {value}
      </Link>
    );
  }

  return value;
}

export default function DataQualityTable() {
  const [accounts, setAccounts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

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
    <Paper
      elevation={0}
      sx={{
        border: "1px solid rgba(0, 51, 108, 0.10)",
        borderRadius: 2,
        overflow: "hidden",
      }}
    >
      <TableContainer sx={{ maxHeight: "calc(100vh - 230px)" }}>
        <Table stickyHeader>
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
                  }}
                >
                  {column.label}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {accounts.length ? (
              accounts.map((account, index) => (
                <TableRow key={account.accountid || `${account.name}-${index}`} hover>
                  {columns.map((column) => (
                    <TableCell
                      key={column.key}
                      sx={{
                        maxWidth: column.key === "description" ? 420 : 220,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        verticalAlign: "top",
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
  );
}
