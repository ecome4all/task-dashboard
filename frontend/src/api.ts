// Empty by default so relative /api paths work through the Vite dev proxy
// (see vite.config.ts). In production, set VITE_API_BASE_URL to the deployed
// backend's origin, since the frontend and backend live on different domains.
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export class ApiError extends Error {
  // `detail` is what actually went wrong, in the underlying service's own
  // words — Google's message and status, say. The message is what to do about
  // it; the detail is there so a cause nobody wrote a friendly line for can
  // still be acted on rather than met with a shrug. Shown, not swallowed.
  constructor(message: string, public status?: number, public detail?: string) {
    super(message);
  }
}

// Called whenever a 401 comes back from anywhere except /auth/login (see
// below) — i.e. a previously-valid session just expired or was invalidated.
// App.tsx registers this once, to drop back to the login screen instead of
// leaving every screen stuck on a dead-end "(401) Try again" that can never
// actually succeed until the user manually logs out and back in.
type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  onUnauthorized = handler;
}

// Reading the body can itself fail (already-consumed stream, non-JSON body),
// and that must never replace the real error with a parsing one.
async function serverErrorText(res: Response): Promise<{ error: string | null; detail?: string }> {
  try {
    const body = await res.json();
    return {
      error: typeof body?.error === "string" && body.error.trim() ? body.error : null,
      detail: typeof body?.detail === "string" && body.detail.trim() ? body.detail : undefined,
    };
  } catch {
    return { error: null };
  }
}

// Network failures (offline, DNS, CORS) throw before a Response even exists —
// wrapped here so every caller sees the same ApiError shape either way.
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { credentials: "include", ...init });
  } catch {
    throw new ApiError("Couldn't reach the server. Check your connection and try again.");
  }

  if (!res.ok) {
    // A 401 from the login route itself just means "wrong password" — there's
    // no session yet to treat as expired (login() handles that case itself).
    // A 401 from /auth/me is the normal, unremarkable result of checking
    // "is anyone logged in?" on a fresh visit that was never logged in in
    // the first place — App.tsx's initial mount already handles that by
    // just showing the login screen, with no "your session expired" framing
    // (fetchCurrentUser() below swallows this 401 itself). A 401 from
    // anywhere else only happens once requireAuth, having already let the
    // user load this screen, starts rejecting the same cookie — i.e. an
    // actual previously-valid session expired or was invalidated since.
    if (res.status === 401 && path !== "/api/auth/login" && path !== "/api/auth/me") {
      onUnauthorized?.();
    }
    // Prefer whatever the server said went wrong — routes answer with
    // { error: "..." } written for the person reading it ("Kinjal already
    // logs in with that email"), which is far more use than a status code.
    // Falls back to the generic line when there's no JSON body, or the body
    // has no error text (an HTML error page from a proxy, say).
    const said = await serverErrorText(res);
    throw new ApiError(
      said.error ?? `Something went wrong (${res.status}). Try again.`,
      res.status,
      said.detail
    );
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

function postJson<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// These used to be fixed string-literal unions, but Marketplace/Status/Type
// are now admin-editable lists (see ConfigOption below) — an admin can add a
// value this frontend has never heard of, so the type can't enumerate them
// up front. "waiting_for_marketplace" stays meaningful to the frontend only
// because statusLabel() in Dashboard.tsx special-cases that one value.
export type TaskStatus = string;
export type TaskType = string;
export type Marketplace = string;

export type SendableTaskField = "status" | "marketplace" | "assignee" | "dueDate";

export interface Task {
  id: string;
  source: string;
  sourceRef: string;
  chatName: string | null;
  description: string;
  clientName: string | null;
  assignee: string | null;
  taskType: TaskType | null;
  marketplace: Marketplace | null;
  status: TaskStatus;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  doneAt: string | null;
  // Fields changed since the last WhatsApp send (manual or automatic) for
  // this task — computed server-side, since "what's already been told to
  // the client" is shared across whoever's using the dashboard, not
  // per-browser state.
  pendingSendFields: SendableTaskField[];
  // How many notes this task has. The notes themselves are only fetched
  // when a row is actually opened — see fetchTaskNotes.
  noteCount: number;
  // Whether a note is waiting to go to the client. The Send button turns on
  // for this even when no field has changed, since otherwise a note on a task
  // nobody edits again could never reach anyone.
  hasNoteForClient: boolean;
}

export interface TaskNote {
  id: string;
  taskId: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
  // Whether this note is meant for the client at all. Ticking the box when
  // writing it sets this — and sends nothing: the note waits and goes out
  // inside the next update this task sends.
  sendToClient: boolean;
  // When it actually reached the client's group. Null with sendToClient true
  // means it is still waiting for that next update; null with sendToClient
  // false means it was never meant to go.
  sentAt: string | null;
}

// Oldest first — a note thread reads top to bottom.
export function fetchTaskNotes(taskId: string): Promise<TaskNote[]> {
  return request(`/api/tasks/${taskId}/notes`);
}

// sendToWhatsapp is opted into per note, and no longer sends anything by
// itself: it marks the note for the client, and the note goes out inside the
// next update this task sends. So this call either saves or it doesn't —
// there is no half-success to report any more.
export function addTaskNote(
  taskId: string,
  body: string,
  sendToWhatsapp: boolean
): Promise<TaskNote> {
  return postJson(`/api/tasks/${taskId}/notes`, { body, sendToWhatsapp });
}

// Only the person who wrote a note (or an admin) can remove it — enforced
// server-side too, not just by hiding the button.
export function deleteTaskNote(taskId: string, noteId: string): Promise<void> {
  return request(`/api/tasks/${taskId}/notes/${noteId}`, { method: "DELETE" });
}

// Removes a task and its notes for good. Marking a task done is how finished
// work is closed — this is for a duplicate, a test, or a message that should
// never have become a task. Admins and managers only, enforced server-side.
export function deleteTask(id: string): Promise<void> {
  return request(`/api/tasks/${id}`, { method: "DELETE" });
}

export type Frequency = "daily" | "weekly" | "fortnightly" | "monthly";

// Kept in step with FREQUENCY_LABEL in the backend's services/recurrence.ts —
// the key order is the order of the dropdown on the board and on Repeating
// Tasks, both of which read the keys of this object.
export const FREQUENCY_LABEL: Record<Frequency, string> = {
  daily: "Every day",
  weekly: "Every week",
  fortnightly: "Every 2 weeks",
  monthly: "Every month",
};

export interface RecurringTask {
  id: string;
  source: string;
  sourceRef: string;
  chatName: string | null;
  description: string;
  clientName: string | null;
  assignee: string | null;
  taskType: string | null;
  marketplace: string | null;
  frequency: Frequency;
  nextRunAt: string;
  lastRunAt: string | null;
  active: boolean;
  createdBy: string;
  createdAt: string;
}

export function fetchRecurringTasks(): Promise<RecurringTask[]> {
  return request("/api/recurring-tasks");
}

// "Repeat this" on a task: copies that task's details into a standalone
// repeat, so editing or deleting the original later changes nothing.
// nextRunAt is when the first one should be made — chosen explicitly, since
// "every week" says nothing about which day or what time.
export function createRecurringTask(
  taskId: string,
  frequency: Frequency,
  nextRunAt: string
): Promise<RecurringTask> {
  return postJson("/api/recurring-tasks", { taskId, frequency, nextRunAt });
}

// Changing frequency leaves the next date where it is — move it explicitly
// with nextRunAt if you want it somewhere else.
export function updateRecurringTask(
  id: string,
  changes: { active?: boolean; frequency?: Frequency; nextRunAt?: string }
): Promise<RecurringTask> {
  return request(`/api/recurring-tasks/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(changes),
  });
}

export function deleteRecurringTask(id: string): Promise<void> {
  return request(`/api/recurring-tasks/${id}`, { method: "DELETE" });
}

export function fetchTasks(): Promise<Task[]> {
  return request("/api/tasks");
}

// Raising a task by hand instead of waiting for one to arrive over WhatsApp —
// work that came in by phone, in a meeting, or that Ecom4all set itself.
// Admins and managers only, enforced server-side.
//
// clientId is what decides where updates on this task can be sent: the
// client's linked WhatsApp group, or their number if they have no group. With
// no client picked the task is internal — a perfectly good task, just with
// nobody to send to (its Send button stays off).
export interface NewTask {
  description: string;
  clientId?: string | null;
  assignee?: string | null;
  taskType?: string | null;
  marketplace?: string | null;
  // Same rule as on the board: only an admin or manager can set one.
  dueDate?: string | null;
}

export function createTask(task: NewTask): Promise<Task> {
  return postJson("/api/tasks", task);
}

// Whether this task has a client WhatsApp group or number behind it. Tasks
// that arrived over WhatsApp always do; one raised by hand with no client
// picked has nowhere to send, so the Send button is off for it.
export function canSendToClient(task: Task): boolean {
  return Boolean(task.sourceRef);
}

export function updateTask(
  id: string,
  changes: Partial<Pick<Task, "assignee" | "status" | "taskType" | "marketplace" | "dueDate">>
): Promise<Task> {
  return request(`/api/tasks/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(changes),
  });
}

// Manual WhatsApp send for anything other than the automatic status-change
// notification. No field picking -- the backend works out what's changed
// since the last send for this task (see Task.pendingSendFields) and sends
// exactly that, as one message.
export function sendTaskUpdate(id: string): Promise<{ sent: boolean; fields: SendableTaskField[] }> {
  return postJson(`/api/tasks/${id}/send-update`, {});
}

export interface Employee {
  id: string;
  name: string;
  role: "admin" | "manager" | "member";
  active: boolean;
  // WhatsApp number for the "a new task is yours" alert and the daily "your
  // open work" reminder. Empty means this employee just doesn't get either.
  phone: string | null;
  // The email they sign in with, if an admin has given them a login. An
  // employee row on its own is not a login — see hasLogin.
  email: string | null;
  // Whether this person can actually sign in: both an email and a password
  // have to be set, so the email alone doesn't answer it.
  hasLogin: boolean;
}

export function fetchEmployees(): Promise<Employee[]> {
  return request("/api/employees");
}

// Admin-only: includes inactive employees so they can be reactivated.
export function fetchAllEmployees(): Promise<Employee[]> {
  return request("/api/employees/all");
}

export function createEmployee(name: string): Promise<Employee> {
  return postJson("/api/employees", { name });
}

// Renaming moves the person's existing tasks to the new name server-side —
// Task.assignee holds a name, not an id, so a rename that didn't cascade
// would orphan all their work. Fails with 409 if another employee already
// uses that name, since two people sharing one makes assignment ambiguous.
export function updateEmployee(
  id: string,
  changes: Partial<Pick<Employee, "name" | "role" | "active" | "phone">>
): Promise<Employee> {
  return request(`/api/employees/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(changes),
  });
}

// Removes someone for good. Deactivating is the right answer for a person who
// has left — it stops their login and their messages while keeping their name
// on the work they did. This is for a duplicate or a test account.
//
// The server refuses to delete your own account, or the last active admin,
// and says why — show the message rather than a generic failure.
export function deleteEmployee(id: string): Promise<void> {
  return request(`/api/employees/${id}`, { method: "DELETE" });
}

// Admin-only. Sets an employee's login, or replaces the one they have — both
// halves at once, since there's no password-reset email to fall back on if
// only one were changed. Fails with 409 if another employee already signs in
// with that email.
export function setEmployeeLogin(id: string, email: string, password: string): Promise<Employee> {
  return request(`/api/employees/${id}/login`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

// Admin-only. Takes sign-in access away and leaves the employee in place —
// they keep their name, their tasks and their WhatsApp messages.
export function removeEmployeeLogin(id: string): Promise<Employee> {
  return request(`/api/employees/${id}/login`, { method: "DELETE" });
}

// Anyone, for their own account. The current password is asked for even
// though the session already proves who this is — it's what stops a browser
// left logged in from being turned into a permanent takeover.
export function changeMyPassword(currentPassword: string, newPassword: string): Promise<void> {
  return postJson("/api/auth/change-password", { currentPassword, newPassword });
}

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: "admin" | "manager" | "member";
}

// Callers treat "not logged in" as a normal, expected state, not an error —
// so this swallows failures (401 or otherwise) rather than throwing.
export async function fetchCurrentUser(): Promise<CurrentUser | null> {
  try {
    return await request<CurrentUser>("/api/auth/me");
  } catch {
    return null;
  }
}

// Wrong password (401) is an expected outcome the caller shows inline, not
// an error state — only a genuine connection/server failure throws here.
export async function login(email: string, password: string): Promise<CurrentUser | null> {
  try {
    return await postJson<CurrentUser>("/api/auth/login", { email, password });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export function logout(): Promise<void> {
  return request("/api/auth/logout", { method: "POST" });
}

export interface ClientWhatsappGroup {
  id: string;
  groupId: string;
  groupName: string | null;
}

export interface Client {
  id: string;
  name: string;
  phone: string | null;
  // A client can be in more than one WhatsApp group (e.g. separate regional
  // or purpose-specific groups) — Send Report lets staff pick which one a
  // given message actually goes to when there's more than one.
  whatsappGroups: ClientWhatsappGroup[];
  notes: string | null;
  active: boolean;
  createdAt: string;
  // The Google Sheets this client's performance numbers are read from — one
  // per marketplace, since a client selling on Amazon and Flipkart has two
  // separate sets of figures. Empty means no reports can be sent for them.
  // Read-only from this app; nothing here writes to a sheet.
  reportSheets: ClientReportSheet[];
}

export interface ClientReportSheet {
  id: string;
  // A marketplace value from the admin-editable list — "amazon", "flipkart".
  marketplace: string;
  sheetUrl: string;
}

// One sheet per marketplace per client. Fails with 409 if this client already
// has one for that marketplace — remove it first to replace it, rather than
// having a link somebody set be silently overwritten.
export function addClientReportSheet(
  clientId: string,
  marketplace: string,
  sheetUrl: string
): Promise<ClientReportSheet> {
  return postJson(`/api/clients/${clientId}/report-sheets`, { marketplace, sheetUrl });
}

export function removeClientReportSheet(clientId: string, sheetId: string): Promise<void> {
  return request(`/api/clients/${clientId}/report-sheets/${sheetId}`, { method: "DELETE" });
}

export interface ClientOverview {
  client: Client;
  // Every task ever logged for this client, newest first — matched on the
  // client's name, their linked WhatsApp groups and their phone (see the
  // backend's taskRepository.listForClient), so a rename doesn't hide old
  // work. Same shape as fetchTasks() returns.
  tasks: Task[];
}

// Everything the Client Details screen shows, in one round trip.
export function fetchClientOverview(id: string): Promise<ClientOverview> {
  return request(`/api/clients/${id}/overview`);
}

export function fetchClients(): Promise<Client[]> {
  return request("/api/clients");
}

// Admin/manager-only: includes inactive clients so they can be reactivated.
export function fetchAllClients(): Promise<Client[]> {
  return request("/api/clients/all");
}

export function createClient(data: { name: string; phone?: string; notes?: string }): Promise<Client> {
  return postJson("/api/clients", data);
}

export interface UnrecognizedSender {
  chatId: string;
  chatName: string | null;
  messageCount: number;
  lastSeenAt: string;
}

// Senders (individuals or groups) that have sent a task: message but aren't
// tied to a client yet — their messages were logged here instead of becoming
// a task. Admin/manager assign these manually, nothing here is auto-matched.
export function fetchUnrecognizedSenders(): Promise<UnrecognizedSender[]> {
  return request("/api/clients/unrecognized");
}

// Dismisses a sender from the Unrecognized Senders list without linking them
// to a client. Not a permanent block — if this chat_id sends another
// task: message later, it's logged fresh and reappears in the list.
export function ignoreUnrecognizedSender(chatId: string): Promise<void> {
  return request(`/api/clients/unrecognized/${encodeURIComponent(chatId)}`, { method: "DELETE" });
}

export function sendClientUpdate(
  id: string,
  data: { phone: string; channel: "whapi" | "official"; message: string }
): Promise<{ sent: boolean }> {
  return postJson(`/api/clients/${id}/send-update`, data);
}

export function updateClient(
  id: string,
  changes: Partial<Pick<Client, "name" | "phone" | "notes" | "active">>
): Promise<Client> {
  return request(`/api/clients/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(changes),
  });
}

// Adds one more WhatsApp group to a client — a client can have several.
// Throws (409) if this chat_id is already linked to some client.
export function addClientWhatsappGroup(
  clientId: string,
  groupId: string,
  groupName?: string
): Promise<ClientWhatsappGroup> {
  return postJson(`/api/clients/${clientId}/groups`, { groupId, groupName });
}

export function removeClientWhatsappGroup(clientId: string, groupRowId: string): Promise<void> {
  return request(`/api/clients/${clientId}/groups/${groupRowId}`, { method: "DELETE" });
}

export interface ReportField {
  label: string;
  value: string;
}

export interface ReportSection {
  // e.g. "Weekly — July, Week 2" or "Daily — 2026-07-08" — which tab/period
  // this block of fields came from.
  source: string;
  fields: ReportField[];
  // Agreed columns this client's sheet has, but which are blank or hold a
  // spreadsheet error for this period, so they are not in the report. Shown
  // before anything is sent — a dropped column used to be invisible, and a set
  // of reports went out with Acos and T.Acos quietly missing.
  leftOut?: string[];
}

// Why a report came back with nothing in it — see EmptyReason in the backend's
// weeklyReportPreview.ts. Only "no_period_rows" actually means the sheet isn't
// filled in yet; the other two are the wrong sheet being linked, and formulas
// erroring inside a row that does exist.
export type EmptyReason = "no_tab" | "no_period_rows" | "no_agreed_columns";

export interface WeeklyReportPreview {
  week: number;
  month: string;
  sections: ReportSection[];
  // Set only when `sections` is empty.
  emptyReason?: EmptyReason;
  // The sheet's real tab names, sent with "no_tab" so the screen can name what
  // is actually in the file that was linked.
  tabsInSheet?: string[];
  // Daily reports only: the day the figures are actually for, worded as the
  // sheet writes it ("9 August"). Sheets are filled in a day or two behind, so
  // this is often an earlier day than the one asked for — which is why the
  // message is headed with this and not with the chosen date.
  dailyDate?: string;
}

// Reads one of this client's linked Google Sheets for the current week's
// numbers (see Client.reportSheets). Google allows the account only 60 sheet
// reads a minute and this screen reads one per client, so the backend holds
// what a tab contained for a minute — the figures are the sheet's own, and at
// most a minute old.
//
// `marketplace` picks which sheet. It can be left off only when the client has
// exactly one; with several linked the server refuses to guess rather than
// answering with the wrong marketplace's figures.
export function fetchWeeklyReportPreview(
  clientId: string,
  marketplace?: string
): Promise<WeeklyReportPreview> {
  const query = marketplace ? `?marketplace=${encodeURIComponent(marketplace)}` : "";
  return request(`/api/clients/${clientId}/weekly-report-preview${query}`);
}

// The three reports that can be sent to a client, each read from its own tab
// of that client's sheet: "Daily", "Weekly" and "SKU".
export type ReportKind = "daily" | "weekly_sales" | "weekly_sku" | "monthly";

export const REPORT_KIND_LABEL: Record<ReportKind, string> = {
  daily: "Daily Report",
  weekly_sales: "Weekly Sales Report",
  weekly_sku: "Weekly SKU Report",
  monthly: "Monthly Report",
};

// One specific report, rather than every tab at once like
// fetchWeeklyReportPreview. Empty sections means that tab isn't in the
// client's sheet, or has nothing for the period asked for yet.
//
// `date` (YYYY-MM-DD) is the day the report is about: it picks the day a
// daily report reads, and the week and month the other reports read. Left
// off, it is today.
// `marketplace` picks which of the client's sheets to read — see
// fetchWeeklyReportPreview.
export function fetchReportPreview(
  clientId: string,
  kind: ReportKind,
  date?: string,
  marketplace?: string
): Promise<WeeklyReportPreview> {
  const params = new URLSearchParams();
  if (date) params.set("date", date);
  if (marketplace) params.set("marketplace", marketplace);
  const query = params.toString() ? `?${params}` : "";
  return request(`/api/clients/${clientId}/report-preview/${kind}${query}`);
}

// Permanent — unlike updateClient(id, { active: false }), which is reversible.
export function deleteClient(id: string): Promise<void> {
  return request(`/api/clients/${id}`, { method: "DELETE" });
}

export type ConfigOptionCategory = "marketplace" | "status" | "task_type";

export interface ConfigOption {
  id: string;
  category: ConfigOptionCategory;
  value: string;
  label: string;
  sortOrder: number;
  active: boolean;
}

// Active options only, in display order — what every dropdown on the Task
// board reads. Any logged-in employee can call this.
export function fetchConfigOptions(category: ConfigOptionCategory): Promise<ConfigOption[]> {
  return request(`/api/config-options/${category}`);
}

// Admin-only: includes inactive options, for the Settings management view.
export function fetchAllConfigOptions(category: ConfigOptionCategory): Promise<ConfigOption[]> {
  return request(`/api/config-options/${category}/all`);
}

export function createConfigOption(category: ConfigOptionCategory, label: string): Promise<ConfigOption> {
  return postJson(`/api/config-options/${category}`, { label });
}

export function updateConfigOption(
  category: ConfigOptionCategory,
  id: string,
  changes: Partial<Pick<ConfigOption, "label" | "active">>
): Promise<ConfigOption> {
  return request(`/api/config-options/${category}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(changes),
  });
}
