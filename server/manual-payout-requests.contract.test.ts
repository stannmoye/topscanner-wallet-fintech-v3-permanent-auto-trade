import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { transform } from "esbuild";

const db = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
const router = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");
const schema = readFileSync(new URL("../drizzle/schema.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../drizzle/0059_manual_payout_requests.sql", import.meta.url), "utf8");
const lifecycleMigration = readFileSync(new URL("../drizzle/0117_manual_payout_lifecycle.sql", import.meta.url), "utf8");
const migrationRunner = readFileSync(new URL("../scripts/apply-portal-migrations.mjs", import.meta.url), "utf8");
const customerUi = readFileSync(new URL("../client/src/components/PayoutRequests.tsx", import.meta.url), "utf8");
const payoutBrowserAcceptance = readFileSync(new URL("../scripts/payout-browser-acceptance.cjs", import.meta.url), "utf8");
const adminUi = readFileSync(new URL("../client/src/components/AdminOperationsPages.tsx", import.meta.url), "utf8");

const requestStart = db.indexOf("export async function createCustomerPayoutRequest");
const cancelStart = db.indexOf("export async function cancelCustomerPayoutRequest");
const resolveStart = db.indexOf("export async function resolveCustomerPayoutRequest");
const requestService = db.slice(requestStart, cancelStart);
const cancelService = db.slice(cancelStart, resolveStart);
const resolveService = db.slice(resolveStart);

describe("manual payout request lifecycle contract", () => {
  it("limits payout currency to canonical main-wallet assets and tracks requests in a migration", () => {
    expect(db).toContain('new Set(["USD", "EUR", "GBP", "BTC", "ETH", "USDT"])');
    expect(router).toContain('z.enum(["USD", "EUR", "GBP", "BTC", "ETH", "USDT"])');
    expect(customerUi).toContain('["USD", "EUR", "GBP", "BTC", "ETH", "USDT"] as const');
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS `payout_requests`");
    expect(migration).toContain("payout_requests_external_reference_unique");
    expect(schema).toContain('export const payoutRequests = mysqlTable("payout_requests"');
    expect(schema).toContain('"confirming", "processing", "completed", "declined", "cancelled"');
    expect(lifecycleMigration).toContain("CREATE TABLE IF NOT EXISTS `payout_requests`");
    expect(lifecycleMigration).toContain("payout_requests_external_reference_unique");
    expect(lifecycleMigration).toContain("ENUM('confirming','processing','completed','declined','cancelled')");
    expect(lifecycleMigration).toContain("SET `status` = 'confirming' WHERE `status` = 'pending'");
    expect(lifecycleMigration).toContain("SET `status` = 'declined' WHERE `status` = 'rejected'");
    expect(migrationRunner).toContain('"0059_manual_payout_requests.sql"');
    expect(migrationRunner).toContain('"0117_manual_payout_lifecycle.sql"');
    expect(migrationRunner).toContain('"payout_requests"');
  });

  it("lets every customer request a withdrawal without policy, account-status, KYC, or 2FA gates", () => {
    expect(requestStart).toBeGreaterThanOrEqual(0);
    expect(cancelStart).toBeGreaterThan(requestStart);
    expect(requestService).toContain("payoutIdempotencyKey(userId, input.idempotencyKey)");
    expect(requestService).not.toContain("assertPayoutPolicyAllowsRequest");
    expect(db).not.toContain("assertPayoutPolicyAllowsRequest");
    expect(db).not.toContain('policy.withdrawals !== true');
    expect(db).not.toContain('controls.withdrawalsEnabled !== true');
    expect(db).not.toContain('profile?.overallStatus !== "VERIFIED"');
    expect(db).not.toContain("controls.emailVerified !== true");
    expect(db).not.toContain("policy.twofa === true || controls.twoFactorRequired === true");
    expect(db).not.toContain("consumePayoutAuthenticatorCode");
    expect(db).toContain("return { allowed: true, reason: null };");
  });

  it("uses row locks and reserves only non-promotional funds atomically", () => {
    expect(requestService).toContain('from(users).where(eq(users.id, userId)).limit(1).for("update")');
    expect(requestService).toContain("prior.destinationDetails === destinationDetails");
    expect(requestService).toContain("Number.isSafeInteger(input.amountMinor)");
    expect(requestService).toContain("promotional > available");
    expect(requestService).toContain("input.amountMinor > available - promotional");
    expect(requestService).toContain('const expectedDestinationType = cryptoCurrency ? "crypto_transfer" : "bank_transfer"');
    expect(requestService).toContain("no conversion is performed.");
    expect(requestService).toContain("Payout wallet reservation");
    expect(requestService).toContain('entryType: "payout_reserve"');
    expect(requestService).toContain("status: initialPayoutRequestStatus(currencyCode)");
    expect(requestService).toContain("notifyAdminsOfPayoutRequest(outcome.request, resolvedScale)");
    expect(requestService).toContain("openPayoutSupportTicket(outcome.request, resolvedScale)");
    expect(db).toContain("async function openPayoutSupportTicket(");
    expect(db).toContain('createTicket(request.userId, { subject, body, priority: "high", category: "wallet" })');
  });

  it("uses stable bounded continuation pages for customer and admin history instead of truncating", () => {
    expect(db).toContain("function payoutHistoryPageSize(value?: number)");
    expect(db).toContain("pageSize > 100");
    expect(db).toContain("rows.length > pageSize");
    expect(db).toContain("nextCursor: hasMore");
    expect(db).toContain("orderBy(desc(payoutRequests.createdAt), desc(payoutRequests.id))");
    expect(db).toContain("payoutHistoryCursorPredicate(cursor)");
    const payoutRoutes = router.slice(router.indexOf("payoutRequests: protectedProcedure"), router.indexOf("requestPayout:", router.indexOf("payoutRequests: protectedProcedure"))) + router.slice(router.indexOf("payoutRequests: adminProcedure"), router.indexOf("resolvePayoutRequest:", router.indexOf("payoutRequests: adminProcedure")));
    expect(payoutRoutes.match(/pageSize: z.number\(\).int\(\).min\(1\).max\(100\)/g)).toHaveLength(2);
  });
  it("releases reserved funds on customer cancellation or admin decline", () => {
    expect(cancelService).toContain('eq(payoutRequests.userId, userId)');
    expect(cancelService).toContain("!isOpenPayoutStatus(request.status)");
    expect(cancelService).toContain("Payout cancellation wallet release");
    expect(cancelService).toContain('status: "cancelled"');
    expect(resolveService).toContain("Payout rejection wallet release");
    expect(resolveService).toContain('entryType: "payout_release"');
  });

  it("requires a unique external reference for payout completion and never triggers an automatic transfer", () => {
    expect(resolveService).toContain("externalReference.length < 3");
    expect(resolveService).toContain("note.length < 3");
    expect(resolveService).toContain("resolutionNote: note || null");
    expect(router).toContain('note: z.string().trim().min(3).max(1000)');
    expect(resolveService).toContain("duplicateReference");
    expect(resolveService).toContain("Payout paid wallet settlement");
    expect(resolveService).toContain('entryType: "payout_paid"');
    expect(resolveService).toContain('status: input.action');
    expect(schema).toContain('externalReferenceUnique: uniqueIndex("payout_requests_external_reference_unique")');
    expect(resolveService).not.toContain("transferProvider");
    expect(resolveService).not.toContain("sendExternalTransfer");
    const deleteStart = db.indexOf("export async function deleteAdminCustomer");
    const deleteService = db.slice(deleteStart);
    expect(deleteService).toContain("Direct customer deletion is disabled.");
    expect(deleteService).toContain("explicit administrator decision workflow");
    expect(router).toContain('code: "PRECONDITION_FAILED"');
    expect(router).toContain("deleteAdminCustomer(input.userId)");
  });

  it("exposes only customer-owned requests and admin-only resolution in the router", () => {
    expect(router).toContain("payoutEligibility: protectedProcedure.query(({ ctx }) => getCustomerPayoutEligibility(ctx.user.id))");
    expect(router).toContain("listCustomerPayoutRequests(ctx.user.id, input ?? {})");
    expect(router).toContain("cancelCustomerPayoutRequest(ctx.user.id, input.requestId)");
    expect(router).toContain("listAdminPayoutRequests(input ?? {})");
    expect(router).toContain("resolveCustomerPayoutRequest(ctx.user.id, input)");
    expect(customerUi).toContain("trpc.customer.payoutEligibility.useQuery");
    expect(customerUi).toContain("eligibility.data?.allowed !== false");
    expect(customerUi).toContain('className="payout-eligibility-alert" role="alert"');
    expect(customerUi).toContain("!payoutAllowed || !amountValid");
    expect(customerUi).toContain('setAmountText(""); setWalletAddress(""); setNetwork(firstPayoutNetwork(nextCurrency));');
    expect(customerUi).toContain("Never enter your account password, private keys, or seed phrases.");
    expect(customerUi).toContain('id="payout-pin"');
    expect(customerUi).toContain("pinValid");
    expect(customerUi).toContain('id="payout-network"');
    expect(customerUi).toContain('id="payout-wallet-address"');
    expect(customerUi).toContain("composeCryptoDestination(network, walletAddress)");
    expect(customerUi).toContain("composeBankDestination({ beneficiaryName, bankName, accountNumber, swiftCode, bankCountry })");
    expect(customerUi).toContain("Auto-generated withdrawal record");
    expect(adminUi).toContain("Decline and release");
    expect(adminUi).toContain("Mark successful");
  });

  it("keeps payout list and review actions on the dedicated owner component only", () => {
    const reviewStart = adminUi.indexOf("export function AdminTransactionReview");
    const payoutStart = adminUi.indexOf("export function AdminManualPayouts()");
    const nextComponent = adminUi.indexOf("function csvCell(value: unknown)", payoutStart);
    expect(reviewStart).toBeGreaterThanOrEqual(0);
    expect(payoutStart).toBeGreaterThan(reviewStart);
    expect(nextComponent).toBeGreaterThan(payoutStart);
    const financeAndSettlement = adminUi.slice(reviewStart, payoutStart);
    const payoutOwner = adminUi.slice(payoutStart, nextComponent);
    expect(financeAndSettlement).not.toContain("adminOperations.payoutRequests");
    expect(financeAndSettlement).not.toContain("adminOperations.resolvePayoutRequest");
    expect(payoutOwner).toContain("trpc.adminOperations.payoutRequests.useQuery");
    expect(payoutOwner).toContain("trpc.adminOperations.resolvePayoutRequest.useMutation");
    expect(payoutOwner).toContain('action: "completed"');
    expect(payoutOwner).toContain('action: "declined"');
    expect(payoutOwner).toContain("No external bank or blockchain transfer is initiated here.");
  });

  it("keeps the payout browser acceptance script parseable and focused on real user-visible flow states", async () => {
    const parsed = await transform(payoutBrowserAcceptance, { loader: "js", target: "node22" });
    expect(parsed.code).toContain('procedure === "customer.requestPayout"');
    expect(payoutBrowserAcceptance).toContain('procedure === "customer.requestPayout"');
    expect(payoutBrowserAcceptance).toContain('procedure === "customer.cancelPayoutRequest"');
    expect(payoutBrowserAcceptance).toContain('procedure === "customer.withdrawalPinStatus"');
    expect(payoutBrowserAcceptance).toContain('getByLabel("Withdrawal PIN")');
    expect(payoutBrowserAcceptance).toContain("withdrawal PIN is required before a request can be submitted");
    expect(payoutBrowserAcceptance).toContain("Available for withdrawal: USD 80.00");
    expect(payoutBrowserAcceptance).toContain('getByText("Processing", { exact: true })');
    expect(payoutBrowserAcceptance).toContain('getByText(/External: BANK-TRANSFER-VERIFIED-001/)');
    expect(payoutBrowserAcceptance).toContain("const pendingStatusVisible = await pendingStatus.isVisible().catch(() => false);")
    expect(payoutBrowserAcceptance).toContain("staleDestinationCleared");
    expect(payoutBrowserAcceptance).toContain("Cancelled · funds released");
    expect(payoutBrowserAcceptance).toContain("No external bank or blockchain transfer is initiated.");
    expect(payoutBrowserAcceptance).toContain("async function runAdminPayoutReview(browser)");
    expect(payoutBrowserAcceptance).toContain("External transfer reference for payout-admin-paid-1");
    expect(payoutBrowserAcceptance).toContain("Required operator note for payout-admin-reject-1");
    expect(payoutBrowserAcceptance).toContain("async function runAdminPayoutReview(browser)");
    expect(payoutBrowserAcceptance).toContain("External transfer reference for payout-admin-paid-1");
    expect(payoutBrowserAcceptance).toContain("Required operator note for payout-admin-reject-1");
  });
});
