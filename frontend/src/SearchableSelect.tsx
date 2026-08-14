import { useState } from "react";
import DropdownPanel from "./DropdownPanel";

export interface SearchableSelectOption {
  value: string;
  label: string;
}

// A dropdown with a search box, for pickers whose option list can grow
// past what's comfortable to scan in a plain <select> — Marketplace,
// Status, Task Type, and Employee all use this on the Task board now that
// the first three are admin-editable lists.
//
// Picks exactly one. MultiSelect is the same control for picking several,
// and both sit on DropdownPanel, which owns the trigger and the floating
// panel's positioning.
export default function SearchableSelect({
  value,
  options,
  placeholder,
  onChange,
  allowClear = true,
  triggerClassName,
}: {
  value: string;
  options: SearchableSelectOption[];
  placeholder: string;
  onChange: (value: string) => void;
  allowClear?: boolean;
  // Extra class(es) for the trigger button — e.g. to color-code it by the
  // selected value (see the Task board's Status column, which colors the
  // dropdown itself instead of showing a separate pill next to it).
  triggerClassName?: string;
}) {
  const [query, setQuery] = useState("");

  const selected = options.find((o) => o.value === value);
  const filtered = query.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  return (
    <DropdownPanel
      label={selected?.label ?? placeholder}
      triggerClassName={triggerClassName}
      onClose={() => setQuery("")}
    >
      {({ close }) => {
        function select(newValue: string) {
          onChange(newValue);
          close();
        }
        return (
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
                // Enter takes the top match, not only an only-match: typing
                // "trac" and pressing Enter should pick Tracker without
                // having to reach for the mouse, even while "Tracking" is
                // still on the list below it.
                if (e.key === "Enter" && filtered.length > 0) select(filtered[0].value);
              }}
            />
            <ul className="searchable-select-list">
              {allowClear && (
                <li className="searchable-select-option" onClick={() => select("")}>
                  {placeholder}
                </li>
              )}
              {filtered.map((o) => (
                <li
                  key={o.value}
                  className={`searchable-select-option ${o.value === value ? "selected" : ""}`}
                  onClick={() => select(o.value)}
                >
                  {o.label}
                </li>
              ))}
              {filtered.length === 0 && <li className="searchable-select-empty">No matches</li>}
            </ul>
          </>
        );
      }}
    </DropdownPanel>
  );
}
