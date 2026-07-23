import { useEffect, useState } from "react";
import {
  Task,
  TaskStatus,
  Marketplace,
  Employee,
  ConfigOption,
  ApiError,
  fetchTasks,
  updateTask,
  fetchEmployees,
  fetchConfigOptions,
} from "./api";
import Spinner from "./Spinner";
import ErrorBanner from "./ErrorBanner";

// Only used for the handful of statuses this frontend knows to color —
// anything an admin adds beyond these falls back to pill-neutral, since
// there's no meaningful color to guess for an arbitrary new status.
const STATUS_PILL: Record<string, string> = {
  started: "pill-neutral",
  submitted: "pill-info",
  waiting_for_marketplace: "pill-warn",
  waiting_for_client: "pill-warn",
  again_submitted: "pill-info",
  done: "pill-good",
};

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong. Try again.";
}

export default function Dashboard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [statusOptions, setStatusOptions] = useState<ConfigOption[]>([]);
  const [taskTypeOptions, setTaskTypeOptions] = useState<ConfigOption[]>([]);
  const [marketplaceOptions, setMarketplaceOptions] = useState<ConfigOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const [taskList, employeeList, statusList, taskTypeList, marketplaceList] = await Promise.all([
        fetchTasks(),
        fetchEmployees(),
        fetchConfigOptions("status"),
        fetchConfigOptions("task_type"),
        fetchConfigOptions("marketplace"),
      ]);
      setTasks(taskList);
      setEmployees(employeeList);
      setStatusOptions(statusList);
      setTaskTypeOptions(taskTypeList);
      setMarketplaceOptions(marketplaceList);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const marketplaceLabels = Object.fromEntries(marketplaceOptions.map((o) => [o.value, o.label]));

  // "Waiting for Amazon" needs to read "Waiting for Flipkart" etc. depending
  // on the task's own marketplace column — same rule the backend uses when
  // it composes the WhatsApp update message. Falls back to the raw value for
  // any status this list doesn't (yet) know a label for, e.g. right after an
  // admin renames one and this component hasn't reloaded yet.
  function statusLabel(status: TaskStatus, marketplace: Marketplace | null): string {
    if (status === "waiting_for_marketplace") {
      return `Waiting for ${(marketplace && marketplaceLabels[marketplace]) || "Marketplace"}`;
    }
    const option = statusOptions.find((o) => o.value === status);
    return option?.label ?? status;
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

  async function handleStatusChange(task: Task, status: TaskStatus) {
    setActionError("");
    try {
      const updated = await updateTask(task.id, { status });
      setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)));
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  async function handleTypeChange(task: Task, taskType: string) {
    setActionError("");
    try {
      const updated = await updateTask(task.id, { taskType: (taskType || null) as string | null | undefined });
      setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)));
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  async function handleMarketplaceChange(task: Task, marketplace: string) {
    setActionError("");
    try {
      const updated = await updateTask(task.id, {
        marketplace: (marketplace || null) as Marketplace | null | undefined,
      });
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
                <th>Client</th>
                <th>Source</th>
                <th>Group Name</th>
                <th>Group ID</th>
                <th>Marketplace</th>
                <th>Type</th>
                <th>Employee</th>
                <th>Status</th>
                <th>Created</th>
                <th>Updated</th>
                <th>Completed</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr key={task.id}>
                  <td>{task.description}</td>
                  <td>{task.clientName ?? "—"}</td>
                  <td>{task.source}</td>
                  <td>{task.chatName ?? "—"}</td>
                  <td className="panel-sub">{task.sourceRef}</td>
                  <td>
                    <select
                      className="field-select"
                      value={task.marketplace ?? ""}
                      onChange={(e) => handleMarketplaceChange(task, e.target.value)}
                    >
                      <option value="">Unset</option>
                      {marketplaceOptions.map((mp) => (
                        <option key={mp.value} value={mp.value}>
                          {mp.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      className="field-select"
                      value={task.taskType ?? ""}
                      onChange={(e) => handleTypeChange(task, e.target.value)}
                    >
                      <option value="">Untriaged</option>
                      {taskTypeOptions.map((type) => (
                        <option key={type.value} value={type.value}>
                          {type.label}
                        </option>
                      ))}
                    </select>
                  </td>
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
                      <span className={`pill ${STATUS_PILL[task.status] ?? "pill-neutral"}`}>
                        {statusLabel(task.status, task.marketplace)}
                      </span>
                      <select
                        className="field-select"
                        value={task.status}
                        onChange={(e) => handleStatusChange(task, e.target.value as TaskStatus)}
                      >
                        {statusOptions.map((status) => (
                          <option key={status.value} value={status.value}>
                            {statusLabel(status.value, task.marketplace)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </td>
                  <td>{new Date(task.createdAt).toLocaleString()}</td>
                  <td>{new Date(task.updatedAt).toLocaleString()}</td>
                  <td>{task.doneAt ? new Date(task.doneAt).toLocaleString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
