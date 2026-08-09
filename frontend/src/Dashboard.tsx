import { Fragment, useEffect, useState } from "react";
import {
  Task,
  TaskStatus,
  Marketplace,
  Employee,
  ConfigOption,
  CurrentUser,
  ApiError,
  Frequency,
  FREQUENCY_LABEL,
  fetchTasks,
  updateTask,
  fetchEmployees,
  fetchConfigOptions,
  sendTaskUpdate,
  deleteTask,
  createRecurringTask,
} from "./api";
import Spinner from "./Spinner";
import ErrorBanner from "./ErrorBanner";
import SearchableSelect from "./SearchableSelect";
import TaskNotes from "./TaskNotes";
import Pagination, { usePaged } from "./Paged";
import { statusColor, statusLabel as buildStatusLabel } from "./taskDisplay";
import { defaultFirstRun, fromLocalInputValue } from "./dateTimeInput";

const PAGE_SIZE = 10;

// Sentinel shared by the Type/Marketplace/Employee filters' "Not Set" /
// "Unassigned" option — distinct from `null` (which means "no filter
// applied, show everything").
const UNSET_TYPE = "__unset__";
const UNSET_MARKETPLACE = "__unset__";
const UNASSIGNED = "__unset__";

function matchesTypeFilter(task: Task, filter: string | null): boolean {
  if (filter === null) return true;
  if (filter === UNSET_TYPE) return !task.taskType;
  return task.taskType === filter;
}

function matchesMarketplaceFilter(task: Task, filter: string | null): boolean {
  if (filter === null) return true;
  if (filter === UNSET_MARKETPLACE) return !task.marketplace;
  return task.marketplace === filter;
}

function matchesEmployeeFilter(task: Task, filter: string | null): boolean {
  if (filter === null) return true;
  if (filter === UNASSIGNED) return !task.assignee;
  return task.assignee === filter;
}

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong. Try again.";
}

// Turns a Task.dueDate ISO string into the yyyy-mm-dd shape <input type="date"> needs.
function toDateInputValue(dueDate: string | null): string {
  return dueDate ? dueDate.slice(0, 10) : "";
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
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [marketplaceFilter, setMarketplaceFilter] = useState<string | null>(null);
  const [employeeFilter, setEmployeeFilter] = useState<string | null>(null);
  const [sendingTaskId, setSendingTaskId] = useState<string | null>(null);
  const [justSentTaskId, setJustSentTaskId] = useState<string | null>(null);
  const [openNotesTaskId, setOpenNotesTaskId] = useState<string | null>(null);
  const [repeatingTaskId, setRepeatingTaskId] = useState<string | null>(null);
  const [justRepeatedTaskId, setJustRepeatedTaskId] = useState<string | null>(null);
  // Which task's repeat form is open, and what's been chosen in it. The
  // date and time are picked deliberately — nothing is scheduled until Save.
  const [openRepeatTaskId, setOpenRepeatTaskId] = useState<string | null>(null);
  const [repeatFrequency, setRepeatFrequency] = useState<Frequency>("weekly");
  const [repeatStartAt, setRepeatStartAt] = useState("");

  // Same rule as due dates: setting up work that will keep reappearing on
  // everyone's board is a scheduling decision, not day-to-day triage.
  const canSetDueDate = user.role === "admin" || user.role === "manager";
  const canRepeat = canSetDueDate;
  // Members raise and work tasks; they don't remove them. Matched by the
  // server, which is what actually enforces it.
  const canDelete = canSetDueDate;

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

  function statusLabel(status: TaskStatus, marketplace: Marketplace | null): string {
    return buildStatusLabel(status, marketplace, statusOptions, marketplaceLabels);
  }

  function selectStatusFilter(status: string | null) {
    setStatusFilter(status);
    paged.reset();
  }

  function selectTypeFilter(type: string) {
    setTypeFilter(type || null);
    paged.reset();
  }

  function selectMarketplaceFilter(marketplace: string) {
    setMarketplaceFilter(marketplace || null);
    paged.reset();
  }

  function selectEmployeeFilter(employee: string) {
    setEmployeeFilter(employee || null);
    paged.reset();
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

  // No field picking — the backend works out what's changed since the
  // last send for this task (Task.pendingSendFields) and sends exactly
  // that. The button is only enabled when there's something to send.
  async function handleSendUpdate(task: Task) {
    setActionError("");
    setSendingTaskId(task.id);
    try {
      await sendTaskUpdate(task.id);
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, pendingSendFields: [] } : t)));
      setJustSentTaskId(task.id);
      setTimeout(() => setJustSentTaskId((id) => (id === task.id ? null : id)), 1500);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setSendingTaskId(null);
    }
  }

  // Removing a task outright. Finished work is closed by marking it Done —
  // this is for the things that were never work: a duplicate, a test, a
  // message that shouldn't have become a task. The notes go with it, which
  // is why the confirmation says so.
  async function handleDeleteTask(task: Task) {
    const noteWarning = task.noteCount > 0 ? `\n\nIts ${task.noteCount} note(s) will be deleted too.` : "";
    if (
      !window.confirm(
        `Delete "${task.description}"?${noteWarning}\n\nThis can't be undone. Nothing is sent to the client.`
      )
    ) {
      return;
    }
    setActionError("");
    try {
      await deleteTask(task.id);
      setTasks((prev) => prev.filter((t) => t.id !== task.id));
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  function openRepeatForm(task: Task) {
    if (openRepeatTaskId === task.id) {
      setOpenRepeatTaskId(null);
      return;
    }
    setOpenRepeatTaskId(task.id);
    setRepeatFrequency("weekly");
    setRepeatStartAt(defaultFirstRun());
  }

  // Sets up a repeat from an existing task. The copy happens server-side —
  // see the recurring-tasks route — so editing this task afterwards doesn't
  // change what the repeat goes on producing. The first run is whatever date
  // and time was picked, not a guess.
  async function handleRepeat(task: Task) {
    const startsAt = fromLocalInputValue(repeatStartAt);
    if (!startsAt) {
      setActionError("Pick the date and time for the first one.");
      return;
    }
    setActionError("");
    setRepeatingTaskId(task.id);
    try {
      await createRecurringTask(task.id, repeatFrequency, startsAt);
      setOpenRepeatTaskId(null);
      setJustRepeatedTaskId(task.id);
      setTimeout(() => setJustRepeatedTaskId((id) => (id === task.id ? null : id)), 2000);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setRepeatingTaskId(null);
    }
  }

  const filteredTasks = tasks.filter(
    (t) =>
      (!statusFilter || t.status === statusFilter) &&
      matchesTypeFilter(t, typeFilter) &&
      matchesMarketplaceFilter(t, marketplaceFilter) &&
      matchesEmployeeFilter(t, employeeFilter)
  );
  const paged = usePaged(filteredTasks, PAGE_SIZE);

  if (loading) return <Spinner label="Loading tasks…" />;

  if (loadError) return <ErrorBanner message={loadError} onRetry={load} />;


  return (
    <>
      {actionError && <ErrorBanner message={actionError} onRetry={() => setActionError("")} />}

      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">Tasks</span>
          <span className="panel-sub">{filteredTasks.length} shown of {tasks.length} total</span>
        </div>
        <div className="panel-body">
          <div className="filter-row">
            {/* Status sits with the other filters as a dropdown rather than a
                row of chips — the counts that made the chips worth their width
                are kept on each option. */}
            <select
              className="field-select"
              value={statusFilter ?? ""}
              onChange={(e) => selectStatusFilter(e.target.value || null)}
            >
              <option value="">All Statuses ({tasks.length})</option>
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} ({tasks.filter((t) => t.status === option.value).length})
                </option>
              ))}
            </select>
            <select
              className="field-select"
              value={marketplaceFilter ?? ""}
              onChange={(e) => selectMarketplaceFilter(e.target.value)}
            >
              <option value="">All Marketplaces</option>
              {marketplaceOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
              <option value={UNSET_MARKETPLACE}>Unset</option>
            </select>
            <select
              className="field-select"
              value={employeeFilter ?? ""}
              onChange={(e) => selectEmployeeFilter(e.target.value)}
            >
              <option value="">All Employees</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.name}>{employee.name}</option>
              ))}
              <option value={UNASSIGNED}>Unassigned</option>
            </select>
            <select
              className="field-select"
              value={typeFilter ?? ""}
              onChange={(e) => selectTypeFilter(e.target.value)}
            >
              <option value="">All Types</option>
              {taskTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
              <option value={UNSET_TYPE}>Not Set</option>
            </select>
          </div>

          <table className="data-table">
            <thead>
              <tr>
                <th>Task</th>
                <th>Client</th>
                <th>Source</th>
                <th>WhatsApp Group</th>
                <th>Marketplace</th>
                <th>Type</th>
                <th>Employee</th>
                <th>Status</th>
                <th>Created</th>
                <th>Due Date</th>
                <th>Updated</th>
                <th>Completed</th>
                <th>Notes</th>
                {canRepeat && <th>Repeat</th>}
                <th>Send</th>
                {canDelete && <th></th>}
              </tr>
            </thead>
            <tbody>
              {paged.items.map((task) => (
                <Fragment key={task.id}>
                <tr>
                  <td>{task.description}</td>
                  <td>{task.clientName ?? "—"}</td>
                  <td>{task.source}</td>
                  <td>{task.chatName ?? "—"}</td>
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
                      triggerClassName={`status-trigger-${statusColor(task.status)}`}
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
                    <button
                      className={`btn btn-sm ${openNotesTaskId === task.id ? "btn-primary" : "btn-ghost"}`}
                      onClick={() => setOpenNotesTaskId(openNotesTaskId === task.id ? null : task.id)}
                    >
                      {task.noteCount > 0 ? `Notes (${task.noteCount})` : "Notes"}
                    </button>
                  </td>
                  {canRepeat && (
                    <td>
                      <button
                        className={`btn btn-sm ${openRepeatTaskId === task.id ? "btn-primary" : "btn-ghost"}`}
                        onClick={() => openRepeatForm(task)}
                      >
                        {justRepeatedTaskId === task.id ? "Set ✓" : "Repeat"}
                      </button>
                    </td>
                  )}
                  <td>
                    <button
                      className={`btn btn-sm ${task.pendingSendFields.length > 0 ? "btn-primary" : "btn-ghost"}`}
                      disabled={task.pendingSendFields.length === 0 || sendingTaskId === task.id}
                      onClick={() => handleSendUpdate(task)}
                    >
                      {sendingTaskId === task.id ? "Sending…" : justSentTaskId === task.id ? "Sent ✓" : "Send"}
                    </button>
                  </td>
                  {canDelete && (
                    <td>
                      {/* For a duplicate, a test, or a message that should
                          never have become a task. Finished work is closed by
                          marking it Done, not by removing it. */}
                      <button
                        className="btn btn-ghost btn-sm"
                        title="Remove this task for good"
                        onClick={() => handleDeleteTask(task)}
                      >
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
                {canRepeat && openRepeatTaskId === task.id && (
                  <tr className="note-row">
                    <td colSpan={14 + (canRepeat ? 1 : 0) + (canDelete ? 1 : 0)}>
                      <div className="repeat-form">
                        <div>
                          <label className="fact-label">How often</label>
                          <select
                            className="field-select"
                            value={repeatFrequency}
                            onChange={(e) => setRepeatFrequency(e.target.value as Frequency)}
                          >
                            {(Object.keys(FREQUENCY_LABEL) as Frequency[]).map((freq) => (
                              <option key={freq} value={freq}>{FREQUENCY_LABEL[freq]}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="fact-label">First one on</label>
                          <input
                            className="field-input"
                            type="datetime-local"
                            value={repeatStartAt}
                            onChange={(e) => setRepeatStartAt(e.target.value)}
                          />
                        </div>
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => handleRepeat(task)}
                          disabled={repeatingTaskId === task.id || !repeatStartAt}
                          type="button"
                        >
                          {repeatingTaskId === task.id ? "Saving…" : "Save repeat"}
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setOpenRepeatTaskId(null)} type="button">
                          Cancel
                        </button>
                      </div>
                      <p className="panel-sub" style={{ marginTop: 8 }}>
                        A new task is made on that date and time, then every {FREQUENCY_LABEL[repeatFrequency].replace("Every ", "")} after it.
                      </p>
                    </td>
                  </tr>
                )}
                {openNotesTaskId === task.id && (
                  <tr className="note-row">
                    <td colSpan={14 + (canRepeat ? 1 : 0) + (canDelete ? 1 : 0)}>
                      <TaskNotes
                        taskId={task.id}
                        user={user}
                        onCountChange={(count) =>
                          setTasks((prev) =>
                            prev.map((t) => (t.id === task.id ? { ...t, noteCount: count } : t))
                          )
                        }
                      />
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
              <Pagination paged={paged} />
        </div>
      </div>
    </>
  );
}
