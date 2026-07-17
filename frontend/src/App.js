import { useEffect, useState } from "react";
import {
  clearAuthToken,
  getAuthToken,
  getPreferredDashboardView,
  loginUser,
  onUnauthorized,
  savePreferredDashboardView,
  signupUser,
} from "./auth";
import LandingPage from "./landingPage";
import Login from "./login";
import ConsultingDashboard from "./consultingDashboard";
import ManagementDashboard from "./managementDashboard";
import ProspectingDashboard from "./prospectingDashboard";
import SignUp from "./signup";

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(() => Boolean(getAuthToken()));
  const [authView, setAuthView] = useState("login");
  const [dashboardView, setDashboardView] = useState(getPreferredDashboardView);

  useEffect(() => {
    return onUnauthorized(() => {
      setIsLoggedIn(false);
      setAuthView("login");
    });
  }, []);

  async function handleLogin(credentials, nextDashboardView) {
    await loginUser(credentials);
    savePreferredDashboardView(nextDashboardView);
    setDashboardView(nextDashboardView);
    setIsLoggedIn(true);
  }

  async function handleSignup(credentials) {
    await signupUser(credentials);
    savePreferredDashboardView("main");
    setDashboardView("main");
    setIsLoggedIn(true);
  }

  function handleLogout() {
    clearAuthToken();
    setIsLoggedIn(false);
    setAuthView("login");
  }

  if (isLoggedIn) {
    if (dashboardView === "management") {
      return <ManagementDashboard onLogout={handleLogout} />;
    }

    if (dashboardView === "prospecting") {
      return <ProspectingDashboard onLogout={handleLogout} />;
    }

    if (dashboardView === "consulting") {
      return <ConsultingDashboard onLogout={handleLogout} />;
    }

    return <LandingPage onLogout={handleLogout} />;
  }

  if (authView === "signup") {
    return (
      <SignUp
        onShowLogin={() => setAuthView("login")}
        onSignup={handleSignup}
      />
    );
  }

  return (
    <Login
      onLogin={handleLogin}
      onShowSignup={() => setAuthView("signup")}
    />
  );
}
