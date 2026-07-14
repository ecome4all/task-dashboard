import { useEffect, useState } from "react";
import { Task, Employee, fetchTasks, updateTask, fetchEmployees, createEmployee } from "./api";

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [newEmployeeName, setNewEmployeeName] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const [taskList, employeeList] = await Promise.all([fetchTasks(), fetchEmployees()]);
    setTasks(taskList);
    setEmployees(employeeList);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleAddEmployee(e: React.FormEvent) {
    e.preventDefault();
    const name = newEmployeeName.trim();
    if (!name) return;
    const employee = await createEmployee(name);
    setEmployees((prev) => [...prev, employee].sort((a, b) => a.name.localeCompare(b.name)));
    setNewEmployeeName("");
  }

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
        <>
        <form className="add-employee" onSubmit={handleAddEmployee}>
          <input
            type="text"
            placeholder="Add employee name"
            value={newEmployeeName}
            onChange={(e) => setNewEmployeeName(e.target.value)}
          />
          <button type="submit">Add</button>
        </form>
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
                    value={task.assignee ?? ""}
                    onChange={(e) => handleAssigneeChange(task, e.target.value)}
                  >
                    <option value="">Unassigned</option>
                    {employees.map((employee) => (
                      <option key={employee.id} value={employee.name}>
                        {employee.name}
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
        </>
      )}
    </main>
  );
}
