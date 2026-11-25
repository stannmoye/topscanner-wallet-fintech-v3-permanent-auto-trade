// URL-backed persistence for the in-app portal sections.
//
// The customer and administrator portals keep the visible page in plain React
// state, so historically the URL never changed and a browser refresh always fell
// back to the portal home. This helper mirrors the active section (and the
// optional administrator focus) into the query string and reads it back on load,
// so a refresh restores the same page. It deliberately preserves every other
// query parameter (for example the KYC verification token) and the URL hash.

const SECTION_PARAM = "section";
const FOCUS_PARAM = "focus";

export type PortalRoute = { section: string | null; focus: string | null };

/** Parses the persisted section and focus from a location search string. */
export function parsePortalRoute(search: string): PortalRoute {
  const params = new URLSearchParams(search);
  return {
    section: params.get(SECTION_PARAM) || null,
    focus: params.get(FOCUS_PARAM) || null,
  };
}

/**
 * Returns the path (with query string and hash) that reflects the given
 * section/focus, preserving unrelated query parameters. The section parameter is
 * removed when it matches the portal default so the home URL stays clean.
 */
export function buildPortalHref(currentHref: string, section: string, focus: string | null | undefined, defaultSection: string): string {
  const url = new URL(currentHref);
  if (!section || section === defaultSection) url.searchParams.delete(SECTION_PARAM);
  else url.searchParams.set(SECTION_PARAM, section);
  if (!focus) url.searchParams.delete(FOCUS_PARAM);
  else url.searchParams.set(FOCUS_PARAM, focus);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Reads the persisted route from the current browser location, if available. */
export function readPortalRoute(): PortalRoute {
  if (typeof window === "undefined") return { section: null, focus: null };
  return parsePortalRoute(window.location.search);
}

/**
 * Resolves the section to open on first render: the persisted section when it is
 * a known destination, otherwise the portal default. Validating against the
 * known set keeps a hand-edited or stale URL from rendering an empty page.
 */
export function readInitialPortalSection(allowed: ReadonlySet<string>, fallback: string): string {
  const { section } = readPortalRoute();
  return section && allowed.has(section) ? section : fallback;
}

/** Resolves the administrator focus to open on first render, if one is persisted. */
export function readInitialPortalFocus(): string | undefined {
  return readPortalRoute().focus || undefined;
}

/**
 * Mirrors the active section and focus into the browser URL without navigating or
 * adding a history entry, so a refresh re-opens the same page. Called whenever the
 * active section changes.
 */
export function writePortalRoute(section: string, focus: string | null | undefined, defaultSection: string): void {
  if (typeof window === "undefined") return;
  const next = buildPortalHref(window.location.href, section, focus, defaultSection);
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next === current) return;
  window.history.replaceState(window.history.state, "", next);
}
