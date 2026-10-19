import { useEffect, useState } from "react";
import {
  clearAuthToken,
  getAllowedDashboardViews,
  getAuthToken,
  getCurrentUser,
  getDefaultDashboardView,
  getPreferredAllowedDashboardView,
  loginUser,
  onUnauthorized,
  savePreferredDashboardView,
} from "./auth";
import AdminDashboard from "./adminDashboard";
import LandingPage from "./landingPage";
import LegalPage from "./legalPages";
import Login from "./login";
import QuickBooksSettings from "./QuickBooksSettings";
import ConsultingDashboard from "./consultingDashboard";
import ManagementDashboard from "./managementDashboard";
import ProspectingDashboard from "./prospectingDashboard";

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(() => Boolean(getAuthToken()));
  const [currentUser, setCurrentUser] = useState(getCurrentUser);
  const [dashboardView, setDashboardView] = useState(() => getPreferredAllowedDashboardView(getCurrentUser()));

  useEffect(() => {
    return onUnauthorized(() => {
      setIsLoggedIn(false);
      setCurrentUser(null);
    });
  }, []);

  async function handleLogin(credentials, nextDashboardView) {
    const user = await loginUser(credentials);
    const allowedDashboardViews = getAllowedDashboardViews(user);
    const resolvedDashboardView = allowedDashboardViews.some((option) => option.value === nextDashboardView)
      ? nextDashboardView
      : getDefaultDashboardView(user);

    savePreferredDashboardView(resolvedDashboardView);
    setCurrentUser(user);
    setDashboardView(resolvedDashboardView);
    setIsLoggedIn(true);
  }

  function handleLogout() {
    clearAuthToken();
    setIsLoggedIn(false);
    setCurrentUser(null);
  }

  if (window.location.pathname === "/terms") {
    return <LegalPage type="terms" />;
  }

  if (window.location.pathname === "/privacy") {
    return <LegalPage type="privacy" />;
  }

  if (isLoggedIn) {
    if (window.location.pathname === "/settings/integrations/quickbooks") {
      return <QuickBooksSettings onLogout={handleLogout} />;
    }

    const allowedDashboardViews = getAllowedDashboardViews(currentUser);
    const resolvedDashboardView = allowedDashboardViews.some((option) => option.value === dashboardView)
      ? dashboardView
      : getDefaultDashboardView(currentUser);

    if (resolvedDashboardView === "admin") {
      return <AdminDashboard onLogout={handleLogout} />;
    }

    if (resolvedDashboardView === "management") {
      return <ManagementDashboard onLogout={handleLogout} />;
    }

    if (resolvedDashboardView === "prospecting") {
      return <ProspectingDashboard onLogout={handleLogout} />;
    }

    if (resolvedDashboardView === "consulting") {
      return <ConsultingDashboard onLogout={handleLogout} />;
    }

    return <LandingPage onLogout={handleLogout} />;
  }

  return <Login onLogin={handleLogin} />;
}
