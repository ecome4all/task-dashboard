import { useEffect, useState } from "react";
import { CurrentUser, fetchCurrentUser, logout } from "./api";
import Login from "./Login";
import Dashboard from "./Dashboard";

const ROLE_LABEL: Record<CurrentUser["role"], string> = {
  admin: "Admin",
  member: "Member",
};

export default function App() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    fetchCurrentUser().then((currentUser) => {
      setUser(currentUser);
      setCheckingSession(false);
    });
  }, []);

  if (checkingSession) return null;

  if (!user) {
    return <Login onLoggedIn={setUser} />;
  }

  async function handleLogout() {
    await logout();
    setUser(null);
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">Ecom4all</div>
        <nav className="nav">
          <button className="nav-item active">Tasks</button>
        </nav>
        <div className="sidebar-footer">
          created by{" "}
          <span className="credit-mark">
            <span className="n4">ai4</span>
            <span className="work">work</span>
          </span>
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
          <Dashboard user={user} />
        </section>
      </div>
    </div>
  );
}
