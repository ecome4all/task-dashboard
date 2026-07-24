import { useEffect, useState } from "react";
import { CurrentUser, fetchCurrentUser, logout, setUnauthorizedHandler } from "./api";
import Login from "./Login";
import Dashboard from "./Dashboard";
import Employees from "./Employees";
import Clients from "./Clients";
import ClientUpdate from "./ClientUpdate";
import Settings from "./Settings";
import { BrandLogo, BrandCredit } from "./Brand";
import Spinner from "./Spinner";

const ROLE_LABEL: Record<CurrentUser["role"], string> = {
  admin: "Admin",
  manager: "Manager",
  member: "Member",
};

type View = "tasks" | "employees" | "clients" | "client-update" | "settings";

export default function App() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [view, setView] = useState<View>("tasks");
  const [sessionExpired, setSessionExpired] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    fetchCurrentUser().then((currentUser) => {
      setUser(currentUser);
      setCheckingSession(false);
    });
  }, []);

  // Registered once for the whole app's lifetime: any authenticated API call
  // that comes back 401 (session expired or invalidated since this screen
  // loaded) drops back to the login screen instead of leaving every panel
  // stuck showing a dead-end "(401) Try again" that can never succeed until
  // the user manually logs out and back in.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      setSessionExpired(true);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  if (checkingSession) {
    return (
      <main className="login-page">
        <Spinner label="Loading…" />
      </main>
    );
  }

  if (!user) {
    return <Login onLoggedIn={(loggedInUser) => { setSessionExpired(false); setUser(loggedInUser); }} sessionExpired={sessionExpired} />;
  }

  const canSeeClients = user.role === "admin" || user.role === "manager";
  const canSeeEmployees = user.role === "admin";

  async function handleLogout() {
    await logout();
    setSessionExpired(false);
    setUser(null);
  }

  // Closes the slide-in nav after picking a view — on desktop the sidebar
  // is always visible so this is a no-op there (mobileNavOpen never got
  // set to true in the first place).
  function selectView(newView: View) {
    setView(newView);
    setMobileNavOpen(false);
  }

  return (
    <div className="shell">
      {mobileNavOpen && <div className="sidebar-backdrop" onClick={() => setMobileNavOpen(false)} />}
      <aside className={`sidebar ${mobileNavOpen ? "open" : ""}`}>
        <div className="brand">
          <BrandLogo height={26} />
        </div>
        <nav className="nav">
          <button
            className={`nav-item ${view === "tasks" ? "active" : ""}`}
            onClick={() => selectView("tasks")}
          >
            Tasks
          </button>
          {canSeeEmployees && (
            <button
              className={`nav-item ${view === "employees" ? "active" : ""}`}
              onClick={() => selectView("employees")}
            >
              Employees
            </button>
          )}
          {canSeeClients && (
            <button
              className={`nav-item ${view === "clients" ? "active" : ""}`}
              onClick={() => selectView("clients")}
            >
              Clients
            </button>
          )}
          {canSeeClients && (
            <button
              className={`nav-item ${view === "client-update" ? "active" : ""}`}
              onClick={() => selectView("client-update")}
            >
              Send Report
            </button>
          )}
          {canSeeEmployees && (
            <button
              className={`nav-item ${view === "settings" ? "active" : ""}`}
              onClick={() => selectView("settings")}
            >
              Settings
            </button>
          )}
        </nav>
        <div className="sidebar-footer">
          created by <BrandCredit />
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button
            className="nav-toggle"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open menu"
          >
            ☰
          </button>
          <div className="who">
            <span className="name">{user.name}</span>
            <span className="role">{ROLE_LABEL[user.role]}</span>
          </div>
          <button className="btn btn-primary" onClick={handleLogout}>Log out</button>
        </header>

        <section className="view">
          {view === "tasks" && <Dashboard user={user} />}
          {view === "employees" && <Employees user={user} />}
          {view === "clients" && <Clients />}
          {view === "client-update" && <ClientUpdate />}
          {view === "settings" && <Settings />}
        </section>
      </div>
    </div>
  );
}
