import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Item 59 — remove dead code. These assertions read the source files directly
// (source-contract pattern used elsewhere in this repo) so the removed
// components and the unreachable dashboard in App() cannot be re-introduced
// without failing. They also guard against over-removal by asserting the live
// portal entry points are still present.

const appSource = readFileSync(new URL("../client/src/App.tsx", import.meta.url), "utf8");

describe("dead code removal", () => {
  it("deletes the unused DashboardLayout components", () => {
    expect(existsSync(new URL("../client/src/components/DashboardLayout.tsx", import.meta.url))).toBe(false);
    expect(existsSync(new URL("../client/src/components/DashboardLayoutSkeleton.tsx", import.meta.url))).toBe(false);
  });

  it("removes the unused customerMainNavigation constant", () => {
    expect(appSource).not.toContain("customerMainNavigation");
  });

  it("removes the unreachable dashboard body from App()", () => {
    // Symbols that were only reachable from the unreachable dashboard body.
    expect(appSource).not.toContain("function PageIntro");
    expect(appSource).not.toContain("function BoxIcon");
    expect(appSource).not.toContain("function BalanceCard");
    expect(appSource).not.toContain("function OpportunityModal");
    expect(appSource).not.toContain('className="app-shell"');
  });

  it("keeps every live portal entry point", () => {
    expect(appSource).toContain("function CustomerDashboard(");
    expect(appSource).toContain("function AdminPortal(");
    expect(appSource).toContain("function AdminRoute(");
    expect(appSource).toContain("return <CustomerPortal />;");
    expect(appSource.trimEnd().endsWith("export default App;")).toBe(true);
  });
});
