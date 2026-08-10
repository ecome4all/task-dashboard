import { useEffect, useState } from "react";
import {
  Client,
  ReportField,
  ReportKind,
  REPORT_KIND_LABEL,
  WeeklyReportPreview,
  ApiError,
  fetchClients,
  fetchReportPreview,
  sendClientUpdate,
} from "./api";
import Spinner from "./Spinner";
import ErrorBanner from "./ErrorBanner";

// Pause between one client's message and the next.
const SEND_GAP_MS = 2000;

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong. Try again.";
}

// What the service itself said, when it said anything — carried through to the
// screen so an unfamiliar failure can be acted on instead of guessed at.
function errorDetail(err: unknown): string | undefined {
  return err instanceof ApiError ? err.detail : undefined;
}

function fieldKey(source: string, field: ReportField): string {
  return `${source}::${field.label}`;
}

type RowStatus = "sending" | "sent" | "failed";

function rowStatusLabel(status: RowStatus | undefined): string {
  if (status === "sending") return "Sending…";
  if (status === "sent") return "Sent ✓";
  if (status === "failed") return "Failed ✗";
  return "";
}

interface ClientReportState {
  client: Client;
  loading: boolean;
  loadError: string;
  loadErrorDetail?: string;
  preview: WeeklyReportPreview | null;
  included: Record<string, boolean>;
  sendVia: string; // a groupId, or "phone"
}

// Where this client's message actually goes: a specific group if it has one
// (or the staff's own choice among several), otherwise its saved phone.
function sendTargetFor(state: ClientReportState): { value: string; label: string } | undefined {
  const groups = state.client.whatsappGroups;
  const phone = state.client.phone?.trim() ?? "";

  if (groups.length === 0) return phone ? { value: phone, label: "Phone" } : undefined;
  if (state.sendVia === "phone") return phone ? { value: phone, label: "Phone" } : undefined;

  const chosen = groups.find((g) => g.groupId === state.sendVia) ?? groups[0];
  return { value: chosen.groupId, label: chosen.groupName ?? chosen.groupId };
}

// A cell holding a nought, however the sheet writes it: "0", "0.00", "0%",
// "₹0". Kept the same as isZeroValue in backend/src/services/reportPeriod.ts —
// the automatic send applies the same rule with nobody there to tick.
function isZeroText(value: string): boolean {
  const cleaned = value.trim().replace(/[,\s%₹$]/g, "");
  if (cleaned === "") return false;
  const asNumber = Number(cleaned);
  return !Number.isNaN(asNumber) && asNumber === 0;
}

// Everything starts ticked except a zero. "Spend: 0, Order: 0, Sales: 0" tells
// a client nothing, so picking a client ticks the lines that say something and
// leaves the noughts alone — still on screen, so it's clear they're noughts
// rather than lines that went missing, and still tickable if you want one.
function isIncluded(state: ClientReportState, source: string, field: ReportField): boolean {
  return state.included[fieldKey(source, field)] ?? !isZeroText(field.value);
}

// Whether this client has anything left to send once the noughts are out.
function hasSomethingToSend(state: ClientReportState): boolean {
  return (state.preview?.sections ?? []).some((section) =>
    section.fields.some((field) => isIncluded(state, section.source, field))
  );
}

// Today, as the date input wants it (YYYY-MM-DD) and in the browser's own
// timezone — toISOString would give UTC, which is the day before for the first
// 5.5 hours of every Indian morning.
function todayValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// The heading each report leads with. The daily one is dated rather than
// week-numbered, since "Week 3" on a single day's numbers reads oddly.
//
// It uses the day the figures came from, not the day chosen or today — sheets
// are filled in behind, so those differ, and a client must never be shown one
// day's numbers under another day's date. Kept identical to reportHeading in
// backend/src/services/reportSchedule.ts; change both together.
function reportHeading(kind: ReportKind, preview: WeeklyReportPreview): string {
  if (kind === "daily") return `📊 *Daily Update — ${preview.dailyDate ?? new Date().toLocaleDateString()}*`;
  if (kind === "weekly_sku") return `📦 *SKU Update — ${preview.month}, Week ${preview.week}*`;
  if (kind === "monthly") return `📊 *Monthly Update — ${preview.month}*`;
  return `📊 *Performance Update — ${preview.month}, Week ${preview.week}*`;
}

function composeMessage(state: ClientReportState, kind: ReportKind): string {
  const { client, preview } = state;
  if (!preview) return "";

  const lines: string[] = [];
  lines.push(reportHeading(kind, preview));
  lines.push(`Hi ${client.name}, here's your update:`);

  for (const section of preview.sections) {
    const includedFields = section.fields.filter((f) => isIncluded(state, section.source, f));
    if (includedFields.length === 0) continue;

    lines.push("");
    // Only the SKU report names its sections — they are products, and the name
    // is what tells them apart. The others have one section covering the
    // period the heading already names, so repeating it read as a stutter:
    // "Daily — 9 August" directly under "Daily Update — 9 August".
    if (kind === "weekly_sku") lines.push(`*${section.source}*`);

    for (const f of includedFields) lines.push(`${f.label}: ${f.value}`);
  }

  lines.push("");
  lines.push("— Team Ecom4all");
  return lines.join("\n");
}

// YYYY-MM-DD as people here write dates.
function humanDate(value: string): string {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

// What a client's card says when their sheet has nothing for this report.
// Worded per report, because "no data for July, Week 2" made no sense on a
// daily report and had staff hunting for a week that wasn't the problem.
function emptyMessage(kind: ReportKind, preview: WeeklyReportPreview, date: string): string {
  if (kind === "daily") {
    return `No numbers for ${humanDate(date)} or the week before it — this client's sheet isn't filled in yet.`;
  }
  if (kind === "monthly") return `No numbers for ${preview.month} yet.`;
  if (kind === "weekly_sku") return `No SKU numbers for ${preview.month}, Week ${preview.week} yet.`;
  return `No numbers for ${preview.month}, Week ${preview.week} yet.`;
}

// Why this client isn't in the send. Shown rather than the row simply not
// counting: ticking five clients and reading "Send all (1)" with nothing said
// about the other four is the screen keeping a secret.
function notSendableReason(state: ClientReportState): string {
  if (state.loading) return "still reading the sheet";
  if (state.loadError) return "sheet could not be read";
  if (!state.preview || state.preview.sections.length === 0) return "no numbers for this date";
  if (!hasSomethingToSend(state)) return "every figure is zero — nothing to say";
  if (!sendTargetFor(state)) return "no WhatsApp group or phone saved";
  return "";
}

export default function WeeklyReports() {
  const [kind, setKind] = useState<ReportKind>("weekly_sales");
  // Which day the report is about. Picks the day a daily report reads, and the
  // week and month the others read, so a period already gone by can still be
  // sent — a Monday morning weekly for the week just finished, say.
  const [date, setDate] = useState<string>(todayValue());
  const [states, setStates] = useState<ClientReportState[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [loadErrorDetail, setLoadErrorDetail] = useState<string | undefined>();
  const [sendError, setSendError] = useState("");
  const [sendErrorDetail, setSendErrorDetail] = useState<string | undefined>();
  const [rowStatus, setRowStatus] = useState<Record<string, RowStatus>>({});
  const [sendingAll, setSendingAll] = useState(false);
  // Which clients this send covers. Empty means "everyone that's ready" —
  // the common case, so nothing has to be ticked to send to all of them.
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const clients = (await fetchClients()).filter((c) => c.reportSheetUrl);
      const initial: ClientReportState[] = clients.map((client) => ({
        client,
        loading: true,
        loadError: "",
        preview: null,
        included: {},
        sendVia: "",
      }));
      setStates(initial);
      setLoading(false);

      // Each client's sheet is read independently — one client's sheet being
      // unshared shouldn't stop the rest of the list appearing — but a few at
      // a time, not all at once.
      //
      // Asking for nineteen sheets in one breath is what put "couldn't read
      // this client's report sheet" beside healthy clients: Google answers a
      // burst unevenly, some come back 429, and the screen reported that as a
      // problem with those sheets. The backend retries a busy answer now, and
      // this stops provoking it in the first place. Rows still fill in as
      // each one lands, so it doesn't feel slower.
      const queue = [...clients];
      const readNext = async (): Promise<void> => {
        const client = queue.shift();
        if (!client) return;
        try {
          const preview = await fetchReportPreview(client.id, kind, date);
          setStates((prev) =>
            prev.map((s) => (s.client.id === client.id ? { ...s, loading: false, preview } : s))
          );
        } catch (err) {
          setStates((prev) =>
            prev.map((s) =>
              s.client.id === client.id
                ? { ...s, loading: false, loadError: errorMessage(err), loadErrorDetail: errorDetail(err) }
                : s
            )
          );
        }
        return readNext();
      };
      await Promise.all(Array.from({ length: Math.min(4, clients.length) }, readNext));
    } catch (err) {
      setLoadError(errorMessage(err));
      setLoadErrorDetail(errorDetail(err));
      setLoading(false);
    }
  }

  // Reloads whenever the report or the date is switched — each report reads a
  // different tab of the sheet, and the date decides which rows of it, so the
  // previews and the composed messages all change.
  //
  // Sent marks are cleared with them: they belong to the message that was on
  // screen, and leaving them up after the numbers change would read as "this
  // client already got this", which they did not.
  useEffect(() => {
    load();
    setRowStatus({});
  }, [kind, date]);

  function toggleField(clientId: string, source: string, field: ReportField) {
    setStates((prev) =>
      prev.map((s) => {
        if (s.client.id !== clientId) return s;
        const key = fieldKey(source, field);
        return { ...s, included: { ...s.included, [key]: !isIncluded(s, source, field) } };
      })
    );
    clearStatus(clientId);
  }

  function setSendVia(clientId: string, value: string) {
    setStates((prev) => prev.map((s) => (s.client.id === clientId ? { ...s, sendVia: value } : s)));
    clearStatus(clientId);
  }

  function clearStatus(clientId: string) {
    setRowStatus((prev) => {
      if (!(clientId in prev)) return prev;
      const { [clientId]: _, ...rest } = prev;
      return rest;
    });
  }

  // Ticking a client with every figure at zero would send a heading, a
  // greeting and a sign-off with nothing between them, so "ready" means there
  // is something left once the noughts are out — not merely that the sheet
  // had rows.
  const ready = states.filter(
    (s) => s.preview && s.preview.sections.length > 0 && hasSomethingToSend(s) && sendTargetFor(s)
  );
  const anySelected = Object.values(selected).some(Boolean);
  // Nothing is sent to a client who wasn't ticked. This used to treat an empty
  // selection as "everyone", which put one keystroke between a quiet screen
  // and a message to every client on the list — too close together for
  // something that can't be taken back.
  const sendable = ready.filter((s) => selected[s.client.id] && rowStatus[s.client.id] !== "sent");
  // Ticked, but nothing can go to them. Named under the button, so the gap
  // between "I ticked five" and "Send all (1)" is accounted for.
  const blocked = anySelected ? states.filter((s) => selected[s.client.id] && notSendableReason(s)) : [];

  async function handleSendAll() {
    const targets = sendable;
    if (targets.length === 0) {
      setSendError(
        ready.length === 0
          ? "No client has a report ready to send yet."
          : "Everything here has already been sent — edit a client's fields to send again."
      );
      return;
    }
    setSendError("");
    setSendingAll(true);
    setProgress({ done: 0, total: targets.length });

    for (let i = 0; i < targets.length; i++) {
      const state = targets[i];
      const target = sendTargetFor(state);
      if (!target) continue;
      setRowStatus((prev) => ({ ...prev, [state.client.id]: "sending" }));
      try {
        const message = composeMessage(state, kind);
        await sendClientUpdate(state.client.id, { phone: target.value, channel: "whapi", message });
        setRowStatus((prev) => ({ ...prev, [state.client.id]: "sent" }));
      } catch (err) {
        setRowStatus((prev) => ({ ...prev, [state.client.id]: "failed" }));
        setSendError(`Failed to send to ${state.client.name}: ${errorMessage(err)}`);
        setSendErrorDetail(errorDetail(err));
      }
      setProgress({ done: i + 1, total: targets.length });
      if (i < targets.length - 1) {
        // A gap between messages so WhatsApp doesn't read the batch as spam.
        await new Promise((resolve) => setTimeout(resolve, SEND_GAP_MS));
      }
    }

    setSendingAll(false);
    setProgress(null);
  }

  if (loading) return <Spinner label="Loading clients…" />;

  if (loadError) return <ErrorBanner message={loadError} detail={loadErrorDetail} onRetry={load} />;

  return (
    <>
      {sendError && (
        <ErrorBanner
          message={sendError}
          detail={sendErrorDetail}
          onRetry={() => {
            setSendError("");
            setSendErrorDetail(undefined);
          }}
        />
      )}

      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">Reports</span>
          <span className="panel-sub">Read live from each client's linked Google Sheet</span>
        </div>
        <p className="tip">
          💡 Pulls the numbers straight from each client's report sheet — nothing to paste. Pick the report and
          the date, then tick the clients you want. Ticking a client picks its figures for you, leaving out any
          that are zero — untick a row to drop it, tick a zero to put it back. Nothing is sent to a client you
          haven't ticked. A client with no sheet linked (see Clients) won't show up here.
        </p>
        <div className="panel-body">
          <div className="filter-chips">
            {(Object.keys(REPORT_KIND_LABEL) as ReportKind[]).map((option) => (
              <button
                key={option}
                className={`chip ${kind === option ? "active" : ""}`}
                onClick={() => setKind(option)}
                disabled={sendingAll}
              >
                {REPORT_KIND_LABEL[option]}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 12 }}>
            <div>
              <label className="panel-sub" style={{ display: "block", marginBottom: 4 }} htmlFor="report-date">
                Report for
              </label>
              <input
                id="report-date"
                type="date"
                className="field-input"
                value={date}
                // No future dates: those rows are blank in every sheet, so the
                // only thing picking one can do is empty the screen.
                max={todayValue()}
                onChange={(e) => setDate(e.target.value || todayValue())}
                disabled={sendingAll}
              />
            </div>
            {date !== todayValue() && (
              <button
                className="btn btn-ghost"
                onClick={() => setDate(todayValue())}
                disabled={sendingAll}
                type="button"
              >
                Back to today
              </button>
            )}
          </div>

          {states.length === 0 && (
            <p className="panel-sub">No clients have a report sheet linked yet — add one on the Clients screen.</p>
          )}

          <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <button className="btn btn-primary" onClick={handleSendAll} disabled={sendingAll || sendable.length === 0}>
              {sendingAll
                ? `Sending ${progress?.done ?? 0} of ${progress?.total ?? sendable.length}…`
                : !anySelected
                ? "Send — tick a client first"
                : sendable.length === 0
                ? "All sent ✓"
                : `Send to ${sendable.length} selected`}
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => setSelected(Object.fromEntries(ready.map((s) => [s.client.id, true])))}
              disabled={sendingAll || ready.length === 0}
              type="button"
            >
              Select all with numbers ({ready.length})
            </button>
            <button className="btn btn-ghost" onClick={() => setSelected({})} disabled={sendingAll || !anySelected} type="button">
              Clear selection
            </button>
            <button className="btn btn-ghost" onClick={load} disabled={sendingAll} type="button">
              Refresh from sheets
            </button>
          </div>

          {blocked.length > 0 && (
            <p className="panel-sub" style={{ marginBottom: 16 }}>
              Not going to {blocked.length} of the clients you ticked:{" "}
              {blocked.map((s) => `${s.client.name} — ${notSendableReason(s)}`).join("; ")}
            </p>
          )}

          {states.map((state) => {
            const groups = state.client.whatsappGroups;
            const target = sendTargetFor(state);
            const message = composeMessage(state, kind);
            return (
              <div key={state.client.id} className="panel" style={{ boxShadow: "none", border: "1px solid var(--border)" }}>
                {/* The one tick that chooses a client. The ticks inside the
                    table below choose lines within their message, and the two
                    were being read as the same thing — hence the word "Send
                    to" here, and the caption above the table. */}
                <div className="panel-head">
                  <span className="panel-title">
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={!!selected[state.client.id]}
                        onChange={(e) =>
                          setSelected((prev) => ({ ...prev, [state.client.id]: e.target.checked }))
                        }
                        disabled={sendingAll}
                      />
                      <span style={{ fontWeight: 400, opacity: 0.7 }}>Send to</span> {state.client.name}
                    </label>
                  </span>
                  <span className="panel-sub">{rowStatusLabel(rowStatus[state.client.id])}</span>
                </div>
                <div className="panel-body">
                  {state.loading && <Spinner label="Reading sheet…" />}
                  {!state.loading && state.loadError && (
                    <ErrorBanner message={state.loadError} detail={state.loadErrorDetail} onRetry={load} />
                  )}
                  {!state.loading && !state.loadError && state.preview && state.preview.sections.length === 0 && (
                    <p className="panel-sub">{emptyMessage(kind, state.preview, date)}</p>
                  )}
                  {/* Sheets are filled in a day or two behind, so a daily report
                      is usually an earlier day's numbers. Said plainly here, and
                      the message itself is headed with the same day. */}
                  {kind === "daily" && state.preview?.dailyDate && (
                    <p className="panel-sub" style={{ marginBottom: 8 }}>
                      Numbers are for {state.preview.dailyDate}.
                    </p>
                  )}
                  {!state.loading && !state.loadError && state.preview && state.preview.sections.length > 0 && (
                    <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                      <div style={{ flex: "1 1 340px", minWidth: 280 }}>
                        {groups.length > 0 && (
                          <div style={{ marginBottom: 10 }}>
                            <label className="panel-sub" style={{ display: "block", marginBottom: 4 }}>Send via</label>
                            <select
                              className="field-select"
                              value={state.sendVia === "phone" ? "phone" : target?.value ?? groups[0].groupId}
                              onChange={(e) => setSendVia(state.client.id, e.target.value)}
                              disabled={sendingAll}
                            >
                              {groups.map((g) => (
                                <option key={g.id} value={g.groupId}>{g.groupName ?? g.groupId}</option>
                              ))}
                              <option value="phone">Phone number</option>
                            </select>
                          </div>
                        )}
                        <div className="panel-sub" style={{ marginBottom: 8 }}>
                          {selected[state.client.id]
                            ? "Lines going in their message. Zeros were left out — tick one to put it back."
                            : `Tick "Send to ${state.client.name}" above to include this client. Its figures below will tick themselves, apart from any zeros.`}
                        </div>
                        {state.preview.sections.map((section) => (
                          <div key={section.source} style={{ marginBottom: 14 }}>
                            <div className="panel-sub" style={{ marginBottom: 4, fontWeight: 600 }}>{section.source}</div>
                            <table className="data-table">
                              <tbody>
                                {section.fields.map((field) => (
                                  <tr key={field.label}>
                                    {/* Dead until the client is ticked, so the
                                        two ticks can't be mistaken for each
                                        other: this one only decides what goes
                                        in a message that is already going. */}
                                    <td style={{ width: 28 }}>
                                      <input
                                        type="checkbox"
                                        checked={
                                          !!selected[state.client.id] && isIncluded(state, section.source, field)
                                        }
                                        disabled={!selected[state.client.id] || sendingAll}
                                        onChange={() => toggleField(state.client.id, section.source, field)}
                                      />
                                    </td>
                                    <td>{field.label}</td>
                                    <td>{field.value}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ))}
                      </div>
                      <div style={{ flex: "1 1 300px", minWidth: 260 }}>
                        {/* Shown whether or not the client is ticked: the point
                            of it is to decide, and that needs seeing what would
                            go before committing to send it. */}
                        <div className="panel-sub" style={{ marginBottom: 6 }}>
                          {selected[state.client.id] ? "Preview — this is what they get" : "Preview — if you tick them"}
                        </div>
                        <pre
                          style={{
                            whiteSpace: "pre-wrap",
                            background: "var(--bg-alt)",
                            border: "1px solid var(--border)",
                            borderRadius: 8,
                            padding: 14,
                            fontSize: 13,
                            fontFamily: "inherit",
                            minHeight: 140,
                          }}
                        >
                          {message}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
