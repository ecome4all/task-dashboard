import { useEffect, useState } from "react";
import {
  Task,
  TaskStatus,
  Marketplace,
  Employee,
  ConfigOption,
  CurrentUser,
  SendableTaskField,
  ApiError,
  fetchTasks,
  updateTask,
  fetchEmployees,
  fetchConfigOptions,
  sendTaskUpdate,
} from "./api";
import Spinner from "./Spinner";
import ErrorBanner from "./ErrorBanner";
import SearchableSelect from "./SearchableSelect";
import SendUpdatePopover, { SendableField } from "./SendUpdatePopover";

// Only used for the handful of statuses this frontend knows to color —
// anything an admin adds beyond these falls back to "neutral", since
// there's no meaningful color to guess for an arbitrary new status.
const STATUS_COLOR: Record<string, string> = {
  started: "neutral",
  submitted: "info",
  waiting_for_marketplace: "warn",
  waiting_for_client: "warn",
  again_submitted: "info",
  done: "good",
};

const PAGE_SIZE = 10;

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong. Try again.";
}

// Turns a Task.dueDate ISO string into the yyyy-mm-dd shape <input type="date"> needs.
function toDateInputValue(dueDate: string | null): string {
  return dueDate ? dueDate.slice(0, 10) : "";
}

interface ClientSummaryRow {
  name: string;
  total: number;
  pending: number;
  done: number;
}

export default function Dashboard({ user }: { user: CurrentUser }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [statusOptions, setStatusOptions] = useState<ConfigOption[]>([]);
  const [taskTypeOptions, setTaskTypeOptions] = useState<ConfigOption[]>([]);
  const [marketplaceOptions, setMarketplaceOptions] = useState<ConfigOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  const canSetDueDate = user.role === "admin" || user.role === "manager";

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
  const taskTypeLabels = Object.fromEntries(taskTypeOptions.map((o) => [o.value, o.label]));

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

  function selectStatusFilter(status: string | null) {
    setStatusFilter(status);
    setPage(1);
  }

  // Updates the row immediately with the picked value (so the dropdown
  // reflects the change the instant you click it, instead of sitting on
  // the old value until the PATCH round-trip finishes), then reconciles
  // with the server response — or rolls back to the prior row on failure.
  async function applyTaskChange(
    task: Task,
    optimistic: Partial<Task>,
    apiChanges: Partial<Pick<Task, "assignee" | "status" | "taskType" | "marketplace" | "dueDate">>
  ) {
    setActionError("");
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, ...optimistic } : t)));
    try {
      const updated = await updateTask(task.id, apiChanges);
      setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)));
    } catch (err) {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)));
      setActionError(errorMessage(err));
    }
  }

  function handleAssigneeChange(task: Task, assignee: string) {
    return applyTaskChange(task, { assignee }, { assignee });
  }

  function handleStatusChange(task: Task, status: TaskStatus) {
    return applyTaskChange(task, { status }, { status });
  }

  function handleTypeChange(task: Task, taskType: string) {
    const value = (taskType || null) as string | null;
    return applyTaskChange(task, { taskType: value }, { taskType: value });
  }

  function handleMarketplaceChange(task: Task, marketplace: string) {
    const value = (marketplace || null) as Marketplace | null;
    return applyTaskChange(task, { marketplace: value }, { marketplace: value });
  }

  function handleDueDateChange(task: Task, value: string) {
    const isoDate = value ? new Date(value).toISOString() : null;
    return applyTaskChange(task, { dueDate: isoDate }, { dueDate: isoDate });
  }

  // What the "Send" popover offers for a given task, with each field's
  // current value shown inline so staff pick from what's actually there,
  // not an abstract field name.
  function sendableFieldsFor(task: Task): SendableField[] {
    return [
      { key: "status", label: "Status", value: statusLabel(task.status, task.marketplace) },
      { key: "marketplace", label: "Marketplace", value: (task.marketplace && marketplaceLabels[task.marketplace]) || "Not set" },
      { key: "taskType", label: "Type", value: (task.taskType && taskTypeLabels[task.taskType]) || "Not set" },
      { key: "assignee", label: "Employee", value: task.assignee || "Unassigned" },
      { key: "dueDate", label: "Due Date", value: task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "Not set" },
      { key: "createdAt", label: "Created", value: new Date(task.createdAt).toLocaleDateString() },
    ];
  }

  async function handleSendUpdate(task: Task, fields: SendableTaskField[]): Promise<boolean> {
    setActionError("");
    try {
      await sendTaskUpdate(task.id, fields);
      return true;
    } catch (err) {
      setActionError(errorMessage(err));
      return false;
    }
  }

  if (loading) return <Spinner label="Loading tasks…" />;

  if (loadError) return <ErrorBanner message={loadError} onRetry={load} />;

  const filteredTasks = statusFilter ? tasks.filter((t) => t.status === statusFilter) : tasks;
  const pageCount = Math.max(1, Math.ceil(filteredTasks.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pagedTasks = filteredTasks.slice(pageStart, pageStart + PAGE_SIZE);

  const clientSummary: ClientSummaryRow[] = Object.values(
    tasks.reduce<Record<string, ClientSummaryRow>>((acc, t) => {
      const name = t.clientName ?? "No Client";
      const row = (acc[name] ??= { name, total: 0, pending: 0, done: 0 });
      row.total += 1;
      if (t.status === "done") row.done += 1;
      else row.pending += 1;
      return acc;
    }, {})
  ).sort((a, b) => b.total - a.total);

  return (
    <>
      {actionError && <ErrorBanner message={actionError} onRetry={() => setActionError("")} />}

      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">Client Summary</span>
        </div>
        <div className="panel-body">
          <table className="data-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Total</th>
                <th>Pending</th>
                <th>Done</th>
              </tr>
            </thead>
            <tbody>
              {clientSummary.map((row) => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td>{row.total}</td>
                  <td>{row.pending}</td>
                  <td>{row.done}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">Tasks</span>
          <span className="panel-sub">{filteredTasks.length} shown of {tasks.length} total</span>
        </div>
        <div className="panel-body">
          <div className="filter-chips">
            <button
              className={`chip ${statusFilter === null ? "active" : ""}`}
              onClick={() => selectStatusFilter(null)}
            >
              All <span className="chip-count">{tasks.length}</span>
            </button>
            {statusOptions.map((option) => (
              <button
                key={option.value}
                className={`chip ${statusFilter === option.value ? "active" : ""}`}
                onClick={() => selectStatusFilter(option.value)}
              >
                {option.label} <span className="chip-count">{tasks.filter((t) => t.status === option.value).length}</span>
              </button>
            ))}
          </div>

          <table className="data-table">
            <thead>
              <tr>
                <th>Task</th>
                <th>Client</th>
                <th>Source</th>
                <th>Marketplace</th>
                <th>Type</th>
                <th>Employee</th>
                <th>Status</th>
                <th>Created</th>
                <th>Due Date</th>
                <th>Updated</th>
                <th>Completed</th>
                <th>Send</th>
              </tr>
            </thead>
            <tbody>
              {pagedTasks.map((task) => (
                <tr key={task.id}>
                  <td>{task.description}</td>
                  <td>{task.clientName ?? "—"}</td>
                  <td>{task.source}</td>
                  <td>
                    <SearchableSelect
                      value={task.marketplace ?? ""}
                      placeholder="Unset"
                      options={marketplaceOptions.map((mp) => ({ value: mp.value, label: mp.label }))}
                      onChange={(value) => handleMarketplaceChange(task, value)}
                    />
                  </td>
                  <td>
                    <SearchableSelect
                      value={task.taskType ?? ""}
                      placeholder="Not Set"
                      options={taskTypeOptions.map((type) => ({ value: type.value, label: type.label }))}
                      onChange={(value) => handleTypeChange(task, value)}
                    />
                  </td>
                  <td>
                    <SearchableSelect
                      value={task.assignee ?? ""}
                      placeholder="Unassigned"
                      options={employees.map((employee) => ({ value: employee.name, label: employee.name }))}
                      onChange={(value) => handleAssigneeChange(task, value)}
                    />
                  </td>
                  <td>
                    <SearchableSelect
                      value={task.status}
                      placeholder="Status"
                      allowClear={false}
                      triggerClassName={`status-trigger-${STATUS_COLOR[task.status] ?? "neutral"}`}
                      options={statusOptions.map((status) => ({
                        value: status.value,
                        label: statusLabel(status.value, task.marketplace),
                      }))}
                      onChange={(value) => handleStatusChange(task, value)}
                    />
                  </td>
                  <td>{new Date(task.createdAt).toLocaleString()}</td>
                  <td>
                    {canSetDueDate ? (
                      <input
                        className="field-input"
                        type="date"
                        value={toDateInputValue(task.dueDate)}
                        onChange={(e) => handleDueDateChange(task, e.target.value)}
                      />
                    ) : (
                      task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "—"
                    )}
                  </td>
                  <td>{new Date(task.updatedAt).toLocaleString()}</td>
                  <td>{task.doneAt ? new Date(task.doneAt).toLocaleString() : "—"}</td>
                  <td>
                    <SendUpdatePopover
                      fields={sendableFieldsFor(task)}
                      onSend={(fields) => handleSendUpdate(task, fields)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {pageCount > 1 && (
            <div className="pagination">
              <span className="pagination-info">
                {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, filteredTasks.length)} of {filteredTasks.length}
              </span>
              <button
                className="btn btn-ghost btn-sm"
                disabled={currentPage <= 1}
                onClick={() => setPage(currentPage - 1)}
              >
                Prev
              </button>
              <span className="pagination-info">Page {currentPage} of {pageCount}</span>
              <button
                className="btn btn-ghost btn-sm"
                disabled={currentPage >= pageCount}
                onClick={() => setPage(currentPage + 1)}
              >
                Next
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
