import { useState } from "react";
import { login, CurrentUser } from "./api";

export default function Login({ onLoggedIn }: { onLoggedIn: (user: CurrentUser) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const user = await login(email, password);
    if (!user) {
      setError("Invalid email or password");
      return;
    }
    onLoggedIn(user);
  }

  return (
    <main className="page login-page">
      <form className="login-form" onSubmit={handleSubmit}>
        <h1>Task Dashboard</h1>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="error">{error}</p>}
        <button type="submit">Log in</button>
      </form>
    </main>
  );
}
