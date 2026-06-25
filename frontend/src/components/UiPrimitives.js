import {
  Box,
  Button,
  DialogTitle,
  IconButton,
  Paper,
  Stack,
  SvgIcon,
  Typography,
} from "@mui/material";

const iconPaths = {
  close: "M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4 6.4 5Z",
  database: "M12 3C7.6 3 4 4.3 4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6c0-1.7-3.6-3-8-3Zm0 2c3.8 0 5.8 1 6 1.3-.2.6-2.2 1.7-6 1.7S6.2 6.9 6 6.3C6.2 6 8.2 5 12 5Zm0 14c-3.8 0-5.8-1-6-1.3v-2.9c1.5.8 3.7 1.2 6 1.2s4.5-.4 6-1.2v2.9c-.2.3-2.2 1.3-6 1.3Zm0-5c-3.8 0-5.8-1-6-1.3V9.8c1.5.8 3.7 1.2 6 1.2s4.5-.4 6-1.2v2.9c-.2.3-2.2 1.3-6 1.3Z",
  search: "M9.5 3a6.5 6.5 0 1 0 3.9 11.7l4.9 4.9 1.4-1.4-4.9-4.9A6.5 6.5 0 0 0 9.5 3Zm0 2a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Z",
  inbox: "M4 4h16l2 9v7H2v-7l2-9Zm1.6 2-1.3 6H8l1 2h6l1-2h3.7l-1.3-6H5.6Z",
};

export function AppIcon({ name = "inbox", ...props }) {
  return (
    <SvgIcon viewBox="0 0 24 24" {...props}>
      <path d={iconPaths[name] || iconPaths.inbox} />
    </SvgIcon>
  );
}

export function ModalTitle({ children, onClose, subtitle }) {
  return (
    <DialogTitle sx={{ borderBottom: "1px solid", borderColor: "divider", px: 3, py: 2.25 }}>
      <Stack alignItems="flex-start" direction="row" justifyContent="space-between" spacing={2}>
        <Box sx={{ minWidth: 0 }}>
          <Typography color="text.primary" component="h2" variant="h5">
            {children}
          </Typography>
          {subtitle ? (
            <Typography color="text.secondary" sx={{ mt: 0.5 }} variant="body2">
              {subtitle}
            </Typography>
          ) : null}
        </Box>
        {onClose ? (
          <IconButton aria-label="Close dialog" onClick={onClose} size="small" sx={{ mt: -0.5 }}>
            <AppIcon fontSize="small" name="close" />
          </IconButton>
        ) : null}
      </Stack>
    </DialogTitle>
  );
}

export function EmptyState({
  actionLabel,
  compact = false,
  description,
  icon = "inbox",
  onAction,
  title,
}) {
  return (
    <Paper
      elevation={0}
      sx={{
        alignItems: "center",
        backgroundColor: "transparent",
        border: 0,
        display: "flex",
        flexDirection: "column",
        px: 3,
        py: compact ? 4 : 6,
        textAlign: "center",
      }}
    >
      <Box
        sx={{
          alignItems: "center",
          backgroundColor: "rgba(18, 59, 100, 0.07)",
          borderRadius: 3,
          color: "primary.main",
          display: "flex",
          height: 48,
          justifyContent: "center",
          mb: 2,
          width: 48,
        }}
      >
        <AppIcon name={icon} />
      </Box>
      <Typography color="text.primary" variant="subtitle1">
        {title}
      </Typography>
      {description ? (
        <Typography color="text.secondary" sx={{ maxWidth: 480, mt: 0.5 }} variant="body2">
          {description}
        </Typography>
      ) : null}
      {actionLabel && onAction ? (
        <Button onClick={onAction} sx={{ mt: 2 }} variant="outlined">
          {actionLabel}
        </Button>
      ) : null}
    </Paper>
  );
}

export const subtleTableHeadCellSx = {
  backgroundColor: "#F1F4F6",
  color: "#385066",
  fontWeight: 700,
  py: 1.25,
};
