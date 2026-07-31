import { useEffect, useState } from "react";
import {
  ApiError,
  Client,
  ConfigOption,
  Task,
  WeeklyReportPreview,
  fetchAllClients,
  fetchClientOverview,
  fetchConfigOptions,
  fetchWeeklyReportPreview,
  updateClient,
} from "./api";
import Spinner from "./Spinner";
import ErrorBanner from "./ErrorBanner";
import { statusColor, statusLabel as buildStatusLabel } from "./taskDisplay";

const PAGE_SIZE = 10;

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong. Try again.";
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : "—";
}

function formatDateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "—";
}

// A task counts as late from the morning after its due date — comparing
// against "right now" instead would mark a task due today as late from
// 00:01 onwards, which isn't how anyone reads a due date.
function isLate(task: Task, todayStart: number): boolean {
  return task.status !== "done" && task.dueDate !== null && new Date(task.dueDate).getTime() < todayStart;
}

interface EmployeeRow {
  name: string;
  total: number;
  open: number;
  done: number;
}

// How many days between two dates, ignoring the time of day — used for the
// average "how long work takes" number, so a task opened late on Monday and
// finished early on Tuesday reads as 1 day, not 0.
function daysBetween(from: string, to: string): number {
  return Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000);
}

export default function ClientDetail({
  clientId,
  onSelectClient,
}: {
  clientId: string | null;
  onSelectClient: (id: string) => void;
}) {
  const [clients, setClients] = useState<Client[]>([]);
  const [client, setClient] = useState<Client | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [statusOptions, setStatusOptions] = useState<ConfigOption[]>([]);
  const [taskTypeOptions, setTaskTypeOptions] = useState<ConfigOption[]>([]);
  const [marketplaceOptions, setMarketplaceOptions] = useState<ConfigOption[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingClient, setLoadingClient] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [notesDraft, setNotesDraft] = useState<string | null>(null);
  const [savingNotes, setSavingNotes] = useState(false);
  const [report, setReport] = useState<WeeklyReportPreview | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState("");
  // Bumped by the sheet panel's own Retry button — the sheet read depends on
  // a client id that hasn't changed, so there's nothing else for the effect
  // below to key off to run it again.
  const [reportReload, setReportReload] = useState(0);

  // The client list and the dropdown option lists don't change when you
  // switch clients, so they're loaded once rather than on every switch.
  async function loadShared() {
    setLoadingList(true);
    setLoadError("");
    try {
      const [clientList, statusList, taskTypeList, marketplaceList] = await Promise.all([
        fetchAllClients(),
        fetchConfigOptions("status"),
        fetchConfigOptions("task_type"),
        fetchConfigOptions("marketplace"),
      ]);
      setClients(clientList);
      setStatusOptions(statusList);
      setTaskTypeOptions(taskTypeList);
      setMarketplaceOptions(marketplaceList);
      // Landing here from the sidebar with nothing picked yet shows the
      // first client rather than an empty screen with a dropdown to hunt
      // through — coming in from the Clients list already sets clientId.
      if (!clientId && clientList.length > 0) onSelectClient(clientList[0].id);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoadingList(false);
    }
  }

  useEffect(() => {
    loadShared();
  }, []);

  async function loadClient(id: string) {
    setLoadingClient(true);
    setLoadError("");
    setStatusFilter(null);
    setPage(1);
    setNotesDraft(null);
    setReport(null);
    setReportError("");
    try {
      const overview = await fetchClientOverview(id);
      setClient(overview.client);
      setTasks(overview.tasks);
    } catch (err) {
      setClient(null);
      setTasks([]);
      setLoadError(errorMessage(err));
    } finally {
      setLoadingClient(false);
    }
  }

  useEffect(() => {
    if (clientId) loadClient(clientId);
  }, [clientId]);

  // Read separately from the overview, and only for a client that actually
  // has a sheet linked: it's a live Google Sheets call, so a slow or
  // misconfigured sheet would otherwise hold up the whole screen.
  useEffect(() => {
    if (!client?.reportSheetUrl) return;
    let cancelled = false;
    setReportLoading(true);
    setReportError("");
    fetchWeeklyReportPreview(client.id)
      .then((preview) => {
        if (!cancelled) setReport(preview);
      })
      .catch((err) => {
        if (!cancelled) setReportError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setReportLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client?.id, client?.reportSheetUrl, reportReload]);

  async function handleNotesSave() {
    if (!client || notesDraft === null || notesDraft === (client.notes ?? "")) {
      setNotesDraft(null);
      return;
    }
    setActionError("");
    setSavingNotes(true);
    try {
      const updated = await updateClient(client.id, { notes: notesDraft });
      setClient(updated);
      setNotesDraft(null);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setSavingNotes(false);
    }
  }

  if (loadingList) return <Spinner label="Loading clients…" />;

  if (loadError && !client) return <ErrorBanner message={loadError} onRetry={() => (clientId ? loadClient(clientId) : loadShared())} />;

  if (clients.length === 0) {
    return <p className="panel-sub">No clients yet — add one on the Clients screen first.</p>;
  }

  const marketplaceLabels = Object.fromEntries(marketplaceOptions.map((o) => [o.value, o.label]));
  const taskTypeLabels = Object.fromEntries(taskTypeOptions.map((o) => [o.value, o.label]));

  function statusLabel(task: Task): string {
    return buildStatusLabel(task.status, task.marketplace, statusOptions, marketplaceLabels);
  }

  const todayStart = new Date().setHours(0, 0, 0, 0);
  const done = tasks.filter((t) => t.status === "done");
  const open = tasks.filter((t) => t.status !== "done");
  const late = open.filter((t) => isLate(t, todayStart));
  const noEmployee = open.filter((t) => !t.assignee);

  // Only tasks that actually got finished can say how long work takes —
  // an average over open ones would keep drifting as they sit there.
  const closedWithTimes = done.filter((t) => t.doneAt);
  const averageDays =
    closedWithTimes.length > 0
      ? Math.round(
          closedWithTimes.reduce((sum, t) => sum + daysBetween(t.createdAt, t.doneAt as string), 0) /
            closedWithTimes.length
        )
      : null;

  // Every status that this client actually has work in, in the admin's own
  // display order — statuses with nothing in them are left out rather than
  // shown as empty rows.
  const statusRows = statusOptions
    .map((option) => ({
      value: option.value,
      label: buildStatusLabel(option.value, null, statusOptions, marketplaceLabels),
      count: tasks.filter((t) => t.status === option.value).length,
      tone: statusColor(option.value),
    }))
    .filter((row) => row.count > 0);

  const employeeRows: EmployeeRow[] = Object.values(
    tasks.reduce<Record<string, EmployeeRow>>((acc, task) => {
      const name = task.assignee ?? "No employee set";
      const row = (acc[name] ??= { name, total: 0, open: 0, done: 0 });
      row.total += 1;
      if (task.status === "done") row.done += 1;
      else row.open += 1;
      return acc;
    }, {})
  ).sort((a, b) => b.total - a.total);

  const filteredTasks = statusFilter ? tasks.filter((t) => t.status === statusFilter) : tasks;
  const pageCount = Math.max(1, Math.ceil(filteredTasks.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pagedTasks = filteredTasks.slice(pageStart, pageStart + PAGE_SIZE);

  return (
    <>
      {actionError && <ErrorBanner message={actionError} onRetry={() => setActionError("")} />}

      <div className="panel">
        <div className="panel-body" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", paddingTop: 16 }}>
          <label className="panel-sub" htmlFor="client-picker">Showing</label>
          <select
            id="client-picker"
            className="field-select"
            value={clientId ?? ""}
            onChange={(e) => onSelectClient(e.target.value)}
            style={{ minWidth: 200 }}
          >
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}{c.active ? "" : " (not active)"}
              </option>
            ))}
          </select>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => clientId && loadClient(clientId)}
            disabled={loadingClient || !clientId}
            type="button"
          >
            {loadingClient ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {loadingClient && <Spinner label="Loading client…" />}

      {!loadingClient && client && (
        <>
          <div className="panel">
            <div className="panel-body" style={{ paddingTop: 16 }}>
              <div className="client-head">
                <span className="client-name">{client.name}</span>
                <span className={`pill ${client.active ? "pill-good" : "pill-neutral"}`}>
                  {client.active ? "Active" : "Not active"}
                </span>
              </div>
              <div className="panel-sub">
                Added {formatDate(client.createdAt)}
                {tasks.length > 0 && ` · Last work came in ${formatDate(tasks[0].createdAt)}`}
              </div>
            </div>
          </div>

          <div className="stat-row">
            <div className="stat-tile">
              <div className="stat-label">All work</div>
              <div className="stat-value">{tasks.length}</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">Still open</div>
              <div className="stat-value">{open.length}</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">Done</div>
              <div className={`stat-value ${done.length > 0 ? "is-good" : ""}`}>{done.length}</div>
              <div className="stat-note">
                {tasks.length > 0 ? `${Math.round((done.length / tasks.length) * 100)}% of all work` : "Nothing yet"}
              </div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">Past due date</div>
              <div className={`stat-value ${late.length > 0 ? "is-danger" : ""}`}>{late.length}</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">No employee</div>
              <div className={`stat-value ${noEmployee.length > 0 ? "is-warn" : ""}`}>{noEmployee.length}</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">Days to finish</div>
              <div className="stat-value">{averageDays === null ? "—" : averageDays}</div>
              <div className="stat-note">
                {averageDays === null ? "Nothing finished yet" : `Average of ${closedWithTimes.length} finished`}
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <span className="panel-title">Work by status</span>
              <span className="panel-sub">{tasks.length} in total</span>
            </div>
            <div className="panel-body">
              {statusRows.length === 0 && <p className="panel-sub">No work logged for this client yet.</p>}
              {statusRows.length > 0 && (
                <>
                  <div className="status-bar">
                    {statusRows.map((row) => (
                      <div
                        key={row.value}
                        className={`status-bar-seg tone-${row.tone}`}
                        style={{ flexGrow: row.count }}
                        title={`${row.label}: ${row.count}`}
                      />
                    ))}
                  </div>
                  <div className="status-legend">
                    {statusRows.map((row) => (
                      <div key={row.value} className="status-legend-row">
                        <span className={`status-legend-swatch tone-${row.tone}`} />
                        <span>{row.label}</span>
                        <span className="status-legend-count">
                          {row.count} · {Math.round((row.count / tasks.length) * 100)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <span className="panel-title">Contact and chats</span>
              <span className="panel-sub">Change these on the Clients screen</span>
            </div>
            <div className="panel-body">
              <div className="fact-grid">
                <div>
                  <div className="fact-label">Phone</div>
                  <div className="fact-value">{client.phone || "Not saved"}</div>
                </div>
                <div>
                  <div className="fact-label">WhatsApp groups</div>
                  <div className="fact-value">
                    {client.whatsappGroups.length === 0 && "Not linked to any group"}
                    {client.whatsappGroups.map((group) => (
                      <div key={group.id} style={{ marginBottom: 4 }}>
                        <div>{group.groupName ?? "No name saved"}</div>
                        <div className="panel-sub">{group.groupId}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="fact-label">Report sheet</div>
                  <div className="fact-value">
                    {client.reportSheetUrl ? (
                      <a href={client.reportSheetUrl} target="_blank" rel="noreferrer">Open sheet</a>
                    ) : (
                      "Not saved"
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <span className="panel-title">Notes</span>
              <span className="panel-sub">Only your team sees this — the client never does</span>
            </div>
            <div className="panel-body">
              <textarea
                className="field-input"
                rows={4}
                placeholder="Anything the team should know about this client"
                value={notesDraft ?? client.notes ?? ""}
                onChange={(e) => setNotesDraft(e.target.value)}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleNotesSave}
                  disabled={savingNotes || notesDraft === null || notesDraft === (client.notes ?? "")}
                  type="button"
                >
                  {savingNotes ? "Saving…" : "Save notes"}
                </button>
                {notesDraft !== null && notesDraft !== (client.notes ?? "") && (
                  <button className="btn btn-ghost btn-sm" onClick={() => setNotesDraft(null)} type="button">
                    Undo
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <span className="panel-title">Who is working on this client</span>
            </div>
            <div className="panel-body">
              {employeeRows.length === 0 && <p className="panel-sub">No work logged for this client yet.</p>}
              {employeeRows.length > 0 && (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>All work</th>
                      <th>Still open</th>
                      <th>Done</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employeeRows.map((row) => (
                      <tr key={row.name}>
                        <td>{row.name}</td>
                        <td>{row.total}</td>
                        <td>{row.open}</td>
                        <td>{row.done}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {client.reportSheetUrl && (
            <div className="panel">
              <div className="panel-head">
                <span className="panel-title">This week's numbers</span>
                <span className="panel-sub">Read live from this client's report sheet</span>
              </div>
              <div className="panel-body">
                {reportLoading && <Spinner label="Reading sheet…" />}
                {!reportLoading && reportError && (
                  <ErrorBanner message={reportError} onRetry={() => setReportReload((n) => n + 1)} />
                )}
                {!reportLoading && !reportError && report && report.sections.length === 0 && (
                  <p className="panel-sub">
                    Nothing filled in yet for {report.month}, Week {report.week}.
                  </p>
                )}
                {!reportLoading && !reportError && report && report.sections.length > 0 && (
                  <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                    {report.sections.map((section) => (
                      <div key={section.source} style={{ flex: "1 1 260px", minWidth: 240 }}>
                        <div className="panel-sub" style={{ marginBottom: 4, fontWeight: 600 }}>{section.source}</div>
                        <table className="data-table">
                          <tbody>
                            {section.fields.map((field) => (
                              <tr key={field.label}>
                                <td>{field.label}</td>
                                <td>{field.value}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="panel">
            <div className="panel-head">
              <span className="panel-title">All work</span>
              <span className="panel-sub">{filteredTasks.length} shown of {tasks.length} total</span>
            </div>
            <div className="panel-body">
              {tasks.length === 0 && (
                <p className="panel-sub">
                  Nothing logged for this client yet. Tasks show up here once someone sends a
                  “task:” message from their phone number or a linked WhatsApp group.
                </p>
              )}
              {tasks.length > 0 && (
                <>
                  <div className="filter-chips">
                    <button
                      className={`chip ${statusFilter === null ? "active" : ""}`}
                      onClick={() => {
                        setStatusFilter(null);
                        setPage(1);
                      }}
                    >
                      All <span className="chip-count">{tasks.length}</span>
                    </button>
                    {statusRows.map((row) => (
                      <button
                        key={row.value}
                        className={`chip ${statusFilter === row.value ? "active" : ""}`}
                        onClick={() => {
                          setStatusFilter(row.value);
                          setPage(1);
                        }}
                      >
                        {row.label} <span className="chip-count">{row.count}</span>
                      </button>
                    ))}
                  </div>

                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Task</th>
                        <th>Status</th>
                        <th>Type</th>
                        <th>Marketplace</th>
                        <th>Employee</th>
                        <th>Came in</th>
                        <th>Due date</th>
                        <th>Finished</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedTasks.map((task) => (
                        <tr key={task.id}>
                          <td>{task.description}</td>
                          <td>
                            <span className={`pill pill-${statusColor(task.status)}`}>{statusLabel(task)}</span>
                          </td>
                          <td>{(task.taskType && taskTypeLabels[task.taskType]) ?? "Not set"}</td>
                          <td>{(task.marketplace && marketplaceLabels[task.marketplace]) ?? "Not set"}</td>
                          <td>{task.assignee ?? "No employee"}</td>
                          <td>{formatDateTime(task.createdAt)}</td>
                          <td>
                            {task.dueDate ? (
                              <span className={isLate(task, todayStart) ? "text-danger" : undefined}>
                                {formatDate(task.dueDate)}
                                {isLate(task, todayStart) && " · late"}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td>{formatDateTime(task.doneAt)}</td>
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
                </>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
