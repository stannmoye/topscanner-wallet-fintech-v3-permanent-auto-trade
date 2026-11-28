import crypto from "node:crypto";
import mysql from "mysql2/promise";
import { getSharedMysqlPool } from "./_core/mysql";
import {
  compareCooperateDeptCompanies,
  findCooperateDeptCompany,
  getCooperateDeptCatalogue,
  type CooperateDeptCompany,
} from "@shared/cooperate-dept-catalogue";
import {
  findEnabledAdminCooperateDeptCompany,
  listEnabledAdminCooperateDeptCompanies,
  type OwnershipBasis,
} from "./cooperateDeptCompanies";
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

/** Additive, self-hosted storage for Cooperate Dept purchases (outside Drizzle). */
export const COOPERATE_DEPT_POSITIONS_TABLE = "cooperate_dept_positions";

const CREATE_POSITIONS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS cooperate_dept_positions (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  positionCode VARCHAR(40) NOT NULL,
  userId INT NOT NULL,
  companyId VARCHAR(80) NOT NULL,
  companyName VARCHAR(200) NOT NULL,
  country VARCHAR(80) NULL,
  countryCode VARCHAR(8) NULL,
  severity VARCHAR(16) NULL,
  companyStatus VARCHAR(24) NULL,
  ownershipBasis VARCHAR(24) NOT NULL,
  amountMinor BIGINT NOT NULL,
  currency VARCHAR(12) NOT NULL DEFAULT 'USD',
  fundingSource VARCHAR(24) NULL,
  fundingPlanJson TEXT NULL,
  targetDate VARCHAR(24) NULL,
  dataSource VARCHAR(160) NULL,
  dataAsOf VARCHAR(24) NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
  openedAt DATETIME NOT NULL,
  ledgerReference VARCHAR(160) NOT NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY cooperate_dept_positions_code_idx (positionCode),
  KEY cooperate_dept_positions_user_idx (userId, status)
) ENGINE=InnoDB`;

/** Columns added after the first release; `ADD COLUMN IF NOT EXISTS` is not portable, so they are attempted and tolerated. */
const ADD_POSITIONS_COLUMNS_SQL = [
  "ALTER TABLE cooperate_dept_positions ADD COLUMN fundingSource VARCHAR(24) NULL",
  "ALTER TABLE cooperate_dept_positions ADD COLUMN fundingPlanJson TEXT NULL",
];

/** Every Cooperate Dept purchase settles into this currency; other wallets fund it through live FX. */
const SETTLEMENT_CURRENCY = "USD";
export const COOPERATE_DEPT_COMBINED_SOURCE = "COMBINED";
const MAX_PURCHASE_MINOR = 100_000_000; // $1,000,000 ceiling per purchase

/** The desk key this desk's auto-assigned economics are stored under. */
const COOPERATE_DEPT_DESK_KEY = "cooperate" as const;

/**
 * Read one company's auto-assigned economic profile, assigning and persisting it
 * on first sight. Fails soft: a storage problem still yields the deterministically
 * derived profile so a card never loses its offer details.
 */
async function getOrAssignCooperateEconomics(instrumentId: string): Promise<DeskEconomics | null> {
  try {
    return await getOrAssignDeskEconomics(COOPERATE_DEPT_DESK_KEY, instrumentId);
  } catch (error) {
    console.error("[CooperateDept] Failed to assign economics:", error instanceof Error ? error.message : "UnknownError");
    return null;
  }
}

/** Merge a company's economic profile without touching its published register data. */
function withCooperateEconomics(company: CooperateDeptCompany, economics: DeskEconomics | null | undefined): CooperateDeptCompany {
  if (!economics) return company;
  return { ...company, economics };
}

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

/**
 * Create the additive positions table when it is missing. Managed hosts start
 * from `dist/index.js` without the external schema wrapper, so the server
 * guarantees its own storage. Deliberately memoized and idempotent.
 */
export function ensureCooperateDeptSchema(): Promise<void> {
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
      schemaReady = null;
      console.error("[CooperateDept] Failed to ensure schema:", error instanceof Error ? error.message : "UnknownError");
    }
  })();
  return schemaReady;
}

function idempotencyKey(input: string | undefined, userId: number) {
  const value = String(input || "").trim();
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(value)) throw new Error("A valid idempotency key is required");
  return `cooperate-dept:${userId}:${crypto.createHash("sha256").update(value).digest("hex")}`;
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
  if (requiredUsdMinor > MAX_PURCHASE_MINOR) throw new Error("This amount exceeds the per-purchase ceiling for the Cooperate Dept desk");

  const usd = wallets.find((wallet) => wallet.currency === SETTLEMENT_CURRENCY);
  const usdScale = usd ? usd.scale : 2;
  const usdAvailableMinor = usd ? usd.availableMinor : 0;
  const targetRate = usdUnitRate(usdScale);
  const source = String(fundingSource || COOPERATE_DEPT_COMBINED_SOURCE).trim().toUpperCase();
  const insufficient = new Error("Insufficient combined spendable wallet balance at current exchange rates");

  if (source === SETTLEMENT_CURRENCY) {
    if (requiredUsdMinor <= usdAvailableMinor) return { requiredUsdMinor, usdAvailableMinor, convertedUsdMinor: 0, debits: [], targetRate };
    throw insufficient;
  }

  const fundedNonSettlement = wallets.filter((wallet) => wallet.currency !== SETTLEMENT_CURRENCY && wallet.availableMinor > 0);
  const candidates = source === COOPERATE_DEPT_COMBINED_SOURCE
    ? fundedNonSettlement
    : fundedNonSettlement.filter((wallet) => wallet.currency === source);

  if (source === COOPERATE_DEPT_COMBINED_SOURCE && requiredUsdMinor <= usdAvailableMinor && !candidates.length) {
    return { requiredUsdMinor, usdAvailableMinor, convertedUsdMinor: 0, debits: [], targetRate };
  }
  const targetAvailableMinor = source === COOPERATE_DEPT_COMBINED_SOURCE ? usdAvailableMinor : 0;
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
    priorityCurrencies: source === COOPERATE_DEPT_COMBINED_SOURCE ? priorityOrder : null,
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
 * Read one customer's stored Cooperate Dept purchases and wallet balances.
 * The two reads are deliberately independent: the customer's wallets live in
 * the platform's own `customer_balances` / `currency_registry` tables, so a
 * hiccup in the new purchase store must never hide them (and the live company
 * catalogue stays unaffected either way).
 */
async function readCooperateDeptStore(userId: number): Promise<{ positions: any[]; balances: any[]; warning: string | null }> {
  const failed: string[] = [];

  // The customer's existing wallets are read first, through the platform's own
  // wallet readers. They read `customer_balances` and `currency_registry`
  // separately (never a cross-collation JOIN) so the desk shows exactly the
  // same wallets as the rest of the portal, and they always load even when the
  // (separate) purchase store is unavailable.
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
    console.error("[CooperateDept] Failed to read wallet balances:", error instanceof Error ? error.message : "UnknownError");
    failed.push("wallet balances");
  }

  // Purchases are served by the desk's own additive table; a missing or
  // not-yet-migrated table degrades to "no purchases", never to a blank desk.
  let positions: any[] = [];
  try {
    await ensureCooperateDeptSchema();
    positions = await withConnection(async (conn) => {
      const [rows] = await conn.query<any[]>(
        `SELECT id, positionCode, companyId, companyName, country, countryCode, severity, companyStatus,
                ownershipBasis, amountMinor, currency, fundingSource, fundingPlanJson, targetDate,
                dataSource, dataAsOf, status, openedAt, ledgerReference
         FROM cooperate_dept_positions WHERE userId=? ORDER BY openedAt DESC`,
        [userId],
      );
      return rows;
    });
  } catch (error) {
    console.error("[CooperateDept] Failed to read purchase store:", error instanceof Error ? error.message : "UnknownError");
    failed.push("saved purchases");
  }

  const warning = failed.length >= 2
    ? "Your saved purchases and wallet balances could not be loaded right now. The live catalogue below is unaffected."
    : failed.length === 1
      ? `Your ${failed[0]} could not be loaded right now. The live catalogue below is unaffected.`
      : null;
  return { positions, balances, warning };
}

/**
 * Read administrator-published companies for the customer desk. Best-effort:
 * a database hiccup must never hide the live public-register catalogue.
 */
async function readAdminCompanies(): Promise<CooperateDeptCompany[]> {
  try {
    return await listEnabledAdminCooperateDeptCompanies();
  } catch (error) {
    console.error("[CooperateDept] Failed to read administrator companies:", error instanceof Error ? error.message : "UnknownError");
    return [];
  }
}

/**
 * Assemble the Cooperate Dept desk for one customer: the live company catalogue
 * plus administrator-published companies, that customer's own purchases, wallet
 * balances and a derived summary. The catalogue read and the storage read run
 * independently so a failure in either one still returns the rest.
 */
export async function getCooperateDeptDashboard(userId: number) {
  const [catalogue, store, adminCompanies] = await Promise.all([
    getCooperateDeptCatalogue(),
    readCooperateDeptStore(userId),
    readAdminCompanies(),
  ]);

  const companies = [...adminCompanies, ...catalogue.companies].sort(compareCooperateDeptCompanies);

  // Every company the desk shows carries an auto-assigned economic profile
  // (investable amount, profit, term, currency, platform fee and any occasional
  // settlement delay). It is read as one batch and merged additively; the
  // published register data, source and observation date are never touched.
  let economicsByCompany = new Map<string, DeskEconomics>();
  try {
    economicsByCompany = await getDeskEconomicsMap(COOPERATE_DEPT_DESK_KEY, companies.map((company) => company.id));
  } catch (error) {
    console.error("[CooperateDept] Failed to read desk economics:", error instanceof Error ? error.message : "UnknownError");
  }
  const companiesWithEconomics = companies.map((company) => withCooperateEconomics(company, economicsByCompany.get(company.id)));

  const sources = adminCompanies.length
    ? [...catalogue.sources, {
        name: "Arbitrade desk — administrator published",
        url: "",
        country: "XX",
        role: "companies" as const,
        status: "ok" as const,
        detail: `${adminCompanies.length} administrator-published compan${adminCompanies.length === 1 ? "y" : "ies"}`,
      }]
    : catalogue.sources;

  const positions = store.positions;
  const balances = store.balances;
  const active = positions.filter((p) => p.status === "ACTIVE");
  const purchasedMinor = active.reduce((sum, p) => sum + Number(p.amountMinor || 0), 0);
  const countries = new Set(active.map((p) => String(p.country || "")).filter(Boolean)).size;
  const critical = companies.filter((company) => company.severity === "CRITICAL").length;
  const imminent = companies.filter((company) => {
    if (!company.countdown || company.countdown.direction !== "until") return false;
    const target = Date.parse(company.countdown.targetDate);
    if (!Number.isFinite(target)) return false;
    return target - Date.now() <= 90 * 86400000;
  }).length;
  const summary = {
    purchasedMinor,
    activePurchases: active.length,
    completedPurchases: positions.filter((p) => p.status !== "ACTIVE").length,
    countries,
    criticalCompanies: critical,
    imminentLitigation: imminent,
  };
  const usd = balances.find((b) => b.currency === SETTLEMENT_CURRENCY);
  return {
    companies: companiesWithEconomics,
    positions,
    balances,
    wallets: balances,
    settlementCurrency: SETTLEMENT_CURRENCY,
    combinedSource: COOPERATE_DEPT_COMBINED_SOURCE,
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
 * Resolve the company for a purchase. Administrator-published companies are
 * checked first so a manually created record never depends on the public data
 * providers; a lookup failure there falls through to the live catalogue.
 */
async function resolveCompanyForPurchase(companyId: string): Promise<CooperateDeptCompany | null> {
  try {
    const admin = await findEnabledAdminCooperateDeptCompany(companyId);
    if (admin) return admin;
  } catch (error) {
    console.error("[CooperateDept] Failed to resolve administrator company:", error instanceof Error ? error.message : "UnknownError");
  }
  return findCooperateDeptCompany(companyId);
}

/**
 * Preview how a purchase would be funded without touching any balance. Returns
 * the combined spendable value and the exact per-wallet debits the settlement
 * wallet would draw on. Fails soft: an unknown rate or shortfall is reported as
 * a shortfall rather than an error, so the customer sees what is missing.
 */
export async function quoteCooperateDeptPurchase(
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
    const plan = planPurchaseFunding(wallets, rates, amountMinor, String(input.fundingSource || COOPERATE_DEPT_COMBINED_SOURCE), order);
    return {
      amountMinor,
      fundingSource: String(input.fundingSource || COOPERATE_DEPT_COMBINED_SOURCE).toUpperCase(),
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
      fundingSource: String(input.fundingSource || COOPERATE_DEPT_COMBINED_SOURCE).toUpperCase(),
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
 * Buy a stake in (or the whole of) a company with the customer's own money. The
 * purchase settles in USD and may be funded from the settlement wallet alone, a
 * single chosen wallet, or every wallet combined through live FX. The existing
 * wallet ledger is debited per source wallet, the amount is locked, and one
 * durable position plus a notice is written in a single transaction. Idempotent
 * per request key; the company's published data is re-read server-side so a
 * client cannot dictate severity, ownership basis or the recorded source.
 */
export async function purchaseCooperateDeptCompany(
  userId: number,
  input: { companyId: string; amountMinor: number; ownershipBasis: OwnershipBasis; fundingSource?: string; idempotencyKey: string },
) {
  await ensureCooperateDeptSchema();
  const company = await resolveCompanyForPurchase(String(input.companyId || ""));
  if (!company) throw new Error("This company is not currently published on the Cooperate Dept desk. Refresh and try again.");
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new Error("Enter a valid purchase amount");
  if (input.amountMinor > MAX_PURCHASE_MINOR) throw new Error("This amount exceeds the per-purchase ceiling for the Cooperate Dept desk");
  if (!["SHARES", "FULL_OWNERSHIP", "ASSET_PURCHASE"].includes(input.ownershipBasis)) throw new Error("Select a valid ownership basis");

  const fundingSource = String(input.fundingSource || COOPERATE_DEPT_COMBINED_SOURCE).trim().toUpperCase();
  const key = idempotencyKey(input.idempotencyKey, userId);
  const targetDate = company.countdown?.targetDate || null;

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
      const positionCode = `CD-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
      const reference = `cooperate-dept-purchase:${positionCode}`;

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
          [userId, debit.currency, -debit.amountMinor, "cooperate_dept_fx_debit", `${reference}-fx-${debit.currency}-debit`],
        );
        await conn.execute(
          `INSERT INTO balance_ledger (userId,currency,amountMinor,entryType,reference,withdrawable) VALUES (?,?,?,?,?,false)`,
          [userId, SETTLEMENT_CURRENCY, debit.convertedUsdMinor, "cooperate_dept_fx_credit", `${reference}-fx-${debit.currency}-credit`],
        );
        await conn.execute(
          `INSERT INTO fx_rate_snapshots (baseAsset,quoteAsset,rate,provider,sourceDate,rawJson) VALUES (?,?,?,?,?,?)`,
          [
            debit.currency, SETTLEMENT_CURRENCY, debit.rate.rateUsdPerUnit, debit.rate.provider, debit.rate.sourceDate,
            JSON.stringify({
              purpose: "cooperate_dept_cross_wallet_conversion",
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
        [userId, SETTLEMENT_CURRENCY, -input.amountMinor, "cooperate_dept_purchase", reference],
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
        `INSERT INTO cooperate_dept_positions
          (positionCode,userId,companyId,companyName,country,countryCode,severity,companyStatus,ownershipBasis,amountMinor,currency,fundingSource,fundingPlanJson,targetDate,dataSource,dataAsOf,status,openedAt,ledgerReference)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'ACTIVE', NOW(), ?)`,
        [
          positionCode, userId, company.id, company.name, company.country, company.countryCode,
          company.severity, company.status, input.ownershipBasis, input.amountMinor, SETTLEMENT_CURRENCY,
          fundingSource, fundingPlanJson, targetDate, company.source, company.asOf, reference,
        ],
      );

      const basisLabel = input.ownershipBasis === "FULL_OWNERSHIP" ? "full-ownership" : input.ownershipBasis === "SHARES" ? "share" : "asset-purchase";
      const fundingLabel = plan.debits.length
        ? `funded from ${plan.debits.map((debit) => debit.currency).join(", ")} alongside ${SETTLEMENT_CURRENCY}`
        : `funded from your ${SETTLEMENT_CURRENCY} balance`;
      await conn.execute(
        `INSERT INTO customer_notifications (userId,title,body,eventKey,category,priority) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE eventKey=VALUES(eventKey)`,
        [
          userId,
          "Cooperate Dept purchase recorded",
          `A ${basisLabel} purchase of ${input.amountMinor} minor units of ${SETTLEMENT_CURRENCY} in ${company.name} was recorded through the wallet ledger, ${fundingLabel}. The desk administrator will contact you to progress due diligence.`,
          `u${userId}:cooperate-dept:${positionCode}`,
          "ledger_debit",
          "normal",
        ],
      );

      const result = {
        positionCode,
        companyId: company.id,
        companyName: company.name,
        country: company.country,
        countryCode: company.countryCode,
        severity: company.severity,
        companyStatus: company.status,
        ownershipBasis: input.ownershipBasis,
        amountMinor: input.amountMinor,
        currency: SETTLEMENT_CURRENCY,
        fundingSource,
        fundingPlan: JSON.parse(fundingPlanJson),
        targetDate,
        status: "ACTIVE",
        openedAt: now.toISOString(),
        ledgerReference: reference,
      };
      await conn.execute(
        `INSERT INTO v5_idempotency_keys (userId,keyValue,command,resultJson) VALUES (?,?,?,?)`,
        [userId, key, "cooperate-dept.purchase", JSON.stringify(result)],
      );
      await conn.commit();
      return result;
    } catch (error) {
      await conn.rollback();
      throw error;
    }
  });
}
