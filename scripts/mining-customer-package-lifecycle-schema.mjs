const normalize = value =>
  String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, "");
// The administrator "stop" action writes status='ended', which the base table
// enum does not contain. Repairs preserve every existing enum value and only
// add the required lifecycle values, so no stored status is dropped.
const REQUIRED_STATUSES = [
  "active",
  "replaced",
  "expired",
  "cancelled",
  "ended",
];

function parseEnumValues(columnType) {
  const match = /^enum\((.*)\)$/i.exec(String(columnType ?? "").trim());
  if (!match) return null;
  const values = match[1]
    .split(",")
    .map(part => part.trim().replace(/^'(.*)'$/, "$1"));
  return values.length ? values : null;
}

function enumSql(values) {
  return values.map(value => "'" + value.replace(/'/g, "''") + "'").join(",");
}

// MySQL returns column_default unquoted ("active"); MariaDB returns it quoted
// ("'active'"). Strip either form so the drift check cannot loop on a correct
// column and permanently block the guarded migration.
const defaultIsActive = column =>
  String(column?.columnDefault ?? "").replace(/^['"]|['"]$/g, "").toLowerCase() === "active";

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
  if (!ledgerColumn) {
    // Admin grants are zero-charge entitlements with no wallet movement, so the
    // ledger link must exist and be nullable. Recreate it additively if a stale
    // baseline left it out entirely.
    await db.query(
      "ALTER TABLE mining_customer_packages ADD COLUMN ledgerTransactionId INT NULL AFTER quoteId"
    );
    ledgerColumn = await readColumn(db, "ledgerTransactionId");
    repaired = true;
  }
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
  const liveStatuses = parseEnumValues(statusColumn?.columnType);
  if (!statusColumn || !liveStatuses || !liveStatuses.includes("active")) {
    throw new Error(
      "Mining schema verification failed for mining_customer_packages.status enum"
    );
  }
  const missingStatuses = REQUIRED_STATUSES.filter(
    value => !liveStatuses.includes(value)
  );
  const statusDrift =
    missingStatuses.length > 0 ||
    normalize(statusColumn.isNullable) !== "no" ||
    !defaultIsActive(statusColumn);
  if (statusDrift) {
    const values = [
      ...liveStatuses,
      ...missingStatuses.filter(value => !liveStatuses.includes(value)),
    ];
    await db.query(
      "ALTER TABLE mining_customer_packages MODIFY COLUMN status ENUM(" +
        enumSql(values) +
        ") NOT NULL DEFAULT 'active'"
    );
    statusColumn = await readColumn(db, "status");
    repaired = true;
  }
  const finalStatuses = parseEnumValues(statusColumn?.columnType);
  if (
    !statusColumn ||
    !finalStatuses ||
    REQUIRED_STATUSES.some(value => !finalStatuses.includes(value)) ||
    normalize(statusColumn.isNullable) !== "no" ||
    !defaultIsActive(statusColumn)
  ) {
    throw new Error(
      "Mining schema verification failed for mining_customer_packages.status"
    );
  }

  return { present: true, repaired };
}
