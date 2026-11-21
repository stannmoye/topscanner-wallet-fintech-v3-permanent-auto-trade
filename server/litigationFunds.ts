import crypto from "node:crypto";
import mysql from "mysql2/promise";
import { mysqlConnectionOptions } from "./_core/mysql";
import {
  compareLitigationCases,
  getLitigationFundsCatalogue,
  type LitigationCase,
  type LitigationBundle,
  type LitigationOutcome,
} from "@shared/litigation-funds-catalogue";
import {
  applyDossierOutcome,
  findAdminLitigationDossier,
  findEnabledAdminLitigationBundle,
  findEnabledAdminLitigationDossier,
  listEnabledAdminLitigationBundles,
  listEnabledAdminLitigationDossiers,
  LITIGATION_BUNDLES_TABLE,
  LITIGATION_DOSSIERS_TABLE,
} from "./litigationFundDossiers";
import {
  FxRateUnavailableError,
  planCrossWalletFunding,
  calculateCombinedAvailableTargetMinor,
  type FxRateSnapshot,
} from "./modules/trading-wallet-fx";
import { getFreshTradingFxRate, getWalletFundingPriorityForFunding } from "./db";

type Db = mysql.PoolConnection;

/**
 * Additive, self-hosted storage for Litigation Funds positions (kept outside
 * Drizzle, matching the cooperateDept / treasuryBonds template).
 *
 * A position is a customer's money placed into ONE case share or ONE case
 * bundle. Purchases settle in USD and may be funded from the settlement wallet,
 * any single funded wallet, or every funded wallet combined through live FX —
 * the same cross-wallet engine as the rest of the platform.
 */
export const LITIGATION_POSITIONS_TABLE = "litigation_fund_positions";

const CREATE_POSITIONS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS litigation_fund_positions (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  positionCode VARCHAR(40) NOT NULL,
  userId INT NOT NULL,
  instrumentType VARCHAR(16) NOT NULL,
  instrumentId VARCHAR(80) NOT NULL,
  instrumentName VARCHAR(200) NOT NULL,
  claimType VARCHAR(120) NULL,
  jurisdiction VARCHAR(120) NULL,
  countryCode VARCHAR(8) NULL,
  amountMinor BIGINT NOT NULL,
  currency VARCHAR(12) NOT NULL DEFAULT 'USD',
  fundingSource VARCHAR(24) NULL,
  fundingPlanJson TEXT NULL,
  units INT NULL,
  stageAtPurchase VARCHAR(24) NULL,
  statusAtPurchase VARCHAR(24) NULL,
  expectedMultipleBps INT NULL,
  outcome VARCHAR(16) NULL,
  realisedMinor BIGINT NULL,
  settledAt DATETIME NULL,
  dataSource VARCHAR(160) NULL,
  dataAsOf VARCHAR(24) NULL,
  positionStatus VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
  openedAt DATETIME NOT NULL,
  ledgerReference VARCHAR(160) NOT NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY litigation_fund_positions_code_idx (positionCode),
  KEY litigation_fund_positions_user_idx (userId, positionStatus),
  KEY litigation_fund_positions_instrument_idx (instrumentType, instrumentId, outcome)
) ENGINE=InnoDB`;

/** Every Litigation Funds purchase settles into this currency; other wallets fund it through live FX. */
const SETTLEMENT_CURRENCY = "USD";
export const LITIGATION_COMBINED_SOURCE = "COMBINED";
const MAX_PURCHASE_MINOR = 100_000_000; // $1,000,000 ceiling per purchase

export type LitigationInstrumentType = "CASE" | "BUNDLE";

type WalletRow = {
  id: number;
  currency: string;
  scale: number;
  assetType: "fiat" | "crypto" | "token";
  externalCode: string | null;
  symbol: string | null;
  currencyName: string | null;
  availableMinor: number;
  lockedMinor: number;
};

type FundingDebit = { currency: string; amountMinor: number; convertedUsdMinor: number; rate: FxRateSnapshot };

type PurchaseFundingPlan = {
  requiredUsdMinor: number;
  usdAvailableMinor: number;
  convertedUsdMinor: number;
  debits: FundingDebit[];
  targetRate: FxRateSnapshot;
};

async function withConnection<T>(fn: (conn: Db) => Promise<T>) {
  const pool = mysql.createPool({ ...mysqlConnectionOptions(), connectionLimit: 2 });
  const conn = await pool.getConnection();
  try { return await fn(conn); } finally { conn.release(); await pool.end(); }
}

let schemaReady: Promise<void> | null = null;

/** Idempotently ensure the additive positions table exists (memoized). */
export function ensureLitigationFundsSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    try {
      if (!process.env.DATABASE_URL) return;
      await withConnection(async (conn) => { await conn.query(CREATE_POSITIONS_TABLE_SQL); });
    } catch (error) {
      schemaReady = null;
      console.error("[LitigationFunds] Failed to ensure schema:", error instanceof Error ? error.message : "UnknownError");
    }
  })();
  return schemaReady;
}

function idempotencyKey(input: string | undefined, userId: number) {
  const value = String(input || "").trim();
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(value)) throw new Error("A valid idempotency key is required");
  return `litigation-funds:${userId}:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

/** The dollar value of one unit of the settlement currency is fixed parity. */
function usdUnitRate(scale: number): FxRateSnapshot {
  return {
    currency: SETTLEMENT_CURRENCY,
    scale,
    rateUsdPerUnit: "1",
    provider: "platform-parity",
    sourceDate: new Date().toISOString().slice(0, 10),
    fetchedAt: new Date(),
  };
}

/** Lock or read every enabled, spendable wallet for a customer. */
async function readWalletRows(conn: Db, userId: number, forUpdate = false): Promise<WalletRow[]> {
  const [rows] = await conn.query<any[]>(
    `SELECT b.id, b.currency, c.scale, c.assetType, c.externalCode, c.symbol, c.name currencyName,
            COALESCE(b.availableMinor,0) availableMinor, COALESCE(b.lockedMinor,0) lockedMinor
     FROM customer_balances b
     INNER JOIN currency_registry c ON c.code=b.currency
     WHERE b.userId=? AND c.enabled=true
     ORDER BY b.currency${forUpdate ? " FOR UPDATE" : ""}`,
    [userId],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    currency: String(row.currency).toUpperCase(),
    scale: Number(row.scale || 0),
    assetType: row.assetType,
    externalCode: row.externalCode ? String(row.externalCode) : null,
    symbol: row.symbol ? String(row.symbol) : null,
    currencyName: row.currencyName ? String(row.currencyName) : null,
    availableMinor: Number(row.availableMinor || 0),
    lockedMinor: Number(row.lockedMinor || 0),
  }));
}

async function loadWalletRates(wallets: WalletRow[]): Promise<Map<string, FxRateSnapshot | null>> {
  const rates = new Map<string, FxRateSnapshot | null>();
  await Promise.all(
    wallets
      .filter((wallet) => wallet.currency !== SETTLEMENT_CURRENCY && wallet.availableMinor > 0)
      .map(async (wallet) => {
        try {
          rates.set(wallet.currency, await getFreshTradingFxRate({
            code: wallet.currency, scale: wallet.scale, assetType: wallet.assetType, externalCode: wallet.externalCode,
          }));
        } catch {
          rates.set(wallet.currency, null);
        }
      }),
  );
  return rates;
}

/**
 * Build the all-or-nothing funding plan for a purchase that settles in USD.
 * `COMBINED` spends the settlement wallet first then draws on the other funded
 * wallets in administrator priority order through live FX; a currency code funds
 * the whole purchase from that one wallet. Any shortfall or missing rate throws;
 * nothing is ever debited partially.
 */
function planPurchaseFunding(
  wallets: WalletRow[],
  rates: Map<string, FxRateSnapshot | null>,
  requiredUsdMinor: number,
  fundingSource: string,
  priorityOrder: string[] | null,
): PurchaseFundingPlan {
  if (!Number.isSafeInteger(requiredUsdMinor) || requiredUsdMinor < 1) throw new Error("Enter a valid investment amount");
  if (requiredUsdMinor > MAX_PURCHASE_MINOR) throw new Error("This amount exceeds the per-purchase ceiling for the Litigation Funds desk");

  const usd = wallets.find((wallet) => wallet.currency === SETTLEMENT_CURRENCY);
  const usdScale = usd ? usd.scale : 2;
  const usdAvailableMinor = usd ? usd.availableMinor : 0;
  const targetRate = usdUnitRate(usdScale);
  const source = String(fundingSource || LITIGATION_COMBINED_SOURCE).trim().toUpperCase();
  const insufficient = new Error("Insufficient combined spendable wallet balance at current exchange rates");

  if (source === SETTLEMENT_CURRENCY) {
    if (requiredUsdMinor <= usdAvailableMinor) return { requiredUsdMinor, usdAvailableMinor, convertedUsdMinor: 0, debits: [], targetRate };
    throw insufficient;
  }

  const fundedNonSettlement = wallets.filter((wallet) => wallet.currency !== SETTLEMENT_CURRENCY && wallet.availableMinor > 0);
  const candidates = source === LITIGATION_COMBINED_SOURCE
    ? fundedNonSettlement
    : fundedNonSettlement.filter((wallet) => wallet.currency === source);

  if (source === LITIGATION_COMBINED_SOURCE && requiredUsdMinor <= usdAvailableMinor && !candidates.length) {
    return { requiredUsdMinor, usdAvailableMinor, convertedUsdMinor: 0, debits: [], targetRate };
  }
  const targetAvailableMinor = source === LITIGATION_COMBINED_SOURCE ? usdAvailableMinor : 0;
  if (requiredUsdMinor <= targetAvailableMinor) return { requiredUsdMinor, usdAvailableMinor, convertedUsdMinor: 0, debits: [], targetRate };
  if (!candidates.length) throw insufficient;

  const plan = planCrossWalletFunding({
    requiredTargetMinor: requiredUsdMinor,
    targetAvailableMinor,
    targetRate,
    sourceWallets: candidates.map((wallet) => ({
      currency: wallet.currency, scale: wallet.scale, availableMinor: wallet.availableMinor, rate: rates.get(wallet.currency) ?? null,
    })),
    priorityCurrencies: source === LITIGATION_COMBINED_SOURCE ? priorityOrder : null,
  });

  return {
    requiredUsdMinor,
    usdAvailableMinor,
    convertedUsdMinor: plan.targetCreditMinor,
    debits: plan.sourceDebits.map((debit) => ({
      currency: debit.currency, amountMinor: debit.amountMinor, convertedUsdMinor: debit.convertedTargetMinor, rate: debit.rate,
    })),
    targetRate,
  };
}

/**
 * Read one customer's stored positions and wallet balances. Best-effort: a
 * database hiccup must never hide the live public catalogue.
 */
async function readLitigationStore(userId: number): Promise<{ positions: any[]; balances: any[]; warning: string | null }> {
  try {
    await ensureLitigationFundsSchema();
    return await withConnection(async (conn) => {
      const [positions] = await conn.query<any[]>(
        `SELECT id, positionCode, instrumentType, instrumentId, instrumentName, claimType, jurisdiction, countryCode,
                amountMinor, currency, fundingSource, units, stageAtPurchase, statusAtPurchase, expectedMultipleBps,
                outcome, realisedMinor, settledAt, dataSource, dataAsOf, positionStatus, openedAt, ledgerReference
         FROM litigation_fund_positions WHERE userId=? ORDER BY openedAt DESC`,
        [userId],
      );
      const [balances] = await conn.query<any[]>(
        `SELECT c.code currency, c.symbol, c.scale, c.name currencyName,
                COALESCE(b.availableMinor,0) availableMinor, COALESCE(b.lockedMinor,0) lockedMinor,
                COALESCE(b.promotionalMinor,0) promotionalMinor, COALESCE(b.earnedMinor,0) earnedMinor
         FROM currency_registry c LEFT JOIN customer_balances b ON b.currency=c.code AND b.userId=?
         WHERE c.enabled=true ORDER BY c.id`,
        [userId],
      );
      return { positions, balances, warning: null };
    });
  } catch (error) {
    console.error("[LitigationFunds] Failed to read position store:", error instanceof Error ? error.message : "UnknownError");
    return {
      positions: [],
      balances: [],
      warning: "Your saved positions and wallet balances could not be loaded right now. The live catalogue below is unaffected.",
    };
  }
}

async function readAdminDossiers(): Promise<LitigationCase[]> {
  try { return await listEnabledAdminLitigationDossiers(); }
  catch (error) {
    console.error("[LitigationFunds] Failed to read administrator dossiers:", error instanceof Error ? error.message : "UnknownError");
    return [];
  }
}

async function readAdminBundles(): Promise<LitigationBundle[]> {
  try { return await listEnabledAdminLitigationBundles(); }
  catch (error) {
    console.error("[LitigationFunds] Failed to read administrator bundles:", error instanceof Error ? error.message : "UnknownError");
    return [];
  }
}

/**
 * Assemble the Litigation Funds desk for one customer: administrator dossiers
 * merged with the live public discovery catalogue, administrator bundles, that
 * customer's positions, wallet balances and a derived summary. Catalogue and
 * storage reads run independently so a failure in one still returns the rest.
 */
export async function getLitigationFundsDashboard(userId: number) {
  const [catalogue, store, adminCases, bundles] = await Promise.all([
    getLitigationFundsCatalogue(),
    readLitigationStore(userId),
    readAdminDossiers(),
    readAdminBundles(),
  ]);

  const cases = [...adminCases, ...catalogue.cases].sort(compareLitigationCases);
  const sources = adminCases.length
    ? [...catalogue.sources, {
        name: "Arbitrade litigation desk — administrator published",
        url: "",
        country: "XX",
        role: "context" as const,
        status: "ok" as const,
        detail: `${adminCases.length} administrator-reviewed dossier${adminCases.length === 1 ? "" : "s"} with sourced economics`,
      }]
    : catalogue.sources;

  const positions = store.positions;
  const balances = store.balances;
  const active = positions.filter((p) => p.positionStatus === "ACTIVE");
  const committedMinor = active.reduce((sum, p) => sum + Number(p.amountMinor || 0), 0);
  const realisedMinor = positions.reduce((sum, p) => sum + Number(p.realisedMinor || 0), 0);
  const summary = {
    committedMinor,
    activePositions: active.length,
    settledPositions: positions.filter((p) => p.positionStatus === "SETTLED").length,
    writtenOffPositions: positions.filter((p) => p.positionStatus === "WRITTEN_OFF").length,
    fundableCases: cases.filter((item) => item.fundable).length,
    bundles: bundles.length,
    realisedMinor,
  };
  const usd = balances.find((b) => b.currency === SETTLEMENT_CURRENCY);
  return {
    cases,
    bundles,
    positions,
    balances,
    wallets: balances,
    settlementCurrency: SETTLEMENT_CURRENCY,
    combinedSource: LITIGATION_COMBINED_SOURCE,
    availableMinor: Number(usd?.availableMinor || 0),
    summary,
    sources,
    fetchedAt: catalogue.fetchedAt,
    degraded: catalogue.degraded,
    storeWarning: store.warning,
  };
}

/**
 * Preview how a purchase would be funded without touching any balance. Returns
 * the combined spendable value and the exact per-wallet debits. Fails soft: an
 * unknown rate or shortfall is reported as a shortfall, not an error.
 */
export async function quoteLitigationFundPurchase(
  userId: number,
  input: { amountMinor: number; fundingSource?: string },
) {
  const amountMinor = Math.round(Number(input.amountMinor) || 0);
  const wallets = await withConnection((conn) => readWalletRows(conn, userId));
  const rates = await loadWalletRates(wallets);
  const usd = wallets.find((wallet) => wallet.currency === SETTLEMENT_CURRENCY);
  const targetRate = usdUnitRate(usd ? usd.scale : 2);

  let combinedAvailableMinor: number | null = null;
  try {
    combinedAvailableMinor = calculateCombinedAvailableTargetMinor({
      targetCurrency: SETTLEMENT_CURRENCY,
      targetRate,
      wallets: wallets.map((wallet) => ({
        currency: wallet.currency,
        scale: wallet.scale,
        availableMinor: wallet.availableMinor,
        rate: wallet.currency === SETTLEMENT_CURRENCY ? null : rates.get(wallet.currency) ?? null,
      })),
    });
  } catch {
    combinedAvailableMinor = null;
  }

  const priority = await getWalletFundingPriorityForFunding();
  const order = "blocked" in priority ? null : priority.order;

  try {
    const plan = planPurchaseFunding(wallets, rates, amountMinor, String(input.fundingSource || LITIGATION_COMBINED_SOURCE), order);
    return {
      amountMinor,
      fundingSource: String(input.fundingSource || LITIGATION_COMBINED_SOURCE).toUpperCase(),
      sufficient: true,
      combinedAvailableMinor,
      settlementCurrency: SETTLEMENT_CURRENCY,
      usdAvailableMinor: plan.usdAvailableMinor,
      convertedUsdMinor: plan.convertedUsdMinor,
      shortfallMinor: 0,
      debits: plan.debits.map((debit) => ({
        currency: debit.currency, amountMinor: debit.amountMinor, convertedUsdMinor: debit.convertedUsdMinor,
        rate: debit.rate.rateUsdPerUnit, rateProvider: debit.rate.provider,
      })),
      message: null as string | null,
    };
  } catch (error) {
    const rateGap = error instanceof FxRateUnavailableError;
    const shortfallMinor = combinedAvailableMinor !== null ? Math.max(0, amountMinor - combinedAvailableMinor) : amountMinor;
    return {
      amountMinor,
      fundingSource: String(input.fundingSource || LITIGATION_COMBINED_SOURCE).toUpperCase(),
      sufficient: false,
      combinedAvailableMinor,
      settlementCurrency: SETTLEMENT_CURRENCY,
      usdAvailableMinor: usd ? usd.availableMinor : 0,
      convertedUsdMinor: 0,
      shortfallMinor,
      debits: [],
      message: rateGap ? (error as Error).message : "Insufficient combined spendable wallet balance at current exchange rates",
    };
  }
}

type ResolvedInstrument = {
  instrumentType: LitigationInstrumentType;
  instrumentId: string;
  instrumentName: string;
  claimType: string | null;
  jurisdiction: string | null;
  countryCode: string | null;
  stage: string | null;
  status: string | null;
  expectedMultipleBps: number | null;
  unitPriceMinor: number | null;
  source: string;
  asOf: string;
};

/** Resolve the administrator-published instrument a customer is funding. */
async function resolveInstrument(instrumentType: LitigationInstrumentType, instrumentId: string): Promise<ResolvedInstrument> {
  if (instrumentType === "CASE") {
    const item = await findEnabledAdminLitigationDossier(instrumentId);
    if (!item) throw new Error("This case is not currently published on the Litigation Funds desk. Refresh and try again.");
    if (!item.fundable) throw new Error("This case is not open for funding (its outcome scenarios or target are not yet published).");
    return {
      instrumentType, instrumentId: item.id, instrumentName: item.caseName, claimType: item.claimType,
      jurisdiction: item.jurisdiction, countryCode: item.countryCode, stage: item.stage, status: item.status,
      expectedMultipleBps: item.expectedMultipleBps, unitPriceMinor: null, source: item.source, asOf: item.asOf,
    };
  }
  const bundle = await findEnabledAdminLitigationBundle(instrumentId);
  if (!bundle || !bundle.enabled) throw new Error("This bundle is not currently open on the Litigation Funds desk. Refresh and try again.");
  return {
    instrumentType, instrumentId: bundle.id, instrumentName: bundle.name, claimType: bundle.claimType,
    jurisdiction: bundle.jurisdiction, countryCode: null, stage: null, status: null,
    expectedMultipleBps: bundle.expectedMultipleBps, unitPriceMinor: bundle.unitPriceMinor, source: bundle.source, asOf: bundle.asOf,
  };
}

/**
 * Fund a case share or a case bundle with the customer's own money. Settles in
 * USD and may be funded from the settlement wallet, a single chosen wallet, or
 * every wallet combined through live FX. The wallet ledger is debited per source
 * wallet, the amount is locked, and one durable position plus a notice is written
 * in a single transaction. Idempotent per request key; the instrument's published
 * data is re-read server-side so a client cannot dictate its merits or source.
 */
export async function purchaseLitigationFund(
  userId: number,
  input: { instrumentType: LitigationInstrumentType; instrumentId: string; amountMinor: number; fundingSource?: string; idempotencyKey: string },
) {
  await ensureLitigationFundsSchema();
  if (input.instrumentType !== "CASE" && input.instrumentType !== "BUNDLE") throw new Error("Select a valid instrument to fund");
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new Error("Enter a valid investment amount");
  if (input.amountMinor > MAX_PURCHASE_MINOR) throw new Error("This amount exceeds the per-purchase ceiling for the Litigation Funds desk");

  const instrument = await resolveInstrument(input.instrumentType, String(input.instrumentId || ""));
  const fundingSource = String(input.fundingSource || LITIGATION_COMBINED_SOURCE).trim().toUpperCase();
  const key = idempotencyKey(input.idempotencyKey, userId);
  const units = instrument.unitPriceMinor && instrument.unitPriceMinor > 0
    ? Math.floor(input.amountMinor / instrument.unitPriceMinor) : null;

  // Rates and the administrator funding order resolve before the transaction
  // opens: network calls must never run while wallet rows are locked.
  const priority = await getWalletFundingPriorityForFunding();
  if ("blocked" in priority) throw new Error(priority.blocked);
  const preWallets = await withConnection((conn) => readWalletRows(conn, userId));
  const rates = await loadWalletRates(preWallets);

  return withConnection(async (conn) => {
    await conn.beginTransaction();
    try {
      const [prior] = await conn.query<any[]>(
        `SELECT resultJson FROM v5_idempotency_keys WHERE userId=? AND keyValue=? LIMIT 1 FOR UPDATE`,
        [userId, key],
      );
      if (prior.length) { await conn.commit(); return JSON.parse(prior[0].resultJson); }

      await conn.execute(
        `INSERT INTO customer_balances (userId,currency,availableMinor,lockedMinor,promotionalMinor,earnedMinor) VALUES (?,?,0,0,0,0) ON DUPLICATE KEY UPDATE userId=userId`,
        [userId, SETTLEMENT_CURRENCY],
      );
      const wallets = await readWalletRows(conn, userId, true);
      const plan = planPurchaseFunding(wallets, rates, input.amountMinor, fundingSource, priority.order);

      const now = new Date();
      const positionCode = `LF-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
      const reference = `litigation-funds-purchase:${positionCode}`;

      for (const debit of plan.debits) {
        const row = wallets.find((wallet) => wallet.currency === debit.currency);
        if (!row) throw new Error(`Source wallet ${debit.currency} disappeared during funding`);
        const [update] = await conn.execute<any>(
          `UPDATE customer_balances SET availableMinor=availableMinor-?, updatedAt=NOW() WHERE id=? AND availableMinor>=?`,
          [debit.amountMinor, row.id, debit.amountMinor],
        );
        if (Number(update.affectedRows || 0) !== 1) throw new Error(`Insufficient spendable ${debit.currency} balance to fund this investment`);
        await conn.execute(
          `INSERT INTO balance_ledger (userId,currency,amountMinor,entryType,reference,withdrawable) VALUES (?,?,?,?,?,false)`,
          [userId, debit.currency, -debit.amountMinor, "litigation_funds_fx_debit", `${reference}-fx-${debit.currency}-debit`],
        );
        await conn.execute(
          `INSERT INTO balance_ledger (userId,currency,amountMinor,entryType,reference,withdrawable) VALUES (?,?,?,?,?,false)`,
          [userId, SETTLEMENT_CURRENCY, debit.convertedUsdMinor, "litigation_funds_fx_credit", `${reference}-fx-${debit.currency}-credit`],
        );
        await conn.execute(
          `INSERT INTO fx_rate_snapshots (baseAsset,quoteAsset,rate,provider,sourceDate,rawJson) VALUES (?,?,?,?,?,?)`,
          [
            debit.currency, SETTLEMENT_CURRENCY, debit.rate.rateUsdPerUnit, debit.rate.provider, debit.rate.sourceDate,
            JSON.stringify({
              purpose: "litigation_funds_cross_wallet_conversion",
              positionCode, targetCurrency: SETTLEMENT_CURRENCY,
              targetCreditMinor: debit.convertedUsdMinor, sourceDebitMinor: debit.amountMinor,
              fetchedAt: debit.rate.fetchedAt.toISOString(), scale: debit.rate.scale,
            }),
          ],
        );
      }

      const usdRow = wallets.find((wallet) => wallet.currency === SETTLEMENT_CURRENCY)!;
      const minimumFromSettlement = Math.max(0, input.amountMinor - plan.convertedUsdMinor);
      const [settlementUpdate] = await conn.execute<any>(
        `UPDATE customer_balances SET availableMinor=availableMinor+?-?, lockedMinor=lockedMinor+?, updatedAt=NOW() WHERE id=? AND availableMinor>=?`,
        [plan.convertedUsdMinor, input.amountMinor, input.amountMinor, usdRow.id, minimumFromSettlement],
      );
      if (Number(settlementUpdate.affectedRows || 0) !== 1) throw new Error("Insufficient available settlement balance to complete this investment");
      await conn.execute(
        `INSERT INTO balance_ledger (userId,currency,amountMinor,entryType,reference,withdrawable) VALUES (?,?,?,?,?,false)`,
        [userId, SETTLEMENT_CURRENCY, -input.amountMinor, "litigation_funds_purchase", reference],
      );

      const fundingPlanJson = JSON.stringify({
        fundingSource,
        settlementCurrency: SETTLEMENT_CURRENCY,
        requiredUsdMinor: input.amountMinor,
        settlementWalletMinor: input.amountMinor - plan.convertedUsdMinor,
        convertedUsdMinor: plan.convertedUsdMinor,
        sourceDebits: plan.debits.map((debit) => ({
          currency: debit.currency, amountMinor: debit.amountMinor, convertedUsdMinor: debit.convertedUsdMinor,
          rate: debit.rate.rateUsdPerUnit, rateProvider: debit.rate.provider, rateSourceDate: debit.rate.sourceDate,
        })),
        recordedAt: now.toISOString(),
      });

      await conn.execute(
        `INSERT INTO ${LITIGATION_POSITIONS_TABLE}
          (positionCode,userId,instrumentType,instrumentId,instrumentName,claimType,jurisdiction,countryCode,amountMinor,currency,fundingSource,fundingPlanJson,units,stageAtPurchase,statusAtPurchase,expectedMultipleBps,dataSource,dataAsOf,positionStatus,openedAt,ledgerReference)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'ACTIVE', NOW(), ?)`,
        [
          positionCode, userId, instrument.instrumentType, instrument.instrumentId, instrument.instrumentName,
          instrument.claimType, instrument.jurisdiction, instrument.countryCode, input.amountMinor, SETTLEMENT_CURRENCY,
          fundingSource, fundingPlanJson, units, instrument.stage, instrument.status, instrument.expectedMultipleBps,
          instrument.source, instrument.asOf, reference,
        ],
      );

      // Record the customer's contribution against the instrument's live progress.
      if (instrument.instrumentType === "CASE") {
        await conn.execute(`UPDATE ${LITIGATION_DOSSIERS_TABLE} SET committedMinor=committedMinor+?, updatedAt=NOW(3) WHERE dossierId=?`, [input.amountMinor, instrument.instrumentId]);
      } else {
        await conn.execute(`UPDATE ${LITIGATION_BUNDLES_TABLE} SET committedMinor=committedMinor+?, updatedAt=NOW(3) WHERE bundleId=?`, [input.amountMinor, instrument.instrumentId]);
      }

      const fundingLabel = plan.debits.length
        ? `funded from ${plan.debits.map((debit) => debit.currency).join(", ")} alongside ${SETTLEMENT_CURRENCY}`
        : `funded from your ${SETTLEMENT_CURRENCY} balance`;
      await conn.execute(
        `INSERT INTO customer_notifications (userId,title,body,eventKey,category,priority) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE eventKey=VALUES(eventKey)`,
        [
          userId,
          "Litigation Funds commitment recorded",
          `Your ${instrument.instrumentType === "CASE" ? "case-share" : "bundle"} commitment of ${input.amountMinor} minor units of ${SETTLEMENT_CURRENCY} in “${instrument.instrumentName}” was recorded through the wallet ledger, ${fundingLabel}. The amount is held in escrow and released against case milestones; a favourable outcome repays principal plus the configured multiple and a loss writes the capital off.`,
          `u${userId}:litigation-funds:${positionCode}`,
          "ledger_debit",
          "normal",
        ],
      );

      const result = {
        positionCode,
        instrumentType: instrument.instrumentType,
        instrumentId: instrument.instrumentId,
        instrumentName: instrument.instrumentName,
        amountMinor: input.amountMinor,
        currency: SETTLEMENT_CURRENCY,
        fundingSource,
        units,
        fundingPlan: JSON.parse(fundingPlanJson),
        status: "ACTIVE",
        openedAt: now.toISOString(),
        ledgerReference: reference,
      };
      await conn.execute(
        `INSERT INTO v5_idempotency_keys (userId,keyValue,command,resultJson) VALUES (?,?,?,?)`,
        [userId, key, "litigation-funds.purchase", JSON.stringify(result)],
      );
      await conn.commit();
      return result;
    } catch (error) {
      await conn.rollback();
      throw error;
    }
  });
}

/**
 * Record a case's final outcome and pay or write off every funder. For a SETTLE
 * or WIN the money is the administrator-configured funder multiple applied to
 * each position's principal, credited to the settlement wallet with a
 * compensating ledger entry; for LOSE the capital is simply written off (no
 * credit is fabricated). Idempotent: a dossier or position that already carries
 * an outcome is never paid twice, and historical entries are never edited.
 */
export async function recordLitigationOutcome(adminUserId: number, dossierId: string, outcome: LitigationOutcome) {
  const dossier = await findAdminLitigationDossier(dossierId);
  if (!dossier) throw new Error("This dossier no longer exists on the desk");
  if (dossier.outcome) throw new Error(`This case already has a recorded outcome (${dossier.outcome}). Historical outcomes are never changed.`);
  if (!dossier.scenarios.length) throw new Error("This case has no modelled outcome scenarios, so it cannot be settled");
  const scenario = dossier.scenarios.find((item) => item.outcome === outcome);
  if (!scenario) throw new Error("The recorded outcome does not match any modelled scenario");

  await ensureLitigationFundsSchema();
  return withConnection(async (conn) => {
    await conn.beginTransaction();
    try {
      const [positions] = await conn.query<any[]>(
        `SELECT id, userId, positionCode, amountMinor FROM ${LITIGATION_POSITIONS_TABLE}
         WHERE instrumentType='CASE' AND instrumentId=? AND outcome IS NULL FOR UPDATE`,
        [dossierId],
      );
      let paidMinor = 0;
      let writtenOffMinor = 0;
      for (const position of positions) {
        const principal = Number(position.amountMinor || 0);
        const ownerId = Number(position.userId);
        const payout = outcome === "LOSE" ? 0 : Math.round((principal * scenario.funderMultipleBps) / 10_000);

        // The principal was locked at purchase; release that lock now.
        await conn.execute(
          `INSERT INTO customer_balances (userId,currency,availableMinor,lockedMinor,promotionalMinor,earnedMinor) VALUES (?,?,0,0,0,0) ON DUPLICATE KEY UPDATE userId=userId`,
          [ownerId, SETTLEMENT_CURRENCY],
        );
        await conn.execute(
          `UPDATE customer_balances SET availableMinor=availableMinor+?, lockedMinor=GREATEST(0, lockedMinor-?), updatedAt=NOW() WHERE userId=? AND currency=?`,
          [payout, principal, ownerId, SETTLEMENT_CURRENCY],
        );
        if (payout > 0) {
          await conn.execute(
            `INSERT INTO balance_ledger (userId,currency,amountMinor,entryType,reference,withdrawable) VALUES (?,?,?,?,?,true)`,
            [ownerId, SETTLEMENT_CURRENCY, payout, "litigation_funds_payout", `litigation-funds-payout:${position.positionCode}`],
          );
        }
        await conn.execute(
          `UPDATE ${LITIGATION_POSITIONS_TABLE} SET outcome=?, realisedMinor=?, settledAt=NOW(), positionStatus=? WHERE id=?`,
          [outcome, payout, payout > 0 ? "SETTLED" : "WRITTEN_OFF", position.id],
        );
        await conn.execute(
          `INSERT INTO customer_notifications (userId,title,body,eventKey,category,priority) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE eventKey=VALUES(eventKey)`,
          [
            ownerId,
            payout > 0 ? "Litigation Funds payout credited" : "Litigation Funds capital written off",
            payout > 0
              ? `Case “${dossier.caseName}” resolved as a ${outcome.toLowerCase()}. ${payout} minor units of ${SETTLEMENT_CURRENCY} were credited to your wallet, repaying principal plus the configured funder multiple.`
              : `Case “${dossier.caseName}” resolved as a loss. The ${principal} minor units of ${SETTLEMENT_CURRENCY} principal were written off; no credit was made.`,
            `u${ownerId}:litigation-funds-outcome:${position.positionCode}`,
            payout > 0 ? "ledger_credit" : "ledger_debit",
            "normal",
          ],
        );
        if (payout > 0) paidMinor += payout;
        else if (outcome === "LOSE") writtenOffMinor += principal;
      }
      await applyDossierOutcome(conn, dossierId, outcome);
      await conn.execute(`UPDATE ${LITIGATION_DOSSIERS_TABLE} SET dossierStatus='RESOLVED', updatedAt=NOW(3) WHERE dossierId=?`, [dossierId]);
      await conn.execute(
        `INSERT INTO v5_audit_events (actorUserId,action,entityType,entityId,reference,metadataJson) VALUES (?,?,?,?,?,?)`,
        [
          adminUserId, "litigation_outcome_recorded", "litigation_fund_dossier", dossierId,
          `litigation_fund_dossier:${dossierId}`,
          JSON.stringify({ dossierId, outcome, positions: positions.length, paidMinor, writtenOffMinor, funderMultipleBps: scenario.funderMultipleBps }),
        ],
      );
      await conn.commit();
      return { dossierId, outcome, positions: positions.length, paidMinor, writtenOffMinor, funderMultipleBps: scenario.funderMultipleBps };
    } catch (error) {
      await conn.rollback();
      throw error;
    }
  });
}
