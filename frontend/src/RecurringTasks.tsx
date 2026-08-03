import { useEffect, useState } from "react";
import {
  ApiError,
  CurrentUser,
  Frequency,
  FREQUENCY_LABEL,
  RecurringTask,
  deleteRecurringTask,
  fetchRecurringTasks,
  updateRecurringTask,
} from "./api";
import Spinner from "./Spinner";
import ErrorBanner from "./ErrorBanner";
import Pagination, { usePaged } from "./Paged";
import { toLocalInputValue, fromLocalInputValue } from "./dateTimeInput";

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong. Try again.";
}

export default function RecurringTasks({ user }: { user: CurrentUser }) {
  const [repeats, setRepeats] = useState<RecurringTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");

  // Members can see why a task keeps coming back, but only admins and
  // managers can change or stop it — same rule the server enforces.
  const canManage = user.role === "admin" || user.role === "manager";

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      setRepeats(await fetchRecurringTasks());
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleToggle(repeat: RecurringTask) {
    setActionError("");
    try {
      const updated = await updateRecurringTask(repeat.id, { active: !repeat.active });
      setRepeats((prev) => prev.map((r) => (r.id === repeat.id ? updated : r)));
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  async function handleFrequency(repeat: RecurringTask, frequency: Frequency) {
    setActionError("");
    try {
      const updated = await updateRecurringTask(repeat.id, { frequency });
      setRepeats((prev) => prev.map((r) => (r.id === repeat.id ? updated : r)));
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  // The next run is a date the user owns, not something the app decides —
  // saved on blur, like the other inline edits on this app's tables.
  async function handleNextRunSave(repeat: RecurringTask, value: string) {
    const iso = fromLocalInputValue(value);
    if (!iso || iso === new Date(repeat.nextRunAt).toISOString()) return;
    setActionError("");
    try {
      const updated = await updateRecurringTask(repeat.id, { nextRunAt: iso });
      setRepeats((prev) => prev.map((r) => (r.id === repeat.id ? updated : r)));
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  async function handleDelete(repeat: RecurringTask) {
    if (!window.confirm(`Stop repeating "${repeat.description}"? Tasks already created stay on the board.`)) {
      return;
    }
    setActionError("");
    try {
      await deleteRecurringTask(repeat.id);
      setRepeats((prev) => prev.filter((r) => r.id !== repeat.id));
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  const pagedRepeats = usePaged(repeats, 10);

  if (loading) return <Spinner label="Loading repeating tasks…" />;

  if (loadError) return <ErrorBanner message={loadError} onRetry={load} />;

  return (
    <>
      {actionError && <ErrorBanner message={actionError} onRetry={() => setActionError("")} />}

      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">Repeating Tasks</span>
          <span className="panel-sub">{repeats.length} set up</span>
        </div>
        <p className="tip">
          💡 These make a new task on their own, at the date and time set below. To add one, go to Tasks
          and press “Repeat” on any task — you pick how often and when the first one should be. Changing
          or deleting the original task later does not change what gets made here. Changing “How often”
          does not move the next date — set that yourself.
        </p>
        <div className="panel-body">
          {repeats.length === 0 && (
            <p className="panel-sub">Nothing repeating yet.</p>
          )}

          {repeats.length > 0 && (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Client</th>
                  <th>Employee</th>
                  <th>How often</th>
                  <th>Next one</th>
                  <th>Last one</th>
                  <th>On or off</th>
                  {canManage && <th></th>}
                </tr>
              </thead>
              <tbody>
                {pagedRepeats.items.map((repeat) => (
                  <tr key={repeat.id} style={repeat.active ? undefined : { opacity: 0.55 }}>
                    <td>{repeat.description}</td>
                    <td>{repeat.clientName ?? "—"}</td>
                    <td>{repeat.assignee ?? "No employee"}</td>
                    <td>
                      {canManage ? (
                        <select
                          className="field-select"
                          value={repeat.frequency}
                          onChange={(e) => handleFrequency(repeat, e.target.value as Frequency)}
                        >
                          {(Object.keys(FREQUENCY_LABEL) as Frequency[]).map((freq) => (
                            <option key={freq} value={freq}>{FREQUENCY_LABEL[freq]}</option>
                          ))}
                        </select>
                      ) : (
                        FREQUENCY_LABEL[repeat.frequency]
                      )}
                    </td>
                    <td>
                      {canManage ? (
                        <input
                          className="field-input"
                          type="datetime-local"
                          defaultValue={toLocalInputValue(repeat.nextRunAt)}
                          onBlur={(e) => handleNextRunSave(repeat, e.target.value)}
                          style={{ width: 190 }}
                        />
                      ) : (
                        new Date(repeat.nextRunAt).toLocaleString()
                      )}
                      {!repeat.active && <div className="panel-sub">Turned off</div>}
                    </td>
                    <td>{repeat.lastRunAt ? new Date(repeat.lastRunAt).toLocaleString() : "Not yet"}</td>
                    <td>
                      {canManage ? (
                        <button className="btn btn-ghost btn-sm" onClick={() => handleToggle(repeat)}>
                          {repeat.active ? "Turn off" : "Turn on"}
                        </button>
                      ) : (
                        <span className={`pill ${repeat.active ? "pill-good" : "pill-neutral"}`}>
                          {repeat.active ? "On" : "Off"}
                        </span>
                      )}
                    </td>
                    {canManage && (
                      <td>
                        <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(repeat)}>
                          Delete
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
