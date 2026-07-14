import { useEffect, useState } from "react";
import { Task, fetchTasks, updateTask } from "./api";

// Placeholder until an employee-management screen exists; swap for a real
// fetched list before go-live.
const EMPLOYEES = ["Unassigned", "Priya", "Rahul", "Anjali"];

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setTasks(await fetchTasks());
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleAssigneeChange(task: Task, assignee: string) {
    const updated = await updateTask(task.id, { assignee });
    setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)));
  }

  async function handleStatusChange(task: Task, status: Task["status"]) {
    const updated = await updateTask(task.id, { status });
    setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)));
  }

  return (
    <main className="page">
      <h1>Task Dashboard</h1>

      {loading ? (
        <p>Loading…</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Task</th>
              <th>Source</th>
              <th>Assignee</th>
              <th>Status</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr key={task.id}>
                <td>{task.description}</td>
                <td>{task.source}</td>
                <td>
                  <select
                    value={task.assignee ?? "Unassigned"}
                    onChange={(e) => handleAssigneeChange(task, e.target.value)}
                  >
                    {EMPLOYEES.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    value={task.status}
                    onChange={(e) => handleStatusChange(task, e.target.value as Task["status"])}
                  >
                    <option value="new">New</option>
                    <option value="in_progress">In Progress</option>
                    <option value="done">Done</option>
                  </select>
                </td>
                <td>{new Date(task.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
