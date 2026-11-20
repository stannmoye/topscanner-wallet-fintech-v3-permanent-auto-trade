import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { ensureMiningCustomerPackageSchema } from "./mining-customer-package-schema.mjs";

function fakeDb({ tableExists = true, column = null } = {}) {
  let currentColumn = column;
  const query = vi.fn(async (sql) => {
    if (sql.includes("information_schema.tables")) {
      return [tableExists ? [{ tableName: "mining_customer_packages" }] : []];
    }
    if (sql.includes("information_schema.columns")) {
      return [currentColumn ? [currentColumn] : []];
    }
    if (sql.startsWith("ALTER TABLE mining_customer_packages")) {
      currentColumn = {
        columnType: "enum('purchase','admin_grant')",
        isNullable: "NO",
        columnDefault: "purchase",
      };
      return [{ affectedRows: 0 }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  return { query };
}

describe("Mining customer package schema reconciliation", () => {
  it("adds and verifies acquisitionType when it is missing", async () => {
    const db = fakeDb();

    await expect(ensureMiningCustomerPackageSchema(db)).resolves.toEqual({ present: true, repaired: true });
    expect(db.query.mock.calls.some(([sql]) => sql.includes("ADD COLUMN acquisitionType"))).toBe(true);
  });

  it("does not alter an already-correct column", async () => {
    const db = fakeDb({
      column: {
        columnType: "enum('purchase','admin_grant')",
        isNullable: "NO",
        columnDefault: "purchase",
      },
    });

    await expect(ensureMiningCustomerPackageSchema(db)).resolves.toEqual({ present: true, repaired: false });
    expect(db.query).not.toHaveBeenCalledWith(expect.stringContaining("ALTER TABLE"), expect.anything());
  });

  it("fails closed when an existing column has an incompatible contract", async () => {
    const db = fakeDb({
      column: { columnType: "varchar(32)", isNullable: "YES", columnDefault: null },
    });

    await expect(ensureMiningCustomerPackageSchema(db)).rejects.toThrow(
      "Mining schema verification failed for mining_customer_packages.acquisitionType",
    );
  });

  it("allows the main migration phase to run before portal Mining tables exist", async () => {
    const db = fakeDb({ tableExists: false });

    await expect(ensureMiningCustomerPackageSchema(db)).resolves.toEqual({ present: false, repaired: false });
    await expect(ensureMiningCustomerPackageSchema(db, { required: true })).rejects.toThrow(
      "mining_customer_packages is missing",
    );
  });

  it("runs the repair from migration paths and does not overwrite administrator hash-power settings", async () => {
    const [mainRunner, portalRunner, currentSchema] = await Promise.all([
      readFile(new URL("./guarded-main-migrate.mjs", import.meta.url), "utf8"),
      readFile(new URL("./apply-portal-migrations.mjs", import.meta.url), "utf8"),
      readFile(new URL("./ensure-mining-current-schema.mjs", import.meta.url), "utf8"),
    ]);

    expect(mainRunner).toContain("ensureMiningCustomerPackageSchema(connection)");
    expect(portalRunner).toContain("ensureMiningCustomerPackageSchema(connection, { required: true })");
    expect(currentSchema).toContain("ensureMiningCustomerPackageSchema(db, { required: true })");
    expect(currentSchema).not.toContain("SET globalHashPowerThs=67 WHERE globalHashPowerThs=0");
  });
});
