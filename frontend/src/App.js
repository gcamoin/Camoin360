import { useEffect, useState } from "react";
import { clearAuthToken, getAuthToken, loginUser, onUnauthorized, signupUser } from "./auth";
import LandingPage from "./landingPage";
import Login from "./login";
import ManagementDashboard from "./managementDashboard";
import SignUp from "./signup";

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(() => Boolean(getAuthToken()));
  const [authView, setAuthView] = useState("login");
  const [dashboardView, setDashboardView] = useState("main");

  useEffect(() => {
    return onUnauthorized(() => {
      setIsLoggedIn(false);
      setAuthView("login");
      setDashboardView("main");
    });
  }, []);

  async function handleLogin(credentials) {
    await loginUser(credentials);
    setDashboardView("main");
    setIsLoggedIn(true);
  }

  async function handleManagementLogin(credentials) {
    await loginUser(credentials);
    setDashboardView("management");
    setIsLoggedIn(true);
  }

  async function handleSignup(credentials) {
    await signupUser(credentials);
    setDashboardView("main");
    setIsLoggedIn(true);
  }

  function handleLogout() {
    clearAuthToken();
    setIsLoggedIn(false);
    setAuthView("login");
    setDashboardView("main");
  }

  if (isLoggedIn) {
    if (dashboardView === "management") {
      return <ManagementDashboard onLogout={handleLogout} />;
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
      onManagementLogin={handleManagementLogin}
      onShowSignup={() => setAuthView("signup")}
    />
  );
}
