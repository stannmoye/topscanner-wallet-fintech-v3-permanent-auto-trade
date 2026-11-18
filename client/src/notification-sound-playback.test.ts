import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  resolveSoundPlayback,
  soundEnabledForPlayback,
  soundLoopFor,
  type SoundPlaybackSettings,
} from "./notification-sound-playback";

const presets = [
  { id: "sound-01", src: "/sounds/notification-soft-chime.wav" },
  { id: "sound-02", src: "/sounds/notification-bright-bell.wav" },
  { id: "sound-03", src: "/sounds/notification-double-ping.wav" },
  { id: "sound-04", src: "/sounds/notification-warm-tone.wav" },
  { id: "sound-05", src: "/sounds/notification-urgent-pulse.wav" },
] as const;

const soundKeys = [
  "default",
  "opportunity",
  "deposit",
  "credit",
  "debit",
  "withdrawal",
  "trading",
  "mining",
  "support",
  "announcement",
  "failure",
] as const;

function settings(overrides: Partial<Record<string, unknown>> = {}): SoundPlaybackSettings {
  return {
    default: "sound-01",
    opportunity: "sound-02",
    deposit: "sound-03",
    credit: "sound-04",
    debit: "sound-05",
    withdrawal: "sound-05",
    trading: "sound-02",
    mining: "sound-04",
    support: "sound-03",
    announcement: "sound-01",
    failure: "sound-05",
    enabled: true,
    loopOpportunity: false,
    volume: 42,
    ...overrides,
  };
}

describe("notification sound playback resolution", () => {
  it("uses each cue's own configured preset id and volume", () => {
    for (const kind of soundKeys) {
      const plan = resolveSoundPlayback(settings(), kind, presets, { userOptIn: true });
      expect(plan, kind).not.toBeNull();
      const expectedId = settings()[kind] as string;
      expect(plan!.presetId, kind).toBe(expectedId);
      expect(plan!.src, kind).toBe(presets.find((preset) => preset.id === expectedId)!.src);
      expect(plan!.volume, kind).toBe(42);
    }
  });

  it("stays silent when the settings' own enabled flag is false", () => {
    for (const kind of soundKeys) {
      expect(resolveSoundPlayback(settings({ enabled: false }), kind, presets, { userOptIn: true }), kind).toBeNull();
    }
  });

  it("stays silent when the browser opt-in is off but plays for explicit previews", () => {
    for (const kind of soundKeys) {
      expect(resolveSoundPlayback(settings(), kind, presets, { userOptIn: false }), kind).toBeNull();
      expect(resolveSoundPlayback(settings(), kind, presets, { userOptIn: false, force: true }), kind).not.toBeNull();
    }
  });

  it("loops only the opportunity cue, and only when its own loop flag is set", () => {
    const looping = resolveSoundPlayback(settings({ loopOpportunity: true }), "opportunity", presets, { userOptIn: true });
    expect(looping!.loop).toBe(true);
    const notLooping = resolveSoundPlayback(settings({ loopOpportunity: false }), "opportunity", presets, { userOptIn: true });
    expect(notLooping!.loop).toBe(false);
    for (const kind of soundKeys.filter((key) => key !== "opportunity")) {
      expect(resolveSoundPlayback(settings({ loopOpportunity: true }), kind, presets, { userOptIn: true })!.loop, kind).toBe(false);
    }
  });

  it("honours an explicit loop override and an explicit non-loop override", () => {
    expect(resolveSoundPlayback(settings(), "credit", presets, { userOptIn: true, loop: true })!.loop).toBe(true);
    expect(resolveSoundPlayback(settings({ loopOpportunity: true }), "opportunity", presets, { userOptIn: true, loop: false })!.loop).toBe(false);
  });

  it("falls back to the first preset for an unknown id and never throws on bad input", () => {
    expect(resolveSoundPlayback(settings({ credit: "sound-99" }), "credit", presets, { userOptIn: true })!.presetId).toBe("sound-01");
    expect(resolveSoundPlayback(settings({ volume: Number.NaN }), "default", presets, { userOptIn: true })!.volume).toBe(0);
    expect(resolveSoundPlayback(settings(), "default", [], { userOptIn: true })).toBeNull();
  });

  it("exposes the gate and loop helpers directly", () => {
    expect(soundEnabledForPlayback({ enabled: true }, { userOptIn: true })).toBe(true);
    expect(soundEnabledForPlayback({ enabled: true }, { userOptIn: false })).toBe(false);
    expect(soundEnabledForPlayback({ enabled: false }, { userOptIn: true, force: true })).toBe(true);
    expect(soundLoopFor("opportunity", { loopOpportunity: true })).toBe(true);
    expect(soundLoopFor("credit", { loopOpportunity: true })).toBe(false);
  });
});

describe("App sound wiring (item 35)", () => {
  const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

  it("plays the pop-up opportunity cue from the loaded settings", () => {
    expect(app).toContain('playConfiguredSound(soundSettings,"opportunity")');
  });

  it("plays header notification cues from the header settings", () => {
    expect(app).toContain("playConfiguredSound(headerSoundSettings,soundKey)");
  });

  it("plays console cues from the loaded console settings", () => {
    expect(app).toContain('playConfiguredSound(soundSettings,"failure")');
    expect(app).toContain('playConfiguredSound(soundSettings,"debit")');
    expect(app).toContain('playConfiguredSound(soundSettings,"credit")');
  });

  it("previews a cue with force and the form's own volume", () => {
    expect(app).toContain("playConfiguredSound({...form,volume:normalizeNotificationVolume(form.volume)},key,{force:true,loop:key===\"opportunity\"&&form.loopOpportunity})");
  });

  it("plays admin wallet cues from the active settings and keeps them in sync", () => {
    expect(app).toContain("playConfiguredSound(activeSoundSettings,mode)");
    expect(app).toContain('playConfiguredSound(activeSoundSettings,"failure")');
    expect(app).toContain("applyActiveSoundSettings(headerSoundSettingsQuery.data as Partial<SoundSettings>|null|undefined)");
  });

  it("gates the balance-change tone on the loaded policy and volume", () => {
    expect(app).toContain("if(sound&&adminSounds.enabled) playMoneyTone(kind,adminSounds.volume)");
  });

  it("installs an autoplay unlock on the first user gesture", () => {
    expect(app).toContain("function installNotificationAudioUnlockOnFirstGesture()");
    expect(app).toContain('window.addEventListener("pointerdown",unlock,{passive:true})');
    expect(app).toContain("installNotificationAudioUnlockOnFirstGesture();");
  });
});
