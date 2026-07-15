import { useEffect, useState } from "react";
import { CurrentUser, fetchCurrentUser, logout } from "./api";
import Login from "./Login";
import Dashboard from "./Dashboard";
import ReportLinks from "./ReportLinks";
import { BrandMark, BrandCredit } from "./Brand";
import Spinner from "./Spinner";

const ROLE_LABEL: Record<CurrentUser["role"], string> = {
  admin: "Admin",
  supervisor: "Supervisor",
  member: "Member",
};

type View = "tasks" | "reports";

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

  async function handleLogout() {
    await logout();
    setUser(null);
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <BrandMark />
          <span className="brand-name">Ecom4all</span>
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
          {view === "tasks" ? <Dashboard user={user} /> : <ReportLinks />}
        </section>
      </div>
    </div>
  );
}
