import React from "react";
import ReactDOM from "react-dom/client";
import { CssBaseline, ThemeProvider, createTheme } from "@mui/material";

import App from "./App";

const BRAND_BLUE = "#00336C";
const BRAND_GREEN = "#648315";

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
      primary: BRAND_BLUE,
      secondary: "rgba(0, 51, 108, 0.72)",
    },
    background: {
      default: "#f6f8f4",
      paper: "#ffffff",
    },
  },
  shape: {
    borderRadius: 16,
  },
  typography: {
    fontFamily: '"Segoe UI", "Helvetica Neue", Arial, sans-serif',
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
