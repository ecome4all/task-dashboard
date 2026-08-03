import { useEffect, useState } from "react";
import {
  ApiError,
  CurrentUser,
  TaskNote,
  addTaskNote,
  deleteTaskNote,
  fetchTaskNotes,
} from "./api";
import Spinner from "./Spinner";

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong. Try again.";
}

// The note thread for one task, shown in a row that opens underneath it on
// the task board. Loads its own notes on open rather than the board loading
// every task's notes up front — most rows are never opened.
export default function TaskNotes({
  taskId,
  user,
  readOnly = false,
  onCountChange,
}: {
  taskId: string;
  user: CurrentUser;
  readOnly?: boolean;
  onCountChange?: (count: number) => void;
}) {
  const [notes, setNotes] = useState<TaskNote[] | null>(null);
  const [draft, setDraft] = useState("");
  const [alsoSend, setAlsoSend] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchTaskNotes(taskId)
      .then((list) => {
        if (!cancelled) setNotes(list);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  async function handleAdd() {
    const body = draft.trim();
    if (!body) return;
    setSaving(true);
    setError("");
    try {
      const note = await addTaskNote(taskId, body, alsoSend);
      setNotes((prev) => {
        const next = [...(prev ?? []), note];
        onCountChange?.(next.length);
        return next;
      });
      setDraft("");
      // The note saved, but WhatsApp didn't take it. Say so plainly rather
      // than leaving someone thinking the client has been told.
      if (alsoSend && !note.sentAt) {
        setError("Note saved, but it could not be sent to WhatsApp. Try sending it another way.");
      }
      setAlsoSend(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(note: TaskNote) {
    if (!window.confirm("Delete this note?")) return;
    setError("");
    try {
      await deleteTaskNote(taskId, note.id);
      setNotes((prev) => {
        const next = (prev ?? []).filter((n) => n.id !== note.id);
        onCountChange?.(next.length);
        return next;
      });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (notes === null && !error) return <Spinner label="Loading notes…" />;

  return (
    <div className="note-thread">
      {error && <div className="note-error">{error}</div>}

      {notes && notes.length === 0 && <p className="panel-sub">No notes yet.</p>}

      {notes?.map((note) => (
        <div key={note.id} className="note">
          <div className="note-head">
            <span className="note-author">{note.authorName}</span>
            <span className="note-time">{new Date(note.createdAt).toLocaleString()}</span>
            {note.sentAt ? (
              <span className="note-sent" title={`Sent to the group on ${new Date(note.sentAt).toLocaleString()}`}>
                Sent to client ✓
              </span>
            ) : (
              <span className="note-internal">Team only</span>
            )}
            {/* Server enforces this too — an admin, or the person who wrote it. */}
            {(note.authorId === user.id || user.role === "admin") && (
              <button className="note-delete" onClick={() => handleDelete(note)} type="button">
                Delete
              </button>
            )}
          </div>
          <div className="note-body">{note.body}</div>
        </div>
      ))}

      {!readOnly && (
        <div className="note-add">
          <textarea
            className="field-input"
            rows={2}
            placeholder="Write a note for the team"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="note-add-actions">
            <label className="note-send-toggle">
              <input type="checkbox" checked={alsoSend} onChange={(e) => setAlsoSend(e.target.checked)} />
              Also send to the client on WhatsApp
            </label>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleAdd}
              disabled={saving || !draft.trim()}
              type="button"
            >
              {saving ? (alsoSend ? "Sending…" : "Saving…") : alsoSend ? "Add and send" : "Add note"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
