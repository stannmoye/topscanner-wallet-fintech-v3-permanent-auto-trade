import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The customer portal keeps a 12-destination workspace strip plus a drawer that
// is deliberately limited to the twelve curated resource destinations the owner
// asked to keep, arranged into four sections. Investment desks and core pages
// stay reachable from the workspace strip; account settings and trusted devices
// stay reachable from the account-centre rail.

const slideMenu = readFileSync(new URL("./components/CustomerSlideMenu.tsx", import.meta.url), "utf8");
const layoutCss = readFileSync(new URL("./index.css", import.meta.url), "utf8");

const destinationGroupsBlock = slideMenu.match(/const destinationGroups[\s\S]*?\n\];/);
const drawerTargets = Array.from(
  destinationGroupsBlock?.[0].matchAll(/target:\s*"([a-z-]+)"/g) || [],
  (match) => match[1],
);

// The twelve destinations the owner asked to keep, in section order.
const curatedDrawerDestinations = [
  "advanced", "intelligence",
  "whitepaper", "roadmap", "investment-research",
  "knowledge-base", "documentation", "faqs", "trading-guides",
  "risk-disclosure", "legal-documents", "news-updates",
];

describe("customer navigation", () => {
  it("restores the primary workspace strip with all 12 destinations", () => {
    expect(slideMenu).toContain('aria-label="Workspace and investments"');
    const primaryDestinations = [
      "dashboard", "crypto-mining", "tender-bid", "treasury-bond", "cooperate-dept",
      "litigation-funds", "ip-royalties", "music-royalties", "agro-investment",
      "carbon-credit", "green-energy", "lending",
    ];
    const targetBlock = slideMenu.match(/const topWorkspaceTargets = \[([\s\S]*?)\];/);
    expect(targetBlock).not.toBeNull();
    const actualTargets = Array.from(targetBlock?.[1].matchAll(/"([a-z-]+)"/g) || [], (match) => match[1]);
    expect(actualTargets).toEqual(primaryDestinations);
  });

  it("shows only the twelve curated destinations in the drawer, arranged into sections", () => {
    expect(destinationGroupsBlock).not.toBeNull();
    expect(drawerTargets).toEqual(curatedDrawerDestinations);
    const sectionLabels = Array.from(
      destinationGroupsBlock?.[0].matchAll(/\n {4}label: "([^"]+)",\n {4}detail:/g) || [],
      (match) => match[1],
    );
    expect(sectionLabels).toEqual(["Workspace Tools", "Project & Investment", "Knowledge & Support", "Transparency & Updates"]);
  });

  it("retires every other menu entry from the drawer", () => {
    for (const removed of ["wallet", "opportunities", "yield", "activity", "account", "trusted-devices", "tokenomics"]) {
      expect(drawerTargets, `drawer should no longer list "${removed}"`).not.toContain(removed);
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
