import crypto from "node:crypto";
import mysql from "mysql2/promise";
import { mysqlConnectionOptions } from "./_core/mysql";
import {
  compareIpRights,
  findIpRight,
  getIpRoyaltiesCatalogue,
  ipRightFlag,
  expectedAnnualDistMinor,
  outcomeLabel,
  type IpRight,
  type IpRoyaltyInstrumentType,
  type IpRoyaltyOutcome,
  type IpRoyaltyPortfolio,
} from "@shared/ip-royalties-catalogue";
import {
  applyIpRoyaltyDistribution,
  applyIpRoyaltyOutcome,
  findAdminIpRoyaltyDossier,
  findEnabledAdminIpRoyaltyDossier,
  findEnabledAdminIpRoyaltyPortfolio,
  listEnabledAdminIpRoyaltyDossiers,
  listEnabledAdminIpRoyaltyPortfolios,
  IP_ROYALTY_DOSSIERS_TABLE,
  IP_ROYALTY_PORTFOLIOS_TABLE,
} from "./ipRoyaltiesDossiers";
import type { DeskEconomics } from "@shared/investment-economics";
import { getDeskEconomicsMap, getOrAssignDeskEconomics } from "./deskEconomics";
import {
  FxRateUnavailableError,
  planCrossWalletFunding,
  calculateCombinedAvailableTargetMinor,
  type FxRateSnapshot,
} from "./modules/trading-wallet-fx";
import { getFreshTradingFxRate, getWalletFundingPriorityForFunding, listBalances, listCurrencies } from "./db";

type Db = mysql.PoolConnection;

/** One right's stored (or freshly assigned) IP-royalty economics, tolerating a storage hiccup. */
async function getOrAssignIpRoyaltyEconomics(instrumentId: string): Promise<DeskEconomics | null> {
  try {
    return await getOrAssignDeskEconomics("ipRoyalty", instrumentId);
  } catch (error) {
    console.error("[IpRoyalties] Failed to read desk economics:", error instanceof Error ? error.message : "UnknownError");
    return null;
  }
}

/**
 * Overlay an opportunity's auto-assigned economic profile. The USD settlement
 * fields (minimum ticket, funding ask, deadline) are left untouched because the
 * desk settles in USD — the assigned profile carries its own presentation
 * currency for display only. An administrator's published repayment multiple,
 * when present, is never masked.
 */
function withIpRoyaltyEconomics(item: IpRight, economics: DeskEconomics | undefined): IpRight {
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
 * Additive, self-hosted storage for IP-royalty positions (kept outside Drizzle,
 * matching the litigationFunds / cooperateDept / treasuryBonds template).
 *
 * A position is a customer's money placed into ONE IP right share or ONE right
 * portfolio. Purchases settle in USD and may be funded from the settlement
 * wallet, any single funded wallet, or every funded wallet combined through live
 * FX — the same cross-wallet engine as the rest of the platform.
 *
 * Economics: the principal is locked at purchase. Recurring royalty income is
 * credited to funders pro-rata as distributions are recorded, while the
 * principal stays held. At completion the administrator records the final
 * outcome — a buy-out multiple applied to principal (BUYOUT / RUNOFF_COMPLETE)
 * or a write-off (WRITE_OFF, no credit is fabricated).
 */
export const IP_ROYALTY_POSITIONS_TABLE = "ip_royalty_positions";

const CREATE_POSITIONS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS ip_royalty_positions (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  positionCode VARCHAR(40) NOT NULL,
  userId INT NOT NULL,
  instrumentType VARCHAR(16) NOT NULL,
  instrumentId VARCHAR(80) NOT NULL,
  instrumentName VARCHAR(200) NOT NULL,
  rightType VARCHAR(24) NULL,
  jurisdiction VARCHAR(120) NULL,
  countryCode VARCHAR(8) NULL,
  amountMinor BIGINT NOT NULL,
  currency VARCHAR(12) NOT NULL DEFAULT 'USD',
  fundingSource VARCHAR(24) NULL,
  fundingPlanJson TEXT NULL,
  units INT NULL,
  statusAtPurchase VARCHAR(24) NULL,
  expectedMultipleBps INT NULL,
  outcome VARCHAR(24) NULL,
  distributedMinor BIGINT NOT NULL DEFAULT 0,
  realisedMinor BIGINT NULL,
  settledAt DATETIME NULL,
  dataSource VARCHAR(160) NULL,
  dataAsOf VARCHAR(24) NULL,
  positionStatus VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
  openedAt DATETIME NOT NULL,
  ledgerReference VARCHAR(160) NOT NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY ip_royalty_positions_code_idx (positionCode),
  KEY ip_royalty_positions_user_idx (userId, positionStatus),
  KEY ip_royalty_positions_instrument_idx (instrumentType, instrumentId, outcome)
) ENGINE=InnoDB`;

/** Every IP-royalty purchase settles into this currency; other wallets fund it through live FX. */
const SETTLEMENT_CURRENCY = "USD";
export const IP_ROYALTY_COMBINED_SOURCE = "COMBINED";
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
export function ensureIpRoyaltiesSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    try {
      if (!process.env.DATABASE_URL) return;
      await withConnection(async (conn) => { await conn.query(CREATE_POSITIONS_TABLE_SQL); });
    } catch (error) {
      schemaReady = null;
      console.error("[IpRoyalties] Failed to ensure schema:", error instanceof Error ? error.message : "UnknownError");
    }
  })();
  return schemaReady;
}

function idempotencyKey(input: string | undefined, userId: number, scope: string) {
  const value = String(input || "").trim();
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(value)) throw new Error("A valid idempotency key is required");
  return `ip-royalties:${scope}:${userId}:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

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
  if (requiredUsdMinor > MAX_PURCHASE_MINOR) throw new Error("This amount exceeds the per-purchase ceiling for the IP Royalties desk");

  const usd = wallets.find((wallet) => wallet.currency === SETTLEMENT_CURRENCY);
  const usdScale = usd ? usd.scale : 2;
  const usdAvailableMinor = usd ? usd.availableMinor : 0;
  const targetRate = usdUnitRate(usdScale);
  const source = String(fundingSource || IP_ROYALTY_COMBINED_SOURCE).trim().toUpperCase();
  const insufficient = new Error("Insufficient combined spendable wallet balance at current exchange rates");

  if (source === SETTLEMENT_CURRENCY) {
    if (requiredUsdMinor <= usdAvailableMinor) return { requiredUsdMinor, usdAvailableMinor, convertedUsdMinor: 0, debits: [], targetRate };
    throw insufficient;
  }

  const fundedNonSettlement = wallets.filter((wallet) => wallet.currency !== SETTLEMENT_CURRENCY && wallet.availableMinor > 0);
  const candidates = source === IP_ROYALTY_COMBINED_SOURCE
    ? fundedNonSettlement
    : fundedNonSettlement.filter((wallet) => wallet.currency === source);

  if (source === IP_ROYALTY_COMBINED_SOURCE && requiredUsdMinor <= usdAvailableMinor && !candidates.length) {
    return { requiredUsdMinor, usdAvailableMinor, convertedUsdMinor: 0, debits: [], targetRate };
  }
  const targetAvailableMinor = source === IP_ROYALTY_COMBINED_SOURCE ? usdAvailableMinor : 0;
  if (requiredUsdMinor <= targetAvailableMinor) return { requiredUsdMinor, usdAvailableMinor, convertedUsdMinor: 0, debits: [], targetRate };
  if (!candidates.length) throw insufficient;

  const plan = planCrossWalletFunding({
    requiredTargetMinor: requiredUsdMinor,
    targetAvailableMinor,
    targetRate,
    sourceWallets: candidates.map((wallet) => ({
      currency: wallet.currency, scale: wallet.scale, availableMinor: wallet.availableMinor, rate: rates.get(wallet.currency) ?? null,
    })),
    priorityCurrencies: source === IP_ROYALTY_COMBINED_SOURCE ? priorityOrder : null,
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

async function readIpRoyaltyStore(userId: number): Promise<{ positions: any[]; balances: any[]; warning: string | null }> {
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
    console.error("[IpRoyalties] Failed to read wallet balances:", error instanceof Error ? error.message : "UnknownError");
    failed.push("wallet balances");
  }

  // Positions are served by the desk's own additive table; a missing or
  // not-yet-migrated table degrades to "no positions", never to a blank desk.
  let positions: any[] = [];
  try {
    await ensureIpRoyaltiesSchema();
    positions = await withConnection(async (conn) => {
      const [rows] = await conn.query<any[]>(
        `SELECT id, positionCode, instrumentType, instrumentId, instrumentName, rightType, jurisdiction, countryCode,
                amountMinor, currency, fundingSource, units, statusAtPurchase, expectedMultipleBps,
                outcome, distributedMinor, realisedMinor, settledAt, dataSource, dataAsOf, positionStatus, openedAt, ledgerReference
         FROM ${IP_ROYALTY_POSITIONS_TABLE} WHERE userId=? ORDER BY openedAt DESC`,
        [userId],
      );
      return rows;
    });
  } catch (error) {
    console.error("[IpRoyalties] Failed to read position store:", error instanceof Error ? error.message : "UnknownError");
    failed.push("saved positions");
  }

  const warning = failed.length >= 2
    ? "Your saved positions and wallet balances could not be loaded right now. The live desk below is unaffected."
    : failed.length === 1
      ? `Your ${failed[0]} could not be loaded right now. The live desk below is unaffected.`
      : null;
  return { positions, balances, warning };
}

async function readAdminRights(): Promise<IpRight[]> {
  try { return await listEnabledAdminIpRoyaltyDossiers(); }
  catch (error) {
    console.error("[IpRoyalties] Failed to read administrator dossiers:", error instanceof Error ? error.message : "UnknownError");
    return [];
  }
}

async function readAdminPortfolios(): Promise<IpRoyaltyPortfolio[]> {
  try { return await listEnabledAdminIpRoyaltyPortfolios(); }
  catch (error) {
    console.error("[IpRoyalties] Failed to read administrator portfolios:", error instanceof Error ? error.message : "UnknownError");
    return [];
  }
}

/**
 * Assemble the IP Royalties desk for one customer: administrator dossiers merged
 * with the cited discovery catalogue, administrator portfolios, that customer's
 * positions, wallet balances and a derived summary. Catalogue and storage reads
 * run independently so a failure in one still returns the rest.
 */
export async function getIpRoyaltiesDashboard(userId: number) {
  const [catalogue, store, adminRights, portfolios] = await Promise.all([
    getIpRoyaltiesCatalogue(),
    readIpRoyaltyStore(userId),
    readAdminRights(),
    readAdminPortfolios(),
  ]);

  const baseRights = [...adminRights, ...catalogue.rights].sort(compareIpRights);
  let economicsMap = new Map<string, DeskEconomics>();
  try {
    economicsMap = await getDeskEconomicsMap("ipRoyalty", baseRights.map((item) => item.id));
  } catch (error) {
    console.error("[IpRoyalties] Failed to read desk economics:", error instanceof Error ? error.message : "UnknownError");
  }
  const rights = baseRights.map((item) => withIpRoyaltyEconomics(item, economicsMap.get(item.id)));
  const sources = adminRights.length
    ? [...catalogue.sources, {
        name: "Arbitrade IP royalties desk — administrator published",
        url: "",
        country: "XX",
        role: "context" as const,
        status: "ok" as const,
        detail: `${adminRights.length} administrator-reviewed dossier${adminRights.length === 1 ? "" : "s"} with sourced royalty economics`,
      }]
    : catalogue.sources;

  const positions = store.positions;
  const balances = store.balances;
  const active = positions.filter((p) => p.positionStatus === "ACTIVE");
  const committedMinor = active.reduce((sum, p) => sum + Number(p.amountMinor || 0), 0);
  const distributedMinor = positions.reduce((sum, p) => sum + Number(p.distributedMinor || 0), 0);
  const realisedMinor = positions.reduce((sum, p) => sum + Number(p.realisedMinor || 0), 0);
  const summary = {
    committedMinor,
    activePositions: active.length,
    completedPositions: positions.filter((p) => p.positionStatus === "SETTLED").length,
    writtenOffPositions: positions.filter((p) => p.positionStatus === "WRITTEN_OFF").length,
    fundableRights: rights.length,
    modelledRights: rights.filter((right) => right.fundable).length,
    portfolios: portfolios.length,
    distributedMinor,
    realisedMinor,
    expectedAnnualDistributionMinor: rights
      .filter((right) => right.fundable)
      .reduce((sum, right) => sum + (right.expectedAnnualDistributionMinor || expectedAnnualDistMinor(right.scenarios) || 0), 0),
  };
  const usd = balances.find((b) => b.currency === SETTLEMENT_CURRENCY);
  return {
    rights,
    portfolios,
    positions,
    balances,
    wallets: balances,
    settlementCurrency: SETTLEMENT_CURRENCY,
    combinedSource: IP_ROYALTY_COMBINED_SOURCE,
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
export async function quoteIpRoyaltyPurchase(
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
    const plan = planPurchaseFunding(wallets, rates, amountMinor, String(input.fundingSource || IP_ROYALTY_COMBINED_SOURCE), order);
    return {
      amountMinor,
      fundingSource: String(input.fundingSource || IP_ROYALTY_COMBINED_SOURCE).toUpperCase(),
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
      fundingSource: String(input.fundingSource || IP_ROYALTY_COMBINED_SOURCE).toUpperCase(),
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
  instrumentType: IpRoyaltyInstrumentType;
  instrumentId: string;
  instrumentName: string;
  rightType: string | null;
  jurisdiction: string | null;
  countryCode: string | null;
  status: string | null;
  expectedMultipleBps: number | null;
  unitPriceMinor: number | null;
  source: string;
  asOf: string;
};

/**
 * Resolve the instrument a customer is funding. Every right published on the
 * desk is fundable without an administrator dossier — the gate is simply that
 * the right exists on the desk. An administrator-published dossier, when
 * present, only enriches the right with sourced economics (a fixed repayment
 * multiple); its absence never blocks a commitment. Nothing about the economics
 * is ever taken from the client.
 */
async function resolveInstrument(instrumentType: IpRoyaltyInstrumentType, instrumentId: string): Promise<ResolvedInstrument> {
  const economics = await getOrAssignIpRoyaltyEconomics(instrumentId);
  const resolvedMultiple = (published: number | null) => published ?? (economics ? 10_000 + economics.profitBps : null);
  if (instrumentType === "RIGHT") {
    const dossier = await findEnabledAdminIpRoyaltyDossier(instrumentId);
    if (dossier) {
      return {
        instrumentType, instrumentId: dossier.id, instrumentName: dossier.rightName, rightType: dossier.rightType,
        jurisdiction: dossier.jurisdiction, countryCode: dossier.countryCode, status: dossier.status,
        expectedMultipleBps: resolvedMultiple(dossier.expectedMultipleBps), unitPriceMinor: null, source: dossier.source, asOf: dossier.asOf,
      };
    }
    const live = await findIpRight(instrumentId);
    if (live) {
      return {
        instrumentType, instrumentId: live.id, instrumentName: live.rightName, rightType: live.rightType,
        jurisdiction: live.jurisdiction, countryCode: live.countryCode, status: live.status,
        expectedMultipleBps: resolvedMultiple(live.expectedMultipleBps), unitPriceMinor: null, source: live.source, asOf: live.asOf,
      };
    }
    throw new Error("This right is not currently listed on the IP Royalties desk. Refresh and try again.");
  }
  const portfolio = await findEnabledAdminIpRoyaltyPortfolio(instrumentId);
  if (!portfolio || !portfolio.enabled) throw new Error("This portfolio is not currently open on the IP Royalties desk. Refresh and try again.");
  return {
    instrumentType, instrumentId: portfolio.id, instrumentName: portfolio.name, rightType: portfolio.rightType,
    jurisdiction: portfolio.jurisdiction, countryCode: null, status: null,
    expectedMultipleBps: portfolio.expectedMultipleBps, unitPriceMinor: portfolio.unitPriceMinor, source: portfolio.source, asOf: portfolio.asOf,
  };
}

/**
 * Fund a right share or a right portfolio with the customer's own money. Settles
 * in USD and may be funded from the settlement wallet, a single chosen wallet, or
 * every wallet combined through live FX. The wallet ledger is debited per source
 * wallet, the principal is locked, and one durable position plus a notice is
 * written in a single transaction. Idempotent per request key; the instrument's
 * published data is re-read server-side so a client cannot dictate its economics.
 */
export async function purchaseIpRoyalty(
  userId: number,
  input: { instrumentType: IpRoyaltyInstrumentType; instrumentId: string; amountMinor: number; fundingSource?: string; idempotencyKey: string },
) {
  await ensureIpRoyaltiesSchema();
  if (input.instrumentType !== "RIGHT" && input.instrumentType !== "PORTFOLIO") throw new Error("Select a valid instrument to fund");
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new Error("Enter a valid investment amount");
  if (input.amountMinor > MAX_PURCHASE_MINOR) throw new Error("This amount exceeds the per-purchase ceiling for the IP Royalties desk");

  const instrument = await resolveInstrument(input.instrumentType, String(input.instrumentId || ""));
  const fundingSource = String(input.fundingSource || IP_ROYALTY_COMBINED_SOURCE).trim().toUpperCase();
  const key = idempotencyKey(input.idempotencyKey, userId, "purchase");
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
      const positionCode = `IPR-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
      const reference = `ip-royalties-purchase:${positionCode}`;

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
          [userId, debit.currency, -debit.amountMinor, "ip_royalties_fx_debit", `${reference}-fx-${debit.currency}-debit`],
        );
        await conn.execute(
          `INSERT INTO balance_ledger (userId,currency,amountMinor,entryType,reference,withdrawable) VALUES (?,?,?,?,?,false)`,
          [userId, SETTLEMENT_CURRENCY, debit.convertedUsdMinor, "ip_royalties_fx_credit", `${reference}-fx-${debit.currency}-credit`],
        );
        await conn.execute(
          `INSERT INTO fx_rate_snapshots (baseAsset,quoteAsset,rate,provider,sourceDate,rawJson) VALUES (?,?,?,?,?,?)`,
          [
            debit.currency, SETTLEMENT_CURRENCY, debit.rate.rateUsdPerUnit, debit.rate.provider, debit.rate.sourceDate,
            JSON.stringify({
              purpose: "ip_royalties_cross_wallet_conversion",
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
        [userId, SETTLEMENT_CURRENCY, -input.amountMinor, "ip_royalties_purchase", reference],
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
        `INSERT INTO ${IP_ROYALTY_POSITIONS_TABLE}
          (positionCode,userId,instrumentType,instrumentId,instrumentName,rightType,jurisdiction,countryCode,amountMinor,currency,fundingSource,fundingPlanJson,units,statusAtPurchase,expectedMultipleBps,dataSource,dataAsOf,positionStatus,openedAt,ledgerReference)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'ACTIVE', NOW(), ?)`,
        [
          positionCode, userId, instrument.instrumentType, instrument.instrumentId, instrument.instrumentName,
          instrument.rightType, instrument.jurisdiction, instrument.countryCode, input.amountMinor, SETTLEMENT_CURRENCY,
          fundingSource, fundingPlanJson, units, instrument.status, instrument.expectedMultipleBps,
          instrument.source, instrument.asOf, reference,
        ],
      );

      // Record the customer's contribution against the instrument's live progress.
      if (instrument.instrumentType === "RIGHT") {
        await conn.execute(`UPDATE ${IP_ROYALTY_DOSSIERS_TABLE} SET committedMinor=committedMinor+?, updatedAt=NOW(3) WHERE dossierId=?`, [input.amountMinor, instrument.instrumentId]);
      } else {
        await conn.execute(`UPDATE ${IP_ROYALTY_PORTFOLIOS_TABLE} SET committedMinor=committedMinor+?, updatedAt=NOW(3) WHERE portfolioId=?`, [input.amountMinor, instrument.instrumentId]);
      }

      const fundingLabel = plan.debits.length
        ? `funded from ${plan.debits.map((debit) => debit.currency).join(", ")} alongside ${SETTLEMENT_CURRENCY}`
        : `funded from your ${SETTLEMENT_CURRENCY} balance`;
      await conn.execute(
        `INSERT INTO customer_notifications (userId,title,body,eventKey,category,priority) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE eventKey=VALUES(eventKey)`,
        [
          userId,
          "IP Royalties commitment recorded",
          `Your ${instrument.instrumentType === "RIGHT" ? "right-share" : "portfolio"} commitment of ${input.amountMinor} minor units of ${SETTLEMENT_CURRENCY} in “${instrument.instrumentName}” was recorded through the wallet ledger, ${fundingLabel}. The principal is held while royalties are collected; distributions are credited to your wallet as they are recorded, and at completion the principal is returned against the administrator-configured multiple or written off.`,
          `u${userId}:ip-royalties:${positionCode}`,
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
        [userId, key, "ip-royalties.purchase", JSON.stringify(result)],
      );
      await conn.commit();
      return result;
    } catch (error) {
      await conn.rollback();
      throw error;
    }
  });
}

/** One instrument that still carries open customer commitments, for the admin console. */
export type IpRoyaltyOpenInstrument = {
  instrumentType: IpRoyaltyInstrumentType;
  instrumentId: string;
  instrumentName: string;
  openPositions: number;
  committedMinor: number;
  distributedMinor: number;
  currency: string;
};

/**
 * Distinct instruments that still hold open (unresolved) customer positions, so
 * an administrator can record a distribution or settle a funded right/portfolio.
 */
export async function listIpRoyaltyOpenInstruments(): Promise<IpRoyaltyOpenInstrument[]> {
  await ensureIpRoyaltiesSchema();
  return withConnection(async (conn) => {
    const [rows] = await conn.query<any[]>(
      `SELECT instrumentType, instrumentId, MAX(instrumentName) instrumentName, COUNT(*) openPositions,
              SUM(amountMinor) committedMinor, SUM(distributedMinor) distributedMinor, MAX(currency) currency
       FROM ${IP_ROYALTY_POSITIONS_TABLE}
       WHERE outcome IS NULL
       GROUP BY instrumentType, instrumentId
       ORDER BY committedMinor DESC, instrumentId`,
    );
    return rows.map((row) => ({
      instrumentType: row.instrumentType as IpRoyaltyInstrumentType,
      instrumentId: String(row.instrumentId),
      instrumentName: String(row.instrumentName || row.instrumentId),
      openPositions: Number(row.openPositions || 0),
      committedMinor: Number(row.committedMinor || 0),
      distributedMinor: Number(row.distributedMinor || 0),
      currency: String(row.currency || SETTLEMENT_CURRENCY),
    }));
  });
}

/**
 * Record a royalty distribution against a funded instrument. The distribution
 * amount is split pro-rata across every open position by its principal and
 * credited to each funder's settlement wallet with a compensating, withdrawable
 * ledger entry; principal stays locked. Idempotent per request key and against a
 * zero amount; historical entries are never edited.
 */
export async function recordIpRoyaltyDistribution(
  adminUserId: number,
  input: { instrumentType: IpRoyaltyInstrumentType; instrumentId: string; amountMinor: number; note?: string; idempotencyKey: string },
) {
  if (input.instrumentType !== "RIGHT" && input.instrumentType !== "PORTFOLIO") throw new Error("Select a valid instrument");
  const instrumentId = String(input.instrumentId || "").trim();
  if (!instrumentId) throw new Error("Select a funded instrument to distribute against");
  const amountMinor = Math.round(Number(input.amountMinor) || 0);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new Error("Enter a distribution amount above zero");
  const note = String(input.note || "").trim().slice(0, 400) || null;

  await ensureIpRoyaltiesSchema();
  return withConnection(async (conn) => {
    await conn.beginTransaction();
    try {
      const key = idempotencyKey(input.idempotencyKey, adminUserId, "distribution");
      const [prior] = await conn.query<any[]>(
        `SELECT resultJson FROM v5_idempotency_keys WHERE userId=? AND keyValue=? LIMIT 1 FOR UPDATE`,
        [adminUserId, key],
      );
      if (prior.length) { await conn.commit(); return JSON.parse(prior[0].resultJson); }

      const [positions] = await conn.query<any[]>(
        `SELECT id, userId, positionCode, amountMinor, instrumentName FROM ${IP_ROYALTY_POSITIONS_TABLE}
         WHERE instrumentType=? AND instrumentId=? AND outcome IS NULL FOR UPDATE`,
        [input.instrumentType, instrumentId],
      );
      if (!positions.length) throw new Error("No open positions remain on this instrument — it may already be settled.");

      const totalPrincipal = positions.reduce((sum, position) => sum + Number(position.amountMinor || 0), 0);
      if (totalPrincipal <= 0) throw new Error("This instrument has no principal to distribute against");
      const instrumentName = String(positions[0].instrumentName || instrumentId);
      const now = new Date().toISOString();
      const reference = `ip-royalties-distribution:${instrumentId}:${crypto.createHash("sha256").update(`${input.idempotencyKey}`).digest("hex").slice(0, 12)}`;

      let distributed = 0;
      for (const position of positions) {
        const principal = Number(position.amountMinor || 0);
        const ownerId = Number(position.userId);
        // Round down so the sum never exceeds the recorded distribution.
        const share = Math.floor((amountMinor * principal) / totalPrincipal);
        if (share <= 0) continue;

        await conn.execute(
          `INSERT INTO customer_balances (userId,currency,availableMinor,lockedMinor,promotionalMinor,earnedMinor) VALUES (?,?,0,0,0,0) ON DUPLICATE KEY UPDATE userId=userId`,
          [ownerId, SETTLEMENT_CURRENCY],
        );
        await conn.execute(
          `UPDATE customer_balances SET availableMinor=availableMinor+?, updatedAt=NOW() WHERE userId=? AND currency=?`,
          [share, ownerId, SETTLEMENT_CURRENCY],
        );
        await conn.execute(
          `INSERT INTO balance_ledger (userId,currency,amountMinor,entryType,reference,withdrawable) VALUES (?,?,?,?,?,true)`,
          [ownerId, SETTLEMENT_CURRENCY, share, "ip_royalties_distribution", `${reference}:${position.positionCode}`],
        );
        await conn.execute(
          `UPDATE ${IP_ROYALTY_POSITIONS_TABLE} SET distributedMinor=distributedMinor+? WHERE id=?`,
          [share, position.id],
        );
        await conn.execute(
          `INSERT INTO customer_notifications (userId,title,body,eventKey,category,priority) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE eventKey=VALUES(eventKey)`,
          [
            ownerId,
            "IP Royalties distribution credited",
            `A royalty distribution on “${instrumentName}” credited ${share} minor units of ${SETTLEMENT_CURRENCY} to your wallet, pro-rata to your ${principal} minor-unit holding. ${note ? `Note: ${note}` : ""}`.trim(),
            `u${ownerId}:ip-royalties-distribution:${position.positionCode}:${reference}`,
            "ledger_credit",
            "normal",
          ],
        );
        distributed += share;
      }

      await applyIpRoyaltyDistribution(conn, instrumentId, distributed);
      await conn.execute(
        `INSERT INTO v5_audit_events (actorUserId,action,entityType,entityId,reason,reference,metadataJson) VALUES (?,?,?,?,?,?,?)`,
        [
          adminUserId, "ip_royalty_distribution_recorded", `ip_royalty_${input.instrumentType.toLowerCase()}`, instrumentId, note,
          `ip_royalty_${input.instrumentType.toLowerCase()}:${instrumentId}`,
          JSON.stringify({ instrumentId, instrumentType: input.instrumentType, amountMinor, distributedMinor: distributed, positions: positions.length }),
        ],
      );

      const result = { instrumentId, instrumentType: input.instrumentType, instrumentName, amountMinor, distributedMinor: distributed, positions: positions.length, recordedAt: now };
      await conn.execute(
        `INSERT INTO v5_idempotency_keys (userId,keyValue,command,resultJson) VALUES (?,?,?,?)`,
        [adminUserId, key, "ip-royalties.distribution", JSON.stringify(result)],
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
 * Settle a funded instrument. For BUYOUT or RUNOFF_COMPLETE each open position is
 * paid principal × funderMultipleBps into the settlement wallet with a
 * compensating ledger entry; for WRITE_OFF the principal is released from the
 * lock and written off (no credit is fabricated). Positions that already carry
 * an outcome are never paid twice, and historical entries are never edited.
 * Idempotent against a double submit: an instrument with no remaining open
 * positions is rejected rather than paid again.
 */
export async function settleIpRoyaltyInstrument(
  adminUserId: number,
  input: { instrumentType: IpRoyaltyInstrumentType; instrumentId: string; outcome: IpRoyaltyOutcome; funderMultipleBps: number; reason?: string },
) {
  if (input.instrumentType !== "RIGHT" && input.instrumentType !== "PORTFOLIO") throw new Error("Select a valid instrument");
  const instrumentId = String(input.instrumentId || "").trim();
  if (!instrumentId) throw new Error("Select a funded instrument to settle");
  if (input.outcome !== "BUYOUT" && input.outcome !== "RUNOFF_COMPLETE" && input.outcome !== "WRITE_OFF") throw new Error("Select a valid outcome");
  const requestedBps = Math.round(Number(input.funderMultipleBps) || 0);
  if (requestedBps < 0 || requestedBps > 100_000) throw new Error("The completion multiple must be between 0.00x and 10.00x");
  const funderMultipleBps = input.outcome === "WRITE_OFF" ? 0 : requestedBps;

  await ensureIpRoyaltiesSchema();
  return withConnection(async (conn) => {
    await conn.beginTransaction();
    try {
      const [positions] = await conn.query<any[]>(
        `SELECT id, userId, positionCode, amountMinor, instrumentName FROM ${IP_ROYALTY_POSITIONS_TABLE}
         WHERE instrumentType=? AND instrumentId=? AND outcome IS NULL FOR UPDATE`,
        [input.instrumentType, instrumentId],
      );
      if (!positions.length) throw new Error("No open positions remain on this instrument — it may already have been settled.");
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
            [ownerId, SETTLEMENT_CURRENCY, payout, "ip_royalties_payout", `ip-royalties-payout:${position.positionCode}`],
          );
        }
        await conn.execute(
          `UPDATE ${IP_ROYALTY_POSITIONS_TABLE} SET outcome=?, realisedMinor=?, settledAt=NOW(), positionStatus=? WHERE id=?`,
          [input.outcome, payout, payout > 0 ? "SETTLED" : "WRITTEN_OFF", position.id],
        );
        const verb = input.outcome === "WRITE_OFF" ? "written off" : `${outcomeLabel(input.outcome).toLowerCase()}`;
        await conn.execute(
          `INSERT INTO customer_notifications (userId,title,body,eventKey,category,priority) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE eventKey=VALUES(eventKey)`,
          [
            ownerId,
            payout > 0 ? "IP Royalties payout credited" : "IP Royalties principal written off",
            payout > 0
              ? `“${instrumentName}” completed (${verb}). ${payout} minor units of ${SETTLEMENT_CURRENCY} were credited to your wallet, returning principal against the administrator-configured completion multiple.`
              : `“${instrumentName}” completed (${verb}). The ${principal} minor units of ${SETTLEMENT_CURRENCY} principal were written off; no credit was made.`,
            `u${ownerId}:ip-royalties-outcome:${position.positionCode}`,
            payout > 0 ? "ledger_credit" : "ledger_debit",
            "normal",
          ],
        );
        if (payout > 0) paidMinor += payout;
        else if (input.outcome === "WRITE_OFF") writtenOffMinor += principal;
      }

      // If an administrator dossier exists for this right, close it too so it stops
      // advertising funding. A portfolio has no dossier row.
      if (input.instrumentType === "RIGHT") {
        const dossier = await findAdminIpRoyaltyDossier(instrumentId);
        if (dossier) await applyIpRoyaltyOutcome(conn, instrumentId, input.outcome);
      }

      await conn.execute(
        `INSERT INTO v5_audit_events (actorUserId,action,entityType,entityId,reason,reference,metadataJson) VALUES (?,?,?,?,?,?,?)`,
        [
          adminUserId, "ip_royalty_instrument_settled", `ip_royalty_${input.instrumentType.toLowerCase()}`, instrumentId,
          input.reason ? String(input.reason).slice(0, 400) : null,
          `ip_royalty_${input.instrumentType.toLowerCase()}:${instrumentId}`,
          JSON.stringify({ instrumentId, instrumentType: input.instrumentType, outcome: input.outcome, funderMultipleBps, positions: positions.length, paidMinor, writtenOffMinor }),
        ],
      );
      await conn.commit();
      return { instrumentId, instrumentType: input.instrumentType, instrumentName, outcome: input.outcome, funderMultipleBps, positions: positions.length, paidMinor, writtenOffMinor };
    } catch (error) {
      await conn.rollback();
      throw error;
    }
  });
}
