import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The customer portal keeps a 12-destination quick strip and a complete
// searchable drawer so primary pages and additional resources remain reachable.

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

describe("customer navigation", () => {
  it("restores the primary workspace strip with all 12 destinations", () => {
    expect(slideMenu).toContain('aria-label="Workspace and investments"');
    const primaryDestinations = [
      "dashboard", "crypto-mining", "token-launch", "treasury-bond", "cooperate-dept",
      "litigation-funds", "ip-royalties", "music-royalties", "agro-investment",
      "carbon-credit", "green-energy", "support",
    ];
    const targetBlock = slideMenu.match(/const topWorkspaceTargets = \[([\s\S]*?)\];/);
    expect(targetBlock).not.toBeNull();
    const actualTargets = Array.from(targetBlock?.[1].matchAll(/"([a-z-]+)"/g) || [], (match) => match[1]);
    expect(actualTargets).toEqual(primaryDestinations);
  });

  it("keeps every customer destination reachable through the searchable drawer", () => {
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
