// Empty by default so relative /api paths work through the Vite dev proxy
// (see vite.config.ts). In production, set VITE_API_BASE_URL to the deployed
// backend's origin, since the frontend and backend live on different domains.
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export class ApiError extends Error {
  constructor(message: string, public status?: number) {
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
    throw new ApiError(`Something went wrong (${res.status}). Try again.`, res.status);
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
}

export interface TaskNote {
  id: string;
  taskId: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
}

// Oldest first — a note thread reads top to bottom.
export function fetchTaskNotes(taskId: string): Promise<TaskNote[]> {
  return request(`/api/tasks/${taskId}/notes`);
}

export function addTaskNote(taskId: string, body: string): Promise<TaskNote> {
  return postJson(`/api/tasks/${taskId}/notes`, { body });
}

// Only the person who wrote a note (or an admin) can remove it — enforced
// server-side too, not just by hiding the button.
export function deleteTaskNote(taskId: string, noteId: string): Promise<void> {
  return request(`/api/tasks/${taskId}/notes/${noteId}`, { method: "DELETE" });
}

export type Frequency = "daily" | "weekly" | "monthly";

export const FREQUENCY_LABEL: Record<Frequency, string> = {
  daily: "Every day",
  weekly: "Every week",
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
export function createRecurringTask(taskId: string, frequency: Frequency): Promise<RecurringTask> {
  return postJson("/api/recurring-tasks", { taskId, frequency });
}

export function updateRecurringTask(
  id: string,
  changes: { active?: boolean; frequency?: Frequency }
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
  // WhatsApp number for the daily "your open work" reminder. Empty means
  // this employee just doesn't get reminders.
  phone: string | null;
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
  // Google Sheet the client tracks their own performance numbers in — see
  // fetchWeeklyReportPreview. Read-only from this app; nothing here writes
  // to it.
  reportSheetUrl: string | null;
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
  changes: Partial<Pick<Client, "name" | "phone" | "notes" | "active" | "reportSheetUrl">>
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
}

export interface WeeklyReportPreview {
  week: number;
  month: string;
  sections: ReportSection[];
}

// Live-reads this client's linked Google Sheet for the current week's
// numbers (see Client.reportSheetUrl) — no caching, always reflects
// whatever's currently in the sheet.
export function fetchWeeklyReportPreview(clientId: string): Promise<WeeklyReportPreview> {
  return request(`/api/clients/${clientId}/weekly-report-preview`);
}

// The three reports that can be sent to a client, each read from its own tab
// of that client's sheet: "Daily", "Weekly" and "SKU".
export type ReportKind = "daily" | "weekly_sales" | "weekly_sku";

export const REPORT_KIND_LABEL: Record<ReportKind, string> = {
  daily: "Daily Report",
  weekly_sales: "Weekly Sales Report",
  weekly_sku: "Weekly SKU Report",
};

// One specific report, rather than every tab at once like
// fetchWeeklyReportPreview. Empty sections means that tab isn't in the
// client's sheet, or has nothing for the current period yet.
export function fetchReportPreview(clientId: string, kind: ReportKind): Promise<WeeklyReportPreview> {
  return request(`/api/clients/${clientId}/report-preview/${kind}`);
}

// Permanent — unlike updateClient(id, { active: false }), which is reversible.
export function deleteClient(id: string): Promise<void> {
  return request(`/api/clients/${id}`, { method: "DELETE" });
}

export interface ReportLink {
  id: string;
  description: string;
  url: string;
  createdBy: string;
  createdAt: string;
  lastSentAt: string | null;
}

export function fetchReportLinks(): Promise<ReportLink[]> {
  return request("/api/report-links");
}

export function createReportLink(description: string, url: string): Promise<ReportLink> {
  return postJson("/api/report-links", { description, url });
}

// A saved link no longer sends its own WhatsApp message — it's attached
// into the single combined message composed on the Send Report screen,
// which sends via sendClientUpdate. This just records that it was used,
// for the "Last sent" column.
export function markReportLinkSent(id: string): Promise<ReportLink> {
  return postJson(`/api/report-links/${id}/mark-sent`, {});
}

// Permanent — a saved link is only ever read to compose a message, so
// removing one doesn't affect any report already sent.
export function deleteReportLink(id: string): Promise<void> {
  return request(`/api/report-links/${id}`, { method: "DELETE" });
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
