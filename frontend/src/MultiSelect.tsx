import { useState } from "react";
import DropdownPanel from "./DropdownPanel";
import { SearchableSelectOption } from "./SearchableSelect";

// The same dropdown as SearchableSelect, but picking several at once — what
// the Task board's filters use. "Show me the listing work and the ads work"
// used to mean looking at one, then the other, because each filter held a
// single value.
//
// The panel stays open while options are ticked: choosing three things and
// having it shut after each one is the whole reason a multi-select is worth
// having. It closes on Escape, on the Done button, or by clicking away.
export default function MultiSelect({
  values,
  options,
  placeholder,
  onChange,
}: {
  /** Empty means no filter — every row shows. */
  values: string[];
  options: SearchableSelectOption[];
  /** Read on the trigger when nothing is picked, e.g. "All Employees". */
  placeholder: string;
  onChange: (values: string[]) => void;
}) {
  const [query, setQuery] = useState("");

  const filtered = query.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  function toggle(value: string) {
    onChange(
      values.includes(value) ? values.filter((v) => v !== value) : [...values, value]
    );
  }

  // One pick reads as itself; several would not fit the trigger, so the first
  // is named and the rest counted — "Amazon +2" says more than "3 chosen".
  // The full list is in the tooltip for when it matters.
  function triggerLabel(): string {
    if (values.length === 0) return placeholder;
    const chosen = values.map((v) => options.find((o) => o.value === v)?.label ?? v);
    return chosen.length === 1 ? chosen[0] : `${chosen[0]} +${chosen.length - 1}`;
  }

  return (
    <DropdownPanel
      label={triggerLabel()}
      triggerClassName={values.length > 0 ? "multi-select-active" : undefined}
      onClose={() => setQuery("")}
    >
      {({ close }) => (
        <>
          <input
            autoFocus
            className="field-input"
            type="text"
            placeholder="Search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
              // Enter ticks the top match and leaves the panel open, so
              // several can be typed in a row without touching the mouse.
              if (e.key === "Enter" && filtered.length > 0) {
                toggle(filtered[0].value);
                setQuery("");
              }
            }}
          />
          <ul className="searchable-select-list">
            {/* Clearing the filter, worded as what you get rather than as an
                instruction — the trigger reads the same thing when nothing
                is picked. */}
            <li
              className={`searchable-select-option ${values.length === 0 ? "selected" : ""}`}
              onClick={() => onChange([])}
            >
              {placeholder}
            </li>
            {filtered.map((o) => {
              const picked = values.includes(o.value);
              return (
                <li
                  key={o.value}
                  className={`searchable-select-option ${picked ? "selected" : ""}`}
                  onClick={() => toggle(o.value)}
                >
                  <span className={`multi-tick ${picked ? "on" : ""}`} aria-hidden="true">
                    {picked ? "✓" : ""}
                  </span>
                  {o.label}
                </li>
              );
            })}
            {filtered.length === 0 && <li className="searchable-select-empty">No matches</li>}
          </ul>
          <div className="multi-select-foot">
            <span className="panel-sub">
              {values.length === 0 ? "Showing everything" : `${values.length} picked`}
            </span>
            <button className="btn btn-ghost btn-sm" type="button" onClick={close}>
              Done
            </button>
          </div>
        </>
      )}
    </DropdownPanel>
  );
}
