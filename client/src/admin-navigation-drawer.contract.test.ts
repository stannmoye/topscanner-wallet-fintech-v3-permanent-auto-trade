import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { adminSecondaryNavigationGroups, allAdminNavigationItems } from "./admin-navigation";

const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const slideSource = readFileSync(new URL("./components/AdminSlideMenu.tsx", import.meta.url), "utf8");

// Item 42: the mobile admin drawer must close only on real navigation, never
// when a group header is tapped to expand/collapse a group.
describe("Admin mobile navigation drawer close behaviour", () => {
  it("no longer closes the drawer from a blanket click capture on the rail aside", () => {
    expect(appSource).not.toContain("onClickCapture={()=>setMobileNavOpen(false)}");
    const aside = appSource.match(/<aside id="admin-main-navigation"[^>]*>/)?.[0] ?? "";
    expect(aside).toContain('aria-label="Admin portal navigation"');
    expect(aside).not.toContain("onClickCapture");
  });

  it("closes the drawer from an explicit navigation helper", () => {
    expect(appSource).toContain(
      "const navigateAdmin=(target:string,nextFocus?:string)=>{setSection(target);setFocus(nextFocus);setMobileNavOpen(false)};",
    );
  });

  it("routes every real navigation button (items and submenu children) through the helper", () => {
    expect(appSource).toContain("onClick={()=>navigateAdmin(item.target,item.focus)}");
    expect(appSource).not.toContain("onClick={()=>{setSection(item.target);setFocus(item.focus)}}");
  });

  it("keeps the group header a pure expand/collapse toggle that never closes the drawer", () => {
    const toggle = "onClick={()=>setExpandedGroups((current)=>({...current,[group.id]:!isOpen}))}";
    expect(appSource).toContain(toggle);
    expect(toggle).not.toContain("setMobileNavOpen");
    expect(toggle).not.toContain("navigateAdmin");
  });
});

// Item 43: resolve the current section label from the full navigation registry
// and mark exactly one drawer row active by item id.
const resolveActiveItem = (section: string, focus?: string) =>
  allAdminNavigationItems.find((item) => item.target === section && item.focus === focus)
  ?? allAdminNavigationItems.find((item) => item.target === section)
  ?? null;

const secondaryTargets = [...new Set(adminSecondaryNavigationGroups.flatMap((group) => group.items.map((item) => item.target)))];

describe("Admin secondary drawer current-section resolution", () => {
  it("resolves a non-generic label from the full navigation for every secondary target", () => {
    for (const target of secondaryTargets) {
      const owner = resolveActiveItem(target);
      expect(owner, target).not.toBeNull();
      expect(owner?.label, target).toBeTruthy();
      expect(owner?.label, target).not.toBe("Admin workspace");
    }
  });

  it("marks exactly one secondary row active when several share a target", () => {
    for (const target of secondaryTargets) {
      const ownerId = resolveActiveItem(target)?.id;
      const activeRows = adminSecondaryNavigationGroups.flatMap((group) => group.items).filter((item) => item.id === ownerId);
      expect(activeRows, target).toHaveLength(1);
    }
  });

  it("also resolves primary section labels that used to fall back to 'Admin workspace'", () => {
    expect(resolveActiveItem("tradePackageConfiguration")?.label).toBe("Package Configuration");
    expect(resolveActiveItem("packages", "tiers")?.label).toBe("Tiers & Eligibility");
    expect(resolveActiveItem("overview")?.label).toBe("Dashboard");
  });

  it("uses the unique item id for the active state instead of the shared target", () => {
    expect(slideSource).toContain("const active = item.id === activeItemId;");
    expect(slideSource).not.toContain('${section === item.target ? " is-active" : ""}');
    expect(slideSource).not.toContain('aria-current={section === item.target ? "page" : undefined}');
  });

  it("resolves the label from the full registry and receives the focus from the portal", () => {
    expect(slideSource).toContain("allAdminNavigationItems");
    expect(slideSource).not.toContain("adminSecondaryNavigationGroups.flatMap((group) => group.items).find((item) => item.target === section)");
    expect(appSource).toContain("<AdminSlideMenu section={section} focus={focus} onNavigate=");
  });
});

