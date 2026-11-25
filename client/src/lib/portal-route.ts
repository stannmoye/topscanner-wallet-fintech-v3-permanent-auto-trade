// URL-backed persistence for the in-app portal sections.
//
// The customer and administrator portals keep the visible page in plain React
// state, so historically the URL never changed and a browser refresh always fell
// back to the portal home. This module mirrors the active section (and the
// optional administrator focus) into the query string and reads it back on load,
// so a refresh re-opens the same page. It also pushes a history entry for in-app
// navigation and reflects the browser Back/Forward buttons back into the portal
// state. Every other query parameter (for example the KYC verification token)
// and the URL hash are preserved.

import { useEffect, useRef, useState } from "react";

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

function currentPortalHref(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function applyPortalRoute(section: string, focus: string | null | undefined, defaultSection: string, method: "push" | "replace"): void {
  if (typeof window === "undefined") return;
  const next = buildPortalHref(window.location.href, section, focus, defaultSection);
  if (next === currentPortalHref()) return;
  if (method === "push") window.history.pushState(window.history.state, "", next);
  else window.history.replaceState(window.history.state, "", next);
}

/** Mirrors the active route into the URL in place, without adding a history entry. */
export function writePortalRoute(section: string, focus: string | null | undefined, defaultSection: string): void {
  applyPortalRoute(section, focus, defaultSection, "replace");
}

/** Mirrors the active route into the URL as a new history entry so Back/Forward step through pages. */
export function pushPortalRoute(section: string, focus: string | null | undefined, defaultSection: string): void {
  applyPortalRoute(section, focus, defaultSection, "push");
}

export type PortalRouteState = {
  section: string;
  focus: string | undefined;
  setSection: (next: string) => void;
  setFocus: (next: string | undefined) => void;
};

/**
 * React state for a portal section that stays in sync with the URL. The active
 * section/focus is restored from the URL on mount (validated against `allowed`),
 * written back on every change, and updated when the browser Back/Forward buttons
 * fire a `popstate` event.
 */
export function usePortalRouteState(defaultSection: string, allowed: ReadonlySet<string>): PortalRouteState {
  const [section, setSection] = useState<string>(() => readInitialPortalSection(allowed, defaultSection));
  const [focus, setFocus] = useState<string | undefined>(() => readInitialPortalFocus());
  // The last URL we synced, so the mount pass can be normalised in place (replace)
  // while later changes push a history entry, and popstate-driven updates are not
  // pushed again.
  const lastHref = useRef<string | null>(null);

  useEffect(() => {
    const next = buildPortalHref(window.location.href, section, focus ?? null, defaultSection);
    if (next !== currentPortalHref()) {
      if (lastHref.current === null) writePortalRoute(section, focus ?? null, defaultSection);
      else pushPortalRoute(section, focus ?? null, defaultSection);
    }
    lastHref.current = next;
  }, [section, focus, defaultSection]);

  useEffect(() => {
    const handlePopState = () => {
      const { section: rawSection, focus: rawFocus } = readPortalRoute();
      const nextSection = rawSection && allowed.has(rawSection) ? rawSection : defaultSection;
      const nextFocus = rawFocus ?? undefined;
      // Normalise a stale/invalid link in place before the state effect runs so it
      // does not push an extra entry.
      writePortalRoute(nextSection, nextFocus, defaultSection);
      setSection(nextSection);
      setFocus(nextFocus);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [allowed, defaultSection]);

  return { section, focus, setSection, setFocus };
}
