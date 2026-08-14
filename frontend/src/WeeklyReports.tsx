import { useEffect, useState } from "react";
import {
  Client,
  ClientReportSheet,
  ConfigOption,
  ReportField,
  ReportKind,
  REPORT_KIND_LABEL,
  WeeklyReportPreview,
  ApiError,
  fetchClients,
  fetchConfigOptions,
  fetchReportPreview,
  sendClientUpdate,
} from "./api";
import Spinner from "./Spinner";
import ErrorBanner from "./ErrorBanner";
import MultiSelect from "./MultiSelect";

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

// One row per *sheet*, not per client: a client selling on Amazon and
// Flipkart keeps a separate sheet for each and gets a separate report from
// each, so they appear here twice, tick separately, and send separately.
interface ClientReportState {
  client: Client;
  sheet: ClientReportSheet;
  // What to call this row's marketplace on screen and in the message. Only
  // shown when the client has more than one — naming the marketplace on a
  // client who only sells on one adds nothing.
  marketplaceLabel: string;
  showMarketplace: boolean;
  loading: boolean;
  loadError: string;
  loadErrorDetail?: string;
  preview: WeeklyReportPreview | null;
  included: Record<string, boolean>;
  sendVia: string; // a groupId, or "phone"
}

// Everything on this screen is tracked per row — which are ticked, which are
// sending, which fields are included — and two rows can now share a client,
// so the sheet's own id is the identity, not the client's.
function rowKey(state: ClientReportState): string {
  return state.sheet.id;
}

// What to call this row. A client with one sheet is just their name, as
// before; a client with two would otherwise show as the same name twice with
// no way to tell which set of figures is which.
function rowTitle(state: ClientReportState): string {
  return state.showMarketplace ? `${state.client.name} — ${state.marketplaceLabel}` : state.client.name;
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

// Everything starts ticked, noughts included.
//
// They were left unticked for a while, on the reasoning that "Spend: 0,
// Order: 0, Sales: 0" tells a client nothing. Ecom4all asked for the opposite:
// a zero is a real figure about their account — it says nothing was spent and
// nothing sold that day — and a line quietly missing from an otherwise
// complete report raises a question a zero doesn't. Untick one to leave it out.
function isIncluded(state: ClientReportState, source: string, field: ReportField): boolean {
  return state.included[fieldKey(source, field)] ?? true;
}

// Whether this client has anything ticked to send.
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
function reportHeading(
  kind: ReportKind,
  preview: WeeklyReportPreview,
  // Named right after the report's own name — "Daily Update (Amazon)" — for a
  // client who gets more than one of these. Without it they'd receive two
  // identically-headed reports with different numbers in them.
  marketplaceLabel?: string
): string {
  const name = (base: string) => (marketplaceLabel ? `${base} (${marketplaceLabel})` : base);
  if (kind === "daily") return `📊 *${name("Daily Update")} — ${preview.dailyDate ?? new Date().toLocaleDateString()}*`;
  if (kind === "weekly_sku") return `📦 *${name("SKU Update")} — ${preview.month}, Week ${preview.week}*`;
  if (kind === "monthly") return `📊 *${name("Monthly Update")} — ${preview.month}*`;
  return `📊 *${name("Performance Update")} — ${preview.month}, Week ${preview.week}*`;
}

function composeMessage(state: ClientReportState, kind: ReportKind): string {
  const { client, preview } = state;
  if (!preview) return "";

  const lines: string[] = [];
  lines.push(reportHeading(kind, preview, state.showMarketplace ? state.marketplaceLabel : undefined));
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

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// A day inside each week, so every report can be asked for with one date and
// the backend works the period out the same way for all of them. Weeks 1–3 are
// seven days each and week 4 takes the rest of the month — the client's own
// convention, mirrored from currentWeekNumber in reportPeriod.ts.
const DAY_IN_WEEK: Record<number, string> = { 1: "04", 2: "11", 3: "18", 4: "25" };

function weekOf(date: string): number {
  const day = Number(date.split("-")[2]);
  return day <= 7 ? 1 : day <= 14 ? 2 : day <= 21 ? 3 : 4;
}

function monthOf(date: string): string {
  return date.slice(0, 7); // YYYY-MM, what <input type="month"> wants
}

// Which period the figures on screen are for, so the heading says what is
// being read rather than only where it came from.
//
// The week rule mirrors currentWeekNumber in backend/src/services/
// reportPeriod.ts: weeks 1–3 are seven days each and week 4 takes whatever is
// left of the month. That is the client's own convention, not a calendar week
// — if it ever changes there, it has to change here too.
//
// Daily is worded "up to", not "for": the sheets are filled in behind, so the
// figures are usually an earlier day's. Each client's card names the day its
// own numbers came from.
function periodLabel(kind: ReportKind, date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return "Read live from each client's linked Google Sheet";

  const monthName = MONTH_NAMES[month - 1];
  if (kind === "daily") return `Latest figures up to ${humanDate(date)}`;
  if (kind === "monthly") return `${monthName} ${year}`;

  return `${monthName} ${year}, Week ${weekOf(date)}`;
}

// What a client's card says when their sheet has nothing for this report.
// Worded per report, because "no data for July, Week 2" made no sense on a
// daily report and had staff hunting for a week that wasn't the problem.
function emptyMessage(kind: ReportKind, preview: WeeklyReportPreview, date: string): string {
  // The sheet has no table for this report at all. Almost always the wrong
  // file is linked — a master sheet has one tab per client ("Cherisher",
  // "PARVOTSAV"), where a client's own sheet has "Daily Report", "Weekly
  // Sales" and so on. Naming the tabs that ARE in it is what makes that
  // obvious from here instead of only after opening the file.
  if (preview.emptyReason === "no_tab") {
    const tabs = preview.tabsInSheet ?? [];
    const found = tabs.length > 0 ? ` This sheet has: ${tabs.join(", ")}.` : "";
    return (
      `This sheet has no ${REPORT_KIND_LABEL[kind]} tab, so there is nothing to read.${found}` +
      ` Check the client's own sheet is linked, not the master.`
    );
  }

  // Found the day (or the week), but every agreed column in it was blank or
  // held a spreadsheet error. Same cause as the missing Acos columns: Acos is
  // spend ÷ sales, so a period with no sales comes back #DIV/0!.
  if (preview.emptyReason === "no_agreed_columns") {
    return (
      "The row for this period is in the sheet, but every column this report sends is blank" +
      " or shows a sheet error like #DIV/0!. Fix the formulas in the sheet and try again."
    );
  }

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
  if (!hasSomethingToSend(state)) return "every line has been unticked";
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
  // Narrows the screen to certain clients. Nineteen cards, each holding a
  // table and a message preview, is a long scroll when the errand is "check
  // what Cherisher is getting". Empty means every client, as it does on the
  // task board's filters.
  const [clientFilter, setClientFilter] = useState<string[]>([]);
  // Narrows to the sheets of one marketplace — "send the Amazon lot" is a
  // round of its own, and a client selling on two marketplaces has a card for
  // each. Empty means every marketplace.
  const [marketplaceFilter, setMarketplaceFilter] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const [clients, marketplaceOptions] = await Promise.all([
        fetchClients(),
        fetchConfigOptions("marketplace"),
      ]);
      const marketplaceLabels = Object.fromEntries(
        marketplaceOptions.map((option: ConfigOption) => [option.value, option.label])
      );

      // One row per sheet. A client with sheets for two marketplaces appears
      // twice — separate figures, separate ticks, separate message — and a
      // client with none doesn't appear at all.
      const initial: ClientReportState[] = clients.flatMap((client) =>
        client.reportSheets.map((sheet) => ({
          client,
          sheet,
          marketplaceLabel: marketplaceLabels[sheet.marketplace] ?? sheet.marketplace,
          showMarketplace: client.reportSheets.length > 1,
          loading: true,
          loadError: "",
          preview: null,
          included: {},
          sendVia: "",
        }))
      );
      setStates(initial);
      setLoading(false);

      // Each sheet is read independently — one client's sheet being unshared
      // shouldn't stop the rest of the list appearing — but a few at a time,
      // not all at once.
      //
      // Asking for nineteen sheets in one breath is what put "couldn't read
      // this client's report sheet" beside healthy clients: Google answers a
      // burst unevenly, some come back 429, and the screen reported that as a
      // problem with those sheets. The backend retries a busy answer now, and
      // this stops provoking it in the first place. Rows still fill in as
      // each one lands, so it doesn't feel slower. The limit counts sheets
      // rather than clients, since that is what actually hits Google.
      const queue = [...initial];
      const readNext = async (): Promise<void> => {
        const row = queue.shift();
        if (!row) return;
        const id = row.sheet.id;
        try {
          const preview = await fetchReportPreview(row.client.id, kind, date, row.sheet.marketplace);
          setStates((prev) => prev.map((s) => (s.sheet.id === id ? { ...s, loading: false, preview } : s)));
        } catch (err) {
          setStates((prev) =>
            prev.map((s) =>
              s.sheet.id === id
                ? { ...s, loading: false, loadError: errorMessage(err), loadErrorDetail: errorDetail(err) }
                : s
            )
          );
        }
        return readNext();
      };
      await Promise.all(Array.from({ length: Math.min(4, initial.length) }, readNext));
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

  function toggleField(rowId: string, source: string, field: ReportField) {
    setStates((prev) =>
      prev.map((s) => {
        if (rowKey(s) !== rowId) return s;
        const key = fieldKey(source, field);
        return { ...s, included: { ...s.included, [key]: !isIncluded(s, source, field) } };
      })
    );
    clearStatus(rowId);
  }

  function setSendVia(rowId: string, value: string) {
    setStates((prev) => prev.map((s) => (rowKey(s) === rowId ? { ...s, sendVia: value } : s)));
    clearStatus(rowId);
  }

  function clearStatus(rowId: string) {
    setRowStatus((prev) => {
      if (!(rowId in prev)) return prev;
      const { [rowId]: _, ...rest } = prev;
      return rest;
    });
  }

  // Everything below works off the filtered list, sending included: a client
  // hidden behind a filter must not be sent a message from a screen that isn't
  // showing them. Anyone ticked and then filtered out is counted in
  // hiddenSelected and named under the button, rather than silently dropped.
  // The two filters narrow together: pick Amazon and two clients, and you get
  // those clients' Amazon sheets only.
  const visibleStates = states.filter(
    (s) =>
      (clientFilter.length === 0 || clientFilter.includes(s.client.id)) &&
      (marketplaceFilter.length === 0 || marketplaceFilter.includes(s.sheet.marketplace))
  );

  // "Ready" means there is at least one line ticked. Untick every line of a
  // client's report and they would otherwise be sent a heading, a greeting and
  // a sign-off with nothing between them.
  const ready = visibleStates.filter(
    (s) => s.preview && s.preview.sections.length > 0 && hasSomethingToSend(s) && sendTargetFor(s)
  );
  const anySelected = visibleStates.some((s) => selected[rowKey(s)]);
  // Nothing is sent to a client who wasn't ticked. This used to treat an empty
  // selection as "everyone", which put one keystroke between a quiet screen
  // and a message to every client on the list — too close together for
  // something that can't be taken back.
  const sendable = ready.filter((s) => selected[rowKey(s)] && rowStatus[rowKey(s)] !== "sent");
  // Ticked, but nothing can go to them. Named under the button, so the gap
  // between "I ticked five" and "Send all (1)" is accounted for.
  const blocked = anySelected ? visibleStates.filter((s) => selected[rowKey(s)] && notSendableReason(s)) : [];
  const hiddenSelected = states.filter(
    (s) => selected[rowKey(s)] && !visibleStates.includes(s)
  );

  // One entry per client, not per sheet — a client with an Amazon and a
  // Flipkart sheet is one name in the list and picking it shows both cards.
  const clientOptions = Array.from(
    new Map(states.map((s) => [s.client.id, s.client.name])).entries()
  ).map(([value, label]) => ({ value, label }));

  // Only the marketplaces some client actually has a sheet for. Listing every
  // marketplace an admin has ever added would offer filters that can only ever
  // empty the screen.
  const marketplaceFilterOptions = Array.from(
    new Map(states.map((s) => [s.sheet.marketplace, s.marketplaceLabel])).entries()
  ).map(([value, label]) => ({ value, label }));

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
      setRowStatus((prev) => ({ ...prev, [rowKey(state)]: "sending" }));
      try {
        const message = composeMessage(state, kind);
        await sendClientUpdate(rowKey(state), { phone: target.value, channel: "whapi", message });
        setRowStatus((prev) => ({ ...prev, [rowKey(state)]: "sent" }));
      } catch (err) {
        setRowStatus((prev) => ({ ...prev, [rowKey(state)]: "failed" }));
        setSendError(`Failed to send to ${rowTitle(state)}: ${errorMessage(err)}`);
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
          <span className="panel-title">{REPORT_KIND_LABEL[kind]}</span>
          <span className="panel-sub">
            {periodLabel(kind, date)} — read from each client's linked Google Sheet, at most a minute old
          </span>
        </div>
        <p className="tip">
          💡 Pulls the numbers straight from each client's report sheet — nothing to paste. Pick the report and
          the period, then tick the clients you want. Ticking a client picks all of its figures, zeros included —
          untick any row you don't want in their message. Nothing is sent to a client you haven't ticked. A
          client with no sheet linked (see Clients) won't show up here.
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

          {/* Asked for in the unit the report is actually about: a day for the
              daily one, a month and a week for the weekly ones, a month for the
              monthly. All three end up as one date, which is what the backend
              works every period out from — picking a week just means picking a
              day inside it. */}
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 12 }}>
            {kind === "daily" && (
              <div>
                <label className="panel-sub" style={{ display: "block", marginBottom: 4 }} htmlFor="report-date">
                  Day
                </label>
                <input
                  id="report-date"
                  type="date"
                  className="field-input"
                  value={date}
                  // No future days: those rows are blank in every sheet, so the
                  // only thing picking one can do is empty the screen.
                  max={todayValue()}
                  onChange={(e) => setDate(e.target.value || todayValue())}
                  disabled={sendingAll}
                />
              </div>
            )}

            {kind !== "daily" && (
              <div>
                <label className="panel-sub" style={{ display: "block", marginBottom: 4 }} htmlFor="report-month">
                  Month
                </label>
                <input
                  id="report-month"
                  type="month"
                  className="field-input"
                  value={monthOf(date)}
                  max={monthOf(todayValue())}
                  onChange={(e) =>
                    setDate(e.target.value ? `${e.target.value}-${DAY_IN_WEEK[weekOf(date)]}` : todayValue())
                  }
                  disabled={sendingAll}
                />
              </div>
            )}

            {(kind === "weekly_sales" || kind === "weekly_sku") && (
              <div>
                <label className="panel-sub" style={{ display: "block", marginBottom: 4 }} htmlFor="report-week">
                  Week
                </label>
                <select
                  id="report-week"
                  className="field-select"
                  value={weekOf(date)}
                  onChange={(e) => setDate(`${monthOf(date)}-${DAY_IN_WEEK[Number(e.target.value)]}`)}
                  disabled={sendingAll}
                >
                  <option value={1}>Week 1 — 1st to 7th</option>
                  <option value={2}>Week 2 — 8th to 14th</option>
                  <option value={3}>Week 3 — 15th to 21st</option>
                  <option value={4}>Week 4 — 22nd to month end</option>
                </select>
              </div>
            )}

            {/* Tick as many clients as you want to look at. Nothing ticked
                shows every one of them, the same rule the task board uses. */}
            <div style={{ minWidth: 200 }}>
              <label className="panel-sub" style={{ display: "block", marginBottom: 4 }}>
                Clients
              </label>
              <MultiSelect
                values={clientFilter}
                placeholder={`All clients (${clientOptions.length})`}
                options={clientOptions}
                onChange={setClientFilter}
              />
            </div>

            {/* Only worth showing at all once more than one marketplace has a
                sheet linked — a single-marketplace list is a filter whose only
                setting is the one already in force. */}
            {marketplaceFilterOptions.length > 1 && (
              <div style={{ minWidth: 180 }}>
                <label className="panel-sub" style={{ display: "block", marginBottom: 4 }}>
                  Marketplace
                </label>
                <MultiSelect
                  values={marketplaceFilter}
                  placeholder={`All marketplaces (${marketplaceFilterOptions.length})`}
                  options={marketplaceFilterOptions}
                  onChange={setMarketplaceFilter}
                />
              </div>
            )}

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
          {states.length > 0 && visibleStates.length === 0 && (
            <p className="panel-sub">
              Nothing here matches the filters.{" "}
              <button
                className="link-button"
                onClick={() => {
                  setClientFilter([]);
                  setMarketplaceFilter([]);
                }}
                type="button"
              >
                Show everything
              </button>
            </p>
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
              onClick={() => setSelected(Object.fromEntries(ready.map((s) => [rowKey(s), true])))}
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
              {blocked.map((s) => `${rowTitle(s)} — ${notSendableReason(s)}`).join("; ")}
            </p>
          )}

          {/* Ticked earlier, then filtered off the screen. Nothing is sent to
              a client this screen isn't showing, so it says which. */}
          {hiddenSelected.length > 0 && (
            <p className="panel-sub" style={{ marginBottom: 16 }}>
              {hiddenSelected.length} ticked client(s) are hidden by the filters and will not be sent
              to: {hiddenSelected.map((s) => rowTitle(s)).join(", ")}.
            </p>
          )}

          {visibleStates.map((state) => {
            const groups = state.client.whatsappGroups;
            const target = sendTargetFor(state);
            const message = composeMessage(state, kind);
            return (
              <div key={rowKey(state)} className="panel" style={{ boxShadow: "none", border: "1px solid var(--border)" }}>
                {/* The one tick that chooses a client. The ticks inside the
                    table below choose lines within their message, and the two
                    were being read as the same thing — hence the word "Send
                    to" here, and the caption above the table. */}
                <div className="panel-head">
                  <span className="panel-title">
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={!!selected[rowKey(state)]}
                        onChange={(e) =>
                          setSelected((prev) => ({ ...prev, [rowKey(state)]: e.target.checked }))
                        }
                        disabled={sendingAll}
                      />
                      <span style={{ fontWeight: 400, opacity: 0.7 }}>Send to</span> {rowTitle(state)}
                    </label>
                  </span>
                  <span className="panel-sub">{rowStatusLabel(rowStatus[rowKey(state)])}</span>
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
                              onChange={(e) => setSendVia(rowKey(state), e.target.value)}
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
                          {selected[rowKey(state)]
                            ? "Lines going in their message — untick any you don't want."
                            : `Tick "Send to ${state.client.name}" above to include this client. All of its figures below will tick themselves.`}
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
                                          !!selected[rowKey(state)] && isIncluded(state, section.source, field)
                                        }
                                        disabled={!selected[rowKey(state)] || sendingAll}
                                        onChange={() => toggleField(rowKey(state), section.source, field)}
                                      />
                                    </td>
                                    <td>{field.label}</td>
                                    <td>{field.value}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {/* A column that is blank or shows an error in the
                                sheet is dropped on the way in, because
                                "Acos: #DIV/0!" is worse than saying nothing.
                                That dropping used to be invisible, and reports
                                went out with Acos and T.Acos missing for a few
                                clients before anyone noticed. It is not an
                                error, so it doesn't read as one — it is a note
                                about what this report will not say. */}
                            {section.leftOut && section.leftOut.length > 0 && (
                              <div className="left-out">
                                <strong>Not in this report: {section.leftOut.join(", ")}</strong>
                                <div>
                                  {section.leftOut.length === 1 ? "That column is" : "Those columns are"}{" "}
                                  empty or showing an error in this client's sheet for this period.
                                  Acos is spend ÷ sales, so it reads <code>#DIV/0!</code> when there
                                  were no sales. Send as is, or fix the sheet and load again.
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                      <div style={{ flex: "1 1 300px", minWidth: 260 }}>
                        {/* Shown whether or not the client is ticked: the point
                            of it is to decide, and that needs seeing what would
                            go before committing to send it. */}
                        <div className="panel-sub" style={{ marginBottom: 6 }}>
                          {selected[rowKey(state)] ? "Preview — this is what they get" : "Preview — if you tick them"}
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
