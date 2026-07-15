import { useState } from "react";
import axios from "axios";
import { Alert, Box, Button, CircularProgress, Paper, Stack, TextField, Typography } from "@mui/material";

import { API_BASE_URL, getApiErrorMessage, getAuthHeaders, handleUnauthorized } from "../auth";

const API_URL = `${API_BASE_URL}/ai/chat`;
const INITIAL_MESSAGES = [
  {
    role: "assistant",
    content: "Ask a question about this dashboard view.",
  },
];

export default function AiChatBox({ context, placeholder, section }) {
  const [messages, setMessages] = useState(INITIAL_MESSAGES);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");

  async function sendMessage(event) {
    event.preventDefault();
    const prompt = draft.trim();
    if (!prompt || isSending) {
      return;
    }

    const nextMessages = [...messages, { role: "user", content: prompt }];
    setMessages(nextMessages);
    setDraft("");
    setIsSending(true);
    setError("");

    try {
      const response = await axios.post(
        API_URL,
        {
          context,
          messages: nextMessages.filter((message) => message.role !== "assistant" || message.content !== INITIAL_MESSAGES[0].content),
          section,
        },
        { headers: getAuthHeaders() }
      );

      setMessages((currentMessages) => [
        ...currentMessages,
        { role: "assistant", content: response.data?.answer || "No response returned." },
      ]);
    } catch (sendError) {
      if (handleUnauthorized(sendError)) {
        return;
      }

      setError(getApiErrorMessage(sendError, "Unable to send your question to OpenAI."));
    } finally {
      setIsSending(false);
    }
  }

  return (
    <Paper
      elevation={0}
      sx={{
        backgroundColor: "common.white",
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 2,
        p: { xs: 2, md: 2.5 },
      }}
    >
      <Stack spacing={1.5}>
        <Stack spacing={0.4}>
          <Typography color="text.primary" fontWeight={800}>
            AI Analyst
          </Typography>
          <Typography color="text.secondary" variant="body2">
            Answers use the data currently loaded in this tab.
          </Typography>
        </Stack>

        {error ? <Alert severity="error">{error}</Alert> : null}

        <Stack
          spacing={1}
          sx={{
            maxHeight: 260,
            overflowY: "auto",
            pr: 0.5,
          }}
        >
          {messages.map((message, index) => {
            const isUser = message.role === "user";
            return (
              <Box
                key={`${message.role}-${index}`}
                sx={{
                  alignSelf: isUser ? "flex-end" : "flex-start",
                  backgroundColor: isUser ? "primary.main" : "#f8fafc",
                  border: "1px solid",
                  borderColor: isUser ? "primary.main" : "divider",
                  borderRadius: 1.25,
                  color: isUser ? "common.white" : "text.primary",
                  maxWidth: "88%",
                  px: 1.25,
                  py: 1,
                  whiteSpace: "pre-wrap",
                }}
              >
                <Typography variant="body2">{message.content}</Typography>
              </Box>
            );
          })}
          {isSending ? (
            <Stack alignItems="center" direction="row" spacing={1}>
              <CircularProgress size={16} />
              <Typography color="text.secondary" variant="body2">
                Thinking
              </Typography>
            </Stack>
          ) : null}
        </Stack>

        <Box component="form" onSubmit={sendMessage}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            <TextField
              fullWidth
              multiline
              maxRows={4}
              minRows={1}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={placeholder}
              size="small"
              value={draft}
            />
            <Button
              disabled={!draft.trim() || isSending}
              type="submit"
              variant="contained"
              sx={{ borderRadius: 1, fontWeight: 800, minWidth: 92 }}
            >
              Send
            </Button>
          </Stack>
        </Box>
      </Stack>
    </Paper>
  );
}
