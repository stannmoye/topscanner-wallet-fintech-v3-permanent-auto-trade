import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The customer "Language & time" menu must let a customer set the interface
// language (auto-translated on the whole site and kept after sign-out) and the
// country time zone, with a reset back to the English / device defaults.

const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const main = readFileSync(new URL("./main.tsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("./components/CustomerLanguageTimezonePanel.tsx", import.meta.url), "utf8");
const languages = readFileSync(new URL("./i18n/languages.ts", import.meta.url), "utf8");
const css = readFileSync(new URL("./customer-reference.css", import.meta.url), "utf8");

describe("language & time preference wiring", () => {
  it("renders the dedicated panel for the language-region menu item", () => {
    expect(app).toContain('isLanguageRegion=item.id==="language-region"');
    expect(app).toContain("CustomerLanguageTimezonePanel");
  });

  it("mounts the language provider around the whole application", () => {
    expect(main).toContain("LanguageProvider");
    expect(main).toMatch(/<LanguageProvider>[\s\S]*?<App \/>[\s\S]*?<\/LanguageProvider>/);
  });

  it("offers twelve languages with English as the default", () => {
    expect(languages).toContain('export const DEFAULT_LANGUAGE = "en"');
    const count = (languages.match(/code: "/g) || []).length;
    expect(count).toBe(12);
    expect(languages).not.toContain('code: "ar"');
  });

  it("builds a country time zone picker with flag, offset and country name", () => {
    expect(panel).toContain("TIMEZONE_ENTRIES");
    expect(panel).toContain("timezoneOffsetLabel");
    expect(panel).toContain("flagFor");
    expect(panel).toContain("optgroup");
  });

  it("resets language and time zone to their defaults", () => {
    expect(panel).toContain("resetLanguage");
    expect(panel).toContain("Reset to English");
    expect(panel).toContain("clearStoredTimezone");
  });

  it("ships styles for the panel", () => {
    expect(css).toContain(".language-time-panel");
    expect(css).toContain(".language-time-preview");
  });
});
