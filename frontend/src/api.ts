// Empty by default so relative /api paths work through the Vite dev proxy
// (see vite.config.ts). In production, set VITE_API_BASE_URL to the deployed
// backend's origin, since the frontend and backend live on different domains.
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export class ApiError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

// Network failures (offline, DNS, CORS) throw before a Response even exists —
// wrapped here so every caller sees the same ApiError shape either way.
// 401 is deliberately generic here ("not authorized") rather than assuming
// "session expired" — that interpretation is only right for already-logged-in
// routes, not for /auth/login itself, where 401 means "wrong password".
// Callers that need to tell those apart check err.status themselves.
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { credentials: "include", ...init });
  } catch {
    throw new ApiError("Couldn't reach the server. Check your connection and try again.");
  }

  if (!res.ok) {
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

export interface Task {
  id: string;
  source: string;
  sourceRef: string;
  description: string;
  clientName: string | null;
  assignee: string | null;
  status: "new" | "in_progress" | "done";
  createdAt: string;
  doneAt: string | null;
}

export function fetchTasks(): Promise<Task[]> {
  return request("/api/tasks");
}

export function updateTask(id: string, changes: Partial<Pick<Task, "assignee" | "status">>): Promise<Task> {
  return request(`/api/tasks/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(changes),
  });
}

export interface Employee {
  id: string;
  name: string;
  active: boolean;
}

export function fetchEmployees(): Promise<Employee[]> {
  return request("/api/employees");
}

export function createEmployee(name: string): Promise<Employee> {
  return postJson("/api/employees", { name });
}

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: "admin" | "supervisor" | "member";
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

export function sendReportLink(id: string, phone: string, channel: "whapi" | "official"): Promise<ReportLink> {
  return postJson(`/api/report-links/${id}/send`, { phone, channel });
}
