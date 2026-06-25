import {
  Box,
  Chip,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { EmptyState, subtleTableHeadCellSx } from "./UiPrimitives";

const columns = [
  { key: "client_name", label: "Client Name", width: 280 },
  { key: "location", label: "Location", width: 240 },
  { key: "users", label: "Users", width: 160 },
  { key: "contract_expiration", label: "Contract Expiration", width: 220 },
];

const tableMinWidth = columns.reduce((totalWidth, column) => totalWidth + column.width, 0);

export default function PEClients() {
  return (
    <Paper
      elevation={0}
      sx={{
        border: "1px solid rgba(0, 51, 108, 0.10)",
        borderRadius: 2,
        overflow: "hidden",
      }}
    >
      <Box
        sx={{
          alignItems: { xs: "flex-start", sm: "center" },
          borderBottom: "1px solid rgba(0, 51, 108, 0.10)",
          display: "flex",
          flexDirection: { xs: "column", sm: "row" },
          gap: 1,
          justifyContent: "space-between",
          px: { xs: 2, md: 3 },
          py: 2,
        }}
      >
        <Box>
          <Typography color="primary.main" sx={{ fontWeight: 800 }} variant="h6">
            PE Clients
          </Typography>
          <Typography color="text.secondary" variant="body2">
            Private equity client access and contract details.
          </Typography>
        </Box>
        <Chip label="0 total" sx={{ fontWeight: 800 }} />
      </Box>

      <TableContainer sx={{ overflowX: "auto" }}>
        <Table size="small" sx={{ minWidth: tableMinWidth, tableLayout: "fixed" }}>
          <TableHead>
            <TableRow>
              {columns.map((column) => (
                <TableCell
                  key={column.key}
                  sx={{
                    ...subtleTableHeadCellSx,
                    width: column.width,
                  }}
                >
                  {column.label}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell colSpan={columns.length} sx={{ p: 0 }}>
                <EmptyState
                  actionLabel="Refresh"
                  description="Client access and contract records will appear here after a data source is connected."
                  icon="database"
                  onAction={() => window.location.reload()}
                  title="No PE clients available"
                />
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}
