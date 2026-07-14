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
  const res = await fetch("/api/tasks");
  return res.json();
}

export async function updateTask(id: string, changes: Partial<Pick<Task, "assignee" | "status">>): Promise<Task> {
  const res = await fetch(`/api/tasks/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(changes),
  });
  return res.json();
}
