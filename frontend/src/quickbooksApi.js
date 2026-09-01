import axios from "axios";

import { API_BASE_URL, getAuthHeaders, handleUnauthorized } from "./auth";

function getNormalizedApiBaseUrl() {
  return API_BASE_URL.replace(/\/+$/, "");
}

function getQuickBooksState(responseData) {
  if (responseData?.state) {
    return responseData.state;
  }

  if (!responseData?.connect_url) {
    return "";
  }

  try {
    const stateUrl = new URL(responseData.connect_url, getNormalizedApiBaseUrl());
    return stateUrl.searchParams.get("state") || "";
  } catch (error) {
    return "";
  }
}

export async function getQuickBooksStatus() {
  try {
    const response = await axios.get(`${getNormalizedApiBaseUrl()}/quickbooks/status`, {
      headers: getAuthHeaders(),
    });
    return response.data;
  } catch (error) {
    handleUnauthorized(error);
    throw error;
  }
}

export async function getQuickBooksConnectUrl() {
  try {
    const response = await axios.post(
      `${getNormalizedApiBaseUrl()}/quickbooks/oauth-state`,
      {},
      { headers: getAuthHeaders() },
    );
    const state = getQuickBooksState(response.data);

    console.info("QuickBooks OAuth state request succeeded.", {
      statePresent: Boolean(state),
    });

    if (!state) {
      const error = new Error("QuickBooks authorization could not start because the backend did not return an OAuth state.");
      error.userMessage = error.message;
      throw error;
    }

    const connectUrl = new URL("/quickbooks/connect", getNormalizedApiBaseUrl());
    connectUrl.searchParams.set("state", state);

    console.info("QuickBooks connect URL prepared.", {
      host: connectUrl.host,
      path: connectUrl.pathname,
    });

    return connectUrl.toString();
  } catch (error) {
    handleUnauthorized(error);
    throw error;
  }
}

export async function disconnectQuickBooks() {
  try {
    const response = await axios.post(
      `${getNormalizedApiBaseUrl()}/quickbooks/disconnect`,
      {},
      { headers: getAuthHeaders() },
    );
    return response.data;
  } catch (error) {
    handleUnauthorized(error);
    throw error;
  }
}
