// Countdown cues for the Lending desk's live borrower auction.
//
// The auction is server-timed: the customer's browser never decides when the
// countdown ends, it only mirrors the server's `remainingSeconds`. This module
// is deliberately tiny and pure so the cue cadence can be tested without a
// browser, and it reuses the platform's bundled notification sounds (the same
// files the sound policy selects) rather than shipping new audio.

export type LendingCountdownCue = "tick" | "final";

/** The last N seconds of an auction, where a cue plays on each remaining second. */
export const LENDING_COUNTDOWN_WINDOW_SECONDS = 10;

/** Urgent pulse for the ticking seconds; the bright bell marks the final second. */
export const LENDING_TICK_SRC = "/sounds/notification-urgent-pulse.wav";
export const LENDING_FINAL_SRC = "/sounds/notification-bright-bell.wav";

/**
 * Decide which countdown cue (if any) to play for a given remaining-seconds mark.
 * Returns the cue and the whole second it belongs to so the caller can avoid
 * playing the same second twice when the poll re-renders. Returns null when
 * audio should stay silent (outside the window, at zero, or already cued).
 */
export function lendingCountdownCue(
  remainingSeconds: number | null | undefined,
  lastCuedSecond: number | null | undefined,
): { cue: LendingCountdownCue; second: number } | null {
  const seconds = Number(remainingSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds > LENDING_COUNTDOWN_WINDOW_SECONDS) return null;
  const second = Math.floor(seconds);
  if (lastCuedSecond === second) return null;
  return { cue: second <= 3 ? "final" : "tick", second };
}

/** The bundled source that should play for a cue. */
export function lendingCueSource(cue: LendingCountdownCue): string {
  return cue === "final" ? LENDING_FINAL_SRC : LENDING_TICK_SRC;
}

/**
 * A minimal, fire-and-forget player. Playback is gated by the CALLER (the
 * customer's sound opt-in and the administrator sound policy), so this helper
 * only ever tries to play and swallows a blocked/rejected play().
 */
export function createLendingAuctionAudio(
  createAudio: (src: string) => HTMLAudioElement = (src) => new Audio(src),
) {
  return {
    play(cue: LendingCountdownCue, volume: number) {
      try {
        const audio = createAudio(lendingCueSource(cue));
        audio.volume = Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 0));
        void audio.play().catch(() => {});
      } catch {
        /* audio unavailable or blocked — the visual countdown still runs */
      }
    },
  };
}
