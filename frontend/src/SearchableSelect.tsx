import { useEffect, useRef, useState } from "react";

export interface SearchableSelectOption {
  value: string;
  label: string;
}

// A dropdown with a search box, for pickers whose option list can grow
// past what's comfortable to scan in a plain <select> — Marketplace,
// Status, Task Type, and Employee all use this on the Task board now that
// the first three are admin-editable lists.
export default function SearchableSelect({
  value,
  options,
  placeholder,
  onChange,
  allowClear = true,
}: {
  value: string;
  options: SearchableSelectOption[];
  placeholder: string;
  onChange: (value: string) => void;
  allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  function select(newValue: string) {
    onChange(newValue);
    setOpen(false);
    setQuery("");
  }

  const selected = options.find((o) => o.value === value);
  const filtered = query.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  return (
    <div className="searchable-select" ref={containerRef}>
      <button
        type="button"
        className="field-select searchable-select-trigger"
        onClick={() => setOpen((prev) => !prev)}
      >
        {selected?.label ?? placeholder}
      </button>
      {open && (
        <div className="searchable-select-panel">
          <input
            ref={searchRef}
            className="field-input"
            type="text"
            placeholder="Search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { setOpen(false); setQuery(""); }
              if (e.key === "Enter" && filtered.length === 1) select(filtered[0].value);
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
        </div>
      )}
    </div>
  );
}
