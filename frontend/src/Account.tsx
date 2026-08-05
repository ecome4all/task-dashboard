import { useState } from "react";
import { CurrentUser, ApiError, changeMyPassword } from "./api";
import ErrorBanner from "./ErrorBanner";

const ROLE_LABEL: Record<CurrentUser["role"], string> = {
  admin: "Admin",
  manager: "Manager",
  member: "Member",
};

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong. Try again.";
}

// Everyone's own account screen, whatever their role. It exists because an
// admin sets the *first* password by hand and has to say it out loud to hand
// it over — this is where the person changes it to something only they know.
export default function Account({ user }: { user: CurrentUser }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaved(false);

    // Checked here as well as on the server: the second box exists purely to
    // catch a typo in the first, and the server never sees it.
    if (newPassword !== repeatPassword) {
      setError("The two new passwords are not the same.");
      return;
    }

    setSaving(true);
    try {
      await changeMyPassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setRepeatPassword("");
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {error && <ErrorBanner message={error} onRetry={() => setError("")} />}

      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">My account</span>
          <span className="panel-sub">{ROLE_LABEL[user.role]}</span>
        </div>
        <div className="panel-body">
          <p className="panel-sub" style={{ marginTop: 0 }}>
            Signed in as <strong>{user.name}</strong> ({user.email}).
          </p>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">Change my password</span>
        </div>
        <div className="panel-body">
          <p className="panel-sub" style={{ marginTop: 0, marginBottom: 12 }}>
            If an admin set your password for you, change it here so only you know it.
            Use 8 letters or numbers at least.
          </p>
          {saved && (
            <p className="panel-sub" style={{ marginTop: 0, marginBottom: 12 }}>
              <strong>Done.</strong> Use your new password the next time you sign in.
            </p>
          )}
          <form className="add-employee" onSubmit={handleSubmit}>
            <input
              className="field-input"
              type="password"
              autoComplete="current-password"
              placeholder="Password now"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
            <input
              className="field-input"
              type="password"
              autoComplete="new-password"
              placeholder="New password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <input
              className="field-input"
              type="password"
              autoComplete="new-password"
              placeholder="New password again"
              value={repeatPassword}
              onChange={(e) => setRepeatPassword(e.target.value)}
            />
            <button className="btn btn-primary" type="submit" disabled={saving}>
              {saving ? "Saving…" : "Change password"}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
