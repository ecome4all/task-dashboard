import { Fragment, useEffect, useState } from "react";
import {
  Task,
  TaskStatus,
  Marketplace,
  Employee,
  Client,
  ConfigOption,
  CurrentUser,
  ApiError,
  Frequency,
  FREQUENCY_LABEL,
  fetchTasks,
  updateTask,
  fetchEmployees,
  fetchClients,
  fetchConfigOptions,
  sendTaskUpdate,
  deleteTask,
  createTask,
  createRecurringTask,
  canSendToClient,
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

// The day a timestamp falls on where the person reading the screen is, as
// yyyy-mm-dd. Not toISOString().slice(0, 10), which is UTC — a task created
// at 8pm in India would report the day before, and then not show up when
// someone filters for the day they actually created it.
function localDay(timestamp: string): string {
  const date = new Date(timestamp);
  return [
    date.getFullYear(),
    `${date.getMonth() + 1}`.padStart(2, "0"),
    `${date.getDate()}`.padStart(2, "0"),
  ].join("-");
}

// Both ends are inclusive, and either can be left empty for an open-ended
// range ("everything up to the 15th", "everything from the 1st on").
// yyyy-mm-dd strings compare correctly as text, so no date maths is needed.
//
// A task with no date at all (nothing has a due date until someone sets one)
// is not in any range: asked for work due this week, "no due date" isn't an
// answer.
function withinDateRange(timestamp: string | null, from: string, to: string): boolean {
  if (!from && !to) return true;
  if (!timestamp) return false;
  const day = localDay(timestamp);
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

// A task typed onto the board with no client picked has no group or number
// behind it, so there is nobody to send to — the button says why rather than
// looking broken.
const NO_SEND_TARGET_HINT = "No client WhatsApp group or number for this task";

export default function Dashboard({ user }: { user: CurrentUser }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [statusOptions, setStatusOptions] = useState<ConfigOption[]>([]);
  const [taskTypeOptions, setTaskTypeOptions] = useState<ConfigOption[]>([]);
  const [marketplaceOptions, setMarketplaceOptions] = useState<ConfigOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [clients, setClients] = useState<Client[]>([]);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [marketplaceFilter, setMarketplaceFilter] = useState<string | null>(null);
  const [employeeFilter, setEmployeeFilter] = useState<string | null>(null);
  // Date ranges, as yyyy-mm-dd from <input type="date">. Empty means that end
  // is open — see withinDateRange.
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [dueFrom, setDueFrom] = useState("");
  const [dueTo, setDueTo] = useState("");
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
  // The "New task" form: open or not, and what's been typed into it. Nothing
  // is created until Add task is pressed.
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [newDescription, setNewDescription] = useState("");
  const [newClientId, setNewClientId] = useState("");
  const [newMarketplace, setNewMarketplace] = useState("");
  const [newTaskType, setNewTaskType] = useState("");
  const [newAssignee, setNewAssignee] = useState("");
  const [newDueDate, setNewDueDate] = useState("");
  const [creating, setCreating] = useState(false);

  // Same rule as due dates: setting up work that will keep reappearing on
  // everyone's board is a scheduling decision, not day-to-day triage.
  const canSetDueDate = user.role === "admin" || user.role === "manager";
  const canRepeat = canSetDueDate;
  // Members raise and work tasks; they don't remove them. Matched by the
  // server, which is what actually enforces it.
  const canDelete = canSetDueDate;
  // A task typed straight onto the board can carry a client, an employee and
  // a deadline nobody asked for over WhatsApp — same two roles again, and the
  // same two the client list is readable by, which the form needs.
  const canCreate = canSetDueDate;

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const [taskList, employeeList, statusList, taskTypeList, marketplaceList, clientList] = await Promise.all([
        fetchTasks(),
        fetchEmployees(),
        fetchConfigOptions("status"),
        fetchConfigOptions("task_type"),
        fetchConfigOptions("marketplace"),
        // Only for the "New task" form's client picker. A member can't read
        // the client list at all (the server refuses it), so asking for it
        // would fail their whole board, not just this one list.
        canCreate ? fetchClients() : Promise.resolve([] as Client[]),
      ]);
      setTasks(taskList);
      setEmployees(employeeList);
      setStatusOptions(statusList);
      setTaskTypeOptions(taskTypeList);
      setMarketplaceOptions(marketplaceList);
      setClients(clientList);
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

  // Every date box goes through here so page 3 of the old result doesn't
  // survive a narrower filter — same reason the dropdowns above reset it.
  function setDateFilter(set: (value: string) => void, value: string) {
    set(value);
    paged.reset();
  }

  const anyDateFilter = Boolean(createdFrom || createdTo || dueFrom || dueTo);

  function clearDateFilters() {
    setCreatedFrom("");
    setCreatedTo("");
    setDueFrom("");
    setDueTo("");
    paged.reset();
  }

  function closeNewTaskForm() {
    setNewTaskOpen(false);
    setNewDescription("");
    setNewClientId("");
    setNewMarketplace("");
    setNewTaskType("");
    setNewAssignee("");
    setNewDueDate("");
  }

  // A task raised on the board rather than over WhatsApp. The client picked
  // here is what decides where its updates can be sent — see the create route
  // in the backend. The new task goes to the top of the list, which is where
  // the board's newest-first order would put it anyway.
  async function handleCreateTask() {
    if (!newDescription.trim()) {
      setActionError("Write what the task is.");
      return;
    }
    setActionError("");
    setCreating(true);
    try {
      const task = await createTask({
        description: newDescription.trim(),
        clientId: newClientId || null,
        assignee: newAssignee || null,
        taskType: newTaskType || null,
        marketplace: newMarketplace || null,
        // Sent as a whole day, the same way the board's due-date column sets
        // it — nothing on a task is scheduled to a time of day.
        dueDate: newDueDate ? new Date(newDueDate).toISOString() : null,
      });
      setTasks((prev) => [task, ...prev]);
      closeNewTaskForm();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setCreating(false);
    }
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
      matchesEmployeeFilter(t, employeeFilter) &&
      withinDateRange(t.createdAt, createdFrom, createdTo) &&
      withinDateRange(t.dueDate, dueFrom, dueTo)
  );
  const paged = usePaged(filteredTasks, PAGE_SIZE);

  if (loading) return <Spinner label="Loading tasks…" />;

  if (loadError) return <ErrorBanner message={loadError} onRetry={load} />;


  return (
    <>
      {actionError && <ErrorBanner message={actionError} onRetry={() => setActionError("")} />}

      {/* Raising a task by hand, for work that came in by phone or in a
          meeting rather than over WhatsApp. Everything the board holds is on
          the one form, so a new task doesn't have to be made and then triaged
          in five separate edits. */}
      {canCreate && (
        <div className="panel">
          <div className="panel-head">
            <span className="panel-title">New task</span>
            <button
              className={`btn btn-sm ${newTaskOpen ? "btn-ghost" : "btn-primary"}`}
              onClick={() => (newTaskOpen ? closeNewTaskForm() : setNewTaskOpen(true))}
              type="button"
            >
              {newTaskOpen ? "Close" : "Add a task"}
            </button>
          </div>
          {newTaskOpen && (
            <div className="panel-body">
              <div className="new-task-form">
                <div className="new-task-description">
                  <label className="fact-label" htmlFor="new-task-description">What is the task</label>
                  <input
                    id="new-task-description"
                    className="field-input"
                    type="text"
                    placeholder="e.g. Fix the listing images for the new SKU"
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                  />
                </div>
                <div>
                  {/* The client is also what decides where updates on this
                      task can be sent — their WhatsApp group, or their number
                      if they have no group. Left empty, the task stays
                      internal and its Send button is off. */}
                  <span className="fact-label">Client</span>
                  <SearchableSelect
                    value={newClientId}
                    placeholder="No client"
                    options={clients.map((client) => ({ value: client.id, label: client.name }))}
                    onChange={setNewClientId}
                  />
                </div>
                <div>
                  <span className="fact-label">Platform</span>
                  <SearchableSelect
                    value={newMarketplace}
                    placeholder="Unset"
                    options={marketplaceOptions.map((mp) => ({ value: mp.value, label: mp.label }))}
                    onChange={setNewMarketplace}
                  />
                </div>
                <div>
                  <span className="fact-label">Type</span>
                  <SearchableSelect
                    value={newTaskType}
                    placeholder="Not Set"
                    options={taskTypeOptions.map((type) => ({ value: type.value, label: type.label }))}
                    onChange={setNewTaskType}
                  />
                </div>
                <div>
                  <span className="fact-label">Employee</span>
                  <SearchableSelect
                    value={newAssignee}
                    placeholder="Unassigned"
                    options={employees.map((employee) => ({ value: employee.name, label: employee.name }))}
                    onChange={setNewAssignee}
                  />
                </div>
                <div>
                  <label className="fact-label" htmlFor="new-task-due">Due date</label>
                  <input
                    id="new-task-due"
                    className="field-input"
                    type="date"
                    value={newDueDate}
                    onChange={(e) => setNewDueDate(e.target.value)}
                  />
                </div>
                <div className="new-task-actions">
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={handleCreateTask}
                    disabled={creating || !newDescription.trim()}
                    type="button"
                  >
                    {creating ? "Adding…" : "Add task"}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={closeNewTaskForm} type="button">
                    Cancel
                  </button>
                </div>
              </div>
              <p className="panel-sub" style={{ marginTop: 10 }}>
                Picking an employee sends them a WhatsApp message straight away, the same as
                putting them on a task from the board.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">Tasks</span>
          <span className="panel-sub">{filteredTasks.length} shown of {tasks.length} total</span>
        </div>
        <div className="panel-body">
          {/* Every filter is a type-to-search dropdown, the same one the rows
              use: these lists are admin-editable and keep growing, and a
              plain <select> gives no way to find an option by typing it. The
              "All …" row at the top of each is what clears that filter. */}
          <div className="filter-row">
            {/* Status sits with the other filters as a dropdown rather than a
                row of chips — the counts that made the chips worth their width
                are kept on each option. */}
            <SearchableSelect
              value={statusFilter ?? ""}
              placeholder={`All Statuses (${tasks.length})`}
              options={statusOptions.map((option) => ({
                value: option.value,
                label: `${option.label} (${tasks.filter((t) => t.status === option.value).length})`,
              }))}
              onChange={(value) => selectStatusFilter(value || null)}
            />
            <SearchableSelect
              value={marketplaceFilter ?? ""}
              placeholder="All Marketplaces"
              options={[
                ...marketplaceOptions.map((option) => ({ value: option.value, label: option.label })),
                { value: UNSET_MARKETPLACE, label: "Unset" },
              ]}
              onChange={selectMarketplaceFilter}
            />
            <SearchableSelect
              value={employeeFilter ?? ""}
              placeholder="All Employees"
              options={[
                ...employees.map((employee) => ({ value: employee.name, label: employee.name })),
                { value: UNASSIGNED, label: "Unassigned" },
              ]}
              onChange={selectEmployeeFilter}
            />
            <SearchableSelect
              value={typeFilter ?? ""}
              placeholder="All Types"
              options={[
                ...taskTypeOptions.map((option) => ({ value: option.value, label: option.label })),
                { value: UNSET_TYPE, label: "Not Set" },
              ]}
              onChange={selectTypeFilter}
            />
          </div>

          {/* Date ranges get their own line: four boxes in the row above would
              push the dropdowns onto a second line anyway, and "from/to" only
              reads clearly with its heading next to it. Both ends are
              optional — one box on its own means everything before, or
              everything after. */}
          <div className="filter-dates">
            <div className="filter-date-group">
              <span className="fact-label">Created</span>
              <input
                className="field-input"
                type="date"
                aria-label="Created from"
                value={createdFrom}
                onChange={(e) => setDateFilter(setCreatedFrom, e.target.value)}
              />
              <span className="panel-sub">to</span>
              <input
                className="field-input"
                type="date"
                aria-label="Created to"
                value={createdTo}
                onChange={(e) => setDateFilter(setCreatedTo, e.target.value)}
              />
            </div>
            <div className="filter-date-group">
              <span className="fact-label">Due Date</span>
              <input
                className="field-input"
                type="date"
                aria-label="Due date from"
                value={dueFrom}
                onChange={(e) => setDateFilter(setDueFrom, e.target.value)}
              />
              <span className="panel-sub">to</span>
              <input
                className="field-input"
                type="date"
                aria-label="Due date to"
                value={dueTo}
                onChange={(e) => setDateFilter(setDueTo, e.target.value)}
              />
            </div>
            {anyDateFilter && (
              <button className="btn btn-ghost btn-sm" onClick={clearDateFilters} type="button">
                Clear dates
              </button>
            )}
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
                    {/* A task raised on the board with no client picked has no
                        group or number behind it — the button is off, and says
                        why rather than looking broken. */}
                    <button
                      className={`btn btn-sm ${
                        task.pendingSendFields.length > 0 && canSendToClient(task) ? "btn-primary" : "btn-ghost"
                      }`}
                      title={canSendToClient(task) ? undefined : NO_SEND_TARGET_HINT}
                      disabled={
                        task.pendingSendFields.length === 0 ||
                        !canSendToClient(task) ||
                        sendingTaskId === task.id
                      }
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
