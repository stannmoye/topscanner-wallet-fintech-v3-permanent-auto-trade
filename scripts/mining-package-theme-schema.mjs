const THEMES = ["aurora", "ember", "glacier", "solar", "nebula", "neon", "plasma", "midnight"];

async function readThemeColumn(db) {
  const [columns] = await db.query(
    "SELECT data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='mining_package_versions' AND column_name='themeKey' LIMIT 1",
  );
  return columns[0] || null;
}

function verifyThemeColumn(column) {
  const defaultValue = String(column?.column_default ?? "").replace(/^'|'$/g, "");
  if (!column || column.data_type !== "varchar" || column.is_nullable !== "NO" || defaultValue !== "aurora") {
    throw new Error("Mining schema verification failed for mining_package_versions.themeKey");
  }
}

export async function ensureMiningPackageThemeSchema(db, { required = false } = {}) {
  const [tables] = await db.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='mining_package_versions' LIMIT 1",
  );
  if (!tables.length) {
    if (required) throw new Error("Mining schema verification failed: mining_package_versions is missing");
    return { present: false, repaired: false };
  }

  let column = await readThemeColumn(db);
  let repaired = false;
  if (!column) {
    await db.query("ALTER TABLE mining_package_versions ADD COLUMN themeKey VARCHAR(32) NOT NULL DEFAULT 'aurora'");
    column = await readThemeColumn(db);
    repaired = true;
  }
  verifyThemeColumn(column);
  await db.query(
    "UPDATE mining_package_versions SET themeKey='aurora' WHERE themeKey IS NULL OR themeKey NOT IN ('aurora','ember','glacier','solar','nebula','neon','plasma','midnight')",
  );
  return { present: true, repaired };
}
