import { useEffect, useState } from "react";
import {
  ApiError,
  ConfigOption,
  CurrentUser,
  Frequency,
  FREQUENCY_LABEL,
  RecurringTask,
  deleteRecurringTask,
  fetchConfigOptions,
  fetchRecurringTasks,
  updateRecurringTask,
} from "./api";
import Spinner from "./Spinner";
import ErrorBanner from "./ErrorBanner";
import MultiSelect from "./MultiSelect";
import Pagination, { usePaged } from "./Paged";
import { toLocalInputValue, fromLocalInputValue } from "./dateTimeInput";
import { SavedTick, saveOnEnter, useSavedFlash } from "./savedFlash";
import { useAutoRefresh } from "./useAutoRefresh";

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong. Try again.";
}

// The "No client" / "Not Set" option, told apart from an empty filter list —
// which means no filter at all, show everything. Same sentinel the board's
// filters use.
const UNSET = "__unset__";

// The day a repeat next lands on. Indexed to match getDay(), which counts from
// Sunday — so this list is in its order, not reading order.
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// The dropdown reads Monday first, the way the working week does. Sunday is
// last but still offered, because a repeat can be set for one.
const DAY_FILTER_ORDER = [1, 2, 3, 4, 5, 6, 0];

// Empty filter list means no filter. Several picked means any of them —
// narrowing as you tick more would make the second tick always show less,
// which is the opposite of what picking a second thing means.
function matchesAny(value: string | null, filters: string[]): boolean {
  if (filters.length === 0) return true;
  return filters.some((f) => (f === UNSET ? !value : value === f));
}

export default function RecurringTasks({ user }: { user: CurrentUser }) {
  const [repeats, setRepeats] = useState<RecurringTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [clientFilter, setClientFilter] = useState<string[]>([]);
  const [dayFilter, setDayFilter] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [taskTypeOptions, setTaskTypeOptions] = useState<ConfigOption[]>([]);
  const [marketplaceOptions, setMarketplaceOptions] = useState<ConfigOption[]>([]);
  const { savedKey, flash } = useSavedFlash();

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

  // Types are admin-editable, so the filter reads the same list the board's
  // does rather than a copy. A repeat stores the value; the label is what
  // belongs on screen. Failing to load them costs the labels, not the screen,
  // so this doesn't go through the error banner.
  useEffect(() => {
    fetchConfigOptions("task_type").then(setTaskTypeOptions).catch(() => {});
    fetchConfigOptions("marketplace").then(setMarketplaceOptions).catch(() => {});
  }, []);

  // The scheduler moves these on its own: every time a repeat fires, its
  // "Next one" and "Last one" change without anybody touching this screen.
  useAutoRefresh(async () => {
    setRepeats(await fetchRecurringTasks());
  }, 60_000);

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
      flash(repeat.id);
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

  // The day is the one the *next* one lands on, read off each repeat rather
  // than stored: a weekly repeat set for a Thursday stays on Thursdays, so the
  // day it next runs is the day it runs.
  const filteredRepeats = repeats.filter(
    (repeat) =>
      matchesAny(repeat.clientName, clientFilter) &&
      matchesAny(repeat.taskType, typeFilter) &&
      (dayFilter.length === 0 ||
        dayFilter.includes(String(new Date(repeat.nextRunAt).getDay())))
  );

  const pagedRepeats = usePaged(filteredRepeats, 10);

  // Every filter goes through here so page 3 of the old result doesn't survive
  // a narrower filter — the same reason the board's dropdowns reset it.
  function pickFilter(set: (values: string[]) => void, values: string[]) {
    set(values);
    pagedRepeats.reset();
  }

  const anyFilter = clientFilter.length > 0 || dayFilter.length > 0 || typeFilter.length > 0;

  function clearFilters() {
    setClientFilter([]);
    setDayFilter([]);
    setTypeFilter([]);
    pagedRepeats.reset();
  }

  // Only the clients that actually have something repeating: offering the full
  // client list would be a dropdown of sixty where eight can match.
  const clientOptions = Array.from(
    new Set(repeats.map((r) => r.clientName).filter((name): name is string => Boolean(name)))
  )
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ value: name, label: name }));

  const typeLabels = Object.fromEntries(taskTypeOptions.map((o) => [o.value, o.label]));
  const marketplaceLabels = Object.fromEntries(marketplaceOptions.map((o) => [o.value, o.label]));

  if (loading) return <Spinner label="Loading repeating tasks…" />;

  if (loadError) return <ErrorBanner message={loadError} onRetry={load} />;

  return (
    <>
      {actionError && <ErrorBanner message={actionError} onRetry={() => setActionError("")} />}

      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">Repeating Tasks</span>
          {/* Says both numbers while a filter is on, so a short table reads as
              "filtered" rather than as "most of them have gone". */}
          <span className="panel-sub">
            {anyFilter
              ? `${filteredRepeats.length} of ${repeats.length} set up`
              : `${repeats.length} set up`}
          </span>
        </div>
        <p className="tip">
          💡 These make a new task on their own, at the date and time set below — but only if the last one
          is done. If it is still open, no second copy is made and the person on it gets a WhatsApp
          reminder instead. To add one, go to Tasks and press “Repeat” on any task — you pick how often
          and when the first one should be. Changing or deleting the original task later does not change
          what gets made here. Changing “How often” does not move the next date — set that yourself.
        </p>
        <div className="panel-body">
          {repeats.length === 0 && (
            <p className="panel-sub">Nothing repeating yet.</p>
          )}

          {/* Type-to-search dropdowns, the same ones the board's filters use.
              Each takes as many values as you want to tick — two clients, or
              Monday and Thursday — and shows anything matching any of them. */}
          {repeats.length > 0 && (
            <div className="filter-row">
              <MultiSelect
                values={clientFilter}
                placeholder="All Clients"
                options={[...clientOptions, { value: UNSET, label: "No client" }]}
                onChange={(values) => pickFilter(setClientFilter, values)}
              />
              <MultiSelect
                values={dayFilter}
                placeholder="All Days"
                options={DAY_FILTER_ORDER.map((day) => ({
                  value: String(day),
                  label: DAY_NAMES[day],
                }))}
                onChange={(values) => pickFilter(setDayFilter, values)}
              />
              <MultiSelect
                values={typeFilter}
                placeholder="All Types"
                options={[
                  ...taskTypeOptions.map((o) => ({ value: o.value, label: o.label })),
                  { value: UNSET, label: "Not Set" },
                ]}
                onChange={(values) => pickFilter(setTypeFilter, values)}
              />
              {anyFilter && (
                <button className="btn btn-ghost btn-sm" onClick={clearFilters} type="button">
                  Clear filters
                </button>
              )}
            </div>
          )}

          {/* A filter that matches nothing needs saying so — an empty table
              under three dropdowns otherwise reads as everything being gone. */}
          {repeats.length > 0 && filteredRepeats.length === 0 && (
            <p className="panel-sub">Nothing matches those filters.</p>
          )}

          {filteredRepeats.length > 0 && (
            <>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Client</th>
                  {/* Two repeats can differ by nothing but this, so without
                      the column those rows read as the same row twice. */}
                  <th>Marketplace</th>
                  <th>Type</th>
                  <th>Employee</th>
                  <th>How often</th>
                  <th>Day</th>
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
                    <td>
                      {repeat.marketplace
                        ? marketplaceLabels[repeat.marketplace] ?? repeat.marketplace
                        : "—"}
                    </td>
                    {/* The stored value only shows if an admin has since
                        renamed or removed that type — better than a blank. */}
                    <td>{repeat.taskType ? typeLabels[repeat.taskType] ?? repeat.taskType : "—"}</td>
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
                    {/* Read off the next run rather than set on its own: move
                        the date and the day follows it, so the two can't
                        disagree. */}
                    <td>{DAY_NAMES[new Date(repeat.nextRunAt).getDay()]}</td>
                    <td>
                      {canManage ? (
                        <>
                          <input
                            className="field-input"
                            type="datetime-local"
                            defaultValue={toLocalInputValue(repeat.nextRunAt)}
                            onBlur={(e) => handleNextRunSave(repeat, e.target.value)}
                            onKeyDown={saveOnEnter}
                            style={{ width: 190 }}
                          />
                          <SavedTick show={savedKey === repeat.id} />
                        </>
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
            <Pagination paged={pagedRepeats} />
            </>
          )}
        </div>
      </div>
    </>
  );
}
