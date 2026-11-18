import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

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
