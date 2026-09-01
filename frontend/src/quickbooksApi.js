import axios from "axios";

import { API_BASE_URL, getAuthHeaders, handleUnauthorized } from "./auth";

export async function getQuickBooksStatus() {
  try {
    const response = await axios.get(`${API_BASE_URL}/quickbooks/status`, {
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
      `${API_BASE_URL}/quickbooks/oauth-state`,
      {},
      { headers: getAuthHeaders() },
    );
    const connectUrl = response.data?.connect_url;

    if (!connectUrl) {
      throw new Error("QuickBooks connect URL was not returned.");
    }

    return `${API_BASE_URL}${connectUrl}`;
  } catch (error) {
    handleUnauthorized(error);
    throw error;
  }
}

export async function disconnectQuickBooks() {
  try {
    const response = await axios.post(
      `${API_BASE_URL}/quickbooks/disconnect`,
      {},
      { headers: getAuthHeaders() },
    );
    return response.data;
  } catch (error) {
    handleUnauthorized(error);
    throw error;
  }
}
