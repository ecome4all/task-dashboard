import { useMemo, useRef, useState, useEffect } from "react";
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

function parsed(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  return value.trim() !== "" && !Number.isNaN(n) ? n : undefined;
}

// "derivedPercent" columns (Acos, T.Acos, Ads Sales %, Organic Sales %) are
// calculated from the other columns, never typed or pasted in directly —
// they still take up a column slot (matching the client's own report
// sheet, which has them in the same positions) so a row pasted straight
// from that sheet lines up cell-for-cell, but the sheet's own value in
// those cells is simply skipped over rather than stored.
type ColumnKind = "text" | "currency" | "number" | "derivedPercent";

interface ColumnDef {
  key: string;
  label: string;
  emoji?: string;
  kind: ColumnKind;
}

// Matches the client's own report spreadsheet column-for-column (see
// "report fields.txt"): mobile number and client name lead, then the
// product identifier, then the metrics in the same order and positions
// (including the calculated Acos/T.Acos/% columns) their sheet has them in.
const COLUMNS: ColumnDef[] = [
  { key: "phone", label: "Phone", kind: "text" },
  { key: "clientName", label: "Client Name", kind: "text" },
  { key: "asin", label: "ASIN", kind: "text" },
  { key: "productName", label: "Name", kind: "text" },
  { key: "adSpend", label: "Spend", emoji: "💰", kind: "currency" },
  { key: "adOrders", label: "Order", emoji: "🛒", kind: "number" },
  { key: "adSales", label: "Sales", emoji: "📈", kind: "currency" },
  { key: "acos", label: "Acos", emoji: "🎯", kind: "derivedPercent" },
  { key: "totalOrders", label: "T.Order", emoji: "📦", kind: "number" },
  { key: "totalSales", label: "T.Sales", emoji: "💵", kind: "currency" },
  { key: "tAcos", label: "T.Acos", emoji: "📊", kind: "derivedPercent" },
  { key: "adsSalesPct", label: "Ads Sales %", emoji: "🟢", kind: "derivedPercent" },
  { key: "organicSalesPct", label: "Organic Sales %", emoji: "🌿", kind: "derivedPercent" },
  { key: "rating", label: "Rating", emoji: "⭐", kind: "number" },
  { key: "reviews", label: "Reviews", emoji: "📝", kind: "number" },
  { key: "fbaUnits", label: "FBA Units", emoji: "📥", kind: "number" },
];

const COLUMN_WIDTH: Record<string, number> = {
  phone: 125, clientName: 140, asin: 105, productName: 130,
  rating: 65, reviews: 75,
};

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

// The four calculated columns, worked out the same way regardless of
// where they're used (a single row's message, or that row's read-only
// table cells).
function deriveValues(rawValues: Record<string, number | undefined>): Record<string, number | undefined> {
  const acos = rawValues.adSpend !== undefined && rawValues.adSales ? rawValues.adSpend / rawValues.adSales : undefined;
  const tAcos =
    rawValues.adSpend !== undefined && rawValues.totalSales ? rawValues.adSpend / rawValues.totalSales : undefined;
  const adsSalesPct =
    rawValues.adSales !== undefined && rawValues.totalSales ? rawValues.adSales / rawValues.totalSales : undefined;
  const organicSalesPct = adsSalesPct !== undefined ? 1 - adsSalesPct : undefined;
  return { acos, tAcos, adsSalesPct, organicSalesPct };
}

function rawValuesFor(row: ClientRow): Record<string, number | undefined> {
  const out: Record<string, number | undefined> = {};
  for (const col of COLUMNS) {
    if (col.kind === "currency" || col.kind === "number") out[col.key] = parsed(row.data[col.key]);
  }
  return out;
}

interface SharedMessageInput {
  period: string;
  highlights: string;
  includeHighlights: boolean;
  attachedLink?: ReportLink;
}

// One message per row (one product), built from that row's own numbers
// plus whatever's shared across the whole batch (period, highlights,
// attached link).
function composeMessage(row: ClientRow, shared: SharedMessageInput): string {
  const rawValues = rawValuesFor(row);
  const derived = deriveValues(rawValues);

  const name = row.data.clientName?.trim() || "there";
  const asin = row.data.asin?.trim();
  const productName = row.data.productName?.trim();

  const lines: string[] = [];
  lines.push(`📊 *Performance Update${shared.period.trim() ? ` — ${shared.period.trim()}` : ""}*`);
  lines.push(`Hi ${name}, here's your update:`);
  if (productName || asin) {
    lines.push(`🏷️ ${[productName, asin ? `ASIN: ${asin}` : null].filter(Boolean).join(" — ")}`);
  }
  lines.push("");

  for (const col of COLUMNS) {
    if (col.kind === "text") continue;
    const value = col.kind === "derivedPercent" ? derived[col.key] : rawValues[col.key];
    if (value === undefined) continue;
    const formatted = col.kind === "currency" ? currency(value) : col.kind === "derivedPercent" ? percent(value) : value.toLocaleString("en-IN");
    lines.push(`${col.emoji ? `${col.emoji} ` : ""}${col.label}: ${formatted}`);
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
  const [clients, setClients] = useState<Client[]>([]);
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

  // Typing a saved client's name or number auto-fills the other one (once,
  // only into an empty cell) — the "lookup as you start typing" the report
  // sheet has, backed by the same Clients directory the rest of the app
  // uses. The <datalist> on each input supplies the suggestions as you type.
  function setCell(rowIndex: number, key: string, value: string) {
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== rowIndex) return r;
        const data = { ...r.data, [key]: value };
        const query = value.trim().toLowerCase();
        if (key === "clientName" && !r.data.phone?.trim()) {
          const match = clients.find((c) => c.name.toLowerCase() === query);
          const phone = match?.whatsappGroupId ?? match?.phone;
          if (phone) data.phone = phone;
        } else if (key === "phone" && !r.data.clientName?.trim()) {
          const match = clients.find((c) => c.whatsappGroupId === value.trim() || c.phone === value.trim());
          if (match) data.clientName = match.name;
        }
        return { ...r, data };
      })
    );
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
  // Text columns are kept as plain text; numeric columns strip anything
  // that isn't a digit/decimal point/minus sign, since a spreadsheet cell
  // is often formatted with a currency symbol or a thousands comma that a
  // plain number input can't parse. Calculated columns (Acos, T.Acos, Ads
  // Sales %, Organic Sales %) still occupy their slot so later columns
  // don't shift, but whatever value is in that cell is discarded — we
  // always work those out ourselves.
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
          if (!column || column.kind === "derivedPercent") return;
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

      <datalist id="known-client-names">
        {clients.map((c) => <option key={c.id} value={c.name} />)}
      </datalist>
      <datalist id="known-client-phones">
        {clients.map((c) => <option key={c.id} value={c.whatsappGroupId ?? c.phone ?? ""} />)}
      </datalist>

      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">Send client update</span>
          <span className="panel-sub">One row per product, sent as a batch over WhatsApp</span>
        </div>
        <p className="tip">
          💡 Paste a whole block straight from your report spreadsheet, starting at Phone — it fills every row and
          column in order (adding rows as needed) and skips over Acos/T.Acos/Ads Sales %/Organic Sales %, since
          those are calculated here automatically. Typing a saved client's name or number also fills in the other
          one for you.
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
                {rows.map((row, rowIndex) => {
                  const derived = deriveValues(rawValuesFor(row));
                  return (
                    <tr key={row.id}>
                      {COLUMNS.map((col, colIndex) => (
                        <td key={col.key}>
                          {col.kind === "derivedPercent" ? (
                            <span className="panel-sub">
                              {derived[col.key] !== undefined ? percent(derived[col.key]!) : "—"}
                            </span>
                          ) : (
                            <input
                              className="field-input"
                              type={col.kind === "text" ? "text" : "number"}
                              list={col.key === "clientName" ? "known-client-names" : col.key === "phone" ? "known-client-phones" : undefined}
                              value={row.data[col.key] ?? ""}
                              onChange={(e) => setCell(rowIndex, col.key, e.target.value)}
                              onPaste={(e) => handleGridPaste(e, rowIndex, colIndex)}
                              disabled={sendingAll}
                              style={{ width: COLUMN_WIDTH[col.key] ?? 85 }}
                            />
                          )}
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
                  );
                })}
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
