import axios from "axios";

function getDefaultApiBaseUrl() {
  const hostname = window.location.hostname || "127.0.0.1";
  return `http://${hostname}:8000`;
}

export const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || getDefaultApiBaseUrl();
const AUTH_STORAGE_KEY = "sophie:authToken";
const UNAUTHORIZED_EVENT = "sophie:auth-unauthorized";

function decodeTokenPayload(token) {
  try {
    const [body] = token.split(".");
    const normalizedBody = body.replace(/-/g, "+").replace(/_/g, "/");
    const paddedBody = normalizedBody.padEnd(
      normalizedBody.length + ((4 - (normalizedBody.length % 4)) % 4),
      "="
    );
    return JSON.parse(window.atob(paddedBody));
  } catch (error) {
    return null;
  }
}

export function isTokenExpired(token) {
  const payload = decodeTokenPayload(token);
  const expiresAt = Number(payload?.exp || 0);

  return !expiresAt || expiresAt * 1000 <= Date.now();
}

export function getAuthToken() {
  const token = window.localStorage.getItem(AUTH_STORAGE_KEY);

  if (token && isTokenExpired(token)) {
    clearAuthToken();
    return null;
  }

  return token;
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

export function isUnauthorizedError(error) {
  return error.response?.status === 401;
}

export function handleUnauthorized(error) {
  if (!isUnauthorizedError(error)) {
    return false;
  }

  clearAuthToken();
  window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  return true;
}

export function onUnauthorized(callback) {
  window.addEventListener(UNAUTHORIZED_EVENT, callback);
  return () => window.removeEventListener(UNAUTHORIZED_EVENT, callback);
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
