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

function isIncluded(state: ClientReportState, source: string, field: ReportField): boolean {
  return state.included[fieldKey(source, field)] ?? true;
}

// The heading each report leads with. The daily one is dated rather than
// week-numbered, since "Week 3" on a single day's numbers reads oddly.
function reportHeading(kind: ReportKind, preview: WeeklyReportPreview): string {
  if (kind === "daily") return `📊 *Daily Update — ${new Date().toLocaleDateString()}*`;
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
    lines.push(`*${section.source}*`);
    for (const f of includedFields) lines.push(`${f.label}: ${f.value}`);
  }

  lines.push("");
  lines.push("— Team Ecom4all");
  return lines.join("\n");
}

export default function WeeklyReports() {
  const [kind, setKind] = useState<ReportKind>("weekly_sales");
  const [states, setStates] = useState<ClientReportState[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [sendError, setSendError] = useState("");
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

      // Each client's sheet is read independently and in parallel — one
      // client's sheet being unshared/misconfigured shouldn't block the
      // rest of the list from showing up.
      await Promise.all(
        clients.map(async (client) => {
          try {
            const preview = await fetchReportPreview(client.id, kind);
            setStates((prev) =>
              prev.map((s) => (s.client.id === client.id ? { ...s, loading: false, preview } : s))
            );
          } catch (err) {
            setStates((prev) =>
              prev.map((s) => (s.client.id === client.id ? { ...s, loading: false, loadError: errorMessage(err) } : s))
            );
          }
        })
      );
    } catch (err) {
      setLoadError(errorMessage(err));
      setLoading(false);
    }
  }

  // Reloads whenever the report is switched — each report reads a different
  // tab of the sheet, so the previews and the composed messages all change.
  useEffect(() => {
    load();
    setRowStatus({});
  }, [kind]);

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

  const ready = states.filter((s) => s.preview && s.preview.sections.length > 0 && sendTargetFor(s));
  const anySelected = Object.values(selected).some(Boolean);
  const chosen = anySelected ? ready.filter((s) => selected[s.client.id]) : ready;
  const sendable = chosen.filter((s) => rowStatus[s.client.id] !== "sent");

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

  if (loadError) return <ErrorBanner message={loadError} onRetry={load} />;

  return (
    <>
      {sendError && <ErrorBanner message={sendError} onRetry={() => setSendError("")} />}

      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">Reports</span>
          <span className="panel-sub">Read live from each client's linked Google Sheet</span>
        </div>
        <p className="tip">
          💡 Pulls the numbers straight from each client's report sheet — nothing to paste. Untick anything
          that shouldn't go out, then Send All. A client with no sheet linked (see Clients) won't show up here.
          Each report reads its own tab of the sheet: <strong>Daily</strong>, <strong>Weekly</strong> and{" "}
          <strong>SKU</strong>.
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

          {states.length === 0 && (
            <p className="panel-sub">No clients have a report sheet linked yet — add one on the Clients screen.</p>
          )}

          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <button className="btn btn-primary" onClick={handleSendAll} disabled={sendingAll || sendable.length === 0}>
              {sendingAll
                ? `Sending ${progress?.done ?? 0} of ${progress?.total ?? sendable.length}…`
                : sendable.length === 0 && ready.length > 0
                ? "All sent ✓"
                : `Send all (${sendable.length})`}
            </button>
            <button className="btn btn-ghost" onClick={load} disabled={sendingAll} type="button">
              Refresh from sheets
            </button>
          </div>

          {states.map((state) => {
            const groups = state.client.whatsappGroups;
            const target = sendTargetFor(state);
            const message = composeMessage(state, kind);
            return (
              <div key={state.client.id} className="panel" style={{ boxShadow: "none", border: "1px solid var(--border)" }}>
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
                      {state.client.name}
                    </label>
                  </span>
                  <span className="panel-sub">{rowStatusLabel(rowStatus[state.client.id])}</span>
                </div>
                <div className="panel-body">
                  {state.loading && <Spinner label="Reading sheet…" />}
                  {!state.loading && state.loadError && (
                    <ErrorBanner message={state.loadError} onRetry={load} />
                  )}
                  {!state.loading && !state.loadError && state.preview && state.preview.sections.length === 0 && (
                    <p className="panel-sub">
                      No data found for {state.preview.month}, Week {state.preview.week} — the sheet may not have
                      this period filled in yet.
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
                        {state.preview.sections.map((section) => (
                          <div key={section.source} style={{ marginBottom: 14 }}>
                            <div className="panel-sub" style={{ marginBottom: 4, fontWeight: 600 }}>{section.source}</div>
                            <table className="data-table">
                              <tbody>
                                {section.fields.map((field) => (
                                  <tr key={field.label}>
                                    <td style={{ width: 28 }}>
                                      <input
                                        type="checkbox"
                                        checked={isIncluded(state, section.source, field)}
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
