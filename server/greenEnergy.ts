import crypto from "node:crypto";
import mysql from "mysql2/promise";
import { getSharedMysqlPool } from "./_core/mysql";
import {
  compareGreenEnergyOpportunities,
  findGreenEnergyOpportunity,
  getGreenEnergyInvestmentCatalogue,
  type GreenEnergyType,
  type GreenEnergyOpportunity,
  type GreenEnergyOutcome,
  type GreenEnergySector,
  type GreenEnergyStandard,
} from "@shared/green-energy-catalogue";
import type { DeskEconomics } from "@shared/investment-economics";
import { getDeskEconomicsMap, getOrAssignDeskEconomics } from "./deskEconomics";
import {
  applyGreenEnergyDossierOutcome,
  findAdminGreenEnergyDossier,
  findEnabledAdminGreenEnergyDossier,
  listEnabledAdminGreenEnergyDossiers,
  GREEN_ENERGY_DOSSIERS_TABLE,
} from "./greenEnergyDossiers";
import {
  FxRateUnavailableError,
  planCrossWalletFunding,
  calculateCombinedAvailableTargetMinor,
  type FxRateSnapshot,
} from "./modules/trading-wallet-fx";
import { getFreshTradingFxRate, getWalletFundingPriorityForFunding, listBalances, listCurrencies } from "./db";

type Db = mysql.PoolConnection;

/** One opportunity's stored (or freshly assigned) Green Energy economics, tolerating a storage hiccup. */
async function getOrAssignGreenEnergyEconomics(instrumentId: string): Promise<DeskEconomics | null> {
  try {
    return await getOrAssignDeskEconomics("greenEnergy", instrumentId);
  } catch (error) {
    console.error("[GreenEnergy] Failed to read desk economics:", error instanceof Error ? error.message : "UnknownError");
    return null;
  }
}

/**
 * Additive, self-hosted storage for Green Energy positions (kept outside
 * Drizzle, matching the litigation / IP royalty / agro template).
 *
 * A position is a customer's money placed into ONE green energy opportunity.
 * Purchases settle in USD and may be funded from the settlement wallet, any
 * single funded wallet, or every funded wallet combined through live FX — the
 * same cross-wallet engine as the rest of the platform. The wallet is debited
 * and the amount locked before the position is written; all in a single
 * transaction.
 */
export const GREEN_ENERGY_POSITIONS_TABLE = "green_energy_positions";

const CREATE_POSITIONS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS green_energy_positions (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  positionCode VARCHAR(40) NOT NULL,
  userId INT NOT NULL,
  instrumentId VARCHAR(80) NOT NULL,
  instrumentName VARCHAR(200) NOT NULL,
  energyType VARCHAR(32) NULL,
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
  UNIQUE KEY green_energy_positions_code_idx (positionCode),
  KEY green_energy_positions_user_idx (userId, positionStatus),
  KEY green_energy_positions_instrument_idx (instrumentId, outcome)
) ENGINE=InnoDB`;

/** Every Green Energy purchase settles into this currency; other wallets fund it through live FX. */
const SETTLEMENT_CURRENCY = "USD";
export const GREEN_ENERGY_COMBINED_SOURCE = "COMBINED";
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
  const conn = await getSharedMysqlPool().getConnection();
  try { return await fn(conn); } finally { conn.release(); }
}

let schemaReady: Promise<void> | null = null;

/** Idempotently ensure the additive positions table exists (memoized). */
export function ensureGreenEnergySchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    try {
      if (!process.env.DATABASE_URL) return;
      await withConnection(async (conn) => { await conn.query(CREATE_POSITIONS_TABLE_SQL); });
    } catch (error) {
      schemaReady = null;
      console.error("[GreenEnergy] Failed to ensure schema:", error instanceof Error ? error.message : "UnknownError");
    }
  })();
  return schemaReady;
}

function idempotencyKey(input: string | undefined, userId: number) {
  const value = String(input || "").trim();
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(value)) throw new Error("A valid idempotency key is required");
  return `green-energy:${userId}:${crypto.createHash("sha256").update(value).digest("hex")}`;
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

/**
 * Lock or read every enabled, spendable wallet for a customer.
 *
 * The balances and the currency metadata are read separately and merged in
 * code rather than with a SQL JOIN. `customer_balances` inherits the database
 * default collation while `currency_registry` is pinned to utf8mb4_unicode_ci,
 * so joining them on `currency=code` fails with "Illegal mix of collations" on
 * databases whose default differs — the platform's own wallet reader reads them
 * separately for the same reason.
 */
async function readWalletRows(conn: Db, userId: number, forUpdate = false): Promise<WalletRow[]> {
  const [currencyRows] = await conn.query<any[]>(
    `SELECT code, scale, assetType, externalCode, symbol, name currencyName
     FROM currency_registry WHERE enabled=true ORDER BY id`,
  );
  const [balanceRows] = await conn.query<any[]>(
    `SELECT id, currency, COALESCE(availableMinor,0) availableMinor, COALESCE(lockedMinor,0) lockedMinor
     FROM customer_balances WHERE userId=? ORDER BY currency${forUpdate ? " FOR UPDATE" : ""}`,
    [userId],
  );
  const currencyByCode = new Map<string, any>();
  for (const row of currencyRows) currencyByCode.set(String(row.code).toUpperCase(), row);
  return balanceRows
    .map((row) => {
      const code = String(row.currency).toUpperCase();
      const currency = currencyByCode.get(code);
      if (!currency) return null; // balance for a currency no longer enabled
      return {
        id: Number(row.id),
        currency: code,
        scale: Number(currency.scale || 0),
        assetType: currency.assetType,
        externalCode: currency.externalCode ? String(currency.externalCode) : null,
        symbol: currency.symbol ? String(currency.symbol) : null,
        currencyName: currency.currencyName ? String(currency.currencyName) : null,
        availableMinor: Number(row.availableMinor || 0),
        lockedMinor: Number(row.lockedMinor || 0),
      } as WalletRow;
    })
    .filter((wallet): wallet is WalletRow => wallet !== null);
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
  if (requiredUsdMinor > MAX_PURCHASE_MINOR) throw new Error("This amount exceeds the per-purchase ceiling for the Green Energy desk");

  const usd = wallets.find((wallet) => wallet.currency === SETTLEMENT_CURRENCY);
  const usdScale = usd ? usd.scale : 2;
  const usdAvailableMinor = usd ? usd.availableMinor : 0;
  const targetRate = usdUnitRate(usdScale);
  const source = String(fundingSource || GREEN_ENERGY_COMBINED_SOURCE).trim().toUpperCase();
  const insufficient = new Error("Insufficient combined spendable wallet balance at current exchange rates");

  if (source === SETTLEMENT_CURRENCY) {
    if (requiredUsdMinor <= usdAvailableMinor) return { requiredUsdMinor, usdAvailableMinor, convertedUsdMinor: 0, debits: [], targetRate };
    throw insufficient;
  }

  const fundedNonSettlement = wallets.filter((wallet) => wallet.currency !== SETTLEMENT_CURRENCY && wallet.availableMinor > 0);
  const candidates = source === GREEN_ENERGY_COMBINED_SOURCE
    ? fundedNonSettlement
    : fundedNonSettlement.filter((wallet) => wallet.currency === source);

  if (source === GREEN_ENERGY_COMBINED_SOURCE && requiredUsdMinor <= usdAvailableMinor && !candidates.length) {
    return { requiredUsdMinor, usdAvailableMinor, convertedUsdMinor: 0, debits: [], targetRate };
  }
  const targetAvailableMinor = source === GREEN_ENERGY_COMBINED_SOURCE ? usdAvailableMinor : 0;
  if (requiredUsdMinor <= targetAvailableMinor) return { requiredUsdMinor, usdAvailableMinor, convertedUsdMinor: 0, debits: [], targetRate };
  if (!candidates.length) throw insufficient;

  const plan = planCrossWalletFunding({
    requiredTargetMinor: requiredUsdMinor,
    targetAvailableMinor,
    targetRate,
    sourceWallets: candidates.map((wallet) => ({
      currency: wallet.currency, scale: wallet.scale, availableMinor: wallet.availableMinor, rate: rates.get(wallet.currency) ?? null,
    })),
    priorityCurrencies: source === GREEN_ENERGY_COMBINED_SOURCE ? priorityOrder : null,
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
 * Read one customer's stored positions and the platform's existing wallet
 * balances. The two reads are deliberately independent: the customer's
 * wallets live in the platform's own `customer_balances` / `currency_registry`
 * tables, so a hiccup in the new position store must never hide them (and the
 * live public catalogue stays unaffected either way).
 */
async function readGreenEnergyStore(userId: number): Promise<{ positions: any[]; balances: any[]; warning: string | null }> {
  await ensureGreenEnergySchema();
  const failed: string[] = [];

  // The customer's existing wallets are read first, through the platform's own
  // wallet readers. They read `customer_balances` and `currency_registry`
  // separately (never a cross-collation JOIN) so the desk shows exactly the
  // same wallets as the rest of the portal, and they always load even when the
  // (separate) position store is unavailable.
  let balances: any[] = [];
  try {
    const [balanceRows, currencies] = await Promise.all([listBalances(userId), listCurrencies()]);
    const currencyByCode = new Map(currencies.map((currency) => [String(currency.code).toUpperCase(), currency]));
    balances = balanceRows.map((row) => {
      const code = String(row.currency).toUpperCase();
      const currency = currencyByCode.get(code);
      return {
        currency: code,
        symbol: currency?.symbol ?? code,
        scale: currency?.scale ?? 2,
        name: currency?.name ?? code,
        currencyName: currency?.name ?? code,
        availableMinor: Number(row.availableMinor || 0),
        lockedMinor: Number(row.lockedMinor || 0),
        promotionalMinor: Number(row.promotionalMinor || 0),
        earnedMinor: Number(row.earnedMinor || 0),
      };
    });
  } catch (error) {
    console.error("[GreenEnergy] Failed to read wallet balances:", error instanceof Error ? error.message : "UnknownError");
    failed.push("wallet balances");
  }

  // Positions are served by the desk's own additive table; a missing or
  // not-yet-migrated table degrades to "no positions", never to a blank desk.
  let positions: any[] = [];
  try {
    positions = await withConnection(async (conn) => {
      const [rows] = await conn.query<any[]>(
        `SELECT id, positionCode, instrumentId, instrumentName, energyType, sector, standard, amountMinor, currency, fundingSource,
                units, statusAtPurchase, expectedMultipleBps, distributedMinor, outcome, realisedMinor, settledAt,
                dataSource, dataAsOf, positionStatus, openedAt, ledgerReference
         FROM ${GREEN_ENERGY_POSITIONS_TABLE} WHERE userId=? ORDER BY openedAt DESC`,
        [userId],
      );
      return rows;
    });
  } catch (error) {
    console.error("[GreenEnergy] Failed to read position store:", error instanceof Error ? error.message : "UnknownError");
    failed.push("saved positions");
  }

  const warning = failed.length >= 2
    ? "Your saved positions and wallet balances could not be loaded right now. The live catalogue below is unaffected."
    : failed.length === 1
      ? `Your ${failed[0]} could not be loaded right now. The live catalogue below is unaffected.`
      : null;
  return { positions, balances, warning };
}

async function readAdminOpportunities(): Promise<GreenEnergyOpportunity[]> {
  try { return await listEnabledAdminGreenEnergyDossiers(); }
  catch (error) {
    console.error("[GreenEnergy] Failed to read administrator dossiers:", error instanceof Error ? error.message : "UnknownError");
    return [];
  }
}

/**
 * Merge an opportunity's auto-assigned economic profile into its record. The
 * opportunity's own percentage always wins ("those that already have a
 * percentage are left as they are"); everything else comes from the assigned
 * profile. The USD settlement fields (minimum ticket, funding ask, deadline) are
 * left untouched because the desk settles in USD — the assigned profile carries
 * its own presentation currency for display only.
 */
function withGreenEnergyEconomics(item: GreenEnergyOpportunity, economics: DeskEconomics | undefined): GreenEnergyOpportunity {
  if (!economics) return item;
  const profitBps = item.expectedMultipleBps !== null && item.expectedMultipleBps !== undefined
    ? item.expectedMultipleBps - 10_000
    : economics.profitBps;
  return {
    ...item,
    economics: { ...economics, profitBps },
    expectedMultipleBps: item.expectedMultipleBps ?? 10_000 + economics.profitBps,
  };
}

/**
 * Assemble the Green Energy desk for one customer: administrator dossiers
 * merged with the live public discovery catalogue, that customer's positions,
 * wallet balances and a derived summary. Catalogue and storage reads run
 * independently so a failure in one still returns the rest. Every opportunity
 * carries an auto-assigned economic profile (amount band, profit, term, close
 * date, currency and platform fee) that an administrator can override.
 */
export async function getGreenEnergyInvestmentDashboard(userId: number) {
  const [catalogue, store, adminOpportunities] = await Promise.all([
    getGreenEnergyInvestmentCatalogue(),
    readGreenEnergyStore(userId),
    readAdminOpportunities(),
  ]);

  const baseOpportunities = [...adminOpportunities, ...catalogue.opportunities].sort(compareGreenEnergyOpportunities);
  let economicsMap = new Map<string, DeskEconomics>();
  try {
    economicsMap = await getDeskEconomicsMap("greenEnergy", baseOpportunities.map((item) => item.id));
  } catch (error) {
    console.error("[GreenEnergy] Failed to read desk economics:", error instanceof Error ? error.message : "UnknownError");
  }
  const opportunities = baseOpportunities.map((item) => withGreenEnergyEconomics(item, economicsMap.get(item.id)));
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
    generation: opportunities.filter((item) => item.energyType === "SOLAR_PV" || item.energyType === "CONCENTRATED_SOLAR" || item.energyType === "ONSHORE_WIND" || item.energyType === "OFFSHORE_WIND" || item.energyType === "HYDROPOWER" || item.energyType === "GEOTHERMAL" || item.energyType === "TIDAL_WAVE" || item.energyType === "BIOMASS_BIOENERGY").length,
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
    combinedSource: GREEN_ENERGY_COMBINED_SOURCE,
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
export async function quoteGreenEnergyPurchase(
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
    const plan = planPurchaseFunding(wallets, rates, amountMinor, String(input.fundingSource || GREEN_ENERGY_COMBINED_SOURCE), order);
    return {
      amountMinor,
      fundingSource: String(input.fundingSource || GREEN_ENERGY_COMBINED_SOURCE).toUpperCase(),
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
      fundingSource: String(input.fundingSource || GREEN_ENERGY_COMBINED_SOURCE).toUpperCase(),
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
  energyType: GreenEnergyType | null;
  sector: GreenEnergySector | null;
  standard: GreenEnergyStandard | null;
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
async function resolveGreenEnergyInstrument(instrumentId: string): Promise<ResolvedInstrument> {
  const economics = await getOrAssignGreenEnergyEconomics(instrumentId);
  const resolvedMultiple = (published: number | null) => published ?? (economics ? 10_000 + economics.profitBps : null);
  const dossier = await findEnabledAdminGreenEnergyDossier(instrumentId);
  if (dossier) {
    return {
      instrumentId: dossier.id, instrumentName: dossier.title, energyType: dossier.energyType, sector: dossier.sector,
      standard: dossier.standard, status: dossier.status, expectedMultipleBps: resolvedMultiple(dossier.expectedMultipleBps), unitPriceMinor: dossier.unitPriceMinor,
      source: dossier.source, asOf: dossier.asOf,
    };
  }
  const discovery = await findGreenEnergyOpportunity(instrumentId);
  if (discovery) {
    return {
      instrumentId: discovery.id, instrumentName: discovery.title, energyType: discovery.energyType, sector: discovery.sector,
      standard: discovery.standard, status: discovery.status, expectedMultipleBps: resolvedMultiple(discovery.expectedMultipleBps), unitPriceMinor: discovery.unitPriceMinor,
      source: discovery.source, asOf: discovery.asOf,
    };
  }
  throw new Error("This opportunity is not currently open on the Green Energy desk. Refresh and try again.");
}

/**
 * Fund one green energy opportunity with the customer's own money. Settles in
 * USD and may be funded from the settlement wallet, a single chosen wallet, or
 * every wallet combined through live FX. The wallet ledger is debited per source
 * wallet, the amount is locked, and one durable position plus a notice is written
 * in a single transaction. Idempotent per request key; the instrument's published
 * data is re-read server-side so a client cannot dictate its merits or source.
 */
export async function purchaseGreenEnergyOpportunity(
  userId: number,
  input: { instrumentId: string; amountMinor: number; fundingSource?: string; idempotencyKey: string },
) {
  await ensureGreenEnergySchema();
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new Error("Enter a valid investment amount");
  if (input.amountMinor > MAX_PURCHASE_MINOR) throw new Error("This amount exceeds the per-purchase ceiling for the Green Energy desk");

  const instrument = await resolveGreenEnergyInstrument(String(input.instrumentId || ""));
  const fundingSource = String(input.fundingSource || GREEN_ENERGY_COMBINED_SOURCE).trim().toUpperCase();
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
      const positionCode = `GE-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
      const reference = `green-energy-purchase:${positionCode}`;

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
          [userId, debit.currency, -debit.amountMinor, "green_energy_fx_debit", `${reference}-fx-${debit.currency}-debit`],
        );
        await conn.execute(
          `INSERT INTO balance_ledger (userId,currency,amountMinor,entryType,reference,withdrawable) VALUES (?,?,?,?,?,false)`,
          [userId, SETTLEMENT_CURRENCY, debit.convertedUsdMinor, "green_energy_fx_credit", `${reference}-fx-${debit.currency}-credit`],
        );
        await conn.execute(
          `INSERT INTO fx_rate_snapshots (baseAsset,quoteAsset,rate,provider,sourceDate,rawJson) VALUES (?,?,?,?,?,?)`,
          [
            debit.currency, SETTLEMENT_CURRENCY, debit.rate.rateUsdPerUnit, debit.rate.provider, debit.rate.sourceDate,
            JSON.stringify({
              purpose: "green_energy_cross_wallet_conversion",
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
        [userId, SETTLEMENT_CURRENCY, -input.amountMinor, "green_energy_purchase", reference],
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
        `INSERT INTO ${GREEN_ENERGY_POSITIONS_TABLE}
          (positionCode,userId,instrumentId,instrumentName,energyType,sector,standard,amountMinor,currency,fundingSource,fundingPlanJson,units,statusAtPurchase,expectedMultipleBps,dataSource,dataAsOf,positionStatus,openedAt,ledgerReference)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'ACTIVE', NOW(), ?)`,
        [
          positionCode, userId, instrument.instrumentId, instrument.instrumentName, instrument.energyType, instrument.sector, instrument.standard,
          input.amountMinor, SETTLEMENT_CURRENCY, fundingSource, fundingPlanJson, units, instrument.status,
          instrument.expectedMultipleBps, instrument.source, instrument.asOf, reference,
        ],
      );

      // Record the customer's contribution against the instrument's live progress.
      await conn.execute(`UPDATE ${GREEN_ENERGY_DOSSIERS_TABLE} SET committedMinor=committedMinor+?, updatedAt=NOW(3) WHERE dossierId=?`, [input.amountMinor, instrument.instrumentId]);

      const fundingLabel = plan.debits.length
        ? `funded from ${plan.debits.map((debit) => debit.currency).join(", ")} alongside ${SETTLEMENT_CURRENCY}`
        : `funded from your ${SETTLEMENT_CURRENCY} balance`;
      await conn.execute(
        `INSERT INTO customer_notifications (userId,title,body,eventKey,category,priority) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE eventKey=VALUES(eventKey)`,
        [
          userId,
          "Green Energy commitment recorded",
          `Your commitment of ${input.amountMinor} minor units of ${SETTLEMENT_CURRENCY} to “${instrument.instrumentName}” was recorded through the wallet ledger, ${fundingLabel}. The amount is held against the opportunity and released against its published milestones; the return depends on the realised issuance revenue and the configured funder multiple.`,
          `u${userId}:green-energy:${positionCode}`,
          "ledger_debit",
          "normal",
        ],
      );

      const result = {
        positionCode,
        instrumentId: instrument.instrumentId,
        instrumentName: instrument.instrumentName,
        energyType: instrument.energyType,
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
        [userId, key, "green-energy.purchase", JSON.stringify(result)],
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
export type GreenEnergyOpenInstrument = {
  instrumentId: string;
  instrumentName: string;
  energyType: string | null;
  standard: string | null;
  openPositions: number;
  committedMinor: number;
  currency: string;
};

/** Distinct instruments that still hold open (unresolved) customer positions. */
export async function listGreenEnergyOpenInstruments(): Promise<GreenEnergyOpenInstrument[]> {
  await ensureGreenEnergySchema();
  return withConnection(async (conn) => {
    const [rows] = await conn.query<any[]>(
      `SELECT instrumentId, MAX(instrumentName) instrumentName, MAX(energyType) energyType, MAX(standard) standard,
              COUNT(*) openPositions, SUM(amountMinor) committedMinor, MAX(currency) currency
       FROM ${GREEN_ENERGY_POSITIONS_TABLE}
       WHERE outcome IS NULL
       GROUP BY instrumentId
       ORDER BY committedMinor DESC, instrumentId`,
    );
    return rows.map((row) => ({
      instrumentId: String(row.instrumentId),
      instrumentName: String(row.instrumentName || row.instrumentId),
      energyType: row.energyType ? String(row.energyType) : null,
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
export async function recordGreenEnergyDistribution(
  adminUserId: number,
  input: { instrumentId: string; amountMinor: number; note?: string; idempotencyKey: string },
) {
  const instrumentId = String(input.instrumentId || "").trim();
  if (!instrumentId) throw new Error("Select an instrument to distribute revenue to");
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new Error("Enter a valid distribution amount");
  const key = `green-energy:distribution:${adminUserId}:${crypto.createHash("sha256").update(String(input.idempotencyKey || "")).digest("hex")}`;

  await ensureGreenEnergySchema();
  return withConnection(async (conn) => {
    await conn.beginTransaction();
    try {
      const [prior] = await conn.query<any[]>(`SELECT resultJson FROM v5_idempotency_keys WHERE userId=? AND keyValue=? LIMIT 1 FOR UPDATE`, [adminUserId, key]);
      if (prior.length) { await conn.commit(); return JSON.parse(prior[0].resultJson); }

      const [positions] = await conn.query<any[]>(
        `SELECT id, userId, positionCode, amountMinor, instrumentName FROM ${GREEN_ENERGY_POSITIONS_TABLE} WHERE instrumentId=? AND outcome IS NULL FOR UPDATE`,
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
          [ownerId, SETTLEMENT_CURRENCY, share, "green_energy_distribution", `green-energy-distribution:${position.positionCode}:${Date.now()}`],
        );
        await conn.execute(
          `UPDATE ${GREEN_ENERGY_POSITIONS_TABLE} SET distributedMinor=distributedMinor+? WHERE id=?`,
          [share, position.id],
        );
        await conn.execute(
          `INSERT INTO customer_notifications (userId,title,body,eventKey,category,priority) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE eventKey=VALUES(eventKey)`,
          [
            ownerId,
            "Green Energy revenue distribution credited",
            `A revenue distribution of ${share} minor units of ${SETTLEMENT_CURRENCY} from “${instrumentName}” was credited to your wallet. Your principal remains held against the opportunity.`,
            `u${ownerId}:green-energy-distribution:${position.positionCode}:${Date.now()}`,
            "ledger_credit",
            "normal",
          ],
        );
        creditedMinor += share;
      }

      const result = { instrumentId, instrumentName, amountMinor: input.amountMinor, creditedMinor, positions: positions.length };
      await conn.execute(
        `INSERT INTO v5_audit_events (actorUserId,action,entityType,entityId,reference,metadataJson) VALUES (?,?,?,?,?,?)`,
        [adminUserId, "green_energy_distribution_recorded", "green_energy_instrument", instrumentId, `green_energy_instrument:${instrumentId}`, JSON.stringify({ ...result, note: input.note ? String(input.note).slice(0, 400) : null })],
      );
      await conn.execute(`INSERT INTO v5_idempotency_keys (userId,keyValue,command,resultJson) VALUES (?,?,?,?)`, [adminUserId, key, "green-energy.distribution", JSON.stringify(result)]);
      await conn.commit();
      return result;
    } catch (error) {
      await conn.rollback();
      throw error;
    }
  });
}

/**
 * Settle a green energy instrument by an administrator-chosen funder multiple.
 * For OUTPERFORM and ON_PLAN each open position is paid principal ×
 * funderMultipleBps into the settlement wallet with a compensating ledger entry;
 * for WRITE_OFF the capital is written off (no credit is fabricated). Positions
 * that already carry an outcome are never paid twice, and historical entries are
 * never edited. Idempotent against a double submit: an instrument with no
 * remaining open positions is rejected rather than paid again.
 */
export async function settleGreenEnergyInstrument(
  adminUserId: number,
  input: { instrumentId: string; outcome: GreenEnergyOutcome; funderMultipleBps: number; reason?: string },
) {
  const instrumentId = String(input.instrumentId || "").trim();
  if (!instrumentId) throw new Error("Select an opportunity to settle");
  if (input.outcome !== "OUTPERFORM" && input.outcome !== "ON_PLAN" && input.outcome !== "WRITE_OFF") throw new Error("Select a valid outcome");
  const requestedBps = Math.round(Number(input.funderMultipleBps) || 0);
  if (requestedBps < 0 || requestedBps > 1_000_000) throw new Error("The funder multiple must be between 0.00x and 100.00x");
  const funderMultipleBps = input.outcome === "WRITE_OFF" ? 0 : requestedBps;

  await ensureGreenEnergySchema();
  return withConnection(async (conn) => {
    await conn.beginTransaction();
    try {
      const [positions] = await conn.query<any[]>(
        `SELECT id, userId, positionCode, amountMinor, instrumentName FROM ${GREEN_ENERGY_POSITIONS_TABLE}
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
            [ownerId, SETTLEMENT_CURRENCY, payout, "green_energy_payout", `green-energy-payout:${position.positionCode}`],
          );
        }
        await conn.execute(
          `UPDATE ${GREEN_ENERGY_POSITIONS_TABLE} SET outcome=?, realisedMinor=?, settledAt=NOW(), positionStatus=? WHERE id=?`,
          [input.outcome, payout, payout > 0 ? "SETTLED" : "WRITTEN_OFF", position.id],
        );
        await conn.execute(
          `INSERT INTO customer_notifications (userId,title,body,eventKey,category,priority) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE eventKey=VALUES(eventKey)`,
          [
            ownerId,
            payout > 0 ? "Green Energy payout credited" : "Green Energy capital written off",
            payout > 0
              ? `“${instrumentName}” resolved as ${input.outcome === "OUTPERFORM" ? "outperform" : "on plan"}. ${payout} minor units of ${SETTLEMENT_CURRENCY} were credited to your wallet, repaying principal plus the configured funder multiple.`
              : `“${instrumentName}” was written off. The ${principal} minor units of ${SETTLEMENT_CURRENCY} principal were written off; no credit was made.`,
            `u${ownerId}:green-energy-outcome:${position.positionCode}`,
            payout > 0 ? "ledger_credit" : "ledger_debit",
            "normal",
          ],
        );
        if (payout > 0) paidMinor += payout;
        else if (input.outcome === "WRITE_OFF") writtenOffMinor += principal;
      }

      // If an administrator dossier exists for this instrument, close it too so it
      // stops advertising funding.
      const dossier = await findAdminGreenEnergyDossier(instrumentId);
      if (dossier) {
        await applyGreenEnergyDossierOutcome(conn, instrumentId, input.outcome);
        await conn.execute(`UPDATE ${GREEN_ENERGY_DOSSIERS_TABLE} SET dossierStatus=?, updatedAt=NOW(3) WHERE dossierId=?`, ["COMPLETED", instrumentId]);
      }

      await conn.execute(
        `INSERT INTO v5_audit_events (actorUserId,action,entityType,entityId,reference,metadataJson) VALUES (?,?,?,?,?,?)`,
        [
          adminUserId, "green_energy_instrument_settled", "green_energy_instrument", instrumentId,
          `green_energy_instrument:${instrumentId}`,
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
