import { useEffect, useState } from "react";
import { Task, TaskStatus, TaskType, Marketplace, Employee, ApiError, fetchTasks, updateTask, fetchEmployees } from "./api";
import Spinner from "./Spinner";
import ErrorBanner from "./ErrorBanner";

const STATUS_PILL: Record<TaskStatus, string> = {
  started: "pill-neutral",
  submitted: "pill-info",
  waiting_for_marketplace: "pill-warn",
  waiting_for_client: "pill-warn",
  again_submitted: "pill-info",
  done: "pill-good",
};

const STATUS_ORDER: TaskStatus[] = [
  "started",
  "submitted",
  "waiting_for_marketplace",
  "waiting_for_client",
  "again_submitted",
  "done",
];

// "Waiting for Amazon" needs to read "Waiting for Flipkart" etc. depending on
// the task's own marketplace column — same rule the backend uses when it
// composes the WhatsApp update message.
function statusLabel(status: TaskStatus, marketplace: Marketplace | null): string {
  if (status === "waiting_for_marketplace") {
    const name = marketplace === "amazon" || marketplace === "flipkart" || marketplace === "meesho"
      ? MARKETPLACE_LABEL[marketplace]
      : "Marketplace";
    return `Waiting for ${name}`;
  }
  const labels: Record<Exclude<TaskStatus, "waiting_for_marketplace">, string> = {
    started: "Started",
    submitted: "Submitted",
    waiting_for_client: "Waiting for Client",
    again_submitted: "Again Submitted",
    done: "Done",
  };
  return labels[status];
}

const TASK_TYPE_LABEL: Record<TaskType, string> = {
  listing: "Listing",
  inventory_manage: "Inventory Manage",
  fba: "FBA",
  claims: "Claims",
  inactive_blocked_product: "Inactive or Blocked Product",
  no_pickup: "No Pick Up",
  ads: "Ads",
  other: "Any Other Issue",
};

const TASK_TYPE_ORDER: TaskType[] = [
  "listing",
  "inventory_manage",
  "fba",
  "claims",
  "inactive_blocked_product",
  "no_pickup",
  "ads",
  "other",
];

const MARKETPLACE_LABEL: Record<Marketplace, string> = {
  amazon: "Amazon",
  flipkart: "Flipkart",
  meesho: "Meesho",
  other: "Other",
};

const MARKETPLACE_ORDER: Marketplace[] = ["amazon", "flipkart", "meesho", "other"];

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong. Try again.";
}

export default function Dashboard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
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
      const updated = await updateTask(task.id, { taskType: (taskType || null) as TaskType | null | undefined });
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
                <th>Source</th>
                <th>Marketplace</th>
                <th>Type</th>
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
                      value={task.marketplace ?? ""}
                      onChange={(e) => handleMarketplaceChange(task, e.target.value)}
                    >
                      <option value="">Unset</option>
                      {MARKETPLACE_ORDER.map((mp) => (
                        <option key={mp} value={mp}>
                          {MARKETPLACE_LABEL[mp]}
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
                      {TASK_TYPE_ORDER.map((type) => (
                        <option key={type} value={type}>
                          {TASK_TYPE_LABEL[type]}
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
                      <span className={`pill ${STATUS_PILL[task.status]}`}>
                        {statusLabel(task.status, task.marketplace)}
                      </span>
                      <select
                        className="field-select"
                        value={task.status}
                        onChange={(e) => handleStatusChange(task, e.target.value as TaskStatus)}
                      >
                        {STATUS_ORDER.map((status) => (
                          <option key={status} value={status}>
                            {statusLabel(status, task.marketplace)}
                          </option>
                        ))}
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
