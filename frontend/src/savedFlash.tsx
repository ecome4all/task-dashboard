import { useCallback, useEffect, useRef, useState } from "react";

// Inline fields on this app's tables save themselves — a phone number, a name,
// a label — and until now they did it completely silently. You typed, you
// clicked away, and nothing on screen changed. The only way to find out
// whether it had stuck was to reload the page and look, which is a large part
// of why this app felt like it needed constant refreshing.
//
// One key at a time is enough: a person edits one box, then the next.

/** ~how long "Saved" stays up. Long enough to read, short enough not to linger. */
const FLASH_MS = 1600;

export function useSavedFlash(ms = FLASH_MS) {
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const flash = useCallback(
    (key: string) => {
      window.clearTimeout(timer.current);
      setSavedKey(key);
      timer.current = window.setTimeout(() => setSavedKey(null), ms);
    },
    [ms]
  );

  // A row deleted while its "Saved" was still showing would otherwise leave a
  // timer running against a component that no longer exists.
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return { savedKey, flash };
}

export function SavedTick({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span className="saved-tick" role="status">
      Saved
    </span>
  );
}

/**
 * Enter saves, the same as clicking away does.
 *
 * These fields save on blur, which is the right moment (saving per keystroke
 * would be a request per digit) but not an obvious one — pressing Enter and
 * seeing nothing happen reads as "it didn't save". This routes Enter into the
 * same single save path rather than adding a second one.
 */
export function saveOnEnter(e: React.KeyboardEvent<HTMLInputElement>): void {
  if (e.key === "Enter") e.currentTarget.blur();
}
