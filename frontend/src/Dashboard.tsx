import { useEffect, useState } from "react";
import { Task, Employee, CurrentUser, ApiError, fetchTasks, updateTask, fetchEmployees, createEmployee } from "./api";
import Spinner from "./Spinner";
import ErrorBanner from "./ErrorBanner";

const STATUS_PILL: Record<Task["status"], string> = {
  new: "pill-neutral",
  in_progress: "pill-warn",
  done: "pill-good",
};

const STATUS_LABEL: Record<Task["status"], string> = {
  new: "New",
  in_progress: "In Progress",
  done: "Done",
};

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong. Try again.";
}

export default function Dashboard({ user }: { user: CurrentUser }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [newEmployeeName, setNewEmployeeName] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const [taskList, employeeList] = await Promise.all([fetchTasks(), fetchEmployees()]);
      setTasks(taskList);
      setEmployees(employeeList);
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

  async function handleAssigneeChange(task: Task, assignee: string) {
    setActionError("");
    try {
      const updated = await updateTask(task.id, { assignee });
      setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)));
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  async function handleStatusChange(task: Task, status: Task["status"]) {
    setActionError("");
    try {
      const updated = await updateTask(task.id, { status });
      setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)));
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  if (loading) return <Spinner label="Loading tasks…" />;

  if (loadError) return <ErrorBanner message={loadError} onRetry={load} />;

  return (
    <>
      {actionError && <ErrorBanner message={actionError} onRetry={() => setActionError("")} />}

      {user.role === "admin" && (
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
      )}

      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">Tasks</span>
          <span className="panel-sub">{tasks.length} total</span>
        </div>
        <div className="panel-body">
          <table className="data-table">
            <thead>
              <tr>
                <th>Task</th>
                <th>Source</th>
                <th>Assignee</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr key={task.id}>
                  <td>{task.description}</td>
                  <td>{task.source}</td>
                  <td>
                    <select
                      className="field-select"
                      value={task.assignee ?? ""}
                      onChange={(e) => handleAssigneeChange(task, e.target.value)}
                    >
                      <option value="">Unassigned</option>
                      {employees.map((employee) => (
                        <option key={employee.id} value={employee.name}>
                          {employee.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className={`pill ${STATUS_PILL[task.status]}`}>{STATUS_LABEL[task.status]}</span>
                      <select
                        className="field-select"
                        value={task.status}
                        onChange={(e) => handleStatusChange(task, e.target.value as Task["status"])}
                      >
                        <option value="new">New</option>
                        <option value="in_progress">In Progress</option>
                        <option value="done">Done</option>
                      </select>
                    </div>
                  </td>
                  <td>{new Date(task.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
