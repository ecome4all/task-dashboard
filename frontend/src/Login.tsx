import { useState } from "react";
import { login, ApiError, CurrentUser } from "./api";
import { BrandLogo, BrandCredit } from "./Brand";
import Spinner from "./Spinner";

export default function Login({
  onLoggedIn,
  sessionExpired,
}: {
  onLoggedIn: (user: CurrentUser) => void;
  sessionExpired?: boolean;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const user = await login(email, password);
      if (!user) {
        setError("Invalid email or password");
        return;
      }
      onLoggedIn(user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="brand">
          <BrandLogo height={46} />
        </div>
        <p className="subtitle">Task Dashboard</p>
        {sessionExpired && <p className="error">Your session expired. Please log in again.</p>}
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
        <button className="btn btn-primary" type="submit" disabled={submitting}>
          {submitting ? <Spinner label="Logging in…" /> : "Log in"}
        </button>
      </form>
      <div className="login-page-credit">
        created by <BrandCredit />
      </div>
    </main>
  );
}
