import { useEffect, useRef } from "react";

// How often a screen quietly re-reads its data while it is open.
//
// Every screen in this app used to load once, when it was opened, and never
// again. Tasks arrive over WhatsApp all day and three people share the same
// board, so the only way to see anything new — or anything a colleague had
// just changed — was to press F5. That is what this replaces.
export const DEFAULT_REFRESH_MS = 30_000;

/**
 * Re-runs `refresh` on a timer while the screen is open, and again the moment
 * the tab comes back to the front.
 *
 * `refresh` must be the *quiet* kind of load: no spinner, and no error banner
 * on failure. A background read that fails should leave the working screen
 * exactly as it was and let the next tick try again — replacing a full board
 * with "Something went wrong" because one poll timed out would be worse than
 * the staleness this is here to fix.
 */
export function useAutoRefresh(refresh: () => Promise<void>, intervalMs = DEFAULT_REFRESH_MS): void {
  // Kept in a ref because a screen builds a new `refresh` closure on every
  // render. Without this, every keystroke in any field on the screen would
  // tear down the timer and start a fresh one, so a screen being typed into
  // would never actually reach a tick.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    let stopped = false;
    let running = false;

    async function run() {
      // Nothing while the tab is in the background: the person isn't looking,
      // and the refresh on the way back is what they'd actually notice. It
      // also keeps a forgotten open tab from calling the backend all night.
      if (stopped || running || document.hidden) return;
      running = true;
      try {
        await refreshRef.current();
      } catch {
        // Deliberately swallowed — see the note above about failures.
      } finally {
        running = false;
      }
    }

    const timer = window.setInterval(run, intervalMs);

    // Coming back to the tab is when stale data is most obvious, and the wait
    // for the next tick is exactly what sends someone to the refresh button.
    // Both events are listened for because they don't fire together: switching
    // browser tabs is a visibility change, switching to another window is a
    // focus change.
    const onBackToScreen = () => {
      if (!document.hidden) run();
    };
    document.addEventListener("visibilitychange", onBackToScreen);
    window.addEventListener("focus", onBackToScreen);

    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onBackToScreen);
      window.removeEventListener("focus", onBackToScreen);
    };
  }, [intervalMs]);
}
