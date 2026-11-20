const EXPECTED_ACQUISITION_TYPE = "enum('purchase','admin_grant')";

const normalize = value => String(value ?? "").toLowerCase().replace(/\s+/g, "");

/**
 * Repair and verify the column used by all customer entitlement reads.
 * A missing Mining table is allowed only for the main migration phase, which
 * can run before the separate portal migration creates the Mining tables.
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

  const failures = [];
  if (normalize(column?.columnType) !== EXPECTED_ACQUISITION_TYPE) {
    failures.push(`expected ${EXPECTED_ACQUISITION_TYPE}, found ${normalize(column?.columnType) || "missing"}`);
  }
  if (normalize(column?.isNullable) !== "no") {
    failures.push(`expected NOT NULL, found nullable=${normalize(column?.isNullable) || "unknown"}`);
  }
  const defaultValue = String(column?.columnDefault ?? "").replace(/^['"]|['"]$/g, "").toLowerCase();
  if (defaultValue !== "purchase") {
    failures.push(`expected default 'purchase', found ${defaultValue || "none"}`);
  }
  if (failures.length) {
    throw new Error("Mining schema verification failed for mining_customer_packages.acquisitionType: " + failures.join("; "));
  }
  return { present: true, repaired };
}
