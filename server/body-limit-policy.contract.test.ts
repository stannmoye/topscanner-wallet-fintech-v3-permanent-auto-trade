import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./_core/index.ts", import.meta.url), "utf8");

describe("item 51: global body limits are small and only large-body routes opt out", () => {
  it("keeps the global JSON and urlencoded body limits small", () => {
    expect(source).toContain('app.use(express.json({ limit: "1mb" }))');
    expect(source).toContain('app.use(express.urlencoded({ limit: "1mb", extended: true }))');
    expect(source).not.toContain('express.json({ limit: "50mb" })');
    expect(source).not.toContain('express.urlencoded({ limit: "50mb"');
  });

  it("allows a larger JSON body only for the admin compose-email procedure", () => {
    expect(source).toContain('const LARGE_JSON_PROCEDURE = "adminOperations.composeEmail"');
    expect(source).toContain('const LARGE_JSON_LIMIT = "50mb"');
    expect(source).toContain("express.json({ limit: LARGE_JSON_LIMIT })");
    const largeParserPosition = source.indexOf("const largeJsonBodyParser = express.json");
    const globalParserPosition = source.indexOf("app.use(express.json(");
    expect(largeParserPosition).toBeGreaterThanOrEqual(0);
    expect(globalParserPosition).toBeGreaterThan(largeParserPosition);
  });

  it("keeps larger limits on the scoped raw upload routes only", () => {
    expect(source).toContain(
      'app.put("/api/support/attachments/upload", express.raw({ type: "*/*", limit: "100mb" })'
    );
    expect(source).toContain(
      'app.put("/api/admin/settlement-evidence/upload", express.raw({ type: "*/*", limit: "30mb" })'
    );
  });
});
