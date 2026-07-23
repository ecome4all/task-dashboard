import { useEffect, useState } from "react";
import {
  Client,
  UnrecognizedSender,
  ApiError,
  fetchAllClients,
  fetchUnrecognizedSenders,
  createClient,
  updateClient,
} from "./api";
import Spinner from "./Spinner";
import ErrorBanner from "./ErrorBanner";

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong. Try again.";
}

export default function Clients() {
  const [clients, setClients] = useState<Client[]>([]);
  const [unrecognizedSenders, setUnrecognizedSenders] = useState<UnrecognizedSender[]>([]);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [phoneDrafts, setPhoneDrafts] = useState<Record<string, string>>({});
  const [linkChoice, setLinkChoice] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const [clientList, senders] = await Promise.all([fetchAllClients(), fetchUnrecognizedSenders()]);
      setClients(clientList);
      setUnrecognizedSenders(senders);
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
      const client = await createClient({ name, phone: newPhone.trim() || undefined });
      setClients((prev) => [...prev, client].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName("");
      setNewPhone("");
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

  async function handleActiveToggle(client: Client, active: boolean) {
    setActionError("");
    try {
      const updated = await updateClient(client.id, { active });
      setClients((prev) => prev.map((c) => (c.id === client.id ? updated : c)));
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  async function handleUnlinkGroup(client: Client) {
    setActionError("");
    try {
      const updated = await updateClient(client.id, { whatsappGroupId: null, whatsappGroupName: null });
      setClients((prev) => prev.map((c) => (c.id === client.id ? updated : c)));
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  async function handleLinkSender(sender: UnrecognizedSender) {
    const clientId = linkChoice[sender.chatId];
    if (!clientId) return;
    setActionError("");
    try {
      const updated = await updateClient(clientId, {
        whatsappGroupId: sender.chatId,
        whatsappGroupName: sender.chatName ?? sender.chatId,
      });
      setClients((prev) => prev.map((c) => (c.id === clientId ? updated : c)));
      setUnrecognizedSenders((prev) => prev.filter((s) => s.chatId !== sender.chatId));
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  if (loading) return <Spinner label="Loading clients…" />;

  if (loadError) return <ErrorBanner message={loadError} onRetry={load} />;

  return (
    <>
      {actionError && <ErrorBanner message={actionError} onRetry={() => setActionError("")} />}

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
                </tr>
              </thead>
              <tbody>
                {unrecognizedSenders.map((sender) => (
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">Clients</span>
          <span className="panel-sub">{clients.length} total</span>
        </div>
        <div className="panel-body">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>WhatsApp Group</th>
                <th>Active</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((client) => (
                <tr key={client.id}>
                  <td>{client.name}</td>
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
                    {client.whatsappGroupId ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span className="panel-sub">{client.whatsappGroupName ?? client.whatsappGroupId}</span>
                        <button className="btn btn-ghost btn-sm" onClick={() => handleUnlinkGroup(client)}>
                          Unlink
                        </button>
                      </div>
                    ) : (
                      <span className="panel-sub">Not linked</span>
                    )}
                  </td>
                  <td>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => handleActiveToggle(client, !client.active)}
                    >
                      {client.active ? "Deactivate" : "Reactivate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
