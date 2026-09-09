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
  addClientWhatsappGroup,
  removeClientWhatsappGroup,
  addClientReportSheet,
  removeClientReportSheet,
} from "./api";
import Spinner from "./Spinner";
import ErrorBanner from "./ErrorBanner";
import SearchableSelect from "./SearchableSelect";
import Pagination, { usePaged } from "./Paged";
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
  const [notesDraft, setNotesDraft] = useState<string | null>(null);
  const [savingNotes, setSavingNotes] = useState(false);
  const [report, setReport] = useState<WeeklyReportPreview | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState("");
  // Bumped by the sheet panel's own Retry button — the sheet read depends on
  // a client id that hasn't changed, so there's nothing else for the effect
  // below to key off to run it again.
  const [reportReload, setReportReload] = useState(0);
  // Which marketplace's sheet the numbers panel is showing, for a client with
  // more than one. Empty means "whichever is first".
  const [reportMarketplace, setReportMarketplace] = useState("");
  // Linking this client a WhatsApp group or a report sheet. Both used to be
  // done on the Clients screen, on every row at once; they belong here, on
  // the one client, beside their work and their notes. Plain strings rather
  // than the per-client maps that screen needed, because this screen only
  // ever has one client open.
  const [newGroupId, setNewGroupId] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [groupError, setGroupError] = useState("");
  const [newSheetUrl, setNewSheetUrl] = useState("");
  const [newSheetMarketplace, setNewSheetMarketplace] = useState("");
  const [sheetError, setSheetError] = useState("");

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
      // Landing here from the menu with nothing picked yet shows the
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
    setNotesDraft(null);
    setReport(null);
    setReportError("");
    setNewGroupId("");
    setNewGroupName("");
    setGroupError("");
    setNewSheetUrl("");
    setNewSheetMarketplace("");
    setSheetError("");
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
  // Which of this client's sheets the numbers below are read from. A client
  // with one sheet never sees the choice; one with sheets for two
  // marketplaces starts on the first and can switch.
  const shownSheet =
    client?.reportSheets.find((sheet) => sheet.marketplace === reportMarketplace) ??
    client?.reportSheets[0] ??
    null;

  useEffect(() => {
    if (!client || !shownSheet) return;
    let cancelled = false;
    setReportLoading(true);
    setReportError("");
    fetchWeeklyReportPreview(client.id, shownSheet.marketplace)
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
  }, [client?.id, shownSheet?.id, reportReload]);

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

  // Adds one more WhatsApp group to this client — a client can be in several
  // (separate regional or purpose-specific groups), so this adds rather than
  // replaces. Fails with a 409 naming the client already holding it, since a
  // group belongs to exactly one.
  async function handleAddGroup() {
    if (!client) return;
    const groupId = newGroupId.trim();
    if (!groupId) {
      setGroupError("Paste the group id first.");
      return;
    }
    setGroupError("");
    setActionError("");
    try {
      const group = await addClientWhatsappGroup(client.id, groupId, newGroupName.trim() || undefined);
      setClient({ ...client, whatsappGroups: [...client.whatsappGroups, group] });
      setNewGroupId("");
      setNewGroupName("");
    } catch (err) {
      setGroupError(errorMessage(err));
    }
  }

  // Unlinking stops this group's messages becoming tasks for this client —
  // they go back to being logged as unrecognized until somebody links them
  // again. It does not touch the tasks it has already produced.
  async function handleUnlinkGroup(groupRowId: string) {
    if (!client) return;
    setActionError("");
    try {
      await removeClientWhatsappGroup(client.id, groupRowId);
      setClient({
        ...client,
        whatsappGroups: client.whatsappGroups.filter((group) => group.id !== groupRowId),
      });
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  // One sheet per marketplace: a client selling on both Amazon and Flipkart
  // has two separate sets of figures, and one sheet cannot hold two accounts'
  // numbers in the same columns. A second sheet for a marketplace they
  // already have is refused rather than replacing the link somebody set.
  async function handleAddSheet() {
    if (!client) return;
    const sheetUrl = newSheetUrl.trim();
    if (!sheetUrl) {
      setSheetError("Paste the link to the sheet first.");
      return;
    }
    if (!newSheetMarketplace) {
      setSheetError("Pick which marketplace this sheet is for.");
      return;
    }
    setSheetError("");
    setActionError("");
    try {
      const sheet = await addClientReportSheet(client.id, newSheetMarketplace, sheetUrl);
      setClient({ ...client, reportSheets: [...client.reportSheets, sheet] });
      setNewSheetUrl("");
      setNewSheetMarketplace("");
    } catch (err) {
      setSheetError(errorMessage(err));
    }
  }

  async function handleRemoveSheet(sheetId: string) {
    if (!client) return;
    setActionError("");
    try {
      await removeClientReportSheet(client.id, sheetId);
      setClient({ ...client, reportSheets: client.reportSheets.filter((sheet) => sheet.id !== sheetId) });
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  const filteredTasks = statusFilter ? tasks.filter((t) => t.status === statusFilter) : tasks;
  const paged = usePaged(filteredTasks, PAGE_SIZE);

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

  return (
    <>
      {actionError && <ErrorBanner message={actionError} onRetry={() => setActionError("")} />}

      <div className="panel">
        <div className="panel-body" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", paddingTop: 16 }}>
          <span className="panel-sub">Showing</span>
          {/* Type-to-search rather than a plain <select>: this list is every
              client on the books and only grows, and picking one by typing
              two letters of the name beats scrolling for it. */}
          <div style={{ minWidth: 220 }}>
            <SearchableSelect
              value={clientId ?? ""}
              placeholder="Pick a client"
              allowClear={false}
              options={clients.map((c) => ({
                value: c.id,
                label: `${c.name}${c.active ? "" : " (not active)"}`,
              }))}
              onChange={onSelectClient}
            />
          </div>
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
                {" · "}
                {client.assignedEmployee
                  ? `New tasks go to ${client.assignedEmployee.name}`
                  : "New tasks arrive unassigned"}
                {" (set on the Clients screen)"}
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

          {/* Where a client's groups and report sheets are set. Both were on
              the Clients screen, open on all 26 rows at once, which is what
              turned that list into a wall of empty boxes. They are set when a
              client is onboarded and rarely touched again, and when they are
              touched it is about one client — so they belong here, beside that
              client's work and notes, rather than on the directory.

              The phone stays on the Clients screen: it is read and changed
              constantly, and it is one short value on a row rather than a
              list that needs managing. */}
          <div className="panel">
            <div className="panel-head">
              <span className="panel-title">Contact and chats</span>
              <span className="panel-sub">The phone is on the Clients screen</span>
            </div>
            <div className="panel-body">
              {/* Not the plain .fact-grid: these three facts want very
                  different widths — see .contact-grid. */}
              <div className="fact-grid contact-grid">
                <div>
                  <div className="fact-label">Phone</div>
                  <div className="fact-value">{client.phone || "Not saved"}</div>
                </div>

                <div>
                  <div className="fact-label">WhatsApp groups</div>
                  <div className="fact-value">
                    {client.whatsappGroups.length === 0 && (
                      <div className="client-linked-none" style={{ marginBottom: 8 }}>
                        Not linked to any group
                      </div>
                    )}
                    {client.whatsappGroups.map((group) => (
                      <div key={group.id} className="cell-list-item">
                        {/* The raw JID is not shown. Nobody reads it and
                            nobody has to: Periskope supplies the group's name,
                            and intake saves the link itself the first time the
                            client posts from their saved number. It stays in
                            the tooltip only, for the rare afternoon somebody
                            is matching this screen against Periskope. */}
                        <div style={{ minWidth: 0, flex: 1 }} title={group.groupId}>
                          {group.groupName ?? "Unnamed group"}
                        </div>
                        <button className="btn btn-ghost btn-sm" onClick={() => handleUnlinkGroup(group.id)}>
                          Unlink
                        </button>
                      </div>
                    ))}
                    {/* The last hand-linking route, and the reason it cannot
                        go: a group links itself only once it has sent a task,
                        and a group has to be linked *before* a report can be
                        sent to it. A client onboarded for reports who has not
                        messaged yet is reachable no other way. Everything
                        else links itself, or is one click on Unrecognized
                        Senders. */}
                    <div className="cell-form">
                      <input
                        className="field-input"
                        type="text"
                        placeholder="Paste a group id"
                        aria-label="WhatsApp group id"
                        value={newGroupId}
                        onChange={(e) => setNewGroupId(e.target.value)}
                        // A group id begins 120363…, so the part that
                        // identifies one is the end. In a narrow box the whole
                        // of that is off-screen and two different groups look
                        // identical — which matters here, where one client can
                        // have a separate group per marketplace.
                        title={newGroupId}
                        style={{ flex: "1 1 200px", minWidth: 0, fontSize: 12 }}
                      />
                      <input
                        className="field-input"
                        type="text"
                        placeholder="Group name"
                        aria-label="WhatsApp group name"
                        value={newGroupName}
                        onChange={(e) => setNewGroupName(e.target.value)}
                        style={{ flex: "1 1 110px", minWidth: 0, fontSize: 12 }}
                      />
                      <button className="btn btn-ghost btn-sm" onClick={handleAddGroup}>
                        + Add
                      </button>
                    </div>
                    {groupError && <div className="cell-error">{groupError}</div>}
                  </div>
                </div>

                <div>
                  {/* One sheet per marketplace — a client selling on Amazon
                      and Flipkart keeps a separate set of figures for each. */}
                  <div className="fact-label">Report sheets</div>
                  <div className="fact-value">
                    {client.reportSheets.length === 0 && (
                      <div className="client-linked-none" style={{ marginBottom: 8 }}>
                        No sheet saved — no reports can be sent
                      </div>
                    )}
                    {client.reportSheets.map((sheet) => (
                      <div key={sheet.id} className="cell-list-item">
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div>{marketplaceLabels[sheet.marketplace] ?? sheet.marketplace}</div>
                          <a
                            className="panel-sub"
                            href={sheet.sheetUrl}
                            target="_blank"
                            rel="noreferrer"
                            title={sheet.sheetUrl}
                          >
                            Open sheet
                          </a>
                        </div>
                        <button className="btn btn-ghost btn-sm" onClick={() => handleRemoveSheet(sheet.id)}>
                          Remove
                        </button>
                      </div>
                    ))}
                    <div className="cell-form">
                      <input
                        className="field-input"
                        type="text"
                        placeholder="Paste sheet link"
                        aria-label="Report sheet link"
                        value={newSheetUrl}
                        title={newSheetUrl}
                        onChange={(e) => setNewSheetUrl(e.target.value)}
                        style={{ flex: "1 1 170px", minWidth: 0, fontSize: 12 }}
                      />
                      <div style={{ flex: "0 0 120px" }}>
                        <SearchableSelect
                          value={newSheetMarketplace}
                          placeholder="Marketplace"
                          options={marketplaceOptions.map((option) => ({
                            value: option.value,
                            label: option.label,
                          }))}
                          onChange={setNewSheetMarketplace}
                        />
                      </div>
                      <button className="btn btn-ghost btn-sm" onClick={handleAddSheet}>
                        + Add
                      </button>
                    </div>
                    {sheetError && <div className="cell-error">{sheetError}</div>}
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

          {/* Counted from this client's tasks, so it is a record of who has
              actually done their work - not a setting, and not the same thing
              as the employee the client is assigned to. The two disagree
              routinely and both are right: somebody can have done every task
              a client has ever sent without being the person their new work
              now goes to. Saying so here is the only thing that made that
              readable. */}
          <div className="panel">
            <div className="panel-head">
              <span className="panel-title">Who has worked on this client</span>
              <span className="panel-sub">
                Counted from the work logged for them - who has done it, not who new tasks go to
              </span>
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

          {shownSheet && (
            <div className="panel">
              <div className="panel-head">
                <span className="panel-title">This week's numbers</span>
                <span className="panel-sub">Read live from this client's report sheet</span>
              </div>
              <div className="panel-body">
                {/* Only worth showing when there's a choice to make. */}
                {client.reportSheets.length > 1 && (
                  <div className="filter-chips">
                    {client.reportSheets.map((sheet) => (
                      <button
                        key={sheet.id}
                        className={`chip ${sheet.id === shownSheet.id ? "active" : ""}`}
                        onClick={() => setReportMarketplace(sheet.marketplace)}
                        type="button"
                      >
                        {marketplaceLabels[sheet.marketplace] ?? sheet.marketplace}
                      </button>
                    ))}
                  </div>
                )}
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
                        paged.reset();
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
                          paged.reset();
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
                      {paged.items.map((task) => (
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
                  <Pagination paged={paged} />
                </>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
