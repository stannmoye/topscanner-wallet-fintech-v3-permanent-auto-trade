const normalize = value =>
  String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, "");
const EXPECTED_STATUS =
  "enum('active','replaced','expired','cancelled','ended')";
const LEGACY_STATUS = "enum('active','replaced','expired','cancelled')";

async function readColumn(db, name) {
  const [columns] = await db.query(
    "SELECT data_type AS dataType,column_type AS columnType,is_nullable AS isNullable,column_default AS columnDefault " +
      "FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='mining_customer_packages' AND column_name=? LIMIT 1",
    [name]
  );
  return columns[0] ?? null;
}

export async function ensureMiningCustomerPackageLifecycleSchema(db) {
  let repaired = false;
  let ledgerColumn = await readColumn(db, "ledgerTransactionId");
  if (!ledgerColumn || normalize(ledgerColumn.dataType) !== "int") {
    throw new Error(
      "Mining schema verification failed for mining_customer_packages.ledgerTransactionId"
    );
  }
  if (normalize(ledgerColumn.isNullable) !== "yes") {
    const columnType = normalize(ledgerColumn.columnType);
    if (!/^int(?:\(\d+\))?(?:unsigned)?$/.test(columnType)) {
      throw new Error(
        "Mining schema verification failed for mining_customer_packages.ledgerTransactionId type"
      );
    }
    await db.query(
      `ALTER TABLE mining_customer_packages MODIFY COLUMN ledgerTransactionId ${columnType} NULL`
    );
    ledgerColumn = await readColumn(db, "ledgerTransactionId");
    repaired = true;
  }
  if (normalize(ledgerColumn?.isNullable) !== "yes") {
    throw new Error(
      "Mining schema verification failed for mining_customer_packages.ledgerTransactionId nullability"
    );
  }

  let statusColumn = await readColumn(db, "status");
  const statusType = normalize(statusColumn?.columnType);
  if (!statusColumn || ![LEGACY_STATUS, EXPECTED_STATUS].includes(statusType)) {
    throw new Error(
      "Mining schema verification failed for mining_customer_packages.status enum"
    );
  }
  if (
    statusType !== EXPECTED_STATUS ||
    normalize(statusColumn.isNullable) !== "no" ||
    String(statusColumn.columnDefault ?? "").toLowerCase() !== "active"
  ) {
    await db.query(
      "ALTER TABLE mining_customer_packages MODIFY COLUMN status ENUM('active','replaced','expired','cancelled','ended') NOT NULL DEFAULT 'active'"
    );
    statusColumn = await readColumn(db, "status");
    repaired = true;
  }
  if (
    normalize(statusColumn?.columnType) !== EXPECTED_STATUS ||
    normalize(statusColumn?.isNullable) !== "no" ||
    String(statusColumn?.columnDefault ?? "").toLowerCase() !== "active"
  ) {
    throw new Error(
      "Mining schema verification failed for mining_customer_packages.status"
    );
  }

  return { present: true, repaired };
}
