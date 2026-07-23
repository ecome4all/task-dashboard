import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface SearchableSelectOption {
  value: string;
  label: string;
}

// A dropdown with a search box, for pickers whose option list can grow
// past what's comfortable to scan in a plain <select> — Marketplace,
// Status, Task Type, and Employee all use this on the Task board now that
// the first three are admin-editable lists.
//
// The open panel renders through a portal at document.body with fixed
// positioning computed from the trigger's on-screen position, instead of
// being a normal absolutely-positioned child. The Task table scrolls
// horizontally (see .table-scroll in styles.css), and a plain absolute
// child would get clipped by that scroll container — a portal escapes it.
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
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  function close() {
    setOpen(false);
    setQuery("");
  }

  function openPanel() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setPanelPos({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 200) });
    }
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (
        triggerRef.current && !triggerRef.current.contains(target) &&
        panelRef.current && !panelRef.current.contains(target)
      ) {
        close();
      }
    }
    // The Task table scrolls independently of the page — if that scroll
    // (or a window resize) happens while open, the panel's position would
    // go stale, so just close it rather than trying to track it live.
    function handleScrollOrResize() {
      close();
    }
    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [open]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  function select(newValue: string) {
    onChange(newValue);
    close();
  }

  const selected = options.find((o) => o.value === value);
  const filtered = query.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`field-select searchable-select-trigger ${triggerClassName ?? ""}`}
        onClick={() => (open ? close() : openPanel())}
      >
        {selected?.label ?? placeholder}
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            className="searchable-select-panel"
            style={{ top: panelPos.top, left: panelPos.left, width: panelPos.width }}
          >
            <input
              ref={searchRef}
              className="field-input"
              type="text"
              placeholder="Search…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") close();
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
          </div>,
          document.body
        )}
    </>
  );
}
