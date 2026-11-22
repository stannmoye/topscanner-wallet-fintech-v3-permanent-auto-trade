import crypto from "node:crypto";
import mysql from "mysql2/promise";
import { mysqlConnectionOptions } from "./_core/mysql";
import {
  compareTreasuryBondInstruments,
  findTreasuryBondInstrument,
  getTreasuryBondCatalogue,
  projectTreasuryBondProfit,
  type TreasuryBondInstrument,
} from "./treasuryBondProvider";
import { findEnabledAdminTreasuryBondInstrument, listEnabledAdminTreasuryBondInstruments } from "./treasuryBondInstruments";
import {
  FxRateUnavailableError,
  planCrossWalletFunding,
  calculateCombinedAvailableTargetMinor,
  type FxRateSnapshot,
} from "./modules/trading-wallet-fx";
import { getFreshTradingFxRate, getWalletFundingPriorityForFunding, listBalances, listCurrencies } from "./db";
import { getDeskEconomicsMap, getOrAssignDeskEconomics } from "./deskEconomics";
import type { DeskEconomics } from "@shared/investment-economics";

type Db = mysql.PoolConnection;

/** The desk key this desk's auto-assigned economics are stored under. */
const TREASURY_DESK_KEY = "treasury" as const;

/** Additive, self-hosted storage for treasury-bond positions (outside Drizzle). */
export const TREASURY_BOND_POSITIONS_TABLE = "treasury_bond_positions";

const CREATE_POSITIONS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS treasury_bond_positions (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  positionCode VARCHAR(40) NOT NULL,
  userId INT NOT NULL,
  instrumentId VARCHAR(80) NOT NULL,
  instrumentName VARCHAR(200) NOT NULL,
  issuer VARCHAR(200) NULL,
  country VARCHAR(80) NULL,
  countryCode VARCHAR(8) NULL,
  category VARCHAR(24) NULL,
  couponRateBps INT NOT NULL,
  tenorYears DECIMAL(8,4) NULL,
  tenureDays INT NULL,
  principalMinor BIGINT NOT NULL,
  expectedProfitMinor BIGINT NOT NULL,
  currency VARCHAR(12) NOT NULL DEFAULT 'USD',
  fundingSource VARCHAR(24) NULL,
  fundingPlanJson TEXT NULL,
  dataSource VARCHAR(140) NULL,
  dataAsOf VARCHAR(24) NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
  openedAt DATETIME NOT NULL,
  maturityAt DATETIME NOT NULL,
  ledgerReference VARCHAR(160) NOT NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY treasury_bond_positions_code_idx (positionCode),
  KEY treasury_bond_positions_user_idx (userId, status)
) ENGINE=InnoDB`;

/** Columns added after the first release; `ADD COLUMN IF NOT EXISTS` is not portable, so they are attempted and tolerated. */
const ADD_POSITIONS_COLUMNS_SQL = [
  "ALTER TABLE treasury_bond_positions ADD COLUMN fundingSource VARCHAR(24) NULL",
  "ALTER TABLE treasury_bond_positions ADD COLUMN fundingPlanJson TEXT NULL",
];

/** Every treasury-bond purchase settles into this currency; other wallets fund it through live FX. */
const SETTLEMENT_CURRENCY = "USD";
export const TREASURY_BOND_COMBINED_SOURCE = "COMBINED";
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

/**
 * Create the additive positions table when it is missing. Managed hosts start
 * from `dist/index.js` without the external schema wrapper, so the server
 * guarantees its own storage. Deliberately memoized and idempotent.
 */
export function ensureTreasuryBondSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    try {
      if (!process.env.DATABASE_URL) return;
      await withConnection(async (conn) => {
        await conn.query(CREATE_POSITIONS_TABLE_SQL);
        for (const statement of ADD_POSITIONS_COLUMNS_SQL) {
          try { await conn.query(statement); } catch { /* column already exists */ }
        }
      });
    } catch (error) {
      // Allow a later attempt to retry if the first one raced a cold database.
      schemaReady = null;
      console.error("[TreasuryBonds] Failed to ensure schema:", error instanceof Error ? error.message : "UnknownError");
    }
  })();
  return schemaReady;
}

function idempotencyKey(input: string | undefined, userId: number) {
  const value = String(input || "").trim();
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(value)) throw new Error("A valid idempotency key is required");
  return `treasury-bond:${userId}:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function rateBps(ratePct: number) {
  return Math.max(0, Math.round(ratePct * 100));
}

function tenureDays(instrument: TreasuryBondInstrument) {
  return Math.max(1, Math.round(instrument.tenorYears * 365));
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
  // The balances and the currency metadata are read separately and merged in
  // code rather than with a SQL JOIN. `customer_balances` inherits the database
  // default collation while `currency_registry` is pinned to utf8mb4_unicode_ci,
  // so joining them on `currency=code` fails with "Illegal mix of collations" on
  // databases whose default differs — the platform's own wallet reader reads
  // them separately for the same reason.
  const [currencyRows] = await conn.query<any[]>(
    `SELECT code, scale, assetType, externalCode, symbol, name currencyName
     FROM currency_registry WHERE enabled=true ORDER BY id`,
  );
  const [balanceRows] = await conn.query<any[]>(
    `SELECT b.id, b.currency, COALESCE(b.availableMinor,0) availableMinor, COALESCE(b.lockedMinor,0) lockedMinor
     FROM customer_balances b WHERE b.userId=? ORDER BY b.currency${forUpdate ? " FOR UPDATE" : ""}`,
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

/**
 * Fetch the live USD rate for every funded, non-settlement wallet that could be
 * used as a source. A missing quote is recorded as `null` so the funding planner
 * fails closed on the wallet it actually needs (it never silently skips it).
 */
async function loadWalletRates(wallets: WalletRow[]): Promise<Map<string, FxRateSnapshot | null>> {
  const rates = new Map<string, FxRateSnapshot | null>();
  await Promise.all(
    wallets
      .filter((wallet) => wallet.currency !== SETTLEMENT_CURRENCY && wallet.availableMinor > 0)
      .map(async (wallet) => {
        try {
          const rate = await getFreshTradingFxRate({
            code: wallet.currency,
            scale: wallet.scale,
            assetType: wallet.assetType,
            externalCode: wallet.externalCode,
          });
          rates.set(wallet.currency, rate);
        } catch {
          rates.set(wallet.currency, null);
        }
      }),
  );
  return rates;
}

/**
 * Build the all-or-nothing funding plan for a purchase that settles in USD.
 *
 * - `COMBINED` spends the settlement wallet first and then draws on the other
 *   wallets in administrator funding-priority order, converting through live FX.
 * - A currency code funds the whole purchase from that one wallet (converted when
 *   it is not the settlement currency).
 *
 * Any shortfall or missing rate throws; nothing is ever debited partially.
 */
function planPurchaseFunding(
  wallets: WalletRow[],
  rates: Map<string, FxRateSnapshot | null>,
  requiredUsdMinor: number,
  fundingSource: string,
  priorityOrder: string[] | null,
): PurchaseFundingPlan {
  if (!Number.isSafeInteger(requiredUsdMinor) || requiredUsdMinor < 1) throw new Error("Enter a valid purchase amount");
  if (requiredUsdMinor > MAX_PURCHASE_MINOR) throw new Error("This amount exceeds the per-purchase ceiling for the treasury-bond desk");

  const usd = wallets.find((wallet) => wallet.currency === SETTLEMENT_CURRENCY);
  const usdScale = usd ? usd.scale : 2;
  const usdAvailableMinor = usd ? usd.availableMinor : 0;
  const targetRate = usdUnitRate(usdScale);
  const source = String(fundingSource || TREASURY_BOND_COMBINED_SOURCE).trim().toUpperCase();
  const insufficient = new Error("Insufficient combined spendable wallet balance at current exchange rates");

  if (source === SETTLEMENT_CURRENCY) {
    if (requiredUsdMinor <= usdAvailableMinor) return { requiredUsdMinor, usdAvailableMinor, convertedUsdMinor: 0, debits: [], targetRate };
    throw insufficient;
  }

  const fundedNonSettlement = wallets.filter((wallet) => wallet.currency !== SETTLEMENT_CURRENCY && wallet.availableMinor > 0);
  const candidates = source === TREASURY_BOND_COMBINED_SOURCE
    ? fundedNonSettlement
    : fundedNonSettlement.filter((wallet) => wallet.currency === source);

  if (source === TREASURY_BOND_COMBINED_SOURCE && requiredUsdMinor <= usdAvailableMinor && !candidates.length) {
    return { requiredUsdMinor, usdAvailableMinor, convertedUsdMinor: 0, debits: [], targetRate };
  }
  const targetAvailableMinor = source === TREASURY_BOND_COMBINED_SOURCE ? usdAvailableMinor : 0;
  if (requiredUsdMinor <= targetAvailableMinor) return { requiredUsdMinor, usdAvailableMinor, convertedUsdMinor: 0, debits: [], targetRate };
  if (!candidates.length) throw insufficient;

  const plan = planCrossWalletFunding({
    requiredTargetMinor: requiredUsdMinor,
    targetAvailableMinor,
    targetRate,
    sourceWallets: candidates.map((wallet) => ({
      currency: wallet.currency,
      scale: wallet.scale,
      availableMinor: wallet.availableMinor,
      rate: rates.get(wallet.currency) ?? null,
    })),
    priorityCurrencies: source === TREASURY_BOND_COMBINED_SOURCE ? priorityOrder : null,
  });

  return {
    requiredUsdMinor,
    usdAvailableMinor,
    convertedUsdMinor: plan.targetCreditMinor,
    debits: plan.sourceDebits.map((debit) => ({
      currency: debit.currency,
      amountMinor: debit.amountMinor,
      convertedUsdMinor: debit.convertedTargetMinor,
      rate: debit.rate,
    })),
    targetRate,
  };
}

/**
 * Read one customer's stored treasury-bond positions and wallet balances.
 * The two reads are deliberately independent: the customer's wallets live in
 * the platform's own `customer_balances` / `currency_registry` tables, so a
 * hiccup in the new position store must never hide them (and the live
 * instrument catalogue stays unaffected either way).
 */
async function readTreasuryBondStore(userId: number): Promise<{ positions: any[]; balances: any[]; warning: string | null }> {
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
    console.error("[TreasuryBonds] Failed to read wallet balances:", error instanceof Error ? error.message : "UnknownError");
    failed.push("wallet balances");
  }

  // Positions are served by the desk's own additive table; a missing or
  // not-yet-migrated table degrades to "no positions", never to a blank desk.
  let positions: any[] = [];
  try {
    await ensureTreasuryBondSchema();
    positions = await withConnection(async (conn) => {
      const [rows] = await conn.query<any[]>(
        `SELECT id, positionCode, instrumentId, instrumentName, issuer, country, countryCode, category,
                couponRateBps, tenorYears, tenureDays, principalMinor, expectedProfitMinor, currency,
                fundingSource, fundingPlanJson, dataSource, dataAsOf, status, openedAt, maturityAt, ledgerReference
         FROM treasury_bond_positions WHERE userId=? ORDER BY openedAt DESC`,
        [userId],
      );
      return rows;
    });
  } catch (error) {
    console.error("[TreasuryBonds] Failed to read position store:", error instanceof Error ? error.message : "UnknownError");
    failed.push("saved positions");
  }

  const warning = failed.length >= 2
    ? "Your saved positions and wallet balance could not be loaded right now. The live catalogue below is unaffected."
    : failed.length === 1
      ? `Your ${failed[0]} could not be loaded right now. The live catalogue below is unaffected.`
      : null;
  return { positions, balances, warning };
}

/**
 * Read administrator-published instruments for the customer desk. Best-effort:
 * a database hiccup must never hide the live public-data catalogue, so failures
 * degrade to an empty list rather than throwing.
 */
async function readAdminInstruments(): Promise<TreasuryBondInstrument[]> {
  try {
    return await listEnabledAdminTreasuryBondInstruments();
  } catch (error) {
    console.error("[TreasuryBonds] Failed to read administrator instruments:", error instanceof Error ? error.message : "UnknownError");
    return [];
  }
}

/**
 * Read one instrument's auto-assigned economic profile, assigning and persisting
 * it on first sight. Fails soft: a storage problem still yields the
 * deterministically derived profile so a card never loses its offer details.
 */
async function getOrAssignTreasuryEconomics(instrumentId: string): Promise<DeskEconomics | null> {
  try {
    return await getOrAssignDeskEconomics(TREASURY_DESK_KEY, instrumentId);
  } catch (error) {
    console.error("[TreasuryBonds] Failed to assign economics:", error instanceof Error ? error.message : "UnknownError");
    return null;
  }
}

/** Merge an instrument's economic profile without touching its published data. */
function withTreasuryEconomics(instrument: TreasuryBondInstrument, economics: DeskEconomics | null | undefined): TreasuryBondInstrument {
  if (!economics) return instrument;
  return { ...instrument, economics };
}

/**
 * Assemble the treasury-bond desk for one customer: the live instrument
 * catalogue plus administrator-published instruments, that customer's own
 * positions, wallet balances and a derived summary. The catalogue read and the
 * storage read run independently so that a failure in either one still returns
 * everything the other can provide.
 */
export async function getTreasuryBondDashboard(userId: number) {
  const [catalogue, store, adminInstruments] = await Promise.all([
    getTreasuryBondCatalogue(),
    readTreasuryBondStore(userId),
    readAdminInstruments(),
  ]);

  const instruments = [...adminInstruments, ...catalogue.instruments].sort(compareTreasuryBondInstruments);

  // Every instrument the desk shows carries an auto-assigned economic profile
  // (investable amount, profit, term, currency, platform fee and any settlement
  // delay). It is read as one batch and merged additively; the published rate,
  // tenor, source and observation date are never touched.
  let economicsByInstrument = new Map<string, DeskEconomics>();
  try {
    economicsByInstrument = await getDeskEconomicsMap(TREASURY_DESK_KEY, instruments.map((instrument) => instrument.id));
  } catch (error) {
    console.error("[TreasuryBonds] Failed to read desk economics:", error instanceof Error ? error.message : "UnknownError");
  }
  const instrumentsWithEconomics = instruments.map((instrument) => withTreasuryEconomics(instrument, economicsByInstrument.get(instrument.id)));

  const sources = adminInstruments.length
    ? [...catalogue.sources, {
        name: "Arbitrade desk — administrator published",
        url: "",
        status: "ok" as const,
        detail: `${adminInstruments.length} administrator-published instrument${adminInstruments.length === 1 ? "" : "s"}`,
      }]
    : catalogue.sources;

  const positions = store.positions;
  const balances = store.balances;
  const active = positions.filter((p) => p.status === "ACTIVE");
  const investedMinor = active.reduce((sum, p) => sum + Number(p.principalMinor || 0), 0);
  const expectedProfitMinor = active.reduce((sum, p) => sum + Number(p.expectedProfitMinor || 0), 0);
  const countries = new Set(active.map((p) => String(p.country || ""))).size;
  const rates = active.map((p) => Number(p.couponRateBps || 0)).filter((value) => value > 0);
  const summary = {
    investedMinor,
    expectedProfitMinor,
    activePositions: active.length,
    completedPositions: positions.filter((p) => p.status !== "ACTIVE").length,
    countries,
    averageRatePct: rates.length ? Math.round((rates.reduce((a, b) => a + b, 0) / rates.length)) / 100 : 0,
  };
  const usd = balances.find((b) => b.currency === SETTLEMENT_CURRENCY);
  return {
    instruments: instrumentsWithEconomics,
    positions,
    balances,
    wallets: balances,
    settlementCurrency: SETTLEMENT_CURRENCY,
    combinedSource: TREASURY_BOND_COMBINED_SOURCE,
    /** Settlement-wallet balance only; the combined figure needs live FX and is quoted on demand. */
    availableMinor: Number(usd?.availableMinor || 0),
    summary,
    sources,
    fetchedAt: catalogue.fetchedAt,
    degraded: catalogue.degraded,
    storeWarning: store.warning,
  };
}

/**
 * Resolve the instrument for a purchase. Administrator-published instruments
 * are checked first so a manually created bond never depends on the public data
 * providers; a lookup failure there falls through to the live catalogue rather
 * than blocking a genuine live purchase.
 */
async function resolveInstrumentForPurchase(instrumentId: string): Promise<TreasuryBondInstrument | null> {
  let instrument: TreasuryBondInstrument | null = null;
  try {
    const admin = await findEnabledAdminTreasuryBondInstrument(instrumentId);
    if (admin) instrument = admin;
  } catch (error) {
    console.error("[TreasuryBonds] Failed to resolve administrator instrument:", error instanceof Error ? error.message : "UnknownError");
  }
  if (!instrument) instrument = await findTreasuryBondInstrument(instrumentId);
  if (!instrument) return null;
  // The published rate still drives settlement; the economic profile is attached
  // so the purchase carries the same offer details the customer reviewed.
  return withTreasuryEconomics(instrument, await getOrAssignTreasuryEconomics(instrument.id));
}

/**
 * Preview how a purchase would be funded without touching any balance. Returns
 * the combined spendable value and the exact per-wallet debits the purchase
 * would draw on. Fails soft: an unknown rate or shortfall is reported as a
 * shortfall rather than an error, so the customer sees what is missing.
 */
export async function quoteTreasuryBondPurchase(
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
    const plan = planPurchaseFunding(wallets, rates, amountMinor, String(input.fundingSource || TREASURY_BOND_COMBINED_SOURCE), order);
    return {
      amountMinor,
      fundingSource: String(input.fundingSource || TREASURY_BOND_COMBINED_SOURCE).toUpperCase(),
      sufficient: true,
      combinedAvailableMinor,
      settlementCurrency: SETTLEMENT_CURRENCY,
      usdAvailableMinor: plan.usdAvailableMinor,
      convertedUsdMinor: plan.convertedUsdMinor,
      shortfallMinor: 0,
      debits: plan.debits.map((debit) => ({
        currency: debit.currency,
        amountMinor: debit.amountMinor,
        convertedUsdMinor: debit.convertedUsdMinor,
        rate: debit.rate.rateUsdPerUnit,
        rateProvider: debit.rate.provider,
      })),
      message: null as string | null,
    };
  } catch (error) {
    const rateGap = error instanceof FxRateUnavailableError;
    const shortfallMinor = combinedAvailableMinor !== null ? Math.max(0, amountMinor - combinedAvailableMinor) : amountMinor;
    return {
      amountMinor,
      fundingSource: String(input.fundingSource || TREASURY_BOND_COMBINED_SOURCE).toUpperCase(),
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

/**
 * Purchase a treasury bond with the customer's own money. The purchase settles
 * in USD and may be funded from the settlement wallet alone, a single chosen
 * wallet, or every wallet combined through live FX. The existing wallet ledger
 * is debited per source wallet, the principal is locked, and one durable
 * position plus a notice is written in a single transaction. Idempotent per
 * request key; the instrument's published rate is re-read server-side so a
 * client cannot dictate the coupon.
 */
export async function purchaseTreasuryBond(
  userId: number,
  input: { instrumentId: string; amountMinor: number; fundingSource?: string; idempotencyKey: string },
) {
  await ensureTreasuryBondSchema();
  const instrument = await resolveInstrumentForPurchase(String(input.instrumentId || ""));
  if (!instrument) throw new Error("This treasury bond is not currently published on the desk. Refresh and try again.");
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new Error("Enter a valid purchase amount");
  if (input.amountMinor < instrument.minInvestmentMinor) {
    throw new Error(`The minimum purchase for ${instrument.name} is ${instrument.minInvestmentMinor} minor units (${(instrument.minInvestmentMinor / 100).toLocaleString()} ${SETTLEMENT_CURRENCY}).`);
  }
  if (input.amountMinor > MAX_PURCHASE_MINOR) throw new Error("This amount exceeds the per-purchase ceiling for the treasury-bond desk");

  const fundingSource = String(input.fundingSource || TREASURY_BOND_COMBINED_SOURCE).trim().toUpperCase();
  const key = idempotencyKey(input.idempotencyKey, userId);
  const couponBps = rateBps(instrument.couponRatePct);
  const expectedProfitMinor = projectTreasuryBondProfit(input.amountMinor, instrument.couponRatePct, instrument.tenorYears);
  const days = tenureDays(instrument);

  // Rates and the administrator funding order are resolved before the transaction
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

      // Guarantee the settlement wallet exists before it is locked.
      await conn.execute(
        `INSERT INTO customer_balances (userId,currency,availableMinor,lockedMinor,promotionalMinor,earnedMinor) VALUES (?,?,0,0,0,0) ON DUPLICATE KEY UPDATE userId=userId`,
        [userId, SETTLEMENT_CURRENCY],
      );
      const wallets = await readWalletRows(conn, userId, true);
      const plan = planPurchaseFunding(wallets, rates, input.amountMinor, fundingSource, priority.order);

      const now = new Date();
      const maturity = new Date(now.getTime() + days * 86400000);
      const positionCode = `TB-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
      const reference = `treasury-bond-purchase:${positionCode}`;

      // Debit every source wallet and credit the settlement wallet through FX.
      for (const debit of plan.debits) {
        const row = wallets.find((wallet) => wallet.currency === debit.currency);
        if (!row) throw new Error(`Source wallet ${debit.currency} disappeared during funding`);
        const [update] = await conn.execute<any>(
          `UPDATE customer_balances SET availableMinor=availableMinor-?, updatedAt=NOW() WHERE id=? AND availableMinor>=?`,
          [debit.amountMinor, row.id, debit.amountMinor],
        );
        if (Number(update.affectedRows || 0) !== 1) throw new Error(`Insufficient spendable ${debit.currency} balance to fund this purchase`);
        await conn.execute(
          `INSERT INTO balance_ledger (userId,currency,amountMinor,entryType,reference,withdrawable) VALUES (?,?,?,?,?,false)`,
          [userId, debit.currency, -debit.amountMinor, "treasury_bond_fx_debit", `${reference}-fx-${debit.currency}-debit`],
        );
        await conn.execute(
          `INSERT INTO balance_ledger (userId,currency,amountMinor,entryType,reference,withdrawable) VALUES (?,?,?,?,?,false)`,
          [userId, SETTLEMENT_CURRENCY, debit.convertedUsdMinor, "treasury_bond_fx_credit", `${reference}-fx-${debit.currency}-credit`],
        );
        await conn.execute(
          `INSERT INTO fx_rate_snapshots (baseAsset,quoteAsset,rate,provider,sourceDate,rawJson) VALUES (?,?,?,?,?,?)`,
          [
            debit.currency, SETTLEMENT_CURRENCY, debit.rate.rateUsdPerUnit, debit.rate.provider, debit.rate.sourceDate,
            JSON.stringify({
              purpose: "treasury_bond_cross_wallet_conversion",
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
      if (Number(settlementUpdate.affectedRows || 0) !== 1) throw new Error("Insufficient available settlement balance to complete this purchase");
      await conn.execute(
        `INSERT INTO balance_ledger (userId,currency,amountMinor,entryType,reference,withdrawable) VALUES (?,?,?,?,?,false)`,
        [userId, SETTLEMENT_CURRENCY, -input.amountMinor, "treasury_bond_purchase", reference],
      );

      const fundingPlanJson = JSON.stringify({
        fundingSource,
        settlementCurrency: SETTLEMENT_CURRENCY,
        requiredUsdMinor: input.amountMinor,
        settlementWalletMinor: input.amountMinor - plan.convertedUsdMinor,
        convertedUsdMinor: plan.convertedUsdMinor,
        sourceDebits: plan.debits.map((debit) => ({
          currency: debit.currency,
          amountMinor: debit.amountMinor,
          convertedUsdMinor: debit.convertedUsdMinor,
          rate: debit.rate.rateUsdPerUnit,
          rateProvider: debit.rate.provider,
          rateSourceDate: debit.rate.sourceDate,
        })),
        recordedAt: now.toISOString(),
      });

      await conn.execute(
        `INSERT INTO treasury_bond_positions
          (positionCode,userId,instrumentId,instrumentName,issuer,country,countryCode,category,couponRateBps,tenorYears,tenureDays,principalMinor,expectedProfitMinor,currency,fundingSource,fundingPlanJson,dataSource,dataAsOf,status,openedAt,maturityAt,ledgerReference)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'ACTIVE', NOW(), ?, ?)`,
        [
          positionCode, userId, instrument.id, instrument.name, instrument.issuer, instrument.country,
          instrument.countryCode, instrument.category, couponBps, instrument.tenorYears, days,
          input.amountMinor, expectedProfitMinor, SETTLEMENT_CURRENCY, fundingSource, fundingPlanJson,
          instrument.source, instrument.asOf, maturity, reference,
        ],
      );

      const fundingLabel = plan.debits.length
        ? `funded from ${plan.debits.map((debit) => debit.currency).join(", ")} alongside ${SETTLEMENT_CURRENCY}`
        : `funded from your ${SETTLEMENT_CURRENCY} balance`;
      await conn.execute(
        `INSERT INTO customer_notifications (userId,title,body,eventKey,category,priority) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE eventKey=VALUES(eventKey)`,
        [
          userId,
          "Treasury bond purchase confirmed",
          `${instrument.name} was purchased and ${input.amountMinor} minor units of ${SETTLEMENT_CURRENCY} principal were reserved through the wallet ledger, ${fundingLabel}. Expected profit at maturity: ${expectedProfitMinor} minor units.`,
          `u${userId}:treasury-bond:${positionCode}`,
          "ledger_debit",
          "normal",
        ],
      );

      const result = {
        positionCode,
        instrumentId: instrument.id,
        instrumentName: instrument.name,
        country: instrument.country,
        countryCode: instrument.countryCode,
        category: instrument.category,
        couponRatePct: instrument.couponRatePct,
        couponRateBps: couponBps,
        tenorYears: instrument.tenorYears,
        principalMinor: input.amountMinor,
        expectedProfitMinor,
        currency: SETTLEMENT_CURRENCY,
        fundingSource,
        fundingPlan: JSON.parse(fundingPlanJson),
        status: "ACTIVE",
        maturityAt: maturity.toISOString(),
        ledgerReference: reference,
      };
      await conn.execute(
        `INSERT INTO v5_idempotency_keys (userId,keyValue,command,resultJson) VALUES (?,?,?,?)`,
        [userId, key, "treasury-bond.purchase", JSON.stringify(result)],
      );
      await conn.commit();
      return result;
    } catch (error) {
      await conn.rollback();
      throw error;
    }
  });
}
