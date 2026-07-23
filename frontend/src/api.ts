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
    // A 401 from anywhere else only happens once requireAuth, which already
    // let the user load this screen, starts rejecting the same cookie — i.e.
    // the session expired or was invalidated since.
    if (res.status === 401 && path !== "/api/auth/login") {
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

export interface Employee {
  id: string;
  name: string;
  role: "admin" | "manager" | "member";
  active: boolean;
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

export function updateEmployee(
  id: string,
  changes: Partial<Pick<Employee, "role" | "active">>
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

export interface Client {
  id: string;
  name: string;
  phone: string | null;
  whatsappGroupId: string | null;
  whatsappGroupName: string | null;
  notes: string | null;
  active: boolean;
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

export function sendClientUpdate(
  id: string,
  data: { phone: string; channel: "whapi" | "official"; message: string }
): Promise<{ sent: boolean }> {
  return postJson(`/api/clients/${id}/send-update`, data);
}

export function updateClient(
  id: string,
  changes: Partial<Pick<Client, "name" | "phone" | "whatsappGroupId" | "whatsappGroupName" | "notes" | "active">>
): Promise<Client> {
  return request(`/api/clients/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(changes),
  });
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
