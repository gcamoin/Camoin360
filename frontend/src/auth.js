import axios from "axios";
import { clearApiCache } from "./apiClient";

function getDefaultApiBaseUrl() {
  const hostname = window.location.hostname || "127.0.0.1";
  return `http://${hostname}:8000`;
}

export const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || getDefaultApiBaseUrl();
const AUTH_STORAGE_KEY = "sophie:authToken";
const AUTH_USER_STORAGE_KEY = "sophie:authUser";
const DASHBOARD_STORAGE_KEY = "sophie:dashboardView";
const UNAUTHORIZED_EVENT = "sophie:auth-unauthorized";
export const MODULE_OPTIONS = [
  { value: "main", label: "Sophie Maintenance" },
  { value: "prospecting", label: "Prospecting" },
  { value: "consulting", label: "Consulting" },
  { value: "management", label: "Management" },
  { value: "admin", label: "Admin" },
];
const DASHBOARD_VIEWS = new Set(MODULE_OPTIONS.map((option) => option.value));

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

export function getCurrentUser() {
  const storedUser = window.localStorage.getItem(AUTH_USER_STORAGE_KEY);

  if (!storedUser) {
    const tokenPayload = decodeTokenPayload(window.localStorage.getItem(AUTH_STORAGE_KEY) || "");

    if (!tokenPayload?.sub) {
      return null;
    }

    return {
      name: tokenPayload.name || tokenPayload.sub,
      email: tokenPayload.sub,
      role: tokenPayload.role || "user",
      modules: Array.isArray(tokenPayload.modules) ? tokenPayload.modules : [],
    };
  }

  try {
    return JSON.parse(storedUser);
  } catch (error) {
    window.localStorage.removeItem(AUTH_USER_STORAGE_KEY);
    return null;
  }
}

export function saveCurrentUser(user) {
  const currentUser = {
    name: user.name,
    email: user.email,
    role: user.role || "user",
    modules: Array.isArray(user.modules) ? user.modules : [],
  };
  window.localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(currentUser));
}

export function clearAuthToken() {
  window.localStorage.removeItem(AUTH_STORAGE_KEY);
  window.localStorage.removeItem(AUTH_USER_STORAGE_KEY);
  clearApiCache();
}

export function getAllowedDashboardViews(user = getCurrentUser()) {
  const modules = Array.isArray(user?.modules) ? user.modules : [];
  return MODULE_OPTIONS.filter((option) => modules.includes(option.value));
}

export function getDefaultDashboardView(user = getCurrentUser()) {
  return getAllowedDashboardViews(user)[0]?.value || "main";
}

export function getPreferredDashboardView() {
  const dashboardView = window.localStorage.getItem(DASHBOARD_STORAGE_KEY);
  return DASHBOARD_VIEWS.has(dashboardView) ? dashboardView : "main";
}

export function getPreferredAllowedDashboardView(user = getCurrentUser()) {
  const preferredDashboardView = getPreferredDashboardView();
  const allowedDashboardViews = getAllowedDashboardViews(user);

  if (allowedDashboardViews.some((option) => option.value === preferredDashboardView)) {
    return preferredDashboardView;
  }

  return allowedDashboardViews[0]?.value || "main";
}

export function savePreferredDashboardView(dashboardView) {
  if (DASHBOARD_VIEWS.has(dashboardView)) {
    window.localStorage.setItem(DASHBOARD_STORAGE_KEY, dashboardView);
  }
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
  if (error.code === "ECONNABORTED") {
    return "The request is taking longer than expected. Try again; cached data may be available shortly.";
  }

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
  saveCurrentUser(response.data);
  return response.data;
}

export async function listAppUsers() {
  const response = await axios.get(`${API_BASE_URL}/auth/users`, { headers: getAuthHeaders() });
  return response.data.users;
}

export async function createAppUser(user) {
  const response = await axios.post(`${API_BASE_URL}/auth/users`, user, { headers: getAuthHeaders() });
  return response.data;
}

export async function updateAppUser(email, user) {
  const response = await axios.patch(`${API_BASE_URL}/auth/users/${encodeURIComponent(email)}`, user, {
    headers: getAuthHeaders(),
  });
  return response.data;
}

export async function deleteAppUser(email) {
  await axios.delete(`${API_BASE_URL}/auth/users/${encodeURIComponent(email)}`, { headers: getAuthHeaders() });
}
