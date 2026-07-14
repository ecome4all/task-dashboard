import { useEffect, useState } from "react";
import { CurrentUser, fetchCurrentUser } from "./api";
import Login from "./Login";
import Dashboard from "./Dashboard";

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

  return <Dashboard user={user} onLoggedOut={() => setUser(null)} />;
}
