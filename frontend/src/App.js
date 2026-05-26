import { useState } from "react";
import { clearAuthToken, getAuthToken, loginUser, signupUser } from "./auth";
import LandingPage from "./landingPage";
import Login from "./login";
import SignUp from "./signup";

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(() => Boolean(getAuthToken()));
  const [authView, setAuthView] = useState("login");

  async function handleLogin(credentials) {
    await loginUser(credentials);
    setIsLoggedIn(true);
  }

  async function handleSignup(credentials) {
    await signupUser(credentials);
    setIsLoggedIn(true);
  }

  function handleLogout() {
    clearAuthToken();
    setIsLoggedIn(false);
    setAuthView("login");
  }

  if (isLoggedIn) {
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
