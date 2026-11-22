import crypto from "node:crypto";
import mysql from "mysql2/promise";
import { mysqlConnectionOptions } from "./_core/mysql";
import {
  compareCarbonOpportunities,
  findCarbonOpportunity,
  getCarbonInvestmentCatalogue,
  type CarbonCreditType,
  type CarbonOpportunity,
  type CarbonOutcome,
  type CarbonSector,
  type CarbonStandard,
} from "@shared/carbon-credit-catalogue";
import {
  applyCarbonDossierOutcome,
  findAdminCarbonDossier,
  findEnabledAdminCarbonDossier,
  listEnabledAdminCarbonDossiers,
  CARBON_DOSSIERS_TABLE,
} from "./carbonCreditDossiers";
import {
  FxRateUnavailableError,
  planCrossWalletFunding,
  calculateCombinedAvailableTargetMinor,
  type FxRateSnapshot,
} from "./modules/trading-wallet-fx";
import { getFreshTradingFxRate, getWalletFundingPriorityForFunding } from "./db";

type Db = mysql.PoolConnection;

/**
 * Additive, self-hosted storage for Carbon Credit positions (kept outside
 * Drizzle, matching the litigation / IP royalty / agro template).
 *
 * A position is a customer's money placed into ONE carbon-credit opportunity.
 * Purchases settle in USD and may be funded from the settlement wallet, any
 * single funded wallet, or every funded wallet combined through live FX — the
 * same cross-wallet engine as the rest of the platform. The wallet is debited
 * and the amount locked before the position is written; all in a single
 * transaction.
 */
export const CARBON_POSITIONS_TABLE = "carbon_credit_positions";

const CREATE_POSITIONS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS carbon_credit_positions (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  positionCode VARCHAR(40) NOT NULL,
  userId INT NOT NULL,
  instrumentId VARCHAR(80) NOT NULL,
  instrumentName VARCHAR(200) NOT NULL,
  creditType VARCHAR(32) NULL,
  sector VARCHAR(16) NULL,
  standard VARCHAR(24) NULL,
  amountMinor BIGINT NOT NULL,
  currency VARCHAR(12) NOT NULL DEFAULT 'USD',
  fundingSource VARCHAR(24) NULL,
  fundingPlanJson TEXT NULL,
  units INT NULL,
  statusAtPurchase VARCHAR(24) NULL,
  expectedMultipleBps INT NULL,
  distributedMinor BIGINT NOT NULL DEFAULT 0,
  outcome VARCHAR(16) NULL,
  realisedMinor BIGINT NULL,
  settledAt DATETIME NULL,
  dataSource VARCHAR(160) NULL,
  dataAsOf VARCHAR(24) NULL,
  positionStatus VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
  openedAt DATETIME NOT NULL,
  ledgerReference VARCHAR(160) NOT NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY carbon_credit_positions_code_idx (positionCode),
  KEY carbon_credit_positions_user_idx (userId, positionStatus),
  KEY carbon_credit_positions_instrument_idx (instrumentId, outcome)
) ENGINE=InnoDB`;

/** Every Carbon Credit purchase settles into this currency; other wallets fund it through live FX. */
const SETTLEMENT_CURRENCY = "USD";
export const CARBON_COMBINED_SOURCE = "COMBINED";
const MAX_PURCHASE_MINOR = 100_000_000; // $1,000,000 ceiling per purchase

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
export function ensureCarbonCreditSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    try {
      if (!process.env.DATABASE_URL) return;
      await withConnection(async (conn) => { await conn.query(CREATE_POSITIONS_TABLE_SQL); });
    } catch (error) {
      schemaReady = null;
      console.error("[CarbonCredits] Failed to ensure schema:", error instanceof Error ? error.message : "UnknownError");
    }
  })();
  return schemaReady;
}

function idempotencyKey(input: string | undefined, userId: number) {
  const value = String(input || "").trim();
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(value)) throw new Error("A valid idempotency key is required");
  return `carbon-credits:${userId}:${crypto.createHash("sha256").update(value).digest("hex")}`;
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
  if (requiredUsdMinor > MAX_PURCHASE_MINOR) throw new Error("This amount exceeds the per-purchase ceiling for the Carbon Credit desk");

  const usd = wallets.find((wallet) => wallet.currency === SETTLEMENT_CURRENCY);
  const usdScale = usd ? usd.scale : 2;
  const usdAvailableMinor = usd ? usd.availableMinor : 0;
  const targetRate = usdUnitRate(usdScale);
  const source = String(fundingSource || CARBON_COMBINED_SOURCE).trim().toUpperCase();
  const insufficient = new Error("Insufficient combined spendable wallet balance at current exchange rates");

  if (source === SETTLEMENT_CURRENCY) {
    if (requiredUsdMinor <= usdAvailableMinor) return { requiredUsdMinor, usdAvailableMinor, convertedUsdMinor: 0, debits: [], targetRate };
    throw insufficient;
  }

  const fundedNonSettlement = wallets.filter((wallet) => wallet.currency !== SETTLEMENT_CURRENCY && wallet.availableMinor > 0);
  const candidates = source === CARBON_COMBINED_SOURCE
    ? fundedNonSettlement
    : fundedNonSettlement.filter((wallet) => wallet.currency === source);

  if (source === CARBON_COMBINED_SOURCE && requiredUsdMinor <= usdAvailableMinor && !candidates.length) {
    return { requiredUsdMinor, usdAvailableMinor, convertedUsdMinor: 0, debits: [], targetRate };
  }
  const targetAvailableMinor = source === CARBON_COMBINED_SOURCE ? usdAvailableMinor : 0;
  if (requiredUsdMinor <= targetAvailableMinor) return { requiredUsdMinor, usdAvailableMinor, convertedUsdMinor: 0, debits: [], targetRate };
  if (!candidates.length) throw insufficient;

  const plan = planCrossWalletFunding({
    requiredTargetMinor: requiredUsdMinor,
    targetAvailableMinor,
    targetRate,
    sourceWallets: candidates.map((wallet) => ({
      currency: wallet.currency, scale: wallet.scale, availableMinor: wallet.availableMinor, rate: rates.get(wallet.currency) ?? null,
    })),
    priorityCurrencies: source === CARBON_COMBINED_SOURCE ? priorityOrder : null,
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
async function readCarbonStore(userId: number): Promise<{ positions: any[]; balances: any[]; warning: string | null }> {
  try {
    await ensureCarbonCreditSchema();
    return await withConnection(async (conn) => {
      const [positions] = await conn.query<any[]>(
        `SELECT id, positionCode, instrumentId, instrumentName, creditType, sector, standard, amountMinor, currency, fundingSource,
                units, statusAtPurchase, expectedMultipleBps, distributedMinor, outcome, realisedMinor, settledAt,
                dataSource, dataAsOf, positionStatus, openedAt, ledgerReference
         FROM ${CARBON_POSITIONS_TABLE} WHERE userId=? ORDER BY openedAt DESC`,
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
    console.error("[CarbonCredits] Failed to read position store:", error instanceof Error ? error.message : "UnknownError");
    return {
      positions: [],
      balances: [],
      warning: "Your saved positions and wallet balances could not be loaded right now. The live catalogue below is unaffected.",
    };
  }
}

async function readAdminOpportunities(): Promise<CarbonOpportunity[]> {
  try { return await listEnabledAdminCarbonDossiers(); }
  catch (error) {
    console.error("[CarbonCredits] Failed to read administrator dossiers:", error instanceof Error ? error.message : "UnknownError");
    return [];
  }
}

/**
 * Assemble the Carbon Credit desk for one customer: administrator dossiers
 * merged with the live public discovery catalogue, that customer's positions,
 * wallet balances and a derived summary. Catalogue and storage reads run
 * independently so a failure in one still returns the rest.
 */
export async function getCarbonInvestmentDashboard(userId: number) {
  const [catalogue, store, adminOpportunities] = await Promise.all([
    getCarbonInvestmentCatalogue(),
    readCarbonStore(userId),
    readAdminOpportunities(),
  ]);

  const opportunities = [...adminOpportunities, ...catalogue.opportunities].sort(compareCarbonOpportunities);
  const sources = adminOpportunities.length
    ? catalogue.sources.map((source) => (source.role === "opportunities"
        ? { ...source, detail: `${adminOpportunities.length} administrator-published opportunity${adminOpportunities.length === 1 ? "" : "ies"} live on the desk with sourced economics.` }
        : source))
    : catalogue.sources;

  const positions = store.positions;
  const balances = store.balances;
  const active = positions.filter((p) => p.positionStatus === "ACTIVE");
  const committedMinor = active.reduce((sum, p) => sum + Number(p.amountMinor || 0), 0);
  const realisedMinor = positions.reduce((sum, p) => sum + Number(p.realisedMinor || 0), 0);
  const distributedMinor = positions.reduce((sum, p) => sum + Number(p.distributedMinor || 0), 0);
  const summary = {
    committedMinor,
    activePositions: active.length,
    settledPositions: positions.filter((p) => p.positionStatus === "SETTLED").length,
    writtenOffPositions: positions.filter((p) => p.positionStatus === "WRITTEN_OFF").length,
    fundableOpportunities: opportunities.filter((item) => item.fundable).length,
    natureBased: opportunities.filter((item) => item.creditType === "REFORESTATION" || item.creditType === "FOREST_CONSERVATION" || item.creditType === "SOIL_CARBON" || item.creditType === "BLUE_CARBON").length,
    published: adminOpportunities.length,
    realisedMinor,
    distributedMinor,
  };
  const usd = balances.find((b) => b.currency === SETTLEMENT_CURRENCY);
  return {
    opportunities,
    positions,
    balances,
    wallets: balances,
    settlementCurrency: SETTLEMENT_CURRENCY,
    combinedSource: CARBON_COMBINED_SOURCE,
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
export async function quoteCarbonPurchase(
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
    const plan = planPurchaseFunding(wallets, rates, amountMinor, String(input.fundingSource || CARBON_COMBINED_SOURCE), order);
    return {
      amountMinor,
      fundingSource: String(input.fundingSource || CARBON_COMBINED_SOURCE).toUpperCase(),
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
      fundingSource: String(input.fundingSource || CARBON_COMBINED_SOURCE).toUpperCase(),
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
  instrumentId: string;
  instrumentName: string;
  creditType: CarbonCreditType | null;
  sector: CarbonSector | null;
  standard: CarbonStandard | null;
  status: string | null;
  expectedMultipleBps: number | null;
  unitPriceMinor: number | null;
  source: string;
  asOf: string;
};

/**
 * Resolve the instrument a customer is funding. Every opportunity on the desk is
 * investable: an administrator-published (enabled) dossier is the primary target,
 * and a cited discovery catalogue reference resolves on its own record so a
 * customer can fund it too. A reference carries no administrator-published
 * economics, so its funding target, progress and top-up multiple stay unset until
 * an administrator publishes them; the position still settles on the
 * administrator-configured multiple.
 */
async function resolveCarbonInstrument(instrumentId: string): Promise<ResolvedInstrument> {
  const dossier = await findEnabledAdminCarbonDossier(instrumentId);
  if (dossier) {
    return {
      instrumentId: dossier.id, instrumentName: dossier.title, creditType: dossier.creditType, sector: dossier.sector,
      standard: dossier.standard, status: dossier.status, expectedMultipleBps: dossier.expectedMultipleBps, unitPriceMinor: dossier.unitPriceMinor,
      source: dossier.source, asOf: dossier.asOf,
    };
  }
  const discovery = await findCarbonOpportunity(instrumentId);
  if (discovery) {
    return {
      instrumentId: discovery.id, instrumentName: discovery.title, creditType: discovery.creditType, sector: discovery.sector,
      standard: discovery.standard, status: discovery.status, expectedMultipleBps: discovery.expectedMultipleBps, unitPriceMinor: discovery.unitPriceMinor,
      source: discovery.source, asOf: discovery.asOf,
    };
  }
  throw new Error("This opportunity is not currently open on the Carbon Credit desk. Refresh and try again.");
}

/**
 * Fund one carbon-credit opportunity with the customer's own money. Settles in
 * USD and may be funded from the settlement wallet, a single chosen wallet, or
 * every wallet combined through live FX. The wallet ledger is debited per source
 * wallet, the amount is locked, and one durable position plus a notice is written
 * in a single transaction. Idempotent per request key; the instrument's published
 * data is re-read server-side so a client cannot dictate its merits or source.
 */
export async function purchaseCarbonOpportunity(
  userId: number,
  input: { instrumentId: string; amountMinor: number; fundingSource?: string; idempotencyKey: string },
) {
  await ensureCarbonCreditSchema();
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new Error("Enter a valid investment amount");
  if (input.amountMinor > MAX_PURCHASE_MINOR) throw new Error("This amount exceeds the per-purchase ceiling for the Carbon Credit desk");

  const instrument = await resolveCarbonInstrument(String(input.instrumentId || ""));
  const fundingSource = String(input.fundingSource || CARBON_COMBINED_SOURCE).trim().toUpperCase();
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
      const positionCode = `CC-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
      const reference = `carbon-credit-purchase:${positionCode}`;

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
          [userId, debit.currency, -debit.amountMinor, "carbon_credit_fx_debit", `${reference}-fx-${debit.currency}-debit`],
        );
        await conn.execute(
          `INSERT INTO balance_ledger (userId,currency,amountMinor,entryType,reference,withdrawable) VALUES (?,?,?,?,?,false)`,
          [userId, SETTLEMENT_CURRENCY, debit.convertedUsdMinor, "carbon_credit_fx_credit", `${reference}-fx-${debit.currency}-credit`],
        );
        await conn.execute(
          `INSERT INTO fx_rate_snapshots (baseAsset,quoteAsset,rate,provider,sourceDate,rawJson) VALUES (?,?,?,?,?,?)`,
          [
            debit.currency, SETTLEMENT_CURRENCY, debit.rate.rateUsdPerUnit, debit.rate.provider, debit.rate.sourceDate,
            JSON.stringify({
              purpose: "carbon_credit_cross_wallet_conversion",
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
        [userId, SETTLEMENT_CURRENCY, -input.amountMinor, "carbon_credit_purchase", reference],
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
        `INSERT INTO ${CARBON_POSITIONS_TABLE}
          (positionCode,userId,instrumentId,instrumentName,creditType,sector,standard,amountMinor,currency,fundingSource,fundingPlanJson,units,statusAtPurchase,expectedMultipleBps,dataSource,dataAsOf,positionStatus,openedAt,ledgerReference)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'ACTIVE', NOW(), ?)`,
        [
          positionCode, userId, instrument.instrumentId, instrument.instrumentName, instrument.creditType, instrument.sector, instrument.standard,
          input.amountMinor, SETTLEMENT_CURRENCY, fundingSource, fundingPlanJson, units, instrument.status,
          instrument.expectedMultipleBps, instrument.source, instrument.asOf, reference,
        ],
      );

      // Record the customer's contribution against the instrument's live progress.
      await conn.execute(`UPDATE ${CARBON_DOSSIERS_TABLE} SET committedMinor=committedMinor+?, updatedAt=NOW(3) WHERE dossierId=?`, [input.amountMinor, instrument.instrumentId]);

      const fundingLabel = plan.debits.length
        ? `funded from ${plan.debits.map((debit) => debit.currency).join(", ")} alongside ${SETTLEMENT_CURRENCY}`
        : `funded from your ${SETTLEMENT_CURRENCY} balance`;
      await conn.execute(
        `INSERT INTO customer_notifications (userId,title,body,eventKey,category,priority) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE eventKey=VALUES(eventKey)`,
        [
          userId,
          "Carbon Credit commitment recorded",
          `Your commitment of ${input.amountMinor} minor units of ${SETTLEMENT_CURRENCY} to “${instrument.instrumentName}” was recorded through the wallet ledger, ${fundingLabel}. The amount is held against the opportunity and released against its published milestones; the return depends on the realised issuance revenue and the configured funder multiple.`,
          `u${userId}:carbon-credits:${positionCode}`,
          "ledger_debit",
          "normal",
        ],
      );

      const result = {
        positionCode,
        instrumentId: instrument.instrumentId,
        instrumentName: instrument.instrumentName,
        creditType: instrument.creditType,
        amountMinor: input.amountMinor,
        currency: SETTLEMENT_CURRENCY,
        fundingSource,
        units,
        fundingPlan: JSON.parse(fundingPlanJson),
        status: "ACTIVE" as const,
        openedAt: now.toISOString(),
        ledgerReference: reference,
      };
      await conn.execute(
        `INSERT INTO v5_idempotency_keys (userId,keyValue,command,resultJson) VALUES (?,?,?,?)`,
        [userId, key, "carbon-credits.purchase", JSON.stringify(result)],
      );
      await conn.commit();
      return result;
    } catch (error) {
      await conn.rollback();
      throw error;
    }
  });
}

/** One opportunity that still carries open customer commitments, for the settlement console. */
export type CarbonOpenInstrument = {
  instrumentId: string;
  instrumentName: string;
  creditType: string | null;
  standard: string | null;
  openPositions: number;
  committedMinor: number;
  currency: string;
};

/** Distinct instruments that still hold open (unresolved) customer positions. */
export async function listCarbonOpenInstruments(): Promise<CarbonOpenInstrument[]> {
  await ensureCarbonCreditSchema();
  return withConnection(async (conn) => {
    const [rows] = await conn.query<any[]>(
      `SELECT instrumentId, MAX(instrumentName) instrumentName, MAX(creditType) creditType, MAX(standard) standard,
              COUNT(*) openPositions, SUM(amountMinor) committedMinor, MAX(currency) currency
       FROM ${CARBON_POSITIONS_TABLE}
       WHERE outcome IS NULL
       GROUP BY instrumentId
       ORDER BY committedMinor DESC, instrumentId`,
    );
    return rows.map((row) => ({
      instrumentId: String(row.instrumentId),
      instrumentName: String(row.instrumentName || row.instrumentId),
      creditType: row.creditType ? String(row.creditType) : null,
      standard: row.standard ? String(row.standard) : null,
      openPositions: Number(row.openPositions || 0),
      committedMinor: Number(row.committedMinor || 0),
      currency: String(row.currency || SETTLEMENT_CURRENCY),
    }));
  });
}

/**
 * Credit a revenue distribution to every open position in an instrument, pro-rata
 * by principal. The amount is credited to the settlement wallet with a
 * compensating ledger entry; the principal stays locked. Idempotent per request
 * key. Historical entries are never edited.
 */
export async function recordCarbonDistribution(
  adminUserId: number,
  input: { instrumentId: string; amountMinor: number; note?: string; idempotencyKey: string },
) {
  const instrumentId = String(input.instrumentId || "").trim();
  if (!instrumentId) throw new Error("Select an instrument to distribute revenue to");
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new Error("Enter a valid distribution amount");
  const key = `carbon-credits:distribution:${adminUserId}:${crypto.createHash("sha256").update(String(input.idempotencyKey || "")).digest("hex")}`;

  await ensureCarbonCreditSchema();
  return withConnection(async (conn) => {
    await conn.beginTransaction();
    try {
      const [prior] = await conn.query<any[]>(`SELECT resultJson FROM v5_idempotency_keys WHERE userId=? AND keyValue=? LIMIT 1 FOR UPDATE`, [adminUserId, key]);
      if (prior.length) { await conn.commit(); return JSON.parse(prior[0].resultJson); }

      const [positions] = await conn.query<any[]>(
        `SELECT id, userId, positionCode, amountMinor, instrumentName FROM ${CARBON_POSITIONS_TABLE} WHERE instrumentId=? AND outcome IS NULL FOR UPDATE`,
        [instrumentId],
      );
      if (!positions.length) throw new Error("No open positions remain on this opportunity.");
      const totalPrincipal = positions.reduce((sum, position) => sum + Number(position.amountMinor || 0), 0);
      if (totalPrincipal <= 0) throw new Error("This opportunity has no principal to distribute against");

      const instrumentName = String(positions[0].instrumentName || instrumentId);
      let creditedMinor = 0;
      let remainder = input.amountMinor;
      for (let index = 0; index < positions.length; index += 1) {
        const position = positions[index];
        const principal = Number(position.amountMinor || 0);
        const ownerId = Number(position.userId);
        const share = index === positions.length - 1
          ? remainder
          : Math.round((input.amountMinor * principal) / totalPrincipal);
        remainder -= share;
        if (share <= 0) continue;

        await conn.execute(
          `INSERT INTO customer_balances (userId,currency,availableMinor,lockedMinor,promotionalMinor,earnedMinor) VALUES (?,?,0,0,0,0) ON DUPLICATE KEY UPDATE userId=userId`,
          [ownerId, SETTLEMENT_CURRENCY],
        );
        await conn.execute(
          `UPDATE customer_balances SET availableMinor=availableMinor+?, earnedMinor=earnedMinor+?, updatedAt=NOW() WHERE userId=? AND currency=?`,
          [share, share, ownerId, SETTLEMENT_CURRENCY],
        );
        await conn.execute(
          `INSERT INTO balance_ledger (userId,currency,amountMinor,entryType,reference,withdrawable) VALUES (?,?,?,?,?,true)`,
          [ownerId, SETTLEMENT_CURRENCY, share, "carbon_credit_distribution", `carbon-credit-distribution:${position.positionCode}:${Date.now()}`],
        );
        await conn.execute(
          `UPDATE ${CARBON_POSITIONS_TABLE} SET distributedMinor=distributedMinor+? WHERE id=?`,
          [share, position.id],
        );
        await conn.execute(
          `INSERT INTO customer_notifications (userId,title,body,eventKey,category,priority) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE eventKey=VALUES(eventKey)`,
          [
            ownerId,
            "Carbon Credit revenue distribution credited",
            `A revenue distribution of ${share} minor units of ${SETTLEMENT_CURRENCY} from “${instrumentName}” was credited to your wallet. Your principal remains held against the opportunity.`,
            `u${ownerId}:carbon-credit-distribution:${position.positionCode}:${Date.now()}`,
            "ledger_credit",
            "normal",
          ],
        );
        creditedMinor += share;
      }

      const result = { instrumentId, instrumentName, amountMinor: input.amountMinor, creditedMinor, positions: positions.length };
      await conn.execute(
        `INSERT INTO v5_audit_events (actorUserId,action,entityType,entityId,reference,metadataJson) VALUES (?,?,?,?,?,?)`,
        [adminUserId, "carbon_distribution_recorded", "carbon_credit_instrument", instrumentId, `carbon_credit_instrument:${instrumentId}`, JSON.stringify({ ...result, note: input.note ? String(input.note).slice(0, 400) : null })],
      );
      await conn.execute(`INSERT INTO v5_idempotency_keys (userId,keyValue,command,resultJson) VALUES (?,?,?,?)`, [adminUserId, key, "carbon-credits.distribution", JSON.stringify(result)]);
      await conn.commit();
      return result;
    } catch (error) {
      await conn.rollback();
      throw error;
    }
  });
}

/**
 * Settle a carbon instrument by an administrator-chosen funder multiple. For
 * HIGH_ISSUANCE and ON_PLAN each open position is paid principal ×
 * funderMultipleBps into the settlement wallet with a compensating ledger entry;
 * for WRITE_OFF the capital is written off (no credit is fabricated). Positions
 * that already carry an outcome are never paid twice, and historical entries are
 * never edited. Idempotent against a double submit: an instrument with no
 * remaining open positions is rejected rather than paid again.
 */
export async function settleCarbonInstrument(
  adminUserId: number,
  input: { instrumentId: string; outcome: CarbonOutcome; funderMultipleBps: number; reason?: string },
) {
  const instrumentId = String(input.instrumentId || "").trim();
  if (!instrumentId) throw new Error("Select an opportunity to settle");
  if (input.outcome !== "HIGH_ISSUANCE" && input.outcome !== "ON_PLAN" && input.outcome !== "WRITE_OFF") throw new Error("Select a valid outcome");
  const requestedBps = Math.round(Number(input.funderMultipleBps) || 0);
  if (requestedBps < 0 || requestedBps > 1_000_000) throw new Error("The funder multiple must be between 0.00x and 100.00x");
  const funderMultipleBps = input.outcome === "WRITE_OFF" ? 0 : requestedBps;

  await ensureCarbonCreditSchema();
  return withConnection(async (conn) => {
    await conn.beginTransaction();
    try {
      const [positions] = await conn.query<any[]>(
        `SELECT id, userId, positionCode, amountMinor, instrumentName FROM ${CARBON_POSITIONS_TABLE}
         WHERE instrumentId=? AND outcome IS NULL FOR UPDATE`,
        [instrumentId],
      );
      if (!positions.length) throw new Error("No open positions remain on this opportunity — it may already have been settled.");
      const instrumentName = String(positions[0].instrumentName || instrumentId);
      let paidMinor = 0;
      let writtenOffMinor = 0;
      for (const position of positions) {
        const principal = Number(position.amountMinor || 0);
        const ownerId = Number(position.userId);
        const payout = funderMultipleBps === 0 ? 0 : Math.round((principal * funderMultipleBps) / 10_000);

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
            [ownerId, SETTLEMENT_CURRENCY, payout, "carbon_credit_payout", `carbon-credit-payout:${position.positionCode}`],
          );
        }
        await conn.execute(
          `UPDATE ${CARBON_POSITIONS_TABLE} SET outcome=?, realisedMinor=?, settledAt=NOW(), positionStatus=? WHERE id=?`,
          [input.outcome, payout, payout > 0 ? "SETTLED" : "WRITTEN_OFF", position.id],
        );
        await conn.execute(
          `INSERT INTO customer_notifications (userId,title,body,eventKey,category,priority) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE eventKey=VALUES(eventKey)`,
          [
            ownerId,
            payout > 0 ? "Carbon Credit payout credited" : "Carbon Credit capital written off",
            payout > 0
              ? `“${instrumentName}” resolved as ${input.outcome === "HIGH_ISSUANCE" ? "high issuance" : "on plan"}. ${payout} minor units of ${SETTLEMENT_CURRENCY} were credited to your wallet, repaying principal plus the configured funder multiple.`
              : `“${instrumentName}” was written off. The ${principal} minor units of ${SETTLEMENT_CURRENCY} principal were written off; no credit was made.`,
            `u${ownerId}:carbon-credits-outcome:${position.positionCode}`,
            payout > 0 ? "ledger_credit" : "ledger_debit",
            "normal",
          ],
        );
        if (payout > 0) paidMinor += payout;
        else if (input.outcome === "WRITE_OFF") writtenOffMinor += principal;
      }

      // If an administrator dossier exists for this instrument, close it too so it
      // stops advertising funding.
      const dossier = await findAdminCarbonDossier(instrumentId);
      if (dossier) {
        await applyCarbonDossierOutcome(conn, instrumentId, input.outcome);
        await conn.execute(`UPDATE ${CARBON_DOSSIERS_TABLE} SET dossierStatus=?, updatedAt=NOW(3) WHERE dossierId=?`, ["COMPLETED", instrumentId]);
      }

      await conn.execute(
        `INSERT INTO v5_audit_events (actorUserId,action,entityType,entityId,reference,metadataJson) VALUES (?,?,?,?,?,?)`,
        [
          adminUserId, "carbon_instrument_settled", "carbon_credit_instrument", instrumentId,
          `carbon_credit_instrument:${instrumentId}`,
          JSON.stringify({ instrumentId, outcome: input.outcome, funderMultipleBps, positions: positions.length, paidMinor, writtenOffMinor, hadDossier: Boolean(dossier), reason: input.reason ? String(input.reason).slice(0, 400) : null }),
        ],
      );
      await conn.commit();
      return { instrumentId, instrumentName, outcome: input.outcome, funderMultipleBps, positions: positions.length, paidMinor, writtenOffMinor, hadDossier: Boolean(dossier) };
    } catch (error) {
      await conn.rollback();
      throw error;
    }
  });
}
