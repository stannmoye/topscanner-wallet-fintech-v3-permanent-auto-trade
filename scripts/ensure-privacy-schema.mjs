import mysql from "mysql2/promise";
import { ensurePrivacyCenterSchema } from "./privacy-schema.mjs";

const raw = process.env.DATABASE_URL;
if (!raw) throw new Error("DATABASE_URL is required");
const url = new URL(raw);
if (!["mysql:", "mariadb:"].includes(url.protocol)) throw new Error("DATABASE_URL must use mysql:// or mariadb://");
if (url.protocol === "mariadb:") url.protocol = "mysql:";
url.searchParams.set("timezone", "Z");
const db = await mysql.createConnection(url.toString());

try {
  const result = await ensurePrivacyCenterSchema(db, { required: true });
  console.log(JSON.stringify({
    status: "ok",
    tables: ["privacy_policy_versions", "privacy_requests", "privacy_request_events", "privacy_audit_events"],
    state: result.repaired ? "created-and-verified" : "verified",
    message: "Privacy Centre schema is ready",
  }));
} finally {
  await db.end();
}
