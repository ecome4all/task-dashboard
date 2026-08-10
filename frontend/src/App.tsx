import { useEffect, useState } from "react";
import { CurrentUser, fetchCurrentUser, logout, setUnauthorizedHandler } from "./api";
import Login from "./Login";
import Dashboard from "./Dashboard";
import RecurringTasks from "./RecurringTasks";
import Employees from "./Employees";
import Clients from "./Clients";
import ClientDetail from "./ClientDetail";
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
  | "weekly-reports"
  | "settings"
  | "account";

const VIEWS: View[] = [
  "tasks",
  "repeating",
  "employees",
  "clients",
  "client-details",
  "weekly-reports",
  "settings",
  "account",
];

// The screen in the address bar, so a refresh comes back to where you were
// rather than to Tasks. Anyone working on Reports refreshes constantly — after
// filling in a sheet, after a send — and each one threw them back to the
// board.
//
// The hash rather than the path: it needs no server rewrite of its own, and it
// leaves the existing /api routing alone.
function viewFromHash(): View {
  const asked = window.location.hash.replace(/^#\/?/, "");
  return VIEWS.includes(asked as View) ? (asked as View) : "tasks";
}

export default function App() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [view, setView] = useState<View>(viewFromHash);
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

  // Keeps the Back button honest: pressing it changes the hash, and this puts
  // the screen back in step with it.
  useEffect(() => {
    const onHashChange = () => setView(viewFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
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

  // A hash can be typed by hand, kept in a bookmark, or left over from before
  // someone's role changed — none of which the nav can hide. The backend
  // refuses the data regardless; this is so nobody is left looking at an empty
  // screen wondering what broke.
  const allowedHere =
    view === "employees" || view === "settings"
      ? canSeeEmployees
      : view === "clients" || view === "client-details" || view === "weekly-reports"
      ? canSeeClients
      : true;
  const shownView: View = allowedHere ? view : "tasks";

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
    // Written rather than pushed, so each screen becomes a step Back can
    // return to.
    window.location.hash = `#/${newView}`;
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
            className={`nav-item ${shownView ==="tasks" ? "active" : ""}`}
            onClick={() => selectView("tasks")}
          >
            Tasks
          </button>
          <button
            className={`nav-item ${shownView ==="repeating" ? "active" : ""}`}
            onClick={() => selectView("repeating")}
          >
            Repeating Tasks
          </button>
          {canSeeEmployees && (
            <button
              className={`nav-item ${shownView ==="employees" ? "active" : ""}`}
              onClick={() => selectView("employees")}
            >
              Employees
            </button>
          )}
          {canSeeClients && (
            <button
              className={`nav-item ${shownView ==="clients" ? "active" : ""}`}
              onClick={() => selectView("clients")}
            >
              Clients
            </button>
          )}
          {canSeeClients && (
            <button
              className={`nav-item ${shownView ==="client-details" ? "active" : ""}`}
              onClick={() => selectView("client-details")}
            >
              Client Details
            </button>
          )}
          {canSeeClients && (
            <button
              className={`nav-item ${shownView ==="weekly-reports" ? "active" : ""}`}
              onClick={() => selectView("weekly-reports")}
            >
              Reports
            </button>
          )}
          {canSeeEmployees && (
            <button
              className={`nav-item ${shownView ==="settings" ? "active" : ""}`}
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
          {shownView ==="tasks" && <Dashboard user={user} />}
          {shownView ==="repeating" && <RecurringTasks user={user} />}
          {shownView ==="employees" && <Employees user={user} />}
          {shownView ==="clients" && (
            <Clients
              onOpenClient={(id) => {
                setSelectedClientId(id);
                selectView("client-details");
              }}
            />
          )}
          {shownView ==="client-details" && (
            <ClientDetail clientId={selectedClientId} onSelectClient={setSelectedClientId} />
          )}
          {shownView ==="weekly-reports" && <WeeklyReports />}
          {shownView ==="settings" && <Settings />}
          {shownView ==="account" && <Account user={user} />}
        </section>
      </div>
    </div>
  );
}
