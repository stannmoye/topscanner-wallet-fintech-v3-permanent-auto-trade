import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Item 41 — the customer portal must expose a single navigation menu and no
// destination may become unreachable. These assertions read the source files
// directly (source-contract pattern used elsewhere in this repo) so a future
// change cannot silently re-introduce a duplicate menu or drop a destination.

const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const slideMenu = readFileSync(new URL("./components/CustomerSlideMenu.tsx", import.meta.url), "utf8");
const layoutCss = readFileSync(new URL("./index.css", import.meta.url), "utf8");

const drawerTargets = new Set(
  Array.from(slideMenu.matchAll(/target:\s*"([a-z-]+)"/g)).map((match) => match[1]),
);

// Every destination the customer portal can render. The single navigation menu
// must be able to reach each one (the header bell/console/profile and the
// dashboard quick actions remain as shortcuts, not as the only path).
const requiredDestinations = [
  "dashboard", "wallet", "opportunities", "yield", "activity", "crypto-mining", "support",
  "advanced", "intelligence", "account",
  "whitepaper", "token-launch", "tokenomics", "roadmap", "investment-research",
  "knowledge-base", "documentation", "faqs", "trading-guides",
  "risk-disclosure", "legal-documents", "news-updates",
  "treasury-bond", "cooperate-dept", "litigation-funds", "ip-royalties",
  "music-royalties", "agro-investment", "carbon-credit", "green-energy",
];

describe("customer navigation consolidation", () => {
  it("removes the duplicate top workspace strip", () => {
    expect(appSource).not.toContain("CustomerTopWorkspaceMenu");
    expect(appSource).not.toContain("customer-top-workspace-menu");
  });

  it("keeps the workspace drawer as the single navigation with every destination", () => {
    for (const target of requiredDestinations) {
      expect(drawerTargets.has(target), `drawer is missing destination "${target}"`).toBe(true);
    }
  });

  it("marks the active destination with aria-current for accessibility", () => {
    expect(slideMenu).toContain('aria-current={section === item.target ? "page" : undefined}');
  });

  it("keeps the drawer trigger reachable on desktop so desktop users are not stranded", () => {
    expect(layoutCss).toContain(".customer-slide-layer .customer-resource-peek-trigger");
    expect(layoutCss).toContain("@media (min-width:1101px) and (hover:hover) and (pointer:fine)");
  });
});
