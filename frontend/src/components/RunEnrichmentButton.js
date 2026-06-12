import React, { useState } from "react";
import axios from "axios";
import { Button, CircularProgress, Snackbar, Alert } from "@mui/material";

export default function RunEnrichmentButton({ onComplete }) {
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [error, setError] = useState("");

  const handleRun = async () => {
    setLoading(true);
    setError("");
    setSuccessMsg("");

    try {
      const res = await axios.post("http://localhost:8000/accounts/enrich-all");

      const processed = res.data?.processed || 0;
      const updated = res.data?.updated || 0;

      setSuccessMsg(
        `Enrichment complete: ${processed} processed, ${updated} updated`,
      );

      // 🔥 trigger refresh in dashboard
      if (onComplete) onComplete();
    } catch (err) {
      console.error(err);
      setError("Failed to run enrichment");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        variant="contained"
        color="primary"
        onClick={handleRun}
        disabled={loading}
        sx={{ mb: 3 }}
      >
        {loading ? (
          <CircularProgress size={20} color="inherit" />
        ) : (
          "Run Enrichment"
        )}
      </Button>

      <Snackbar
        open={!!successMsg}
        autoHideDuration={4000}
        onClose={() => setSuccessMsg("")}
      >
        <Alert severity="success">{successMsg}</Alert>
      </Snackbar>

      <Snackbar
        open={!!error}
        autoHideDuration={4000}
        onClose={() => setError("")}
      >
        <Alert severity="error">{error}</Alert>
      </Snackbar>
    </>
  );
}
