import { useEffect, useMemo, useState } from "react";
import { Client, ApiError, fetchClients, sendClientUpdate } from "./api";
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
  const [copied, setCopied] = useState(false);

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      setClients(await fetchClients());
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

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

    lines.push("");
    lines.push("— Team Ecom4all");
    return lines.join("\n");
  }, [clients, clientId, period, rawValues, included, includeHighlights, highlights]);

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
              style={{ width: "100%", marginBottom: 16 }}
            />

            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 28 }}></th>
                  <th>Field</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {RAW_FIELDS.map((field) => (
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
    </>
  );
}
