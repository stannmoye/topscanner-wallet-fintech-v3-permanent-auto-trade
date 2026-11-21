import { ensureMiningCustomerPackageLifecycleSchema } from "./mining-customer-package-lifecycle-schema.mjs";

const EXPECTED_ACQUISITION_TYPE = "enum('purchase','admin_grant')";
const REQUIRED_ACQUISITION_TYPES = ["purchase", "admin_grant"];
const normalize = value => String(value ?? "").toLowerCase().replace(/\s+/g, "");

function parseEnumValues(columnType) {
  const match = /^enum\((.*)\)$/i.exec(String(columnType ?? "").trim());
  if (!match) return null;
  const values = match[1]
    .split(",")
    .map(part => part.trim().replace(/^'(.*)'$/, "$1"));
  return values.length ? values : null;
}

const defaultIsPurchase = column =>
  String(column?.columnDefault ?? "").replace(/^['"]|['"]$/g, "").toLowerCase() === "purchase";

/**
 * Repair and verify the column used by all customer entitlement reads.
 * A missing Mining table is allowed only for the main migration phase, which
 * can run before the separate portal migration creates the Mining tables.
 * Enum repairs preserve every existing value and only add the required
 * values, so a drifted enum is widened rather than replaced.
 */
export async function ensureMiningCustomerPackageSchema(db, { required = false } = {}) {
  const [tables] = await db.query(
    "SELECT table_name AS tableName FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=? LIMIT 1",
    ["mining_customer_packages"],
  );
  if (!tables.length) {
    if (required) throw new Error("Mining schema verification failed: mining_customer_packages is missing.");
    return { present: false, repaired: false };
  }

  const readColumn = async () => {
    const [columns] = await db.query(
      "SELECT column_type AS columnType,is_nullable AS isNullable,column_default AS columnDefault " +
      "FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=? LIMIT 1",
      ["mining_customer_packages", "acquisitionType"],
    );
    return columns[0] ?? null;
  };

  let column = await readColumn();
  let repaired = false;
  if (!column) {
    try {
      await db.query(
        "ALTER TABLE mining_customer_packages " +
        "ADD COLUMN acquisitionType ENUM('purchase','admin_grant') NOT NULL DEFAULT 'purchase' AFTER packageVersionId",
      );
      repaired = true;
    } catch (error) {
      if (error?.code !== "ER_DUP_FIELDNAME" && Number(error?.errno) !== 1060) throw error;
    }
    column = await readColumn();
  }

  const liveValues = parseEnumValues(column?.columnType);
  if (!liveValues) {
    throw new Error(
      "Mining schema verification failed for mining_customer_packages.acquisitionType: expected " +
      EXPECTED_ACQUISITION_TYPE + ", found " + (normalize(column?.columnType) || "missing"),
    );
  }
  const missingValues = REQUIRED_ACQUISITION_TYPES.filter(value => !liveValues.includes(value));
  const drift =
    missingValues.length > 0 ||
    normalize(column.isNullable) !== "no" ||
    !defaultIsPurchase(column);
  if (drift) {
    const values = [...liveValues, ...missingValues.filter(value => !liveValues.includes(value))];
    await db.query(
      "ALTER TABLE mining_customer_packages MODIFY COLUMN acquisitionType ENUM(" +
      values.map(value => "'" + value.replace(/'/g, "''") + "'").join(",") +
      ") NOT NULL DEFAULT 'purchase'",
    );
    column = await readColumn();
    repaired = true;
  }

  const finalValues = parseEnumValues(column?.columnType);
  if (
    !finalValues ||
    REQUIRED_ACQUISITION_TYPES.some(value => !finalValues.includes(value)) ||
    normalize(column.isNullable) !== "no" ||
    !defaultIsPurchase(column)
  ) {
    throw new Error(
      "Mining schema verification failed for mining_customer_packages.acquisitionType: expected " +
      EXPECTED_ACQUISITION_TYPE + ", found " + (normalize(column?.columnType) || "missing"),
    );
  }
  const lifecycleSchema = await ensureMiningCustomerPackageLifecycleSchema(db);
  return { present: true, repaired: repaired || lifecycleSchema.repaired };
}
