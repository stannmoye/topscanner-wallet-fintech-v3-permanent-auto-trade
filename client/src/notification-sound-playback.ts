// Per-sound playback resolution for the bundled notification sounds.
//
// Historically `playConfiguredSound` gated every cue on the module-level
// `defaultSoundSettings.enabled` constant (which is `false`), so a customer or
// administrator sound policy that was actually enabled could still be silenced.
// Each cue now resolves its OWN settings object: its enabled flag, its volume,
// and the opportunity loop flag. This module is pure so every sound can be
// tested without a browser.

export type SoundPreset = { id: string; src: string };

export type SoundPlaybackSettings = {
  enabled?: unknown;
  volume?: unknown;
  loopOpportunity?: unknown;
  [kind: string]: unknown;
};

export type SoundPlaybackPlan = {
  presetId: string;
  src: string;
  loop: boolean;
  volume: number;
};

export type SoundPlaybackOptions = {
  /** The per-browser opt-in ("wisebond-sound-effects"). */
  userOptIn: boolean;
  /** Preview/force playback (administrator preview buttons). */
  force?: boolean;
  /** Explicit loop override; defaults to the opportunity loop flag. */
  loop?: boolean;
};

/**
 * A cue plays only when the caller's own settings are enabled AND the browser
 * opt-in is on, unless the call is an explicit (forced) preview.
 */
export function soundEnabledForPlayback(
  settings: SoundPlaybackSettings,
  options: { userOptIn: boolean; force?: boolean },
): boolean {
  if (options.force) return true;
  return options.userOptIn === true && settings.enabled === true;
}

/** The opportunity cue is the only cue that can loop, and only when configured. */
export function soundLoopFor(kind: string, settings: SoundPlaybackSettings): boolean {
  return kind === "opportunity" && settings.loopOpportunity === true;
}

/**
 * Resolve the concrete playback plan for one cue, or `null` when it must stay
 * silent. Each cue reads the preset id, volume and loop from its OWN settings.
 */
export function resolveSoundPlayback(
  settings: SoundPlaybackSettings,
  kind: string,
  presets: ReadonlyArray<SoundPreset>,
  options: SoundPlaybackOptions,
): SoundPlaybackPlan | null {
  if (!soundEnabledForPlayback(settings, options)) return null;
  if (!presets.length) return null;
  const requested = typeof settings[kind] === "string" ? String(settings[kind]) : "";
  const preset = presets.find((candidate) => candidate.id === requested) ?? presets[0];
  const volume = Number(settings.volume);
  return {
    presetId: preset.id,
    src: preset.src,
    loop: typeof options.loop === "boolean" ? options.loop : soundLoopFor(kind, settings),
    volume: Number.isFinite(volume) ? volume : 0,
  };
}
