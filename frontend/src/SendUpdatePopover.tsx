import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SendableTaskField } from "./api";

export interface SendableField {
  key: SendableTaskField;
  label: string;
  // Current display value, shown next to the checkbox so staff can see
  // exactly what a field would send before picking it — e.g. "Employee:
  // Priya" — instead of just an abstract field name.
  value: string;
}

// A per-task "send whatever's useful" button — separate from the automatic
// WhatsApp notification that already fires on every status change. Staff
// pick any mix of fields (marketplace, employee, due date, etc.) and send
// them as one message, whenever it's worth telling a client something that
// isn't a status change.
//
// Same portal + fixed-position pattern as SearchableSelect (see that file's
// comment) — escapes the Task table so it isn't clipped.
export default function SendUpdatePopover({
  fields,
  onSend,
}: {
  fields: SendableField[];
  onSend: (keys: SendableTaskField[]) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRectRef = useRef<DOMRect | null>(null);

  function close() {
    setOpen(false);
    setChecked({});
    setSent(false);
  }

  function openPanel() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      triggerRectRef.current = rect;
      setPanelPos({ top: rect.bottom + 4, left: rect.right - 260 });
    }
    setOpen(true);
  }

  // Same reasoning as SearchableSelect's identical effect: flip the panel
  // above the trigger once its real height is known, if a row near the
  // bottom of the page would otherwise open it off the edge of the viewport.
  useLayoutEffect(() => {
    if (!open || !panelRef.current || !triggerRectRef.current) return;
    const trigger = triggerRectRef.current;
    const panelHeight = panelRef.current.getBoundingClientRect().height;
    const spaceBelow = window.innerHeight - trigger.bottom;
    const spaceAbove = trigger.top;
    if (spaceBelow < panelHeight + 8 && spaceAbove > panelHeight + 8) {
      setPanelPos((prev) => ({ ...prev, top: trigger.top - panelHeight - 4 }));
    }
  }, [open]);

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

  const selectedKeys = fields.filter((f) => checked[f.key]).map((f) => f.key);

  async function handleSend() {
    setSending(true);
    try {
      const ok = await onSend(selectedKeys);
      if (ok) {
        setSent(true);
        setTimeout(close, 1200);
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => (open ? close() : openPanel())}
      >
        Send
      </button>
      {open &&
        createPortal(
          <div ref={panelRef} className="send-update-panel" style={{ top: panelPos.top, left: panelPos.left }}>
            <div className="send-update-title">Send WhatsApp update</div>
            <ul className="send-update-fields">
              {fields.map((f) => (
                <li key={f.key}>
                  <label>
                    <input
                      type="checkbox"
                      checked={!!checked[f.key]}
                      onChange={() => setChecked((prev) => ({ ...prev, [f.key]: !prev[f.key] }))}
                    />
                    <span className="send-update-field-label">{f.label}:</span> {f.value}
                  </label>
                </li>
              ))}
            </ul>
            <button
              className={`btn btn-sm ${selectedKeys.length === 0 ? "btn-ghost" : "btn-primary"}`}
              disabled={selectedKeys.length === 0 || sending}
              onClick={handleSend}
            >
              {sending ? "Sending…" : sent ? "Sent ✓" : "Send"}
            </button>
          </div>,
          document.body
        )}
    </>
  );
}
