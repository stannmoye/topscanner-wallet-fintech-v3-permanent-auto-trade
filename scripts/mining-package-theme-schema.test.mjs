import { describe, expect, it, vi } from "vitest";
import { ensureMiningPackageThemeSchema } from "./mining-package-theme-schema.mjs";

function fakeDb({ tableExists = true, column = null } = {}) {
  let currentColumn = column;
  const query = vi.fn(async (sql) => {
    if (sql.includes("information_schema.tables")) {
      return [tableExists ? [{ table_name: "mining_package_versions" }] : []];
    }
    if (sql.includes("information_schema.columns")) {
      return [currentColumn ? [currentColumn] : []];
    }
    if (sql.startsWith("ALTER TABLE mining_package_versions")) {
      currentColumn = { data_type: "varchar", is_nullable: "NO", column_default: "aurora" };
      return [{ affectedRows: 0 }];
    }
    if (sql.startsWith("UPDATE mining_package_versions")) return [{ affectedRows: 0 }];
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  return { query };
}

describe("Mining package theme schema reconciliation", () => {
  it("adds and verifies the default theme column", async () => {
    const db = fakeDb();

    await expect(ensureMiningPackageThemeSchema(db)).resolves.toEqual({ present: true, repaired: true });
    expect(db.query).toHaveBeenCalledWith(
      "ALTER TABLE mining_package_versions ADD COLUMN themeKey VARCHAR(32) NOT NULL DEFAULT 'aurora'",
    );
    expect(db.query.mock.calls.some(([sql]) => sql.includes("themeKey NOT IN"))).toBe(true);
  });

  it("keeps a valid column and normalizes unknown stored themes", async () => {
    const db = fakeDb({
      column: { data_type: "varchar", is_nullable: "NO", column_default: "aurora" },
    });

    await expect(ensureMiningPackageThemeSchema(db)).resolves.toEqual({ present: true, repaired: false });
    expect(db.query).not.toHaveBeenCalledWith(expect.stringContaining("ALTER TABLE"), expect.anything());
    expect(db.query.mock.calls.some(([sql]) => sql.startsWith("UPDATE mining_package_versions"))).toBe(true);
  });

  it("fails closed for an incompatible column contract", async () => {
    const db = fakeDb({
      column: { data_type: "varchar", is_nullable: "YES", column_default: null },
    });

    await expect(ensureMiningPackageThemeSchema(db)).rejects.toThrow(
      "Mining schema verification failed for mining_package_versions.themeKey",
    );
  });

  it("allows the main migration phase before Mining tables exist", async () => {
    const db = fakeDb({ tableExists: false });

    await expect(ensureMiningPackageThemeSchema(db)).resolves.toEqual({ present: false, repaired: false });
    await expect(ensureMiningPackageThemeSchema(db, { required: true })).rejects.toThrow(
      "mining_package_versions is missing",
    );
  });
});
