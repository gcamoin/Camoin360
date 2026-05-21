import axios from "axios";

export const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || "http://127.0.0.1:8000";
const AUTH_STORAGE_KEY = "sophie:authToken";

export function getAuthToken() {
  return window.localStorage.getItem(AUTH_STORAGE_KEY);
}

export function saveAuthToken(token) {
  window.localStorage.setItem(AUTH_STORAGE_KEY, token);
}

export function clearAuthToken() {
  window.localStorage.removeItem(AUTH_STORAGE_KEY);
}

export function getAuthHeaders() {
  const token = getAuthToken();

  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function getApiErrorMessage(error, fallbackMessage) {
  if (!error.response) {
    return `Cannot reach the backend at ${API_BASE_URL}. Make sure the FastAPI server is running.`;
  }

  const detail = error.response.data?.detail;

  if (typeof detail === "string") {
    return detail;
  }

  if (Array.isArray(detail)) {
    return detail
      .map((item) => item.msg)
      .filter(Boolean)
      .join(" ");
  }

  return fallbackMessage;
}

export async function loginUser(credentials) {
  const response = await axios.post(`${API_BASE_URL}/auth/login`, credentials);
  saveAuthToken(response.data.token);
  return response.data;
}

export async function signupUser(credentials) {
  const response = await axios.post(`${API_BASE_URL}/auth/signup`, credentials);
  saveAuthToken(response.data.token);
  return response.data;
}
