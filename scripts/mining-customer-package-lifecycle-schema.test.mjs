import { describe, expect, it, vi } from "vitest";
import { ensureMiningCustomerPackageLifecycleSchema } from "./mining-customer-package-lifecycle-schema.mjs";

function fakeDb({
  ledgerNullable = "YES",
  statusType = "enum('active','replaced','expired','cancelled')",
} = {}) {
  const columns = {
    ledgerTransactionId: {
      dataType: "int",
      columnType: "int",
      isNullable: ledgerNullable,
      columnDefault: null,
    },
    status: {
      dataType: "enum",
      columnType: statusType,
      isNullable: "NO",
      columnDefault: "active",
    },
  };
  const query = vi.fn(async (sql, params) => {
    if (sql.includes("information_schema.columns")) {
      const column = columns[params[0]];
      return [column ? [{ ...column }] : []];
    }
    if (sql.includes("MODIFY COLUMN ledgerTransactionId")) {
      columns.ledgerTransactionId.isNullable = "YES";
      return [{ affectedRows: 0 }];
    }
    if (sql.includes("MODIFY COLUMN status")) {
      columns.status.columnType =
        "enum('active','replaced','expired','cancelled','ended')";
      columns.status.isNullable = "NO";
      columns.status.columnDefault = "active";
      return [{ affectedRows: 0 }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  return { query };
}

describe("Mining customer-package lifecycle schema reconciliation", () => {
  it("repairs nullable grant ledger links and adds the admin-ended status", async () => {
    const db = fakeDb({ ledgerNullable: "NO" });

    await expect(
      ensureMiningCustomerPackageLifecycleSchema(db)
    ).resolves.toEqual({ present: true, repaired: true });
    expect(
      db.query.mock.calls.some(([sql]) =>
        sql.includes("MODIFY COLUMN ledgerTransactionId int NULL")
      )
    ).toBe(true);
    expect(db.query.mock.calls.some(([sql]) => sql.includes("'ended'"))).toBe(
      true
    );
  });

  it("leaves a correct lifecycle schema unchanged", async () => {
    const db = fakeDb({
      statusType: "enum('active','replaced','expired','cancelled','ended')",
    });

    await expect(
      ensureMiningCustomerPackageLifecycleSchema(db)
    ).resolves.toEqual({ present: true, repaired: false });
    expect(
      db.query.mock.calls.some(([sql]) => sql.startsWith("ALTER TABLE"))
    ).toBe(false);
  });

  it("fails closed instead of dropping an unknown existing status", async () => {
    const db = fakeDb({
      statusType: "enum('active','replaced','expired','cancelled','paused')",
    });

    await expect(
      ensureMiningCustomerPackageLifecycleSchema(db)
    ).rejects.toThrow(
      "Mining schema verification failed for mining_customer_packages.status enum"
    );
    expect(
      db.query.mock.calls.some(([sql]) => sql.startsWith("ALTER TABLE"))
    ).toBe(false);
  });

  it("rejects an incompatible ledger link type", async () => {
    const db = fakeDb();
    db.query.mockImplementation(async (sql, params) => {
      if (!sql.includes("information_schema.columns"))
        throw new Error(`Unexpected SQL: ${sql}`);
      if (params[0] === "ledgerTransactionId") {
        return [
          [
            {
              dataType: "varchar",
              columnType: "varchar(24)",
              isNullable: "NO",
              columnDefault: null,
            },
          ],
        ];
      }
      return [
        [
          {
            dataType: "enum",
            columnType:
              "enum('active','replaced','expired','cancelled','ended')",
            isNullable: "NO",
            columnDefault: "active",
          },
        ],
      ];
    });

    await expect(
      ensureMiningCustomerPackageLifecycleSchema(db)
    ).rejects.toThrow(
      "Mining schema verification failed for mining_customer_packages.ledgerTransactionId"
    );
  });
});
