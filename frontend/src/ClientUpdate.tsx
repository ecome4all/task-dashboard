import { useMemo, useRef, useState, useEffect } from "react";
import {
  ReportLink,
  ApiError,
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

function parsed(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  return value.trim() !== "" && !Number.isNaN(n) ? n : undefined;
}

type ColumnKind = "text" | "currency" | "number";

interface ColumnDef {
  key: string;
  label: string;
  emoji?: string;
  kind: ColumnKind;
}

const RAW_FIELDS: ColumnDef[] = [
  { key: "adSpend", label: "Ad Spend", emoji: "💰", kind: "currency" },
  { key: "adOrders", label: "Ad Orders", emoji: "🛒", kind: "number" },
  { key: "adSales", label: "Ad Sales", emoji: "📈", kind: "currency" },
  { key: "totalOrders", label: "Total Orders", emoji: "📦", kind: "number" },
  { key: "totalSales", label: "Total Sales", emoji: "💵", kind: "currency" },
  { key: "activeListings", label: "Active Listings", emoji: "✅", kind: "number" },
  { key: "oosListings", label: "Out of Stock", emoji: "⚠️", kind: "number" },
  { key: "inactiveListings", label: "Inactive Listings", emoji: "🚫", kind: "number" },
];

// Client name and phone lead, exactly like the client's own spreadsheet has
// them as its first two columns — everything else follows in the same
// order as RAW_FIELDS, so a whole row copied from that sheet lines up
// cell-for-cell with this table.
const COLUMNS: ColumnDef[] = [
  { key: "clientName", label: "Client Name", kind: "text" },
  { key: "phone", label: "Phone", kind: "text" },
  ...RAW_FIELDS,
];

interface ClientRow {
  id: string;
  data: Record<string, string>;
}

type RowStatus = "sending" | "sent" | "failed";

function rowStatusLabel(status: RowStatus | undefined): string {
  if (status === "sending") return "Sending…";
  if (status === "sent") return "Sent ✓";
  if (status === "failed") return "Failed ✗";
  return "";
}

interface SharedMessageInput {
  period: string;
  highlights: string;
  includeHighlights: boolean;
  attachedLink?: ReportLink;
}

// One message per row, built from that row's own numbers plus whatever's
// shared across the whole batch (period, highlights, attached link) — the
// same template the single-client composer used to build, just parameterized
// per row instead of off top-level state.
function composeMessage(row: ClientRow, shared: SharedMessageInput): string {
  const rawValues: Record<string, number | undefined> = {};
  for (const field of RAW_FIELDS) rawValues[field.key] = parsed(row.data[field.key]);

  const acos = rawValues.adSpend !== undefined && rawValues.adSales ? rawValues.adSpend / rawValues.adSales : undefined;
  const tAcos =
    rawValues.adSpend !== undefined && rawValues.totalSales ? rawValues.adSpend / rawValues.totalSales : undefined;
  const adsSalesPct =
    rawValues.adSales !== undefined && rawValues.totalSales ? rawValues.adSales / rawValues.totalSales : undefined;
  const organicSalesPct = adsSalesPct !== undefined ? 1 - adsSalesPct : undefined;

  const derivedFields: { label: string; emoji: string; value: number | undefined }[] = [
    { label: "ACOS", emoji: "🎯", value: acos },
    { label: "Total ACOS", emoji: "📊", value: tAcos },
    { label: "Ads Sales %", emoji: "🟢", value: adsSalesPct },
    { label: "Organic Sales %", emoji: "🌿", value: organicSalesPct },
  ];

  const name = row.data.clientName?.trim() || "there";
  const lines: string[] = [];
  lines.push(`📊 *Performance Update${shared.period.trim() ? ` — ${shared.period.trim()}` : ""}*`);
  lines.push(`Hi ${name}, here's your update:`);
  lines.push("");

  for (const field of RAW_FIELDS) {
    const value = rawValues[field.key];
    if (value === undefined) continue;
    const formatted = field.kind === "currency" ? currency(value) : value.toLocaleString("en-IN");
    lines.push(`${field.emoji} ${field.label}: ${formatted}`);
  }
  for (const field of derivedFields) {
    if (field.value === undefined) continue;
    lines.push(`${field.emoji} ${field.label}: ${percent(field.value)}`);
  }

  if (shared.includeHighlights && shared.highlights.trim()) {
    lines.push("");
    lines.push(`✨ Highlights:`);
    lines.push(shared.highlights.trim());
  }

  if (shared.attachedLink) {
    lines.push("");
    lines.push(`📎 ${shared.attachedLink.description}`);
    lines.push(shared.attachedLink.url);
  }

  lines.push("");
  lines.push("— Team Ecom4all");
  return lines.join("\n");
}

export default function ClientUpdate() {
  const [links, setLinks] = useState<ReportLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [sendError, setSendError] = useState("");

  const nextRowId = useRef(1);
  const [rows, setRows] = useState<ClientRow[]>([{ id: "row-0", data: {} }]);
  const [rowStatus, setRowStatus] = useState<Record<string, RowStatus>>({});
  const [sendingAll, setSendingAll] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const [period, setPeriod] = useState("");
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
      setLinks(await fetchReportLinks());
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

  function setCell(rowIndex: number, key: string, value: string) {
    setRows((prev) => prev.map((r, i) => (i === rowIndex ? { ...r, data: { ...r.data, [key]: value } } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, { id: `row-${nextRowId.current++}`, data: {} }]);
  }

  function removeRow(rowIndex: number) {
    setRows((prev) => prev.filter((_, i) => i !== rowIndex));
  }

  // A single cell pasted normally (typing, or one value) is left to the
  // browser's default paste. Anything with a tab or a line break is a
  // spreadsheet block — rows down the sheet, columns across it — and gets
  // distributed starting at the cell it landed in, growing the grid with
  // extra rows if the pasted block has more rows than currently exist.
  // Client Name/Phone are kept as plain text; every numeric column strips
  // anything that isn't a digit/decimal point/minus sign, since a
  // spreadsheet cell is often formatted with a currency symbol or a
  // thousands comma that a plain number input can't parse.
  function handleGridPaste(e: React.ClipboardEvent<HTMLInputElement>, rowIndex: number, colIndex: number) {
    const text = e.clipboardData.getData("text");
    if (!/\t|\r\n|\r|\n/.test(text)) return;
    e.preventDefault();

    const pastedRows = text.split(/\r\n|\r|\n/).map((line) => line.split("\t"));

    setRows((prev) => {
      const next = [...prev];
      pastedRows.forEach((cells, r) => {
        const targetIndex = rowIndex + r;
        while (next.length <= targetIndex) next.push({ id: `row-${nextRowId.current++}`, data: {} });
        const data = { ...next[targetIndex].data };
        cells.forEach((raw, c) => {
          const column = COLUMNS[colIndex + c];
          if (!column) return;
          const value = column.kind === "text" ? raw.trim() : raw.replace(/[^0-9.-]/g, "").trim();
          if (value !== "") data[column.key] = value;
        });
        next[targetIndex] = { ...next[targetIndex], data };
      });
      return next;
    });
  }

  const attachedLink = links.find((l) => l.id === attachedLinkId);

  const readyRows = useMemo(
    () => rows.filter((r) => r.data.clientName?.trim() && r.data.phone?.trim()),
    [rows]
  );

  const previewMessage = readyRows.length
    ? composeMessage(readyRows[0], { period, highlights, includeHighlights, attachedLink })
    : "";

  async function handleSendAll() {
    if (readyRows.length === 0) {
      setSendError("Add at least one row with a client name and phone number first.");
      return;
    }
    setSendError("");
    setSendingAll(true);
    setProgress({ done: 0, total: readyRows.length });
    setRowStatus({});

    for (let i = 0; i < readyRows.length; i++) {
      const row = readyRows[i];
      setRowStatus((prev) => ({ ...prev, [row.id]: "sending" }));
      try {
        const message = composeMessage(row, { period, highlights, includeHighlights, attachedLink });
        await sendClientUpdate(row.id, { phone: row.data.phone.trim(), channel: "whapi", message });
        setRowStatus((prev) => ({ ...prev, [row.id]: "sent" }));
      } catch (err) {
        setRowStatus((prev) => ({ ...prev, [row.id]: "failed" }));
        setSendError(`Failed to send to ${row.data.clientName || row.data.phone}: ${errorMessage(err)}`);
      }
      setProgress({ done: i + 1, total: readyRows.length });
      // 5 seconds between sends, but no point waiting after the last one.
      if (i < readyRows.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }

    if (attachedLink) {
      try {
        const updated = await markReportLinkSent(attachedLink.id);
        setLinks((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
      } catch (err) {
        console.error("Failed to record report link as sent:", err);
      }
    }

    setSendingAll(false);
    setProgress(null);
  }

  // wa.me needs digits only (country code, no +, spaces, or dashes) — a
  // manual fallback for just the previewed (first) client.
  const firstPhone = readyRows[0]?.data.phone ?? "";
  const waLink = `https://wa.me/${firstPhone.replace(/\D/g, "")}?text=${encodeURIComponent(previewMessage)}`;

  async function handleCopy() {
    await navigator.clipboard.writeText(previewMessage);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) return <Spinner label="Loading…" />;

  if (loadError) return <ErrorBanner message={loadError} onRetry={load} />;

  return (
    <>
      {sendError && <ErrorBanner message={sendError} onRetry={() => setSendError("")} />}

      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">Send client update</span>
          <span className="panel-sub">One row per client, sent as a batch over WhatsApp</span>
        </div>
        <p className="tip">
          💡 Paste your whole client table at once — copy from Client Name through to Inactive Listings in your
          spreadsheet and drop it into the first cell below. It fills every row and column in order, adding rows as
          needed.
        </p>
        <div className="panel-body">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <input
              className="field-input"
              type="text"
              placeholder="Period (e.g. Week of 1–7 July)"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              style={{ flex: "1 1 220px" }}
            />
            <select
              className="field-select"
              value={attachedLinkId}
              onChange={(e) => setAttachedLinkId(e.target.value)}
              style={{ flex: "1 1 260px" }}
            >
              <option value="">Attach a saved report link (optional)…</option>
              {links.map((link) => (
                <option key={link.id} value={link.id}>{link.description}</option>
              ))}
            </select>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table className="data-table">
              <thead>
                <tr>
                  {COLUMNS.map((col) => (
                    <th key={col.key}>{col.emoji ? `${col.emoji} ` : ""}{col.label}</th>
                  ))}
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIndex) => (
                  <tr key={row.id}>
                    {COLUMNS.map((col, colIndex) => (
                      <td key={col.key}>
                        <input
                          className="field-input"
                          type={col.kind === "text" ? "text" : "number"}
                          value={row.data[col.key] ?? ""}
                          onChange={(e) => setCell(rowIndex, col.key, e.target.value)}
                          onPaste={(e) => handleGridPaste(e, rowIndex, colIndex)}
                          disabled={sendingAll}
                          style={{ width: col.key === "clientName" ? 140 : col.key === "phone" ? 130 : 95 }}
                        />
                      </td>
                    ))}
                    <td className="panel-sub">{rowStatusLabel(rowStatus[row.id])}</td>
                    <td>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => removeRow(rowIndex)}
                        disabled={sendingAll}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button className="btn btn-ghost btn-sm" onClick={addRow} disabled={sendingAll} style={{ marginTop: 10 }}>
            + Add row
          </button>

          <div style={{ marginTop: 16 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={includeHighlights}
                onChange={(e) => setIncludeHighlights(e.target.checked)}
              />
              ✨ Highlights (shared across every message in this batch)
            </label>
            <textarea
              className="field-input"
              value={highlights}
              onChange={(e) => setHighlights(e.target.value)}
              placeholder="Optional note, e.g. Strong week for Mini Case - 1, ACOS trending down."
              style={{ width: "100%", minHeight: 60, resize: "vertical" }}
            />
          </div>

          <div style={{ marginTop: 18, display: "flex", gap: 24, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 320px", minWidth: 280 }}>
              <div className="panel-sub" style={{ marginBottom: 6 }}>Preview — first client</div>
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  background: "var(--bg-alt)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: 14,
                  fontSize: 13,
                  fontFamily: "inherit",
                  minHeight: 160,
                }}
              >
                {previewMessage || "Fill in at least one row's Client Name and Phone to see a preview."}
              </pre>
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <button className="btn btn-primary" onClick={handleSendAll} disabled={sendingAll || readyRows.length === 0}>
                  {sendingAll
                    ? `Sending ${progress?.done ?? 0} of ${progress?.total ?? readyRows.length}…`
                    : `Send all (${readyRows.length})`}
                </button>
                <button className="btn btn-ghost" onClick={handleCopy} type="button" disabled={!previewMessage}>
                  {copied ? "Copied ✓" : "Copy first message"}
                </button>
                <a
                  className="btn btn-ghost"
                  href={previewMessage ? waLink : undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-disabled={!previewMessage}
                  style={{
                    textDecoration: "none",
                    display: "inline-flex",
                    alignItems: "center",
                    pointerEvents: previewMessage ? "auto" : "none",
                    opacity: previewMessage ? 1 : 0.5,
                  }}
                >
                  Open first in WhatsApp
                </a>
              </div>
              <p className="panel-sub" style={{ marginTop: 6 }}>
                "Send all" goes out one message at a time, 5 seconds apart, so WhatsApp doesn't flag the batch as spam.
                "Copy first message" / "Open first in WhatsApp" only cover the previewed client — handy for a one-off
                manual send.
              </p>
            </div>
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
