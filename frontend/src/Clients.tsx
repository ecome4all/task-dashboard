import { useEffect, useState } from "react";
import {
  Client,
  ConfigOption,
  UnrecognizedSender,
  Task,
  ApiError,
  fetchAllClients,
  fetchUnrecognizedSenders,
  ignoreUnrecognizedSender,
  fetchTasks,
  fetchConfigOptions,
  createClient,
  updateClient,
  deleteClient,
  addClientWhatsappGroup,
  fetchEmployees,
  Employee,
} from "./api";
import Spinner from "./Spinner";
import ErrorBanner from "./ErrorBanner";
import SearchableSelect from "./SearchableSelect";
import Pagination, { usePaged } from "./Paged";
import { matchesSearch } from "./searchRows";
import { SavedTick, saveOnEnter, useSavedFlash } from "./savedFlash";
import { useAutoRefresh } from "./useAutoRefresh";

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong. Try again.";
}

interface ClientSummaryRow {
  name: string;
  total: number;
  pending: number;
  done: number;
}

export default function Clients({ onOpenClient }: { onOpenClient: (id: string) => void }) {
  const [clients, setClients] = useState<Client[]>([]);
  const [unrecognizedSenders, setUnrecognizedSenders] = useState<UnrecognizedSender[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newClientGroupId, setNewClientGroupId] = useState("");
  const [newClientGroupName, setNewClientGroupName] = useState("");
  const [phoneDrafts, setPhoneDrafts] = useState<Record<string, string>>({});
  const [marketplaceOptions, setMarketplaceOptions] = useState<ConfigOption[]>([]);
  // Active employees only — the picker must not offer somebody deactivated,
  // since the backend refuses them and a task assigned to one would reach
  // nobody. fetchEmployees is already the active-only list.
  const [employees, setEmployees] = useState<Employee[]>([]);
  // Per client, beside the picker that failed, for the same reason the sheet
  // and group errors are: on a list of 23 rows the banner at the top is well
  // out of view by the time you are changing who a client belongs to.
  const [employeeError, setEmployeeError] = useState<Record<string, string>>({});
  // 26 clients over three pages, and the only way to reach one was paging to
  // it — the same problem the Tasks board and Repeating Tasks already solved
  // with a box that narrows the list as you type.
  const [search, setSearch] = useState("");
  const [linkChoice, setLinkChoice] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  // The phone box saves itself on the way out — this is what says so.
  const { savedKey, flash } = useSavedFlash();

  // A sheet stores the marketplace's stable value ("amazon"); the screen shows
  // whatever an admin has named it. An option since renamed or deactivated
  // falls back to the stored value rather than showing an empty cell.
  function marketplaceLabel(value: string): string {
    return marketplaceOptions.find((option) => option.value === value)?.label ?? value;
  }

  // What this client has, for the summary line: "1 group · Amazon".
  //
  // The marketplaces are named rather than counted. "2 sheets" is not
  // something anybody acts on; "Amazon, Flipkart" says which reports this
  // client actually gets, which is the question the column is there to answer.
  function linkedSummary(client: Client): string[] {
    const parts: string[] = [];
    if (client.whatsappGroups.length > 0) {
      parts.push(
        client.whatsappGroups.length === 1 ? "1 group" : `${client.whatsappGroups.length} groups`
      );
    }
    if (client.reportSheets.length > 0) {
      parts.push(client.reportSheets.map((sheet) => marketplaceLabel(sheet.marketplace)).join(", "));
    }
    return parts;
  }

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const [clientList, senders, taskList, marketplaceList, employeeList] = await Promise.all([
        fetchAllClients(),
        fetchUnrecognizedSenders(),
        fetchTasks(),
        // Only to name a linked sheet's marketplace in the Linked column —
        // the sheets themselves are managed on Client Details now.
        fetchConfigOptions("marketplace"),
        // For the Employee picker: who each client's new tasks go to.
        fetchEmployees(),
      ]);
      setClients(clientList);
      setUnrecognizedSenders(senders);
      setTasks(taskList);
      setMarketplaceOptions(marketplaceList);
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

  // Unrecognized senders turn up on their own, whenever an unknown group
  // messages — this list was only ever right at the moment the screen opened.
  // A minute rather than the default half: nothing here changes as often as
  // the task board, and this reads three lists at once.
  //
  // The phone being typed into a row is held in its own state keyed by client
  // id, so replacing the client list underneath it leaves a half-typed number
  // alone.
  useAutoRefresh(async () => {
    const [clientList, senders, taskList] = await Promise.all([
      fetchAllClients(),
      fetchUnrecognizedSenders(),
      fetchTasks(),
    ]);
    setClients(clientList);
    setUnrecognizedSenders(senders);
    setTasks(taskList);
  }, 60_000);

  async function handleAddClient(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setActionError("");
    try {
      let client = await createClient({ name, phone: newPhone.trim() || undefined });
      const groupId = newClientGroupId.trim();
      // Group is optional and added as a second step right after create —
      // if it fails (e.g. already linked to another client), the client
      // itself still gets created rather than losing the whole submission.
      if (groupId) {
        try {
          const group = await addClientWhatsappGroup(client.id, groupId, newClientGroupName.trim() || undefined);
          client = { ...client, whatsappGroups: [...client.whatsappGroups, group] };
        } catch (err) {
          setActionError(errorMessage(err));
        }
      }
      setClients((prev) => [...prev, client].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName("");
      setNewPhone("");
      setNewClientGroupId("");
      setNewClientGroupName("");
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  async function handlePhoneSave(client: Client) {
    const phone = phoneDrafts[client.id] ?? client.phone ?? "";
    setPhoneDrafts((prev) => {
      const { [client.id]: _, ...rest } = prev;
      return rest;
    });
    if (phone === (client.phone ?? "")) return;
    setActionError("");
    try {
      const updated = await updateClient(client.id, { phone });
      setClients((prev) => prev.map((c) => (c.id === client.id ? updated : c)));
      flash(`${client.id}:phone`);
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  // Who this client's work goes to from now on. Clearing the picker sends
  // null, which takes the employee off rather than leaving them — their tasks
  // go back to arriving unassigned.
  //
  // Nothing already on the board moves. This decides where the client's next
  // task lands, never who the ones sitting there belong to, and the note
  // under the column says so on screen.
  async function handleAssignEmployee(client: Client, employeeId: string) {
    const next = employeeId || null;
    if (next === client.assignedEmployeeId) return;
    setEmployeeError((prev) => ({ ...prev, [client.id]: "" }));
    setActionError("");
    try {
      const updated = await updateClient(client.id, { assignedEmployeeId: next });
      setClients((prev) => prev.map((c) => (c.id === client.id ? updated : c)));
      flash(`${client.id}:employee`);
    } catch (err) {
      setEmployeeError((prev) => ({ ...prev, [client.id]: errorMessage(err) }));
    }
  }

  async function handleActiveToggle(client: Client, active: boolean) {
    setActionError("");
    try {
      const updated = await updateClient(client.id, { active });
      setClients((prev) => prev.map((c) => (c.id === client.id ? updated : c)));
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  async function handleDelete(client: Client) {
    if (!window.confirm(`Delete ${client.name}? This can't be undone — use Deactivate instead if you might want them back.`)) {
      return;
    }
    setActionError("");
    try {
      await deleteClient(client.id);
      setClients((prev) => prev.filter((c) => c.id !== client.id));
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  async function handleLinkSender(sender: UnrecognizedSender) {
    const clientId = linkChoice[sender.chatId];
    if (!clientId) return;
    setActionError("");
    try {
      const group = await addClientWhatsappGroup(clientId, sender.chatId, sender.chatName ?? undefined);
      setClients((prev) =>
        prev.map((c) => (c.id === clientId ? { ...c, whatsappGroups: [...c.whatsappGroups, group] } : c))
      );
      setUnrecognizedSenders((prev) => prev.filter((s) => s.chatId !== sender.chatId));
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  async function handleIgnoreSender(sender: UnrecognizedSender) {
    if (
      !window.confirm(
        `Ignore ${sender.chatName ?? sender.chatId}? This clears their logged messages from this list. If they message again later, they'll reappear here.`
      )
    ) {
      return;
    }
    setActionError("");
    try {
      await ignoreUnrecognizedSender(sender.chatId);
      setUnrecognizedSenders((prev) => prev.filter((s) => s.chatId !== sender.chatId));
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

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

  const pagedSummary = usePaged(clientSummary, 10);
  const pagedSenders = usePaged(unrecognizedSenders, 10);

  // The client's own words: their name, their number and the names of their
  // WhatsApp groups. All three are ways staff actually recognize a client —
  // the name is on the row, but so is the group it was linked from, and a
  // number is sometimes the only thing to hand. There are no dropdown filters
  // on this screen for any of them to disagree with.
  const filteredClients = clients.filter((client) =>
    matchesSearch(search, client.name, client.phone, ...client.whatsappGroups.map((g) => g.groupName))
  );

  // 20 rather than the 10 the other screens use: a client is one line here,
  // so ten of them filled a third of the screen and put 26 clients across
  // three pages. At 20 the whole directory is two.
  const pagedClients = usePaged(filteredClients, 20);

  // Typing narrows the list under you, so page 3 of the old result must not
  // survive it — same reason the other two screens reset on every filter.
  function typeSearch(value: string) {
    setSearch(value);
    pagedClients.reset();
  }

  if (loading) return <Spinner label="Loading clients…" />;

  if (loadError) return <ErrorBanner message={loadError} onRetry={load} />;


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
              {pagedSummary.items.map((row) => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td>{row.total}</td>
                  <td>{row.pending}</td>
                  <td>{row.done}</td>
                </tr>
              ))}
            </tbody>
          </table>
            <Pagination paged={pagedSummary} />
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">Add client</span>
        </div>
        <div className="panel-body">
          <form className="add-employee" onSubmit={handleAddClient}>
            <input
              className="field-input"
              type="text"
              placeholder="Client name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              style={{ flex: 1 }}
            />
            <input
              className="field-input"
              type="text"
              placeholder="Phone (optional)"
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              style={{ flex: 1 }}
            />
            <input
              className="field-input"
              type="text"
              placeholder="Group id (optional)"
              value={newClientGroupId}
              onChange={(e) => setNewClientGroupId(e.target.value)}
              style={{ flex: 1 }}
            />
            <input
              className="field-input"
              type="text"
              placeholder="Group name (optional)"
              value={newClientGroupName}
              onChange={(e) => setNewClientGroupName(e.target.value)}
              style={{ flex: 1 }}
            />
            <button className="btn btn-primary" type="submit">Add</button>
          </form>
        </div>
      </div>

      {unrecognizedSenders.length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <span className="panel-title">Unrecognized Senders</span>
            <span className="panel-sub">
              {unrecognizedSenders.length} sent a task: message but aren't tied to a client — not logged as tasks yet
            </span>
          </div>
          <div className="panel-body">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Sender</th>
                  <th>Messages</th>
                  <th>Last Seen</th>
                  <th>Assign To</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pagedSenders.items.map((sender) => (
                  <tr key={sender.chatId}>
                    <td>{sender.chatName ?? sender.chatId}</td>
                    <td>{sender.messageCount}</td>
                    <td>{new Date(sender.lastSeenAt).toLocaleString()}</td>
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <select
                          className="field-select"
                          value={linkChoice[sender.chatId] ?? ""}
                          onChange={(e) =>
                            setLinkChoice((prev) => ({ ...prev, [sender.chatId]: e.target.value }))
                          }
                        >
                          <option value="">Select client…</option>
                          {clients.map((client) => (
                            <option key={client.id} value={client.id}>{client.name}</option>
                          ))}
                        </select>
                        <button className="btn btn-primary btn-sm" onClick={() => handleLinkSender(sender)}>
                          Link
                        </button>
                      </div>
                    </td>
                    <td>
                      <button className="btn btn-ghost btn-sm" onClick={() => handleIgnoreSender(sender)}>
                        Ignore
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination paged={pagedSenders} />
          </div>
        </div>
      )}

      {/* The directory: who a client is, who has them, and how to reach them.
          Nothing else.

          It used to carry its whole editing surface on every row at once — a
          group id box, a group name box, a sheet link box, a marketplace
          picker and two Add buttons, on all 26 rows. Fifty empty boxes on
          screen for the one you were filling in, each row twice as tall as
          the client's own details, and six clients visible out of 26.

          Groups and report sheets now live on Client Details, next to that
          client's work and their notes. They are set once when a client is
          onboarded and rarely touched again; the employee and the phone are
          read and changed constantly. That is the split. */}
      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">Clients</span>
          <span className="panel-sub">
            {search.trim() === ""
              ? `${clients.length} total · click a name for their work, groups and sheets`
              : `${filteredClients.length} of ${clients.length} match · click a name for their work, groups and sheets`}
          </span>
        </div>
        <div className="panel-body">
          {/* Same box, same rule and the same place on screen as the one on
              the Tasks board and Repeating Tasks — every word typed has to
              appear, in any order. */}
          <div className="filter-search">
            <input
              className="field-input"
              type="search"
              aria-label="Search clients"
              placeholder="Search by client, number or group name"
              value={search}
              onChange={(e) => typeSearch(e.target.value)}
            />
            {search.trim() !== "" && (
              <button className="btn btn-ghost btn-sm" onClick={() => typeSearch("")} type="button">
                Clear search
              </button>
            )}
          </div>

          {/* Said once, here, rather than on all 26 rows. The thing people
              get wrong about the employee column is the same every time:
              they change it expecting the client's open tasks to move too. */}
          <p className="panel-sub" style={{ margin: "0 2px 12px" }}>
            <strong>Employee</strong> is who a client's new tasks are assigned to — changing it takes effect on
            their next task, and tasks already on the board keep the person they are on. WhatsApp groups and
            report sheets are managed on <strong>Client Details</strong>.
          </p>

          <table className="data-table clients-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Employee</th>
                <th>Phone</th>
                <th>Linked</th>
                <th>Manage</th>
              </tr>
            </thead>
            <tbody>
              {pagedClients.items.map((client) => {
                const linked = linkedSummary(client);
                return (
                  <tr key={client.id}>
                    <td>
                      <button className="link-button" onClick={() => onOpenClient(client.id)}>
                        {client.name}
                      </button>
                      {/* Deactivated used to be visible only as the word on
                          the button at the far end of the row, which reads as
                          an action rather than as this client's state. */}
                      {!client.active && (
                        <div style={{ marginTop: 4 }}>
                          <span className="pill pill-neutral">Inactive</span>
                        </div>
                      )}
                    </td>
                    <td>
                      <div style={{ width: 150 }}>
                        <SearchableSelect
                          value={client.assignedEmployeeId ?? ""}
                          placeholder="Nobody"
                          options={employees.map((employee) => ({
                            value: employee.id,
                            label: employee.name,
                          }))}
                          onChange={(value) => handleAssignEmployee(client, value)}
                        />
                      </div>
                      <SavedTick show={savedKey === `${client.id}:employee`} />
                      {/* Somebody can be deactivated after a client was put
                          on them, and from then on this client's tasks arrive
                          unassigned. The picker offers active staff only, so
                          without this the row would show an empty box and no
                          reason for it. */}
                      {client.assignedEmployee && !client.assignedEmployee.active && (
                        <div className="cell-error">
                          {client.assignedEmployee.name} is deactivated, so tasks are arriving unassigned. Pick
                          somebody else.
                        </div>
                      )}
                      {employeeError[client.id] && <div className="cell-error">{employeeError[client.id]}</div>}
                    </td>
                    <td>
                      <input
                        className="cell-input"
                        type="text"
                        aria-label={`Phone for ${client.name}`}
                        value={phoneDrafts[client.id] ?? client.phone ?? ""}
                        placeholder="No phone saved"
                        onChange={(e) => setPhoneDrafts((prev) => ({ ...prev, [client.id]: e.target.value }))}
                        onBlur={() => handlePhoneSave(client)}
                        onKeyDown={saveOnEnter}
                      />
                      <SavedTick show={savedKey === `${client.id}:phone`} />
                    </td>
                    {/* Read-only, and the marketplaces are named rather than
                        counted: "2 sheets" is not something anybody acts on,
                        "Amazon, Flipkart" says which reports this client gets. */}
                    <td>
                      {linked.length === 0 ? (
                        <span className="client-linked-none">Nothing linked</span>
                      ) : (
                        <span className="client-linked">{linked.join(" · ")}</span>
                      )}
                    </td>
                    <td>
                      <div className="cell-actions">
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => handleActiveToggle(client, !client.active)}
                        >
                          {client.active ? "Deactivate" : "Reactivate"}
                        </button>
                        <button
                          className="btn btn-ghost btn-sm btn-danger-quiet"
                          onClick={() => handleDelete(client)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Searching and finding nothing is an ordinary thing to do — a
              typo, or a client who simply is not on the list yet. Without
              this the table just ends, which reads as the screen breaking. */}
          {filteredClients.length === 0 && clients.length > 0 && (
            <p className="panel-sub" style={{ margin: "14px 2px" }}>
              No client matches what you typed. Try fewer words, or clear the search.
            </p>
          )}

          <Pagination paged={pagedClients} />
        </div>
      </div>
    </>
  );
}
