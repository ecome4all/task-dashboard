import { useEffect, useState } from "react";
import { Employee, CurrentUser, ApiError, fetchAllEmployees, createEmployee, updateEmployee } from "./api";
import Spinner from "./Spinner";
import ErrorBanner from "./ErrorBanner";

const ROLE_LABEL: Record<Employee["role"], string> = {
  admin: "Admin",
  supervisor: "Supervisor",
  member: "Member",
};

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong. Try again.";
}

export default function Employees({ user }: { user: CurrentUser }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [newEmployeeName, setNewEmployeeName] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");

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

  async function handleActiveToggle(employee: Employee, active: boolean) {
    setActionError("");
    try {
      const updated = await updateEmployee(employee.id, { active });
      setEmployees((prev) => prev.map((e) => (e.id === employee.id ? updated : e)));
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

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
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Active</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((employee) => {
                const isSelf = employee.id === user.id;
                return (
                  <tr key={employee.id}>
                    <td>{employee.name}{isSelf && " (you)"}</td>
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
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={isSelf}
                        onClick={() => handleActiveToggle(employee, !employee.active)}
                      >
                        {employee.active ? "Deactivate" : "Reactivate"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
