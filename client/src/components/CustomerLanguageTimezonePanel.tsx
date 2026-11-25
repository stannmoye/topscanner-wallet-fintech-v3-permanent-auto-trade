/**
 * Customer "Language & time" preference panel.
 *
 * Lets the customer pick the interface language (applied site-wide, persisted
 * across sign-out) and their country time zone (flag + UTC offset + country
 * name), with a reset back to the English / device defaults.
 */

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock, Globe2, Languages, RotateCcw } from "lucide-react";
import { findCountry, flagFor } from "@shared/country-options";
import { useLanguage } from "@/i18n/LanguageProvider";
import { DEFAULT_LANGUAGE, findLanguage } from "@/i18n/languages";
import {
  TIMEZONE_ENTRIES,
  detectLocalTimezone,
  formatTimezoneClock,
  timezoneCityLabel,
  timezoneOffsetLabel,
} from "@/lib/timezones";
import { clearStoredTimezone, readStoredTimezone, writeStoredTimezone } from "@/lib/locale-preferences";

type TimezoneGroup = {
  code: string;
  name: string;
  flag: string;
  entries: Array<{ tz: string; city: string; offset: string }>;
};

function buildTimezoneGroups(selectedTimezone: string): TimezoneGroup[] {
  const byCountry = new Map<string, string[]>();
  for (const entry of TIMEZONE_ENTRIES) {
    const list = byCountry.get(entry.countryCode) || [];
    list.push(entry.tz);
    byCountry.set(entry.countryCode, list);
  }
  const groups: TimezoneGroup[] = [...byCountry.entries()].map(([code, zones]) => {
    const country = findCountry(code);
    return {
      code,
      name: country?.name || code,
      flag: flagFor(code),
      entries: zones.map((tz) => ({ tz, city: timezoneCityLabel(tz), offset: timezoneOffsetLabel(tz) })),
    };
  });
  groups.sort((a, b) => a.name.localeCompare(b.name));

  // Make sure the current selection is always selectable, even if the device
  // zone is not one of the country reference zones.
  const present = groups.some((group) => group.entries.some((entry) => entry.tz === selectedTimezone));
  if (!present && selectedTimezone) {
    const code = selectedTimezone.split("/")[0] || "UTC";
    groups.unshift({
      code,
      name: findCountry(code)?.name || "Device",
      flag: "🌐",
      entries: [{ tz: selectedTimezone, city: timezoneCityLabel(selectedTimezone), offset: timezoneOffsetLabel(selectedTimezone) }],
    });
  }
  return groups;
}

function zoneMeta(tz: string): { flag: string; countryName: string; city: string } {
  const entry = TIMEZONE_ENTRIES.find((candidate) => candidate.tz === tz);
  const countryCode = entry?.countryCode;
  if (countryCode) {
    return { flag: flagFor(countryCode), countryName: findCountry(countryCode)?.name || countryCode, city: timezoneCityLabel(tz) };
  }
  return { flag: "🌐", countryName: "Device time zone", city: timezoneCityLabel(tz) };
}

export default function CustomerLanguageTimezonePanel({ push }: { push: (message: string) => void }) {
  const { language, setLanguage, resetLanguage, translating, supported } = useLanguage();
  const [timezone, setTimezone] = useState<string>(() => readStoredTimezone());
  const [now, setNow] = useState<Date>(() => new Date());

  // Keep the live preview clock ticking.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const groups = useMemo(() => buildTimezoneGroups(timezone), [timezone]);
  const meta = useMemo(() => zoneMeta(timezone), [timezone]);
  const currentLanguage = findLanguage(language) || supported[0];

  const chooseTimezone = (next: string) => {
    setTimezone(next);
    writeStoredTimezone(next);
    push("Time zone preference saved");
  };

  const resetTimezone = () => {
    clearStoredTimezone();
    const deviceZone = detectLocalTimezone();
    setTimezone(deviceZone);
    push("Time zone reset to your device default");
  };

  return (
    <div className="language-time-panel">
      <div className="preference-card-grid">
        <section className="settings-card preference-card language-time-card">
          <header className="language-time-head">
            <span className="settings-card-icon"><Languages size={18} /></span>
            <div>
              <h2>Website language</h2>
              <p>Translate the whole workspace into your preferred language. Your choice is kept on this device and still applies after you sign out, until you change it.</p>
            </div>
          </header>
          <label className="language-time-field" htmlFor="customer-language-select">
            <span>Preferred language</span>
            <div className="customer-personal-input-wrap">
              <select
                id="customer-language-select"
                value={language}
                onChange={(event) => { setLanguage(event.target.value); push("Language preference saved"); }}
              >
                {supported.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.code === DEFAULT_LANGUAGE ? option.label : `${option.nativeLabel} — ${option.label}`}
                  </option>
                ))}
              </select>
            </div>
          </label>
          <div className="language-time-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => { resetLanguage(); push("Language reset to English"); }}
              disabled={language === DEFAULT_LANGUAGE}
            >
              <RotateCcw size={14} /> Reset to English
            </button>
            <span className="language-time-status" role="status" aria-live="polite">
              <CheckCircle2 size={13} />
              {language === DEFAULT_LANGUAGE ? "English · default" : `${currentLanguage.label} · ${translating ? "applying…" : "active"}`}
            </span>
          </div>
        </section>

        <section className="settings-card preference-card language-time-card">
          <header className="language-time-head">
            <span className="settings-card-icon"><Clock size={18} /></span>
            <div>
              <h2>Country time zone</h2>
              <p>Select your time zone by country. Each option shows the country flag, the UTC offset, and the time-zone name.</p>
            </div>
          </header>
          <label className="language-time-field" htmlFor="customer-timezone-select">
            <span>Country &amp; time zone</span>
            <div className="customer-personal-input-wrap">
              <select
                id="customer-timezone-select"
                value={timezone}
                onChange={(event) => chooseTimezone(event.target.value)}
              >
                {groups.map((group) => (
                  <optgroup key={group.code} label={`${group.flag}  ${group.name}`}>
                    {group.entries.map((entry) => (
                      <option key={entry.tz} value={entry.tz}>
                        {`${group.flag} ${entry.city} · ${entry.offset} · ${entry.tz}`}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          </label>
          <div className="language-time-preview">
            <span className="language-time-preview-flag" aria-hidden="true">{meta.flag}</span>
            <div className="language-time-preview-place">
              <strong>{meta.countryName}</strong>
              <span>{meta.city} · {timezone}</span>
            </div>
            <div className="language-time-preview-clock">
              <strong>{formatTimezoneClock(timezone, now, true)}</strong>
              <span>{timezoneOffsetLabel(timezone, now)}</span>
            </div>
          </div>
          <div className="language-time-actions">
            <button type="button" className="secondary-button" onClick={resetTimezone}>
              <RotateCcw size={14} /> Reset to device time zone
            </button>
          </div>
        </section>
      </div>

      <div className="test-notice">
        <Globe2 size={14} />
        <span>Translations are generated by a free translation service. Your language and time zone are stored on this device, apply across the entire site (including the sign-in and sign-up pages), and remain until you change or reset them.</span>
      </div>
    </div>
  );
}
