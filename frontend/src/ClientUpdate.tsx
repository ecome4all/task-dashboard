import { useEffect, useMemo, useState } from "react";
import {
  Client,
  ReportLink,
  ApiError,
  fetchClients,
  sendClientUpdate,
  fetchReportLinks,
  createReportLink,
  markReportLinkSent,
} from "./api";
import Spinner from "./Spinner";
import ErrorBanner from "./ErrorBanner";

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong. Try again.";
}

function currency(n: number): string {
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function percent(n: number): string {
  return (n * 100).toLocaleString("en-IN", { maximumFractionDigits: 1 }) + "%";
}

function parsed(value: string): number | undefined {
  const n = Number(value);
  return value.trim() !== "" && !Number.isNaN(n) ? n : undefined;
}

interface RawFieldDef {
  key: string;
  label: string;
  emoji: string;
  kind: "currency" | "number";
}

const RAW_FIELDS: RawFieldDef[] = [
  { key: "adSpend", label: "Ad Spend", emoji: "💰", kind: "currency" },
  { key: "adOrders", label: "Ad Orders", emoji: "🛒", kind: "number" },
  { key: "adSales", label: "Ad Sales", emoji: "📈", kind: "currency" },
  { key: "totalOrders", label: "Total Orders", emoji: "📦", kind: "number" },
  { key: "totalSales", label: "Total Sales", emoji: "💵", kind: "currency" },
  { key: "activeListings", label: "Active Listings", emoji: "✅", kind: "number" },
  { key: "oosListings", label: "Out of Stock", emoji: "⚠️", kind: "number" },
  { key: "inactiveListings", label: "Inactive Listings", emoji: "🚫", kind: "number" },
];

export default function ClientUpdate() {
  const [clients, setClients] = useState<Client[]>([]);
  const [links, setLinks] = useState<ReportLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [sendError, setSendError] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  const [clientId, setClientId] = useState("");
  const [phone, setPhone] = useState("");
  const [period, setPeriod] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [included, setIncluded] = useState<Record<string, boolean>>({});
  const [highlights, setHighlights] = useState("");
  const [includeHighlights, setIncludeHighlights] = useState(true);
  const [attachedLinkId, setAttachedLinkId] = useState("");
  const [copied, setCopied] = useState(false);

  const [newLinkDescription, setNewLinkDescription] = useState("");
  const [newLinkUrl, setNewLinkUrl] = useState("");
  const [linkError, setLinkError] = useState("");

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const [clientList, linkList] = await Promise.all([fetchClients(), fetchReportLinks()]);
      setClients(clientList);
      setLinks(linkList);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleAddLink(e: React.FormEvent) {
    e.preventDefault();
    if (!newLinkDescription.trim() || !newLinkUrl.trim()) return;
    setLinkError("");
    try {
      const link = await createReportLink(newLinkDescription.trim(), newLinkUrl.trim());
      setLinks((prev) => [link, ...prev]);
      setNewLinkDescription("");
      setNewLinkUrl("");
    } catch (err) {
      setLinkError(errorMessage(err));
    }
  }

  function handleClientChange(id: string) {
    setClientId(id);
    const client = clients.find((c) => c.id === id);
    // Prefer the client's linked WhatsApp group — that's the channel their
    // tasks actually come in on — and only fall back to a 1:1 phone number
    // if no group has been linked yet.
    setPhone(client?.whatsappGroupId ?? client?.phone ?? "");
  }

  function setValue(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
    // Default a field to included the first time it gets a value.
    setIncluded((prev) => (key in prev ? prev : { ...prev, [key]: true }));
  }

  // The source is a horizontal spreadsheet (column headers along the top,
  // one data row underneath) — copying that row onto the clipboard comes
  // tab-separated. Pasting it into one field fills it and every field after
  // it in order, so the row doesn't need to be transposed into a column by
  // hand first. A column copied instead (newline-separated) works the same
  // way. Strips anything that isn't a digit/decimal point/minus sign per
  // value, since a spreadsheet cell is often formatted with a currency
  // symbol or a thousands comma that a plain number input can't parse.
  // Blank cells are skipped rather than removed, so a gap in the middle of
  // the row (e.g. no value for Out of Stock) doesn't shift every value
  // after it into the wrong field.
  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>, startIndex: number) {
    e.preventDefault();
    const values = e.clipboardData
      .getData("text")
      .split(/\r\n|\r|\n|\t/)
      .map((v) => v.replace(/[^0-9.-]/g, "").trim());
    values.forEach((v, i) => {
      if (v === "") return;
      const field = RAW_FIELDS[startIndex + i];
      if (field) setValue(field.key, v);
    });
  }

  const rawValues = useMemo(() => {
    const out: Record<string, number | undefined> = {};
    for (const field of RAW_FIELDS) out[field.key] = parsed(values[field.key] ?? "");
    return out;
  }, [values]);

  const acos = rawValues.adSpend !== undefined && rawValues.adSales ? rawValues.adSpend / rawValues.adSales : undefined;
  const tAcos =
    rawValues.adSpend !== undefined && rawValues.totalSales ? rawValues.adSpend / rawValues.totalSales : undefined;
  const adsSalesPct =
    rawValues.adSales !== undefined && rawValues.totalSales ? rawValues.adSales / rawValues.totalSales : undefined;
  const organicSalesPct = adsSalesPct !== undefined ? 1 - adsSalesPct : undefined;

  const derivedFields: { key: string; label: string; emoji: string; value: number | undefined }[] = [
    { key: "acos", label: "ACOS", emoji: "🎯", value: acos },
    { key: "tAcos", label: "Total ACOS", emoji: "📊", value: tAcos },
    { key: "adsSalesPct", label: "Ads Sales %", emoji: "🟢", value: adsSalesPct },
    { key: "organicSalesPct", label: "Organic Sales %", emoji: "🌿", value: organicSalesPct },
  ];

  function toggleIncluded(key: string) {
    setIncluded((prev) => ({ ...prev, [key]: !(prev[key] ?? true) }));
  }

  const isIncluded = (key: string) => included[key] ?? true;

  const message = useMemo(() => {
    const client = clients.find((c) => c.id === clientId);
    const lines: string[] = [];
    lines.push(`📊 *Performance Update${period.trim() ? ` — ${period.trim()}` : ""}*`);
    lines.push(`Hi ${client?.name ?? "there"}, here's your update:`);
    lines.push("");

    for (const field of RAW_FIELDS) {
      const value = rawValues[field.key];
      if (value === undefined || !isIncluded(field.key)) continue;
      const formatted = field.kind === "currency" ? currency(value) : value.toLocaleString("en-IN");
      lines.push(`${field.emoji} ${field.label}: ${formatted}`);
    }
    for (const field of derivedFields) {
      if (field.value === undefined || !isIncluded(field.key)) continue;
      lines.push(`${field.emoji} ${field.label}: ${percent(field.value)}`);
    }

    if (includeHighlights && highlights.trim()) {
      lines.push("");
      lines.push(`✨ Highlights:`);
      lines.push(highlights.trim());
    }

    const attachedLink = links.find((l) => l.id === attachedLinkId);
    if (attachedLink) {
      lines.push("");
      lines.push(`📎 ${attachedLink.description}`);
      lines.push(attachedLink.url);
    }

    lines.push("");
    lines.push("— Team Ecom4all");
    return lines.join("\n");
  }, [clients, clientId, period, rawValues, included, includeHighlights, highlights, links, attachedLinkId]);

  async function handleSend() {
    if (!clientId || !phone.trim()) {
      setSendError("Pick a client with a phone number first.");
      return;
    }
    setSendError("");
    setSent(false);
    setSending(true);
    try {
      await sendClientUpdate(clientId, { phone: phone.trim(), channel: "whapi", message });
      setSent(true);
      // The link's own send already happened as part of the message above —
      // this just records it for the "Last sent" column. A failure here
      // shouldn't undo the "Sent" state above, since the update itself did go out.
      if (attachedLinkId) {
        try {
          const updated = await markReportLinkSent(attachedLinkId);
          setLinks((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
        } catch (err) {
          console.error("Failed to record report link as sent:", err);
        }
      }
    } catch (err) {
      setSendError(errorMessage(err));
    } finally {
      setSending(false);
    }
  }

  // wa.me needs digits only (country code, no +, spaces, or dashes).
  const waLink = `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;

  async function handleCopy() {
    await navigator.clipboard.writeText(message);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) return <Spinner label="Loading clients…" />;

  if (loadError) return <ErrorBanner message={loadError} onRetry={load} />;

  return (
    <>
      {sendError && <ErrorBanner message={sendError} onRetry={() => setSendError("")} />}

      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">Send client update</span>
          <span className="panel-sub">Pick the fields to share, then send over WhatsApp</span>
        </div>
        <p className="tip">💡 Copy a row of numbers straight from your spreadsheet and paste it into the first field below — it fills the rest in order, no need to rearrange anything first.</p>
        <div className="panel-body" style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 340px", minWidth: 300 }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <select
                className="field-select"
                value={clientId}
                onChange={(e) => handleClientChange(e.target.value)}
                style={{ flex: 1 }}
              >
                <option value="">Select client…</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>{client.name}</option>
                ))}
              </select>
            </div>
            <input
              className="field-input"
              type="text"
              placeholder="Client phone or WhatsApp group"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              style={{ width: "100%", marginBottom: 4 }}
            />
            {clients.find((c) => c.id === clientId)?.whatsappGroupId && (
              <p className="panel-sub" style={{ marginTop: 0, marginBottom: 10 }}>
                Sending to this client's linked WhatsApp group.
              </p>
            )}
            <input
              className="field-input"
              type="text"
              placeholder="Period (e.g. Week of 1–7 July)"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              style={{ width: "100%", marginBottom: 10 }}
            />
            <select
              className="field-select"
              value={attachedLinkId}
              onChange={(e) => setAttachedLinkId(e.target.value)}
              style={{ width: "100%", marginBottom: 16 }}
            >
              <option value="">Attach a saved report link (optional)…</option>
              {links.map((link) => (
                <option key={link.id} value={link.id}>{link.description}</option>
              ))}
            </select>

            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 28 }}></th>
                  <th>Field</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {RAW_FIELDS.map((field, index) => (
                  <tr key={field.key}>
                    <td>
                      <input
                        type="checkbox"
                        checked={isIncluded(field.key)}
                        onChange={() => toggleIncluded(field.key)}
                      />
                    </td>
                    <td>{field.emoji} {field.label}</td>
                    <td>
                      <input
                        className="field-input"
                        type="number"
                        value={values[field.key] ?? ""}
                        onChange={(e) => setValue(field.key, e.target.value)}
                        onPaste={(e) => handlePaste(e, index)}
                        style={{ width: 110 }}
                      />
                    </td>
                  </tr>
                ))}
                {derivedFields.map((field) => (
                  <tr key={field.key}>
                    <td>
                      <input
                        type="checkbox"
                        checked={isIncluded(field.key)}
                        disabled={field.value === undefined}
                        onChange={() => toggleIncluded(field.key)}
                      />
                    </td>
                    <td>{field.emoji} {field.label}</td>
                    <td className="panel-sub">{field.value !== undefined ? percent(field.value) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ marginTop: 12 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={includeHighlights}
                  onChange={(e) => setIncludeHighlights(e.target.checked)}
                />
                ✨ Highlights
              </label>
              <textarea
                className="field-input"
                value={highlights}
                onChange={(e) => setHighlights(e.target.value)}
                placeholder="Optional note, e.g. Strong week for Mini Case - 1, ACOS trending down."
                style={{ width: "100%", minHeight: 60, resize: "vertical" }}
              />
            </div>
          </div>

          <div style={{ flex: "1 1 320px", minWidth: 280 }}>
            <div className="panel-sub" style={{ marginBottom: 6 }}>Preview</div>
            <pre
              style={{
                whiteSpace: "pre-wrap",
                background: "var(--bg-alt)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: 14,
                fontSize: 13,
                fontFamily: "inherit",
                minHeight: 200,
              }}
            >
              {message}
            </pre>
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <button className="btn btn-primary" onClick={handleSend} disabled={sending}>
                {sending ? "Sending…" : "Send on WhatsApp"}
              </button>
              <button className="btn btn-ghost" onClick={handleCopy} type="button">
                {copied ? "Copied ✓" : "Copy text"}
              </button>
              <a
                className="btn btn-ghost"
                href={waLink}
                target="_blank"
                rel="noopener noreferrer"
                style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}
              >
                Open in WhatsApp
              </a>
            </div>
            <p className="panel-sub" style={{ marginTop: 6 }}>
              "Send on WhatsApp" uses the API set up on the backend. "Copy text" or "Open in WhatsApp" work
              right now without it — handy until that's configured, or for a one-off manual send.
            </p>
            {sent && <p style={{ color: "var(--good)", fontSize: 13, marginTop: 8 }}>Sent ✓</p>}
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">Saved report links</span>
          <span className="panel-sub">e.g. a Google Sheet you maintain yourself — attach one above to include it</span>
        </div>
        <div className="panel-body">
          {linkError && <ErrorBanner message={linkError} onRetry={() => setLinkError("")} />}

          <form className="add-employee" onSubmit={handleAddLink} style={{ marginBottom: 14 }}>
            <input
              className="field-input"
              type="text"
              placeholder="What's it about (e.g. Weekly summary — 1 to 7 Oct)"
              value={newLinkDescription}
              onChange={(e) => setNewLinkDescription(e.target.value)}
              style={{ flex: 1 }}
            />
            <input
              className="field-input"
              type="url"
              placeholder="Sheet link"
              value={newLinkUrl}
              onChange={(e) => setNewLinkUrl(e.target.value)}
              style={{ flex: 1 }}
            />
            <button className="btn btn-primary" type="submit">Save</button>
          </form>

          <table className="data-table">
            <thead>
              <tr>
                <th>Description</th>
                <th>Link</th>
                <th>Last sent</th>
              </tr>
            </thead>
            <tbody>
              {links.map((link) => (
                <tr key={link.id}>
                  <td>{link.description}</td>
                  <td>
                    <a href={link.url} target="_blank" rel="noopener noreferrer">Open</a>
                  </td>
                  <td>{link.lastSentAt ? new Date(link.lastSentAt).toLocaleString() : "Never"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
