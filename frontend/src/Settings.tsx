import { useEffect, useState } from "react";
import {
  ConfigOption,
  ConfigOptionCategory,
  ApiError,
  fetchAllConfigOptions,
  createConfigOption,
  updateConfigOption,
} from "./api";
import Spinner from "./Spinner";
import ErrorBanner from "./ErrorBanner";

const CATEGORIES: { key: ConfigOptionCategory; title: string; addPlaceholder: string }[] = [
  { key: "marketplace", title: "Marketplace", addPlaceholder: "New marketplace name" },
  { key: "status", title: "Status", addPlaceholder: "New status name" },
  { key: "task_type", title: "Task Type", addPlaceholder: "New task type name" },
];

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong. Try again.";
}

function CategoryPanel({ category, title, addPlaceholder }: { category: ConfigOptionCategory; title: string; addPlaceholder: string }) {
  const [options, setOptions] = useState<ConfigOption[]>([]);
  const [newLabel, setNewLabel] = useState("");
  const [labelDrafts, setLabelDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      setOptions(await fetchAllConfigOptions(category));
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const label = newLabel.trim();
    if (!label) return;
    setActionError("");
    try {
      const option = await createConfigOption(category, label);
      setOptions((prev) => [...prev, option]);
      setNewLabel("");
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  async function handleLabelSave(option: ConfigOption) {
    const label = (labelDrafts[option.id] ?? option.label).trim();
    if (!label || label === option.label) return;
    setActionError("");
    try {
      const updated = await updateConfigOption(category, option.id, { label });
      setOptions((prev) => prev.map((o) => (o.id === option.id ? updated : o)));
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  async function handleActiveToggle(option: ConfigOption, active: boolean) {
    setActionError("");
    try {
      const updated = await updateConfigOption(category, option.id, { active });
      setOptions((prev) => prev.map((o) => (o.id === option.id ? updated : o)));
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  if (loading) return <Spinner label={`Loading ${title.toLowerCase()} options…`} />;

  if (loadError) return <ErrorBanner message={loadError} onRetry={load} />;

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">{title}</span>
        <span className="panel-sub">{options.length} total</span>
      </div>
      <div className="panel-body">
        {actionError && <ErrorBanner message={actionError} onRetry={() => setActionError("")} />}

        <form className="add-employee" onSubmit={handleAdd}>
          <input
            className="field-input"
            type="text"
            placeholder={addPlaceholder}
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
          />
          <button className="btn btn-primary" type="submit">Add</button>
        </form>

        <table className="data-table">
          <thead>
            <tr>
              <th>Label</th>
              <th>Active</th>
            </tr>
          </thead>
          <tbody>
            {options.map((option) => (
              <tr key={option.id}>
                <td>
                  <input
                    className="field-input"
                    type="text"
                    value={labelDrafts[option.id] ?? option.label}
                    onChange={(e) => setLabelDrafts((prev) => ({ ...prev, [option.id]: e.target.value }))}
                    onBlur={() => handleLabelSave(option)}
                  />
                </td>
                <td>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => handleActiveToggle(option, !option.active)}
                  >
                    {option.active ? "Deactivate" : "Reactivate"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Settings() {
  return (
    <>
      {CATEGORIES.map((c) => (
        <CategoryPanel key={c.key} category={c.key} title={c.title} addPlaceholder={c.addPlaceholder} />
      ))}
    </>
  );
}
