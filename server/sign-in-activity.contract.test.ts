import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const module = readFileSync(new URL("./sign-in-activity.ts", import.meta.url), "utf8");
const core = readFileSync(new URL("./_core/index.ts", import.meta.url), "utf8");
const router = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");
const nav = readFileSync(new URL("../client/src/admin-navigation.ts", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../client/src/App.tsx", import.meta.url), "utf8");
const component = readFileSync(new URL("../client/src/components/AdminSignInActivity.tsx", import.meta.url), "utf8");

describe("sign-in activity contract", () => {
  it("records all sign-ins in an additive, idempotently-created table", () => {
    expect(module).toContain('export const SIGN_IN_ACTIVITY_TABLE = "sign_in_activity_events"');
    expect(module).toContain("CREATE TABLE IF NOT EXISTS sign_in_activity_events");
    expect(module).toContain("export async function ensureSignInActivitySchema");
    expect(module).toContain("export async function recordSignInActivity");
    // The record path must never break authentication.
    expect(module).toContain("if (isMissingTableError(error)) return;");
    expect(module).toContain("export async function recordSignInActivity(input: RecordSignInActivityInput): Promise<void>");
  });

  it("keeps a seven-day window and clears older rows and residue automatically", () => {
    expect(module).toContain("export const SIGN_IN_ACTIVITY_RETENTION_DAYS = 7");
    expect(module).toContain("export async function purgeSignInActivity");
    // A hard delete of everything past the cutoff leaves no residue behind.
    expect(module).toContain("DELETE FROM sign_in_activity_events WHERE createdAt < ?");
    // The report itself is bounded to the window even before a purge runs.
    expect(module).toContain("WHERE createdAt >= ${windowStart}");
  });

  it("records customer and administrator sign-ins on every successful authentication", () => {
    expect(core).toContain("recordSignInActivityEvent(req, user, \"signup\", \"customer\", device.deviceName)");
    expect(core).toContain("recordSignInActivityEvent(req, user, \"login\", \"customer\", device.deviceName)");
    expect(core).toContain("recordSignInActivityEvent(req, user, \"login\", \"admin\", device.deviceName)");
  });

  it("guarantees the schema and clears expired activity on boot and on a retention schedule", () => {
    expect(core).toContain("await ensureSignInActivitySchema();");
    expect(core).toContain("void purgeSignInActivity()");
    expect(core).toContain("const signInActivityRetentionTimer = registerWorkerInterval(");
    expect(core).toContain("}, 60 * 60_000);");
  });

  it("exposes an admin-only sign-in activity query", () => {
    expect(router).toContain("signInActivity: adminProcedure.input(z.object({");
    expect(router).toContain("getSignInActivityReport(input?.limit ?? 200)");
    expect(router).toContain('import { getSignInActivityReport, getCustomerSignInActivity } from "./sign-in-activity"');
  });

  it("exposes a customer-only sign-in activity query for their own records", () => {
    expect(router).toContain("signInActivity: protectedProcedure.input(z.object({");
    expect(router).toContain("getCustomerSignInActivity(ctx.user.id, input?.limit ?? 100)");
    expect(module).toContain("export async function getCustomerSignInActivity(userId: number");
    // The customer report must be scoped to a single user id.
    expect(module).toContain("WHERE userId=${userId}");
  });

  it("adds a Sign in Activity menu entry that routes to the dedicated owner component", () => {
    expect(nav).toContain('id: "sign-in-activity", target: "signInActivity", label: "Sign in Activity"');
    expect(appSource).toContain('const AdminSignInActivity = lazy(() => import("@/components/AdminSignInActivity"));');
    expect(appSource).toContain('{section==="signInActivity"&&<Suspense');
    expect(appSource).toContain("<AdminSignInActivity/>");
  });

  it("surfaces the summary, the log and the automatic-clear note in the admin console", () => {
    expect(component).toContain("trpc.adminOperations.signInActivity.useQuery({ limit: 200 }");
    expect(component).toContain("admin-sign-in-metrics");
    expect(component).toContain("Sign-ins (7 days)");
    expect(component).toContain("cleared automatically");
  });

  it("wires the customer 'Sign-in activity' menu item to a real log instead of the generic placeholder", () => {
    expect(appSource).toContain('{ id: "login-activity", label: "Sign-in activity"');
    expect(appSource).toContain("const isLoginActivity=item.id===\"login-activity\"");
    expect(appSource).toContain("isLoginActivity?<Suspense fallback={<div className=\"test-notice\" role=\"status\">Loading sign-in activity…</div>}><CustomerSignInActivity push={push}/></Suspense>");
    expect(appSource).toContain('const CustomerSignInActivity = lazy(() => import("@/components/CustomerSignInActivity")');
    const customerComponent = readFileSync(new URL("../client/src/components/CustomerSignInActivity.tsx", import.meta.url), "utf8");
    expect(customerComponent).toContain("trpc.customer.signInActivity.useQuery({ limit: 100 }");
    expect(customerComponent).toContain("customer-sign-in-list");
    expect(customerComponent).toContain("cleared automatically");
  });
});
