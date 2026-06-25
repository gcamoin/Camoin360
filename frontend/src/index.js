import React from "react";
import ReactDOM from "react-dom/client";
import { CssBaseline, ThemeProvider, createTheme } from "@mui/material";

import App from "./App";

const BRAND_BLUE = "#123B64";
const BRAND_GREEN = "#668A2E";
const INK = "#18324A";
const MUTED_INK = "#5D7185";
const BORDER = "#DDE5EA";

const theme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: BRAND_BLUE,
    },
    secondary: {
      main: BRAND_GREEN,
    },
    text: {
      primary: INK,
      secondary: MUTED_INK,
    },
    background: {
      default: "#F5F7F8",
      paper: "#ffffff",
    },
    divider: BORDER,
  },
  shape: {
    borderRadius: 12,
  },
  typography: {
    fontFamily:
      'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    h1: {
      fontSize: "2.5rem",
      fontWeight: 750,
      letterSpacing: "-0.035em",
      lineHeight: 1.08,
    },
    h2: {
      fontSize: "2rem",
      fontWeight: 750,
      letterSpacing: "-0.025em",
      lineHeight: 1.12,
    },
    h3: {
      fontSize: "1.5rem",
      fontWeight: 700,
      letterSpacing: "-0.015em",
      lineHeight: 1.2,
    },
    h4: {
      fontSize: "1.25rem",
      fontWeight: 700,
      lineHeight: 1.25,
    },
    h5: {
      fontSize: "1.125rem",
      fontWeight: 700,
      lineHeight: 1.3,
    },
    h6: {
      fontSize: "1rem",
      fontWeight: 700,
      lineHeight: 1.35,
    },
    subtitle1: {
      fontSize: "0.95rem",
      fontWeight: 650,
      lineHeight: 1.45,
    },
    body1: {
      fontSize: "0.95rem",
      lineHeight: 1.6,
    },
    body2: {
      fontSize: "0.875rem",
      lineHeight: 1.5,
    },
    button: {
      fontSize: "0.875rem",
      fontWeight: 650,
      letterSpacing: 0,
      textTransform: "none",
    },
    overline: {
      fontSize: "0.7rem",
      fontWeight: 700,
      letterSpacing: "0.09em",
      lineHeight: 1.6,
    },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          WebkitFontSmoothing: "antialiased",
          MozOsxFontSmoothing: "grayscale",
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
        },
      },
    },
    MuiButton: {
      defaultProps: {
        disableElevation: true,
      },
      styleOverrides: {
        root: {
          borderRadius: 8,
          minHeight: 38,
          paddingInline: 16,
        },
        containedPrimary: {
          boxShadow: "0 1px 2px rgba(18, 59, 100, 0.16)",
          "&:hover": {
            boxShadow: "0 5px 14px rgba(18, 59, 100, 0.18)",
          },
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 7,
          fontWeight: 650,
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 9,
          backgroundColor: "#FFFFFF",
          "&:hover .MuiOutlinedInput-notchedOutline": {
            borderColor: "#9FB0BF",
          },
        },
        notchedOutline: {
          borderColor: "#CBD6DE",
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          border: `1px solid ${BORDER}`,
          borderRadius: 14,
          boxShadow: "0 24px 60px rgba(24, 50, 74, 0.18)",
        },
      },
    },
    MuiDialogContent: {
      styleOverrides: {
        root: {
          padding: 24,
        },
        dividers: {
          borderColor: BORDER,
        },
      },
    },
    MuiDialogActions: {
      styleOverrides: {
        root: {
          gap: 8,
          padding: "16px 24px",
          borderTop: `1px solid ${BORDER}`,
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderBottom: `1px solid ${BORDER}`,
          color: INK,
          paddingBlock: 12,
        },
        head: {
          backgroundColor: "#F1F4F6",
          color: "#385066",
          fontSize: "0.75rem",
          fontWeight: 700,
          letterSpacing: "0.035em",
          textTransform: "uppercase",
        },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          "&.MuiTableRow-hover:hover": {
            backgroundColor: "#F7F9FA",
          },
        },
      },
    },
    MuiTablePagination: {
      styleOverrides: {
        root: {
          borderTop: `1px solid ${BORDER}`,
          color: MUTED_INK,
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: 9,
        },
      },
    },
  },
});

const root = ReactDOM.createRoot(document.getElementById("root"));

root.render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  </React.StrictMode>
);
