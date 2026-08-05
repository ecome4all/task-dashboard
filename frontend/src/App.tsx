import { useEffect, useState } from "react";
import { CurrentUser, fetchCurrentUser, logout, setUnauthorizedHandler } from "./api";
import Login from "./Login";
import Dashboard from "./Dashboard";
import RecurringTasks from "./RecurringTasks";
import Employees from "./Employees";
import Clients from "./Clients";
import ClientDetail from "./ClientDetail";
import ClientUpdate from "./ClientUpdate";
import WeeklyReports from "./WeeklyReports";
import Settings from "./Settings";
import Account from "./Account";
import { BrandLogo, BrandCredit } from "./Brand";
import Spinner from "./Spinner";

const ROLE_LABEL: Record<CurrentUser["role"], string> = {
  admin: "Admin",
  manager: "Manager",
  member: "Member",
};

type View =
  | "tasks"
  | "repeating"
  | "employees"
  | "clients"
  | "client-details"
  | "client-update"
  | "weekly-reports"
  | "settings"
  | "account";

export default function App() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [view, setView] = useState<View>("tasks");
  const [sessionExpired, setSessionExpired] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Which client the Client Details screen is showing. Held here rather than
  // inside that screen so clicking a name on the Clients list can open it
  // directly on that client, and so switching tabs and back doesn't lose it.
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

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
        {/* Sits directly under the logo, above the menu, so it's on screen
            whenever the sidebar is — the old placement pinned it to the very
            bottom, where a long menu or a short window pushed it out of view. */}
        <div className="brand-credit">
          created by <BrandCredit />
        </div>
        <nav className="nav">
          <button
            className={`nav-item ${view === "tasks" ? "active" : ""}`}
            onClick={() => selectView("tasks")}
          >
            Tasks
          </button>
          <button
            className={`nav-item ${view === "repeating" ? "active" : ""}`}
            onClick={() => selectView("repeating")}
          >
            Repeating Tasks
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
              className={`nav-item ${view === "client-details" ? "active" : ""}`}
              onClick={() => selectView("client-details")}
            >
              Client Details
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
          {canSeeClients && (
            <button
              className={`nav-item ${view === "weekly-reports" ? "active" : ""}`}
              onClick={() => selectView("weekly-reports")}
            >
              Weekly Reports
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
          {/* Your own name is the way into your own account — there's no
              separate menu item for it, since changing a password is a rare
              errand and everyone (not just admins) needs to reach it. */}
          <button className="who" onClick={() => selectView("account")} title="My account">
            <span className="name">{user.name}</span>
            <span className="role">{ROLE_LABEL[user.role]}</span>
          </button>
          <button className="btn btn-primary" onClick={handleLogout}>Log out</button>
        </header>

        <section className="view">
          {view === "tasks" && <Dashboard user={user} />}
          {view === "repeating" && <RecurringTasks user={user} />}
          {view === "employees" && <Employees user={user} />}
          {view === "clients" && (
            <Clients
              onOpenClient={(id) => {
                setSelectedClientId(id);
                setView("client-details");
              }}
            />
          )}
          {view === "client-details" && (
            <ClientDetail clientId={selectedClientId} onSelectClient={setSelectedClientId} />
          )}
          {view === "client-update" && <ClientUpdate />}
          {view === "weekly-reports" && <WeeklyReports />}
          {view === "settings" && <Settings />}
          {view === "account" && <Account user={user} />}
        </section>
      </div>
    </div>
  );
}
