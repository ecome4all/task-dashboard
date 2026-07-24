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
// "report fields.txt") from ASIN onward: product identifier, then the
// metrics in the same order and positions (including the calculated
// Acos/T.Acos/% columns) their sheet has them in. Phone/Client Name (typed
// via lookup, not pasted) and Start/End Date (typed per row -- the sheet's
// own paste block has no date columns) sit before ASIN specifically so
// pasting a block starting at ASIN is never affected by them.
const COLUMNS: ColumnDef[] = [
  { key: "phone", label: "Phone", kind: "text" },
  { key: "clientName", label: "Client Name", kind: "text" },
  { key: "startDate", label: "Start Date", emoji: "📅", kind: "text" },
  { key: "endDate", label: "End Date", emoji: "📅", kind: "text" },
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
  phone: 125, clientName: 140, startDate: 100, endDate: 100, asin: 105, productName: 130,
  rating: 65, reviews: 75,
};

interface ClientRow {
  id: string;
  data: Record<string, string>;
  // Which of the matched client's WhatsApp groups (by groupId) to send to,
  // or "phone" to use the row's own Phone cell instead. Unset until the
  // dropdown is touched, in which case the first group (or phone, if the
  // matched client has none) is used as the default.
  sendVia?: string;
}

type RowStatus = "sending" | "sent" | "failed";

// A row's Client Name matched against the saved Clients directory, so its
// WhatsApp groups can be offered as send targets.
function matchedClientFor(row: ClientRow, clients: Client[]): Client | undefined {
  const name = row.data.clientName?.trim().toLowerCase();
  if (!name) return undefined;
  return clients.find((c) => c.name.toLowerCase() === name);
}

interface SendTarget {
  value: string;
  label: string;
}

// Where a row's message actually goes: a specific group if the matched
// client has one (or the row's own choice among several), otherwise the
// row's own Phone cell.
function sendTargetFor(row: ClientRow, clients: Client[]): SendTarget | undefined {
  const groups = matchedClientFor(row, clients)?.whatsappGroups ?? [];
  const phone = row.data.phone?.trim() ?? "";

  if (groups.length === 0) return phone ? { value: phone, label: "Phone" } : undefined;
  if (row.sendVia === "phone") return phone ? { value: phone, label: "Phone" } : undefined;

  const chosen = groups.find((g) => g.groupId === row.sendVia) ?? groups[0];
  return { value: chosen.groupId, label: chosen.groupName ?? chosen.groupId };
}

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
// attached link). A row's own Start/End Date -- the reporting period for
// that specific SKU, which can differ row to row -- takes priority over
// the shared Period field, which only applies as a fallback when a row has
// no dates of its own set.
function composeMessage(row: ClientRow, shared: SharedMessageInput): string {
  const rawValues = rawValuesFor(row);
  const derived = deriveValues(rawValues);

  const name = row.data.clientName?.trim() || "there";
  const asin = row.data.asin?.trim();
  const productName = row.data.productName?.trim();
  const startDate = row.data.startDate?.trim();
  const endDate = row.data.endDate?.trim();
  const period = startDate && endDate ? `${startDate} – ${endDate}` : startDate || endDate || shared.period.trim();

  const lines: string[] = [];
  lines.push(`📊 *Performance Update${period ? ` — ${period}` : ""}*`);
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
  // Editing any cell also clears that row's sent/failed status, since an
  // edited row is no longer the same message that was (or wasn't) sent —
  // it goes back into the next "Send all" batch.
  function setCell(rowIndex: number, key: string, value: string) {
    const rowId = rows[rowIndex]?.id;
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== rowIndex) return r;
        const data = { ...r.data, [key]: value };
        const query = value.trim().toLowerCase();
        if (key === "clientName" && !r.data.phone?.trim()) {
          const match = clients.find((c) => c.name.toLowerCase() === query);
          if (match?.phone) data.phone = match.phone;
        } else if (key === "phone" && !r.data.clientName?.trim()) {
          const match = clients.find((c) => c.phone === value.trim());
          if (match) data.clientName = match.name;
        }
        return { ...r, data };
      })
    );
    clearRowStatus(rowId);
  }

  function clearRowStatus(rowId: string | undefined) {
    if (!rowId) return;
    setRowStatus((prev) => {
      if (!(rowId in prev)) return prev;
      const { [rowId]: _, ...rest } = prev;
      return rest;
    });
  }

  function setSendVia(rowIndex: number, value: string) {
    setRows((prev) => prev.map((r, i) => (i === rowIndex ? { ...r, sendVia: value } : r)));
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
    const touchedRowIds: string[] = [];

    setRows((prev) => {
      const next = [...prev];
      pastedRows.forEach((cells, r) => {
        const targetIndex = rowIndex + r;
        while (next.length <= targetIndex) next.push({ id: `row-${nextRowId.current++}`, data: {} });
        touchedRowIds.push(next[targetIndex].id);
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
    touchedRowIds.forEach(clearRowStatus);
  }

  const attachedLink = links.find((l) => l.id === attachedLinkId);

  // Ready to send: has a client name and somewhere to actually send it
  // (a matched client's group, or the row's own Phone cell).
  const readyRows = useMemo(
    () => rows.filter((r) => r.data.clientName?.trim() && sendTargetFor(r, clients)),
    [rows, clients]
  );
  // Excludes rows already marked "sent" — re-running "Send all" (e.g. after
  // adding more rows or fixing a failed one) doesn't repeat anyone who
  // already went out. Editing a row clears its "sent" status (see
  // clearRowStatus), so a correction puts it back in the next batch.
  const sendableRows = useMemo(
    () => readyRows.filter((r) => rowStatus[r.id] !== "sent"),
    [readyRows, rowStatus]
  );

  const previewRow = sendableRows[0] ?? readyRows[0];
  const previewMessage = previewRow
    ? composeMessage(previewRow, { period, highlights, includeHighlights, attachedLink })
    : "";

  async function handleSendAll() {
    const targets = sendableRows;
    if (targets.length === 0) {
      setSendError(
        readyRows.length === 0
          ? "Add at least one row with a client name and somewhere to send it first."
          : "Everything here has already been sent — edit a row to send it again."
      );
      return;
    }
    setSendError("");
    setSendingAll(true);
    setProgress({ done: 0, total: targets.length });

    for (let i = 0; i < targets.length; i++) {
      const row = targets[i];
      const target = sendTargetFor(row, clients);
      if (!target) continue;
      setRowStatus((prev) => ({ ...prev, [row.id]: "sending" }));
      try {
        const message = composeMessage(row, { period, highlights, includeHighlights, attachedLink });
        await sendClientUpdate(row.id, { phone: target.value, channel: "whapi", message });
        setRowStatus((prev) => ({ ...prev, [row.id]: "sent" }));
      } catch (err) {
        setRowStatus((prev) => ({ ...prev, [row.id]: "failed" }));
        setSendError(`Failed to send to ${row.data.clientName || target.value}: ${errorMessage(err)}`);
      }
      setProgress({ done: i + 1, total: targets.length });
      // 5 seconds between sends, but no point waiting after the last one.
      if (i < targets.length - 1) {
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
  // manual fallback for just the previewed client, and only meaningful when
  // that target is a phone number rather than a group id.
  const previewTarget = previewRow ? sendTargetFor(previewRow, clients) : undefined;
  const waLink = `https://wa.me/${(previewTarget?.value ?? "").replace(/\D/g, "")}?text=${encodeURIComponent(previewMessage)}`;

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
        {clients.map((c) => <option key={c.id} value={c.phone ?? ""} />)}
      </datalist>

      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">Send client update</span>
          <span className="panel-sub">One row per product, sent as a batch over WhatsApp</span>
        </div>
        <p className="tip">
          💡 Type to search for the client under Phone or Client Name — the other one fills in for you. Set Start
          Date/End Date per row for that SKU's own reporting period. Then paste a whole block straight from your
          report spreadsheet starting at ASIN — it fills every row and column in order from there (adding rows as
          needed) and skips over Acos/T.Acos/Ads Sales %/Organic Sales %, since those are calculated here
          automatically.
        </p>
        <div className="panel-body">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <input
              className="field-input"
              type="text"
              placeholder="Fallback period, used only if a row has no Start/End Date (e.g. Week of 1–7 July)"
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

          <div style={{ overflowX: "scroll" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Send Via</th>
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
                  const groups = matchedClientFor(row, clients)?.whatsappGroups ?? [];
                  const target = sendTargetFor(row, clients);
                  return (
                    <tr key={row.id}>
                      <td>
                        {groups.length === 0 ? (
                          <span className="panel-sub">Phone</span>
                        ) : (
                          <select
                            className="field-select"
                            value={row.sendVia === "phone" ? "phone" : target?.value ?? groups[0].groupId}
                            onChange={(e) => setSendVia(rowIndex, e.target.value)}
                            disabled={sendingAll}
                            style={{ width: 130, fontSize: 12 }}
                          >
                            {groups.map((g) => (
                              <option key={g.id} value={g.groupId}>{g.groupName ?? g.groupId}</option>
                            ))}
                            <option value="phone">Phone number</option>
                          </select>
                        )}
                      </td>
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
                              placeholder={
                                col.key === "clientName" || col.key === "phone"
                                  ? "Type to search"
                                  : col.key === "startDate" || col.key === "endDate"
                                  ? "e.g. 1 Jul"
                                  : undefined
                              }
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
              <div className="panel-sub" style={{ marginBottom: 6 }}>Preview — next to send</div>
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
                {previewMessage || "Fill in at least one row's Client Name and a phone number (or matched WhatsApp group) to see a preview."}
              </pre>
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <button className="btn btn-primary" onClick={handleSendAll} disabled={sendingAll || sendableRows.length === 0}>
                  {sendingAll
                    ? `Sending ${progress?.done ?? 0} of ${progress?.total ?? sendableRows.length}…`
                    : sendableRows.length === 0 && readyRows.length > 0
                    ? "All sent ✓"
                    : `Send all (${sendableRows.length})`}
                </button>
                <button className="btn btn-ghost" onClick={handleCopy} type="button" disabled={!previewMessage}>
                  {copied ? "Copied ✓" : "Copy first message"}
                </button>
                {previewTarget?.label === "Phone" && (
                  <a
                    className="btn btn-ghost"
                    href={waLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}
                  >
                    Open first in WhatsApp
                  </a>
                )}
              </div>
              <p className="panel-sub" style={{ marginTop: 6 }}>
                "Send all" goes out one message at a time, 5 seconds apart, so WhatsApp doesn't flag the batch as spam,
                and skips anything already marked Sent. "Copy first message" / "Open first in WhatsApp" only cover the
                previewed row — handy for a one-off manual send ("Open in WhatsApp" only works for a phone target, not
                a group).
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
