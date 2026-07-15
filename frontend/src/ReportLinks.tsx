import { useEffect, useState } from "react";
import { ReportLink, fetchReportLinks, createReportLink, sendReportLink } from "./api";

export default function ReportLinks() {
  const [links, setLinks] = useState<ReportLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [sendTargets, setSendTargets] = useState<Record<string, { phone: string; channel: "whapi" | "official" }>>(
    {}
  );

  async function load() {
    setLoading(true);
    setLinks(await fetchReportLinks());
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim() || !url.trim()) return;
    const link = await createReportLink(description.trim(), url.trim());
    setLinks((prev) => [link, ...prev]);
    setDescription("");
    setUrl("");
  }

  function targetFor(id: string) {
    return sendTargets[id] ?? { phone: "", channel: "whapi" as const };
  }

  function updateTarget(id: string, changes: Partial<{ phone: string; channel: "whapi" | "official" }>) {
    setSendTargets((prev) => ({ ...prev, [id]: { ...targetFor(id), ...changes } }));
  }

  async function handleSend(id: string) {
    const target = targetFor(id);
    if (!target.phone.trim()) return;
    const updated = await sendReportLink(id, target.phone.trim(), target.channel);
    setLinks((prev) => prev.map((l) => (l.id === id ? updated : l)));
  }

  if (loading) return <p>Loading…</p>;

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">Save a report link</span>
          <span className="panel-sub">e.g. a Google Sheet you maintain yourself</span>
        </div>
        <div className="panel-body">
          <form className="add-employee" onSubmit={handleAdd}>
            <input
              className="field-input"
              type="text"
              placeholder="What's it about (e.g. Weekly summary — 1 to 7 Oct)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              style={{ flex: 1 }}
            />
            <input
              className="field-input"
              type="url"
              placeholder="Sheet link"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              style={{ flex: 1 }}
            />
            <button className="btn btn-primary" type="submit">Save</button>
          </form>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">Saved reports</span>
          <span className="panel-sub">{links.length} total</span>
        </div>
        <div className="panel-body">
          <table className="data-table">
            <thead>
              <tr>
                <th>Description</th>
                <th>Link</th>
                <th>Last sent</th>
                <th>Send to client</th>
              </tr>
            </thead>
            <tbody>
              {links.map((link) => {
                const target = targetFor(link.id);
                return (
                  <tr key={link.id}>
                    <td>{link.description}</td>
                    <td>
                      <a href={link.url} target="_blank" rel="noopener noreferrer">Open</a>
                    </td>
                    <td>{link.lastSentAt ? new Date(link.lastSentAt).toLocaleString() : "Never"}</td>
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <input
                          className="field-input"
                          type="text"
                          placeholder="Client phone"
                          value={target.phone}
                          onChange={(e) => updateTarget(link.id, { phone: e.target.value })}
                          style={{ width: 130 }}
                        />
                        <select
                          className="field-select"
                          value={target.channel}
                          onChange={(e) => updateTarget(link.id, { channel: e.target.value as "whapi" | "official" })}
                        >
                          <option value="whapi">Group (whapi)</option>
                          <option value="official">Official</option>
                        </select>
                        <button className="btn btn-primary btn-sm" onClick={() => handleSend(link.id)}>
                          Send
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
