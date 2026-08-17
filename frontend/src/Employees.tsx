import { Fragment, useEffect, useState } from "react";
import {
  Employee,
  CurrentUser,
  ApiError,
  fetchAllEmployees,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  setEmployeeLogin,
  removeEmployeeLogin,
} from "./api";
import Spinner from "./Spinner";
import ErrorBanner from "./ErrorBanner";
import Pagination, { usePaged } from "./Paged";
import { SavedTick, saveOnEnter, useSavedFlash } from "./savedFlash";

const ROLE_LABEL: Record<Employee["role"], string> = {
  admin: "Admin",
  manager: "Manager",
  member: "Member",
};

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong. Try again.";
}

export default function Employees({ user }: { user: CurrentUser }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [newEmployeeName, setNewEmployeeName] = useState("");
  // Held per-row while typing so the number is only saved on blur — saving
  // on every keystroke would fire a request per digit.
  const [phoneDrafts, setPhoneDrafts] = useState<Record<string, string>>({});
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  // Which row has its login form open, and what's typed into it. Only one
  // employee's login is ever being set at a time in practice, but keying by
  // id means opening a second row can't quietly overwrite the first.
  const [loginDrafts, setLoginDrafts] = useState<Record<string, { email: string; password: string }>>({});
  const [savingLoginFor, setSavingLoginFor] = useState("");
  // The just-set login, shown once so the admin can pass it on. Nothing in
  // the app sends it to the person, and it can't be read back afterwards —
  // only replaced.
  const [loginSetFor, setLoginSetFor] = useState<{ name: string; email: string; password: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  // These boxes save themselves when you click away, and used to do it with no
  // sign at all that anything had happened — see savedFlash.tsx.
  const { savedKey, flash } = useSavedFlash();

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      setEmployees(await fetchAllEmployees());
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleAddEmployee(e: React.FormEvent) {
    e.preventDefault();
    const name = newEmployeeName.trim();
    if (!name) return;
    setActionError("");
    try {
      const employee = await createEmployee(name);
      setEmployees((prev) => [...prev, employee].sort((a, b) => a.name.localeCompare(b.name)));
      setNewEmployeeName("");
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  async function handleRoleChange(employee: Employee, role: Employee["role"]) {
    setActionError("");
    try {
      const updated = await updateEmployee(employee.id, { role });
      setEmployees((prev) => prev.map((e) => (e.id === employee.id ? updated : e)));
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  // Renaming carries the person's existing tasks over to the new name —
  // tasks record who they're for by name, so the server moves them in the
  // same transaction. Reloads afterwards so the assignee shown on the board
  // and the employee list can't drift apart.
  async function handleNameSave(employee: Employee) {
    const name = (nameDrafts[employee.id] ?? employee.name).trim();
    setNameDrafts((prev) => {
      const { [employee.id]: _, ...rest } = prev;
      return rest;
    });
    if (!name || name === employee.name) return;
    setActionError("");
    try {
      const updated = await updateEmployee(employee.id, { name });
      setEmployees((prev) =>
        prev.map((e) => (e.id === employee.id ? updated : e)).sort((a, b) => a.name.localeCompare(b.name))
      );
      flash(`${employee.id}:name`);
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  // The number every WhatsApp message to this employee goes to: the "a new
  // task is yours" alert, and the daily "your open work" reminder. It's also
  // what a tagged number in an incoming task message is matched against.
  // Blank clears it, which just means this employee stops getting messages.
  async function handlePhoneSave(employee: Employee) {
    const phone = phoneDrafts[employee.id] ?? employee.phone ?? "";
    setPhoneDrafts((prev) => {
      const { [employee.id]: _, ...rest } = prev;
      return rest;
    });
    if (phone === (employee.phone ?? "")) return;
    setActionError("");
    try {
      const updated = await updateEmployee(employee.id, { phone });
      setEmployees((prev) => prev.map((e) => (e.id === employee.id ? updated : e)));
      flash(`${employee.id}:phone`);
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  async function handleActiveToggle(employee: Employee, active: boolean) {
    setActionError("");
    try {
      const updated = await updateEmployee(employee.id, { active });
      setEmployees((prev) => prev.map((e) => (e.id === employee.id ? updated : e)));
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  // Deleting is separate from deactivating on purpose, and the wording of the
  // confirmation carries the whole difference: deactivating is what you want
  // for someone who has left, and this isn't that.
  async function handleDelete(employee: Employee) {
    if (
      !window.confirm(
        `Delete ${employee.name} for good?\n\n` +
          `Their name stays on work they already did, but the person is removed and this can't be undone.\n\n` +
          `If they've simply left, press Cancel and use Deactivate instead — that stops their login and their messages, and can be undone.`
      )
    ) {
      return;
    }
    setActionError("");
    try {
      await deleteEmployee(employee.id);
      setEmployees((prev) => prev.filter((e) => e.id !== employee.id));
    } catch (err) {
      // The server refuses your own account and the last active admin, and
      // says which — that message is far more use than a generic failure.
      setActionError(errorMessage(err));
    }
  }

  // Adding an employee gives them a name on the board and WhatsApp messages —
  // it does not give them a way in. This is where that happens, and it's the
  // only place in the app that creates a login: there's no public sign-up.
  async function handleLoginSave(employee: Employee) {
    const draft = loginDrafts[employee.id];
    if (!draft) return;
    setActionError("");
    setSavingLoginFor(employee.id);
    try {
      const updated = await setEmployeeLogin(employee.id, draft.email.trim(), draft.password);
      setEmployees((prev) => prev.map((e) => (e.id === employee.id ? updated : e)));
      closeLoginForm(employee.id);
      // The admin has to pass the password on themselves — nothing here
      // emails or WhatsApps it, so this is the only time it's ever shown.
      setLoginSetFor({ name: updated.name, email: draft.email.trim(), password: draft.password });
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setSavingLoginFor("");
    }
  }

  async function handleLoginRemove(employee: Employee) {
    if (!window.confirm(`Stop ${employee.name} from logging in? They keep their name and their tasks.`)) return;
    setActionError("");
    try {
      const updated = await removeEmployeeLogin(employee.id);
      setEmployees((prev) => prev.map((e) => (e.id === employee.id ? updated : e)));
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  function openLoginForm(employee: Employee) {
    setLoginSetFor(null);
    setLoginDrafts((prev) => ({
      ...prev,
      [employee.id]: { email: employee.email ?? "", password: "" },
    }));
  }

  function closeLoginForm(id: string) {
    setLoginDrafts((prev) => {
      const { [id]: _, ...rest } = prev;
      return rest;
    });
  }

  const pagedEmployees = usePaged(employees, 10);

  if (loading) return <Spinner label="Loading employees…" />;

  if (loadError) return <ErrorBanner message={loadError} onRetry={load} />;

  return (
    <>
      {actionError && <ErrorBanner message={actionError} onRetry={() => setActionError("")} />}

      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">Add employee</span>
        </div>
        <div className="panel-body">
          <form className="add-employee" onSubmit={handleAddEmployee}>
            <input
              className="field-input"
              type="text"
              placeholder="Employee name"
              value={newEmployeeName}
              onChange={(e) => setNewEmployeeName(e.target.value)}
            />
            <button className="btn btn-primary" type="submit">Add</button>
          </form>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">Employees</span>
          <span className="panel-sub">{employees.length} total</span>
        </div>
        <div className="panel-body">
          <p className="panel-sub" style={{ marginTop: 0, marginBottom: 12 }}>
            The WhatsApp number gets each new task as soon as it is given to them, plus the
            daily list of their open work. Tagging this number in a WhatsApp message gives
            the task to them straight away. Leave it empty to stop both.
            <br />
            Adding an employee does not let them sign in. Use <strong>Give login</strong> to
            set the email and first password they will use, then tell them what it is.
          </p>

          {loginSetFor && (
            <div className="panel-sub" style={{ marginBottom: 12, padding: 12, border: "1px solid var(--border)", borderRadius: 8 }}>
              <strong>Login ready for {loginSetFor.name}.</strong> Tell them these details
              yourself — this is the only time the password is shown, and nobody can read it
              back later.
              <div style={{ marginTop: 6 }}>
                Email: <strong>{loginSetFor.email}</strong>
                <br />
                Password: <strong>{loginSetFor.password}</strong>
              </div>
              <button
                className="btn btn-ghost btn-sm"
                style={{ marginTop: 8 }}
                onClick={() => setLoginSetFor(null)}
              >
                Hide
              </button>
            </div>
          )}

          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>WhatsApp number</th>
                <th>Login</th>
                <th>Active</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pagedEmployees.items.map((employee) => {
                const isSelf = employee.id === user.id;
                const loginDraft = loginDrafts[employee.id];
                return (
                  // Two rows per employee — the details, and the login form
                  // underneath when it's open — so the key lives on the pair.
                  <Fragment key={employee.id}>
                  <tr>
                    <td>
                      <input
                        className="field-input"
                        type="text"
                        value={nameDrafts[employee.id] ?? employee.name}
                        onChange={(e) =>
                          setNameDrafts((prev) => ({ ...prev, [employee.id]: e.target.value }))
                        }
                        onBlur={() => handleNameSave(employee)}
                        onKeyDown={saveOnEnter}
                        style={{ width: 150 }}
                      />
                      {isSelf && <span className="panel-sub"> (you)</span>}
                      <SavedTick show={savedKey === `${employee.id}:name`} />
                    </td>
                    <td>
                      <select
                        className="field-select"
                        value={employee.role}
                        disabled={isSelf}
                        onChange={(e) => handleRoleChange(employee, e.target.value as Employee["role"])}
                      >
                        {(Object.keys(ROLE_LABEL) as Employee["role"][]).map((role) => (
                          <option key={role} value={role}>{ROLE_LABEL[role]}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        className="field-input"
                        type="text"
                        placeholder="No number"
                        value={phoneDrafts[employee.id] ?? employee.phone ?? ""}
                        onChange={(e) =>
                          setPhoneDrafts((prev) => ({ ...prev, [employee.id]: e.target.value }))
                        }
                        onBlur={() => handlePhoneSave(employee)}
                        onKeyDown={saveOnEnter}
                        style={{ width: 130 }}
                      />
                      <SavedTick show={savedKey === `${employee.id}:phone`} />
                    </td>
                    <td>
                      {employee.hasLogin ? (
                        <>
                          <div style={{ marginBottom: 4 }}>{employee.email}</div>
                          <button className="btn btn-ghost btn-sm" onClick={() => openLoginForm(employee)}>
                            Change
                          </button>{" "}
                          {/* An admin removing their own login would lock
                              themselves out — the server refuses it too. */}
                          {!isSelf && (
                            <button className="btn btn-ghost btn-sm" onClick={() => handleLoginRemove(employee)}>
                              Remove
                            </button>
                          )}
                        </>
                      ) : (
                        <>
                          <span className="panel-sub">Can't sign in</span>{" "}
                          <button className="btn btn-ghost btn-sm" onClick={() => openLoginForm(employee)}>
                            Give login
                          </button>
                        </>
                      )}
                    </td>
                    <td>
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={isSelf}
                        onClick={() => handleActiveToggle(employee, !employee.active)}
                      >
                        {employee.active ? "Deactivate" : "Reactivate"}
                      </button>
                    </td>
                    <td>
                      {/* Deliberately last and quiet: Deactivate is the one
                          to reach for nine times out of ten. */}
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={isSelf}
                        title={isSelf ? "You can't delete your own account" : "Remove this person for good"}
                        onClick={() => handleDelete(employee)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>

                  {loginDraft && (
                    <tr>
                      <td colSpan={6}>
                        <form
                          className="add-employee"
                          onSubmit={(e) => {
                            e.preventDefault();
                            handleLoginSave(employee);
                          }}
                        >
                          <input
                            className="field-input"
                            type="email"
                            placeholder="Email to sign in with"
                            value={loginDraft.email}
                            onChange={(e) =>
                              setLoginDrafts((prev) => ({
                                ...prev,
                                [employee.id]: { ...loginDraft, email: e.target.value },
                              }))
                            }
                          />
                          <input
                            className="field-input"
                            type="text"
                            placeholder="First password (8 or more)"
                            value={loginDraft.password}
                            onChange={(e) =>
                              setLoginDrafts((prev) => ({
                                ...prev,
                                [employee.id]: { ...loginDraft, password: e.target.value },
                              }))
                            }
                          />
                          <button className="btn btn-primary" type="submit" disabled={savingLoginFor === employee.id}>
                            {savingLoginFor === employee.id ? "Saving…" : "Save login"}
                          </button>
                          <button
                            className="btn btn-ghost"
                            type="button"
                            onClick={() => closeLoginForm(employee.id)}
                          >
                            Cancel
                          </button>
                        </form>
                        <p className="panel-sub" style={{ marginTop: 6, marginBottom: 0 }}>
                          {employee.hasLogin
                            ? `This replaces how ${employee.name} signs in today. Their old password stops working.`
                            : `${employee.name} will sign in with this. Tell them the password yourself — the app never sends it.`}
                        </p>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          <Pagination paged={pagedEmployees} />
        </div>
      </div>
    </>
  );
}
