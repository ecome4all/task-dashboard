import { useEffect, useState } from "react";
import {
  Client,
  UnrecognizedSender,
  Task,
  ApiError,
  fetchAllClients,
  fetchUnrecognizedSenders,
  ignoreUnrecognizedSender,
  fetchTasks,
  createClient,
  updateClient,
  deleteClient,
  addClientWhatsappGroup,
  removeClientWhatsappGroup,
} from "./api";
import Spinner from "./Spinner";
import ErrorBanner from "./ErrorBanner";
import Pagination, { usePaged } from "./Paged";

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
  const [reportSheetDrafts, setReportSheetDrafts] = useState<Record<string, string>>({});
  const [linkChoice, setLinkChoice] = useState<Record<string, string>>({});
  const [newGroupId, setNewGroupId] = useState<Record<string, string>>({});
  const [newGroupName, setNewGroupName] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  // Per client, so a failed "+ Add" is answered beside the button that failed
  // rather than only in the banner at the top of a long list.
  const [groupError, setGroupError] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const [clientList, senders, taskList] = await Promise.all([
        fetchAllClients(),
        fetchUnrecognizedSenders(),
        fetchTasks(),
      ]);
      setClients(clientList);
      setUnrecognizedSenders(senders);
      setTasks(taskList);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

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
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  async function handleReportSheetSave(client: Client) {
    const reportSheetUrl = reportSheetDrafts[client.id] ?? client.reportSheetUrl ?? "";
    setReportSheetDrafts((prev) => {
      const { [client.id]: _, ...rest } = prev;
      return rest;
    });
    if (reportSheetUrl === (client.reportSheetUrl ?? "")) return;
    setActionError("");
    try {
      const updated = await updateClient(client.id, { reportSheetUrl });
      setClients((prev) => prev.map((c) => (c.id === client.id ? updated : c)));
    } catch (err) {
      setActionError(errorMessage(err));
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

  async function handleUnlinkGroup(client: Client, groupRowId: string) {
    setActionError("");
    try {
      await removeClientWhatsappGroup(client.id, groupRowId);
      setClients((prev) =>
        prev.map((c) =>
          c.id === client.id ? { ...c, whatsappGroups: c.whatsappGroups.filter((g) => g.id !== groupRowId) } : c
        )
      );
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  async function handleAddGroup(client: Client) {
    const groupId = (newGroupId[client.id] ?? "").trim();
    setGroupError((prev) => ({ ...prev, [client.id]: "" }));

    // Pressing Add with an empty box used to do nothing and say nothing.
    if (!groupId) {
      setGroupError((prev) => ({ ...prev, [client.id]: "Paste the group id first." }));
      return;
    }

    setActionError("");
    try {
      const group = await addClientWhatsappGroup(client.id, groupId, newGroupName[client.id]?.trim());
      setClients((prev) =>
        prev.map((c) => (c.id === client.id ? { ...c, whatsappGroups: [...c.whatsappGroups, group] } : c))
      );
      setNewGroupId((prev) => ({ ...prev, [client.id]: "" }));
      setNewGroupName((prev) => ({ ...prev, [client.id]: "" }));
    } catch (err) {
      setGroupError((prev) => ({ ...prev, [client.id]: errorMessage(err) }));
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
  const pagedClients = usePaged(clients, 10);

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

      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">Clients</span>
          <span className="panel-sub">{clients.length} total · click a name to see everything about them</span>
        </div>
        <div className="panel-body">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>WhatsApp Groups</th>
                <th>Report Sheet</th>
                <th>Active</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pagedClients.items.map((client) => (
                <tr key={client.id}>
                  <td>
                    <button className="link-button" onClick={() => onOpenClient(client.id)}>
                      {client.name}
                    </button>
                  </td>
                  <td>
                    <input
                      className="field-input"
                      type="text"
                      value={phoneDrafts[client.id] ?? client.phone ?? ""}
                      placeholder="No phone saved"
                      onChange={(e) => setPhoneDrafts((prev) => ({ ...prev, [client.id]: e.target.value }))}
                      onBlur={() => handlePhoneSave(client)}
                    />
                  </td>
                  <td>
                    {client.whatsappGroups.length === 0 && (
                      <span className="panel-sub">Not linked</span>
                    )}
                    {client.whatsappGroups.map((group) => (
                      <div key={group.id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                        <div>
                          <div>{group.groupName ?? "—"}</div>
                          <div className="panel-sub">{group.groupId}</div>
                        </div>
                        <button className="btn btn-ghost btn-sm" onClick={() => handleUnlinkGroup(client, group.id)}>
                          Unlink
                        </button>
                      </div>
                    ))}
                    <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
                      <input
                        className="field-input"
                        type="text"
                        placeholder="Group id, e.g. 1203634…@g.us"
                        value={newGroupId[client.id] ?? ""}
                        onChange={(e) => setNewGroupId((prev) => ({ ...prev, [client.id]: e.target.value }))}
                        // Every WhatsApp group id begins 120363…, so the part
                        // that identifies one is the end. At 110px the whole
                        // of that was off-screen: you could not see what you
                        // had pasted, and two different groups looked
                        // identical — which matters here, where one client's
                        // number can have a separate group per marketplace.
                        title={newGroupId[client.id] ?? ""}
                        style={{ width: 230, fontSize: 12 }}
                      />
                      <input
                        className="field-input"
                        type="text"
                        placeholder="Group name"
                        value={newGroupName[client.id] ?? ""}
                        onChange={(e) => setNewGroupName((prev) => ({ ...prev, [client.id]: e.target.value }))}
                        style={{ width: 110, fontSize: 12 }}
                      />
                      <button className="btn btn-ghost btn-sm" onClick={() => handleAddGroup(client)}>
                        + Add
                      </button>
                    </div>
                    {/* Beside the button that failed. This used to report only
                        into the banner at the top of the screen, which on a
                        list of 23 clients is well out of view by the time you
                        are adding a group — so "+ Add" looked like it did
                        nothing at all. */}
                    {groupError[client.id] && (
                      <div style={{ color: "var(--danger, #b42318)", fontSize: 12, marginTop: 6, maxWidth: 260 }}>
                        {groupError[client.id]}
                      </div>
                    )}
                  </td>
                  <td>
                    <input
                      className="field-input"
                      type="text"
                      value={reportSheetDrafts[client.id] ?? client.reportSheetUrl ?? ""}
                      placeholder="No sheet saved"
                      onChange={(e) => setReportSheetDrafts((prev) => ({ ...prev, [client.id]: e.target.value }))}
                      onBlur={() => handleReportSheetSave(client)}
                      style={{ width: 180 }}
                    />
                  </td>
                  <td>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => handleActiveToggle(client, !client.active)}
                    >
                      {client.active ? "Deactivate" : "Reactivate"}
                    </button>
                  </td>
                  <td>
                    <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(client)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
            <Pagination paged={pagedClients} />
        </div>
      </div>
    </>
  );
}
