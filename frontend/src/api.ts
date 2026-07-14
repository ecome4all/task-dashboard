// Empty by default so relative /api paths work through the Vite dev proxy
// (see vite.config.ts). In production, set VITE_API_BASE_URL to the deployed
// backend's origin, since the frontend and backend live on different domains.
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";
const BASE_OPTS: RequestInit = { credentials: "include" };

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

export async function fetchTasks(): Promise<Task[]> {
  const res = await fetch(`${API_BASE}/api/tasks`, BASE_OPTS);
  return res.json();
}

export async function updateTask(id: string, changes: Partial<Pick<Task, "assignee" | "status">>): Promise<Task> {
  const res = await fetch(`${API_BASE}/api/tasks/${id}`, {
    ...BASE_OPTS,
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(changes),
  });
  return res.json();
}

export interface Employee {
  id: string;
  name: string;
  active: boolean;
}

export async function fetchEmployees(): Promise<Employee[]> {
  const res = await fetch(`${API_BASE}/api/employees`, BASE_OPTS);
  return res.json();
}

export async function createEmployee(name: string): Promise<Employee> {
  const res = await fetch(`${API_BASE}/api/employees`, {
    ...BASE_OPTS,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return res.json();
}

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
}

export async function fetchCurrentUser(): Promise<CurrentUser | null> {
  const res = await fetch(`${API_BASE}/api/auth/me`, BASE_OPTS);
  if (!res.ok) return null;
  return res.json();
}

export async function login(email: string, password: string): Promise<CurrentUser | null> {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    ...BASE_OPTS,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) return null;
  return res.json();
}

export async function logout(): Promise<void> {
  await fetch(`${API_BASE}/api/auth/logout`, { ...BASE_OPTS, method: "POST" });
}
