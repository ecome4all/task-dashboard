import { useEffect, useState } from "react";
import { CurrentUser, fetchCurrentUser, logout } from "./api";
import Login from "./Login";
import Dashboard from "./Dashboard";
import ReportLinks from "./ReportLinks";
import Employees from "./Employees";
import Clients from "./Clients";
import ClientUpdate from "./ClientUpdate";
import { BrandLogo, BrandCredit } from "./Brand";
import Spinner from "./Spinner";

const ROLE_LABEL: Record<CurrentUser["role"], string> = {
  admin: "Admin",
  supervisor: "Supervisor",
  member: "Member",
};

type View = "tasks" | "reports" | "employees" | "clients" | "client-update";

export default function App() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [view, setView] = useState<View>("tasks");

  useEffect(() => {
    fetchCurrentUser().then((currentUser) => {
      setUser(currentUser);
      setCheckingSession(false);
    });
  }, []);

  if (checkingSession) {
    return (
      <main className="login-page">
        <Spinner label="Loading…" />
      </main>
    );
  }

  if (!user) {
    return <Login onLoggedIn={setUser} />;
  }

  const canSeeReports = user.role === "admin" || user.role === "supervisor";
  const canSeeClients = canSeeReports;
  const canSeeEmployees = user.role === "admin";

  async function handleLogout() {
    await logout();
    setUser(null);
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <BrandLogo height={26} />
        </div>
        <nav className="nav">
          <button
            className={`nav-item ${view === "tasks" ? "active" : ""}`}
            onClick={() => setView("tasks")}
          >
            Tasks
          </button>
          {canSeeReports && (
            <button
              className={`nav-item ${view === "reports" ? "active" : ""}`}
              onClick={() => setView("reports")}
            >
              Reports
            </button>
          )}
          {canSeeEmployees && (
            <button
              className={`nav-item ${view === "employees" ? "active" : ""}`}
              onClick={() => setView("employees")}
            >
              Employees
            </button>
          )}
          {canSeeClients && (
            <button
              className={`nav-item ${view === "clients" ? "active" : ""}`}
              onClick={() => setView("clients")}
            >
              Clients
            </button>
          )}
          {canSeeClients && (
            <button
              className={`nav-item ${view === "client-update" ? "active" : ""}`}
              onClick={() => setView("client-update")}
            >
              Send Update
            </button>
          )}
        </nav>
        <div className="sidebar-footer">
          created by <BrandCredit />
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="who">
            <span className="name">{user.name}</span>
            <span className="role">{ROLE_LABEL[user.role]}</span>
          </div>
          <button className="btn btn-primary" onClick={handleLogout}>Log out</button>
        </header>

        <section className="view">
          {view === "tasks" && <Dashboard />}
          {view === "reports" && <ReportLinks />}
          {view === "employees" && <Employees user={user} />}
          {view === "clients" && <Clients />}
          {view === "client-update" && <ClientUpdate />}
        </section>
      </div>
    </div>
  );
}
