import { useMemo, useState } from "react";
import {
  AlertTriangle, Banknote, Check, Clock, Coins, Gavel, Plus, RefreshCw, ScrollText,
  ShieldCheck, Sparkles, Trash2, Trophy,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { COUNTRY_OPTIONS } from "@shared/country-options";
import { INVESTMENT_CURRENCIES } from "@shared/investment-economics";
import {
  LENDING_CONDITION_STATUSES,
  LENDING_CONDITION_TYPES,
  LENDING_LOAN_TYPE_GROUPS,
  LENDING_OUTCOMES,
  LENDING_REPAYMENT_FREQUENCIES,
  LENDING_RISK_GRADES,
  LENDING_SECTORS,
  LENDING_STAGES,
  LENDING_TERRITORY_BANDS,
  defaultLendingDisbursementConditions,
  disbursementConditionLabel,
  lendingOutcomeLabel,
  lendingRiskLabel,
  lendingSectorLabel,
  lendingStageLabel,
  lendingTerritoryBandLabel,
  loanTypeLabel,
  repaymentFrequencyLabel,
  type DisbursementCondition,
  type DisbursementConditionStatus,
  type DisbursementConditionType,
  type LoanStage,
} from "@shared/lending-catalogue";
import "./lending.css";

const lines = (value: string, max: number) => value.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, max);
const toMinor = (value: string): number | null => (value.trim() === "" ? null : Math.round(Number(value) * 100));
const fromMinor = (value: number | null | undefined): string => (value === null || value === undefined ? "" : String(Number(value) / 100));
const toInt = (value: string): number | null => (value.trim() === "" ? null : Math.round(Number(value)));
const toBpsFromPercent = (value: string): number => Math.round((Number(value) || 0) * 100);
const fromBpsToPercent = (bps: number | null | undefined): string => (bps === null || bps === undefined ? "" : String(Number(bps) / 100));
const money = (minor: number | null | undefined, currency = "USD") => {
  const value = Number(minor || 0) / 100;
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(value); }
  catch { return `${currency} ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
};
const percent = (bps: number | null | undefined) => (bps === null || bps === undefined ? "—" : `${(Number(bps) / 100).toFixed(Number(bps) % 100 === 0 ? 0 : 2)}%`);
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(16).slice(2)}`);

/** A stored ISO instant rendered into a `datetime-local` value, or "". */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Loan types grouped into the desk's lanes for the type picker. */
function LoanTypeOptions() {
  return <>{LENDING_LOAN_TYPE_GROUPS.map((group) => <optgroup label={group.label} key={group.label}>
    {group.types.map((value) => <option key={value} value={value}>{loanTypeLabel(value)}</option>)}
  </optgroup>)}</>;
}

type LoanForm = {
  title: string; borrower: string; loanType: string; sector: string; countryCode: string;
  territory: string; territoryBand: string; purpose: string; description: string;
  principal: string; currency: string; startingInterestPercent: string;
  minimumTenureMonths: string; maximumTenureMonths: string; repaymentFrequency: string;
  platformFeePercent: string; riskGrade: string; collateral: string; highlightsText: string;
  stage: string; auctionOpensAt: string; auctionClosesAt: string; reserveId: string;
  source: string; sourceUrl: string; asOf: string; reason: string;
};

const emptyLoan = (): LoanForm => ({
  title: "", borrower: "", loanType: "PERSONAL", sector: "CONSUMER", countryCode: "GB",
  territory: "", territoryBand: "NATIONAL", purpose: "", description: "",
  principal: "", currency: "USD", startingInterestPercent: "",
  minimumTenureMonths: "", maximumTenureMonths: "", repaymentFrequency: "MONTHLY",
  platformFeePercent: "", riskGrade: "", collateral: "", highlightsText: "",
  stage: "SCHEDULED", auctionOpensAt: "", auctionClosesAt: "", reserveId: "",
  source: "", sourceUrl: "", asOf: "", reason: "",
});

type ConditionForm = { type: DisbursementConditionType; label: string; required: boolean; status: DisbursementConditionStatus; detail: string };

type ReserveForm = {
  lender: string; capacity: string; currency: string; countryCode: string; territory: string;
  minimumTicket: string; maximumTicket: string; minimumTenureMonths: string; maximumTenureMonths: string;
  startingInterestPercent: string; loanTypes: string[]; note: string; enabled: boolean;
  source: string; asOf: string;
};

const emptyReserve = (): ReserveForm => ({
  lender: "", capacity: "", currency: "USD", countryCode: "GB", territory: "",
  minimumTicket: "", maximumTicket: "", minimumTenureMonths: "", maximumTenureMonths: "",
  startingInterestPercent: "", loanTypes: [], note: "", enabled: true,
  source: "", asOf: "",
});

const conditionFromDefault = (condition: DisbursementCondition): ConditionForm => ({
  type: condition.type,
  label: condition.label ?? "",
  required: condition.required !== false,
  status: condition.status ?? "PENDING",
  detail: condition.detail ?? "",
});

/**
 * Administrator console for the Lending desk. This desk is two-sided: the
 * administrator publishes each loan (loan amount, minimum and maximum tenure,
 * the starting interest, the repayment frequency and the platform fee), states
 * how much each lender has reserved for borrowers, and controls the auction —
 * when bidding opens, the server-authoritative countdown and when the next
 * auction starts. After a borrower wins, the administrator confirms the
 * disbursement conditions and then disburses and settles. Every money movement
 * stays in the internal ledger.
 */
export function AdminLending() {
  const utils = trpc.useUtils();
  const loansQuery = trpc.adminOperations.lendingLoans.useQuery(undefined, { refetchInterval: 20000 });
  const reservesQuery = trpc.adminOperations.lenderReserves.useQuery(undefined, { refetchInterval: 20000 });
  const settlementQuery = trpc.adminOperations.lendingLoansForSettlement.useQuery(undefined, { refetchInterval: 20000 });

  const [tab, setTab] = useState<"loans" | "reserves" | "auction" | "settlement">("loans");
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">("success");

  const [loan, setLoan] = useState<LoanForm>(emptyLoan);
  const [editingLoanId, setEditingLoanId] = useState<string | null>(null);
  const [conditions, setConditions] = useState<ConditionForm[]>(() => defaultLendingDisbursementConditions().map(conditionFromDefault));

  const [reserve, setReserve] = useState<ReserveForm>(emptyReserve);
  const [editingReserveId, setEditingReserveId] = useState<string | null>(null);

  const [selectedLoanId, setSelectedLoanId] = useState<string>("");
  const [settlementOutcome, setSettlementOutcome] = useState<Record<string, string>>({});
  const [settlementReason, setSettlementReason] = useState<Record<string, string>>({});

  const report = (kind: "success" | "error", text: string) => { setMessageKind(kind); setMessage(text); };
  const onError = (error: { message: string }) => report("error", error.message);
  const invalidate = () => {
    void utils.adminOperations.lendingLoans.invalidate();
    void utils.adminOperations.lenderReserves.invalidate();
    void utils.adminOperations.lendingLoansForSettlement.invalidate();
    void utils.customer.lending.desk.invalidate();
  };

  const createLoan = trpc.adminOperations.createLendingLoan.useMutation({ onSuccess: (row: any) => { resetLoanForm(); invalidate(); report("success", `Published loan ${row.loanId} “${row.title}”.`); }, onError });
  const updateLoan = trpc.adminOperations.updateLendingLoan.useMutation({ onSuccess: (row: any) => { resetLoanForm(); invalidate(); report("success", `Updated loan ${row.loanId}.`); }, onError });
  const toggleLoan = trpc.adminOperations.setLendingLoanEnabled.useMutation({ onSuccess: (row: any) => { invalidate(); report("success", `${row.title} is now ${row.enabled ? "enabled on" : "disabled from"} the customer desk.`); }, onError });
  const setStage = trpc.adminOperations.setLendingLoanStage.useMutation({ onSuccess: (row: any) => { invalidate(); report("success", `${row.title} stage set to ${lendingStageLabel(row.stage)}.`); }, onError });
  const setSchedule = trpc.adminOperations.setLendingLoanSchedule.useMutation({ onSuccess: (row: any) => { invalidate(); report("success", `Auction schedule saved for ${row.loanId} (${lendingStageLabel(row.stage)}).`); }, onError });
  const saveConditions = trpc.adminOperations.setLendingConditions.useMutation({ onSuccess: (row: any) => { invalidate(); report("success", `Disbursement conditions saved for ${row.loanId}.`); }, onError });
  const meetCondition = trpc.adminOperations.meetLendingCondition.useMutation({ onSuccess: (row: any) => { invalidate(); report("success", `Condition marked on ${row.loanId}.`); }, onError });
  const deleteLoan = trpc.adminOperations.deleteLendingLoan.useMutation({ onSuccess: (result: any) => { invalidate(); report("success", `Deleted ${result.loanId}.`); }, onError });

  const createReserve = trpc.adminOperations.createLenderReserve.useMutation({ onSuccess: (row: any) => { resetReserveForm(); invalidate(); report("success", `Posted lender reserve ${row.reserveId} for ${row.lender}.`); }, onError });
  const updateReserve = trpc.adminOperations.updateLenderReserve.useMutation({ onSuccess: (row: any) => { resetReserveForm(); invalidate(); report("success", `Updated lender reserve ${row.reserveId}.`); }, onError });
  const toggleReserve = trpc.adminOperations.setLenderReserveEnabled.useMutation({ onSuccess: (row: any) => { invalidate(); report("success", `${row.lender} reserve is now ${row.enabled ? "enabled" : "disabled"}.`); }, onError });
  const deleteReserve = trpc.adminOperations.deleteLenderReserve.useMutation({ onSuccess: (result: any) => { invalidate(); report("success", `Deleted ${result.reserveId}.`); }, onError });

  // Publish the ready-made example auctions and lender reserves. Idempotent, so it
  // is safe to press more than once: an example already on the desk is skipped.
  const seedExamples = trpc.adminOperations.seedLendingExamples.useMutation({
    onSuccess: (result: any) => { invalidate(); report("success", `Published ${result.loans} example auction(s) and ${result.reserves} lender reserve(s).`); },
    onError,
  });

  const disburse = trpc.adminOperations.disburseLendingLoan.useMutation({
    onSuccess: (result: any) => { invalidate(); report("success", `Disbursed “${result.loanId}” to ${result.winnerLabel}: ${money(result.principalMinor)} credited at ${percent(result.topBidBps)}.`); },
    onError,
  });
  const settle = trpc.adminOperations.settleLendingLoan.useMutation({
    onSuccess: (result: any) => { invalidate(); report("success", `Settled “${result.loanId}” as ${lendingOutcomeLabel(result.outcome)}: ${money(result.repaidMinor)} repaid, ${money(result.creditedToLenders)} returned to lenders, ${money(result.feeMinor)} platform fee.`); },
    onError,
  });

  const bidsQuery = trpc.adminOperations.lendingLoanBids.useQuery(
    { loanId: selectedLoanId },
    { enabled: tab === "auction" && selectedLoanId.length > 0, refetchInterval: 15000 },
  );

  const loans = useMemo(() => (loansQuery.data || []) as any[], [loansQuery.data]);
  const reserves = useMemo(() => (reservesQuery.data || []) as any[], [reservesQuery.data]);
  const settlement = useMemo(() => (settlementQuery.data || []) as any[], [settlementQuery.data]);
  const reserveOptions = useMemo(() => reserves.filter((row) => row.enabled), [reserves]);

  function resetLoanForm() {
    setEditingLoanId(null);
    setLoan(emptyLoan());
    setConditions(defaultLendingDisbursementConditions().map(conditionFromDefault));
  }
  function resetReserveForm() {
    setEditingReserveId(null);
    setReserve(emptyReserve());
  }

  const d = (key: keyof LoanForm, value: string) => setLoan((current) => ({ ...current, [key]: value }));
  const r = (key: keyof ReserveForm, value: any) => setReserve((current) => ({ ...current, [key]: value }));
  const setCond = (index: number, patch: Partial<ConditionForm>) => setConditions((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));

  const loanValid = loan.title.trim().length >= 3
    && loan.borrower.trim().length >= 2
    && /^[A-Za-z]{2}$/.test(loan.countryCode)
    && loan.description.trim().length >= 8;

  const buildConditions = () => conditions
    .filter((item) => item.type)
    .map((item) => ({
      type: item.type,
      label: item.label.trim() || disbursementConditionLabel(item.type as any),
      required: item.required,
      status: item.status,
      detail: item.detail.trim() || null,
    }));

  const buildLoanPayload = () => {
    const payload: any = {
      title: loan.title.trim(),
      borrower: loan.borrower.trim(),
      loanType: loan.loanType,
      sector: loan.sector,
      countryCode: loan.countryCode.toUpperCase(),
      stage: loan.stage,
      description: loan.description.trim(),
      highlights: lines(loan.highlightsText, 12),
      conditions: buildConditions(),
    };
    if (loan.territory.trim()) payload.territory = loan.territory.trim();
    if (loan.territoryBand) payload.territoryBand = loan.territoryBand;
    if (loan.purpose.trim()) payload.purpose = loan.purpose.trim();
    if (loan.principal.trim()) payload.principalMinor = toMinor(loan.principal);
    if (loan.currency) payload.currency = loan.currency;
    if (loan.startingInterestPercent.trim()) payload.startingInterestBps = toBpsFromPercent(loan.startingInterestPercent);
    if (loan.minimumTenureMonths.trim()) payload.minimumTenureMonths = toInt(loan.minimumTenureMonths);
    if (loan.maximumTenureMonths.trim()) payload.maximumTenureMonths = toInt(loan.maximumTenureMonths);
    if (loan.repaymentFrequency) payload.repaymentFrequency = loan.repaymentFrequency;
    if (loan.platformFeePercent.trim()) payload.platformFeeBps = toBpsFromPercent(loan.platformFeePercent);
    if (loan.riskGrade) payload.riskGrade = loan.riskGrade;
    if (loan.collateral.trim()) payload.collateral = loan.collateral.trim();
    if (loan.auctionOpensAt.trim()) payload.auctionOpensAt = loan.auctionOpensAt.trim();
    if (loan.auctionClosesAt.trim()) payload.auctionClosesAt = loan.auctionClosesAt.trim();
    if (loan.reserveId) payload.reserveId = loan.reserveId;
    if (loan.source.trim()) payload.source = loan.source.trim();
    if (loan.sourceUrl.trim()) payload.sourceUrl = loan.sourceUrl.trim();
    if (loan.asOf.trim()) payload.asOf = loan.asOf.trim();
    if (loan.reason.trim()) payload.reason = loan.reason.trim();
    return payload;
  };

  const submitLoan = () => {
    const payload = buildLoanPayload();
    if (editingLoanId) updateLoan.mutate({ loanId: editingLoanId, ...payload });
    else createLoan.mutate(payload);
  };

  const beginEditLoan = (row: any) => {
    setTab("loans");
    setEditingLoanId(row.loanId);
    setMessage("");
    setLoan({
      title: row.title || "", borrower: row.borrower || "", loanType: row.loanType || "PERSONAL", sector: row.sector || "CONSUMER",
      countryCode: row.countryCode || "GB", territory: row.territory || "", territoryBand: row.territoryBand || "NATIONAL",
      purpose: row.purpose || "", description: row.description || "",
      principal: fromMinor(row.principalMinor), currency: row.currency || "USD",
      startingInterestPercent: fromBpsToPercent(row.startingInterestBps),
      minimumTenureMonths: row.minimumTenureMonths === null || row.minimumTenureMonths === undefined ? "" : String(row.minimumTenureMonths),
      maximumTenureMonths: row.maximumTenureMonths === null || row.maximumTenureMonths === undefined ? "" : String(row.maximumTenureMonths),
      repaymentFrequency: row.repaymentFrequency || "MONTHLY",
      platformFeePercent: fromBpsToPercent(row.platformFeeBps),
      riskGrade: row.riskGrade || "", collateral: row.collateral || "",
      highlightsText: Array.isArray(row.highlights) ? row.highlights.join("\n") : "",
      stage: row.stage || "SCHEDULED",
      auctionOpensAt: toLocalInput(row.auctionOpensAt), auctionClosesAt: toLocalInput(row.auctionClosesAt),
      reserveId: row.reserveId || "", source: row.source || "", sourceUrl: row.sourceUrl || "",
      asOf: row.asOf || "", reason: "",
    });
    const rowConditions = Array.isArray(row.conditions) && row.conditions.length
      ? row.conditions.map((item: DisbursementCondition) => conditionFromDefault(item))
      : defaultLendingDisbursementConditions().map(conditionFromDefault);
    setConditions(rowConditions);
  };

  const buildReservePayload = () => {
    const payload: any = {
      lender: reserve.lender.trim(),
      capacityMinor: toMinor(reserve.capacity) ?? 0,
      countryCode: reserve.countryCode.toUpperCase(),
      enabled: reserve.enabled,
    };
    if (reserve.currency) payload.currency = reserve.currency;
    if (reserve.territory.trim()) payload.territory = reserve.territory.trim();
    if (reserve.minimumTicket.trim()) payload.minimumTicketMinor = toMinor(reserve.minimumTicket);
    if (reserve.maximumTicket.trim()) payload.maximumTicketMinor = toMinor(reserve.maximumTicket);
    if (reserve.minimumTenureMonths.trim()) payload.minimumTenureMonths = toInt(reserve.minimumTenureMonths);
    if (reserve.maximumTenureMonths.trim()) payload.maximumTenureMonths = toInt(reserve.maximumTenureMonths);
    if (reserve.startingInterestPercent.trim()) payload.startingInterestBps = toBpsFromPercent(reserve.startingInterestPercent);
    if (reserve.loanTypes.length) payload.loanTypes = reserve.loanTypes;
    if (reserve.note.trim()) payload.note = reserve.note.trim();
    if (reserve.source.trim()) payload.source = reserve.source.trim();
    if (reserve.asOf.trim()) payload.asOf = reserve.asOf.trim();
    return payload;
  };

  const submitReserve = () => {
    const payload = buildReservePayload();
    if (editingReserveId) updateReserve.mutate({ reserveId: editingReserveId, ...payload });
    else createReserve.mutate(payload);
  };

  const beginEditReserve = (row: any) => {
    setTab("reserves");
    setEditingReserveId(row.reserveId);
    setMessage("");
    setReserve({
      lender: row.lender || "", capacity: fromMinor(row.capacityMinor), currency: row.currency || "USD",
      countryCode: row.countryCode || "GB", territory: row.territory || "",
      minimumTicket: fromMinor(row.minimumTicketMinor), maximumTicket: fromMinor(row.maximumTicketMinor),
      minimumTenureMonths: row.minimumTenureMonths === null || row.minimumTenureMonths === undefined ? "" : String(row.minimumTenureMonths),
      maximumTenureMonths: row.maximumTenureMonths === null || row.maximumTenureMonths === undefined ? "" : String(row.maximumTenureMonths),
      startingInterestPercent: fromBpsToPercent(row.startingInterestBps),
      loanTypes: Array.isArray(row.loanTypes) ? row.loanTypes : [], note: row.note || "",
      enabled: row.enabled !== false, source: row.source || "", asOf: row.asOf || "",
    });
  };

  const scheduleSelected = () => {
    const row = loans.find((item) => item.loanId === selectedLoanId);
    if (!row) { report("error", "Select a loan to schedule."); return; }
    setLoan({
      ...emptyLoan(),
      title: row.title, borrower: row.borrower, loanType: row.loanType, sector: row.sector,
      countryCode: row.countryCode, stage: row.stage,
      auctionOpensAt: toLocalInput(row.auctionOpensAt), auctionClosesAt: toLocalInput(row.auctionClosesAt),
    });
    setEditingLoanId(null);
  };

  const pendingLoan = createLoan.isPending || updateLoan.isPending;
  const pendingReserve = createReserve.isPending || updateReserve.isPending;

  return <div className="lend-page lend-admin">
    <header className="lend-hero">
      <span className="lend-hero-glow" aria-hidden="true" />
      <div className="lend-masthead">
        <div className="lend-masthead-lead">
          <span className="eyebrow lend-eyebrow">Lending console</span>
          <h1 className="lend-title">Publish loans, reserve lender capital and run the live auction</h1>
          <p className="lend-lede">
            This desk is two-sided. You publish each loan with its amount, tenure range, starting interest and
            repayment terms, state how much each lender has reserved for borrowers, and control when bidding opens
            and the countdown that decides the winning borrower. Nothing here invents a value: every figure you set
            is what the customer desk and the internal ledger use.
          </p>
        </div>
        <div className="lend-masthead-side">
          <span className="lend-live-chip"><span className="lend-pulse" aria-hidden="true" /> Live auction engine</span>
          <div className="lend-sources">
            <span className="lend-source-chip is-ok">Loans {loans.length}</span>
            <span className="lend-source-chip is-ok">Reserves {reserves.length}</span>
            <span className="lend-source-chip is-degraded">Settlement queue {settlement.length}</span>
          </div>
        </div>
      </div>
    </header>

    {message && (
      <div className={messageKind === "error" ? "lend-error" : "lend-banner"} role="status">
        {messageKind === "error" ? <AlertTriangle size={15} /> : <Check size={15} />}
        <span>{message}</span>
      </div>
    )}

    <div className="lend-toolbar">
      <div className="lend-tabs" role="tablist">
        <button className={`lend-tab${tab === "loans" ? " active" : ""}`} onClick={() => setTab("loans")} type="button">Loans</button>
        <button className={`lend-tab${tab === "reserves" ? " active" : ""}`} onClick={() => setTab("reserves")} type="button">Lender reserves</button>
        <button className={`lend-tab${tab === "auction" ? " active" : ""}`} onClick={() => setTab("auction")} type="button">Auction control</button>
        <button className={`lend-tab${tab === "settlement" ? " active" : ""}`} onClick={() => setTab("settlement")} type="button">Disburse &amp; settle</button>
      </div>
      <button className="secondary-button" type="button" onClick={() => invalidate()}><RefreshCw size={14} /> Refresh</button>
    </div>

    {tab === "loans" && <div className="lend-admin-grid">
      <section className="lend-panel">
        <div className="lend-panel-head">
          <h2>{editingLoanId ? `Edit ${editingLoanId}` : "Publish a new loan"}</h2>
          {editingLoanId && <button className="secondary-button" type="button" onClick={resetLoanForm}>Cancel edit</button>}
        </div>
        <div className="lend-form-grid">
          <div className="lend-field lend-field-wide"><label>Loan title</label><input className="lend-input" value={loan.title} onChange={(e) => d("title", e.target.value)} placeholder="e.g. Riverside working-capital facility" /></div>
          <div className="lend-field"><label>Borrower / applicant</label><input className="lend-input" value={loan.borrower} onChange={(e) => d("borrower", e.target.value)} /></div>
          <div className="lend-field"><label>Loan type</label><select className="lend-select" value={loan.loanType} onChange={(e) => d("loanType", e.target.value)}><LoanTypeOptions /></select></div>
          <div className="lend-field"><label>Sector</label><select className="lend-select" value={loan.sector} onChange={(e) => d("sector", e.target.value)}>{LENDING_SECTORS.map((value) => <option key={value} value={value}>{lendingSectorLabel(value)}</option>)}</select></div>
          <div className="lend-field"><label>Country</label><select className="lend-select" value={loan.countryCode} onChange={(e) => d("countryCode", e.target.value)}>{COUNTRY_OPTIONS.map((option) => <option key={option.code} value={option.code}>{option.name}</option>)}</select></div>
          <div className="lend-field"><label>Territory</label><input className="lend-input" value={loan.territory} onChange={(e) => d("territory", e.target.value)} placeholder="Defaults to the country" /></div>
          <div className="lend-field"><label>Territory band</label><select className="lend-select" value={loan.territoryBand} onChange={(e) => d("territoryBand", e.target.value)}>{LENDING_TERRITORY_BANDS.map((value) => <option key={value} value={value}>{lendingTerritoryBandLabel(value)}</option>)}</select></div>
          <div className="lend-field"><label>Loan amount (major units)</label><input className="lend-input" value={loan.principal} onChange={(e) => d("principal", e.target.value)} inputMode="decimal" /></div>
          <div className="lend-field"><label>Currency</label><select className="lend-select" value={loan.currency} onChange={(e) => d("currency", e.target.value)}>{INVESTMENT_CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}</select></div>
          <div className="lend-field"><label>Starting interest (%)</label><input className="lend-input" value={loan.startingInterestPercent} onChange={(e) => d("startingInterestPercent", e.target.value)} inputMode="decimal" placeholder="e.g. 12.5" /></div>
          <div className="lend-field"><label>Minimum tenure (months)</label><input className="lend-input" value={loan.minimumTenureMonths} onChange={(e) => d("minimumTenureMonths", e.target.value)} inputMode="numeric" /></div>
          <div className="lend-field"><label>Maximum tenure (months)</label><input className="lend-input" value={loan.maximumTenureMonths} onChange={(e) => d("maximumTenureMonths", e.target.value)} inputMode="numeric" /></div>
          <div className="lend-field"><label>Repayment frequency</label><select className="lend-select" value={loan.repaymentFrequency} onChange={(e) => d("repaymentFrequency", e.target.value)}>{LENDING_REPAYMENT_FREQUENCIES.map((value) => <option key={value} value={value}>{repaymentFrequencyLabel(value)}</option>)}</select></div>
          <div className="lend-field"><label>Platform fee (%)</label><input className="lend-input" value={loan.platformFeePercent} onChange={(e) => d("platformFeePercent", e.target.value)} inputMode="decimal" /></div>
          <div className="lend-field"><label>Risk grade</label><select className="lend-select" value={loan.riskGrade} onChange={(e) => d("riskGrade", e.target.value)}><option value="">Unrated</option>{LENDING_RISK_GRADES.map((value) => <option key={value} value={value}>{lendingRiskLabel(value)}</option>)}</select></div>
          <div className="lend-field"><label>Stage</label><select className="lend-select" value={loan.stage} onChange={(e) => d("stage", e.target.value)}>{LENDING_STAGES.map((value) => <option key={value} value={value}>{lendingStageLabel(value)}</option>)}</select></div>
          <div className="lend-field"><label>Linked lender reserve</label><select className="lend-select" value={loan.reserveId} onChange={(e) => d("reserveId", e.target.value)}><option value="">None</option>{reserveOptions.map((row) => <option key={row.reserveId} value={row.reserveId}>{row.lender} · {money(row.availableMinor, row.currency)}</option>)}</select></div>
          <div className="lend-field"><label>Bidding opens</label><input className="lend-input" type="datetime-local" value={loan.auctionOpensAt} onChange={(e) => d("auctionOpensAt", e.target.value)} /></div>
          <div className="lend-field"><label>Countdown ends</label><input className="lend-input" type="datetime-local" value={loan.auctionClosesAt} onChange={(e) => d("auctionClosesAt", e.target.value)} /></div>
          <div className="lend-field lend-field-wide"><label>Purpose</label><input className="lend-input" value={loan.purpose} onChange={(e) => d("purpose", e.target.value)} placeholder="What the funds are for" /></div>
          <div className="lend-field lend-field-wide"><label>Collateral / security</label><input className="lend-input" value={loan.collateral} onChange={(e) => d("collateral", e.target.value)} placeholder="Security pledged against the loan" /></div>
          <div className="lend-field lend-field-wide"><label>Description</label><textarea value={loan.description} onChange={(e) => d("description", e.target.value)} placeholder="Describe the loan in at least 8 characters" /></div>
          <div className="lend-field lend-field-wide"><label>Highlights (one per line)</label><textarea value={loan.highlightsText} onChange={(e) => d("highlightsText", e.target.value)} /></div>
          <div className="lend-field"><label>Source</label><input className="lend-input" value={loan.source} onChange={(e) => d("source", e.target.value)} placeholder="e.g. Administrator" /></div>
          <div className="lend-field"><label>Source URL</label><input className="lend-input" value={loan.sourceUrl} onChange={(e) => d("sourceUrl", e.target.value)} placeholder="https://…" /></div>
          <div className="lend-field"><label>As of</label><input className="lend-input" type="date" value={loan.asOf} onChange={(e) => d("asOf", e.target.value)} /></div>
          <div className="lend-field lend-field-wide"><label>Audit reason (optional)</label><input className="lend-input" value={loan.reason} onChange={(e) => d("reason", e.target.value)} /></div>
        </div>

        <div className="lend-conditions-editor">
          <div className="lend-panel-head"><h2>Disbursement conditions</h2><span>A winner must clear the required conditions before disbursement</span></div>
          {conditions.map((condition, index) => <div className="lend-condition-edit" key={`${condition.type}-${index}`}>
            <select className="lend-select" value={condition.type} onChange={(e) => setCond(index, { type: e.target.value as DisbursementConditionType })}>{LENDING_CONDITION_TYPES.map((value) => <option key={value} value={value}>{disbursementConditionLabel(value)}</option>)}</select>
            <input className="lend-input" value={condition.label} onChange={(e) => setCond(index, { label: e.target.value })} placeholder="Label" />
            <select className="lend-select" value={condition.status} onChange={(e) => setCond(index, { status: e.target.value as DisbursementConditionStatus })}>{LENDING_CONDITION_STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}</select>
            <button className="secondary-button" type="button" onClick={() => setConditions((prev) => prev.filter((_, i) => i !== index))}><Trash2 size={14} /></button>
          </div>)}
          <button className="secondary-button" type="button" onClick={() => setConditions((prev) => [...prev, { type: "KYC_VERIFIED", label: "", required: true, status: "PENDING", detail: "" }])}><Plus size={14} /> Add condition</button>
        </div>

        <div className="lend-actions">
          <button className="primary-button" type="button" disabled={!loanValid || pendingLoan} onClick={submitLoan}>
            {pendingLoan ? <RefreshCw className="spin" size={14} /> : <Plus size={14} />} {editingLoanId ? "Save loan" : "Publish loan"}
          </button>
          {!loanValid && <span className="lend-modal-note">A title (3+), borrower (2+) and a description (8+) with a valid country are required.</span>}
        </div>
      </section>

      <section className="lend-panel lend-admin-loans">
        <div className="lend-panel-head">
          <h2>Published loans</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span>{loans.length} total</span>
            <button type="button" className="secondary-button" disabled={seedExamples.isPending} onClick={() => seedExamples.mutate()}>
              <Sparkles size={13} /> {seedExamples.isPending ? "Publishing…" : "Publish examples"}
            </button>
          </div>
        </div>
        <div className="lend-table">
          <div className="lend-table-head"><span>Loan</span><span>Stage</span><span>Amount</span><span>Starting</span><span>Actions</span></div>
          {loans.length === 0 && <div className="lend-empty"><strong>No loans yet</strong><span>Publish the first loan above.</span></div>}
          {loans.map((row) => <div className="lend-table-row" key={row.loanId}>
            <div>
              <strong>{row.flag} {row.title}</strong>
              <div className="lend-loan-sub">{loanTypeLabel(row.loanType)} · {row.borrower}</div>
            </div>
            <span className={`lend-badge${row.enabled ? "" : " lend-badge--off"}`}>{lendingStageLabel(row.stage)}</span>
            <span className="lend-mono">{money(row.principalMinor, row.currency)}</span>
            <span className="lend-mono">{percent(row.startingInterestBps)}</span>
            <div className="lend-row-actions">
              <button type="button" onClick={() => beginEditLoan(row)}>Edit</button>
              <button type="button" onClick={() => toggleLoan.mutate({ loanId: row.loanId, enabled: !row.enabled })}>{row.enabled ? "Disable" : "Enable"}</button>
              <button type="button" onClick={() => { setSelectedLoanId(row.loanId); setTab("auction"); }}>Auction</button>
              <button className="danger" type="button" onClick={() => deleteLoan.mutate({ loanId: row.loanId })}><Trash2 size={13} /></button>
            </div>
          </div>)}
        </div>
      </section>
    </div>}

    {tab === "reserves" && <div className="lend-admin-grid">
      <section className="lend-panel">
        <div className="lend-panel-head">
          <h2>{editingReserveId ? `Edit ${editingReserveId}` : "Post a lender reserve"}</h2>
          {editingReserveId && <button className="secondary-button" type="button" onClick={resetReserveForm}>Cancel edit</button>}
        </div>
        <p className="lend-modal-note">How much each lender has reserved for borrowers on this desk.</p>
        <div className="lend-form-grid">
          <div className="lend-field"><label>Lender</label><input className="lend-input" value={reserve.lender} onChange={(e) => r("lender", e.target.value)} /></div>
          <div className="lend-field"><label>Reserve capacity (major units)</label><input className="lend-input" value={reserve.capacity} onChange={(e) => r("capacity", e.target.value)} inputMode="decimal" /></div>
          <div className="lend-field"><label>Currency</label><select className="lend-select" value={reserve.currency} onChange={(e) => r("currency", e.target.value)}>{INVESTMENT_CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}</select></div>
          <div className="lend-field"><label>Country</label><select className="lend-select" value={reserve.countryCode} onChange={(e) => r("countryCode", e.target.value)}>{COUNTRY_OPTIONS.map((option) => <option key={option.code} value={option.code}>{option.name}</option>)}</select></div>
          <div className="lend-field"><label>Territory</label><input className="lend-input" value={reserve.territory} onChange={(e) => r("territory", e.target.value)} /></div>
          <div className="lend-field"><label>Minimum ticket (major units)</label><input className="lend-input" value={reserve.minimumTicket} onChange={(e) => r("minimumTicket", e.target.value)} inputMode="decimal" /></div>
          <div className="lend-field"><label>Maximum ticket (major units)</label><input className="lend-input" value={reserve.maximumTicket} onChange={(e) => r("maximumTicket", e.target.value)} inputMode="decimal" /></div>
          <div className="lend-field"><label>Minimum tenure (months)</label><input className="lend-input" value={reserve.minimumTenureMonths} onChange={(e) => r("minimumTenureMonths", e.target.value)} inputMode="numeric" /></div>
          <div className="lend-field"><label>Maximum tenure (months)</label><input className="lend-input" value={reserve.maximumTenureMonths} onChange={(e) => r("maximumTenureMonths", e.target.value)} inputMode="numeric" /></div>
          <div className="lend-field"><label>Starting interest (%)</label><input className="lend-input" value={reserve.startingInterestPercent} onChange={(e) => r("startingInterestPercent", e.target.value)} inputMode="decimal" /></div>
          <div className="lend-field lend-field-wide"><label>Note</label><textarea value={reserve.note} onChange={(e) => r("note", e.target.value)} /></div>
          <div className="lend-field"><label>Source</label><input className="lend-input" value={reserve.source} onChange={(e) => r("source", e.target.value)} /></div>
          <div className="lend-field"><label>As of</label><input className="lend-input" type="date" value={reserve.asOf} onChange={(e) => r("asOf", e.target.value)} /></div>
          <div className="lend-field"><label>Enabled</label><select className="lend-select" value={reserve.enabled ? "yes" : "no"} onChange={(e) => r("enabled", e.target.value === "yes")}><option value="yes">Yes</option><option value="no">No</option></select></div>
        </div>
        <div className="lend-panel-head"><h2>Supported loan types</h2><span>{reserve.loanTypes.length} selected</span></div>
        <div className="lend-conditions-editor">
          {LENDING_LOAN_TYPE_GROUPS.map((group) => <div key={group.label} className="lend-detail-block">
            <span>{group.label}</span>
            <div className="lend-actions">
              {group.types.map((type) => {
                const active = reserve.loanTypes.includes(type);
                return <button key={type} type="button" className={active ? "primary-button" : "secondary-button"}
                  onClick={() => r("loanTypes", active ? reserve.loanTypes.filter((t) => t !== type) : [...reserve.loanTypes, type])}>
                  {active && <Check size={13} />} {loanTypeLabel(type)}
                </button>;
              })}
            </div>
          </div>)}
        </div>
        <div className="lend-actions">
          <button className="primary-button" type="button" disabled={reserve.lender.trim().length < 2 || !reserve.capacity.trim() || pendingReserve} onClick={submitReserve}>
            {pendingReserve ? <RefreshCw className="spin" size={14} /> : <Banknote size={14} />} {editingReserveId ? "Save reserve" : "Post reserve"}
          </button>
        </div>
      </section>

      <section className="lend-panel lend-admin-reserves">
        <div className="lend-panel-head"><h2>Lender reserves</h2><span>{reserves.length} posted</span></div>
        <div className="lend-table">
          <div className="lend-table-head"><span>Lender</span><span>Capacity</span><span>Available</span><span>Starting</span><span>Actions</span></div>
          {reserves.length === 0 && <div className="lend-empty"><strong>No reserves yet</strong><span>Post a lender’s capacity above.</span></div>}
          {reserves.map((row) => <div className="lend-table-row" key={row.reserveId}>
            <div>
              <strong>{row.flag} {row.lender}</strong>
              <div className="lend-loan-sub">{row.territory || row.country} · {Array.isArray(row.loanTypes) && row.loanTypes.length ? `${row.loanTypes.length} loan types` : "All loan types"}</div>
            </div>
            <span className="lend-mono">{money(row.capacityMinor, row.currency)}</span>
            <span className="lend-mono">{money(row.availableMinor, row.currency)}</span>
            <span className="lend-mono">{percent(row.startingInterestBps)}</span>
            <div className="lend-row-actions">
              <button type="button" onClick={() => beginEditReserve(row)}>Edit</button>
              <button type="button" onClick={() => toggleReserve.mutate({ reserveId: row.reserveId, enabled: !row.enabled })}>{row.enabled ? "Disable" : "Enable"}</button>
              <button className="danger" type="button" onClick={() => deleteReserve.mutate({ reserveId: row.reserveId })}><Trash2 size={13} /></button>
            </div>
          </div>)}
        </div>
      </section>
    </div>}

    {tab === "auction" && <div className="lend-admin-grid">
      <section className="lend-panel">
        <div className="lend-panel-head"><h2>Auction control</h2><span>Server-authoritative countdown</span></div>
        <div className="lend-field"><label>Loan</label><select className="lend-select" value={selectedLoanId} onChange={(e) => setSelectedLoanId(e.target.value)}><option value="">Select a loan…</option>{loans.map((row) => <option key={row.loanId} value={row.loanId}>{row.title} · {lendingStageLabel(row.stage)}</option>)}</select></div>
        <div className="lend-actions">
          <button className="secondary-button" type="button" disabled={!selectedLoanId} onClick={scheduleSelected}><Clock size={14} /> Load into schedule form</button>
          <button className="secondary-button" type="button" disabled={!selectedLoanId} onClick={() => bidsQuery.refetch()}><RefreshCw size={14} /> Refresh bids</button>
        </div>

        {selectedLoanId && <div className="lend-detail-block">
          <span>Schedule &amp; stage</span>
          <div className="lend-form-grid">
            <div className="lend-field"><label>Bidding opens</label><input className="lend-input" type="datetime-local" value={loan.auctionOpensAt} onChange={(e) => d("auctionOpensAt", e.target.value)} /></div>
            <div className="lend-field"><label>Countdown ends</label><input className="lend-input" type="datetime-local" value={loan.auctionClosesAt} onChange={(e) => d("auctionClosesAt", e.target.value)} /></div>
            <div className="lend-field"><label>Stage</label><select className="lend-select" value={loan.stage} onChange={(e) => d("stage", e.target.value)}>{LENDING_STAGES.map((value) => <option key={value} value={value}>{lendingStageLabel(value)}</option>)}</select></div>
          </div>
          <div className="lend-actions">
            <button className="primary-button" type="button" onClick={() => setSchedule.mutate({
              loanId: selectedLoanId,
              auctionOpensAt: loan.auctionOpensAt.trim() || null,
              auctionClosesAt: loan.auctionClosesAt.trim() || null,
              stage: loan.stage as LoanStage,
            })}><Clock size={14} /> Save &amp; apply schedule</button>
            <button className="secondary-button" type="button" onClick={() => setSchedule.mutate({ loanId: selectedLoanId, auctionClosesAt: new Date().toISOString() })}>Close bidding now</button>
            <button className="secondary-button" type="button" onClick={() => setStage.mutate({ loanId: selectedLoanId, stage: "WITHDRAWN" })}>Cancel auction</button>
          </div>
        </div>}

        {selectedLoanId && <div className="lend-detail-block">
          <span>Disbursement conditions</span>
          <div className="lend-conditions-editor">
            {conditions.map((condition, index) => <div className="lend-condition-edit" key={`a-${condition.type}-${index}`}>
              <select className="lend-select" value={condition.type} onChange={(e) => setCond(index, { type: e.target.value as DisbursementConditionType })}>{LENDING_CONDITION_TYPES.map((value) => <option key={value} value={value}>{disbursementConditionLabel(value)}</option>)}</select>
              <input className="lend-input" value={condition.label} onChange={(e) => setCond(index, { label: e.target.value })} placeholder="Label" />
              <select className="lend-select" value={condition.status} onChange={(e) => setCond(index, { status: e.target.value as DisbursementConditionStatus })}>{LENDING_CONDITION_STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}</select>
              <button className="secondary-button" type="button" onClick={() => setConditions((prev) => prev.filter((_, i) => i !== index))}><Trash2 size={14} /></button>
            </div>)}
            <button className="secondary-button" type="button" onClick={() => setConditions((prev) => [...prev, { type: "COLLATERAL_PLEDGED", label: "", required: true, status: "PENDING", detail: "" }])}><Plus size={14} /> Add condition</button>
          </div>
          <div className="lend-actions">
            <button className="primary-button" type="button" onClick={() => saveConditions.mutate({ loanId: selectedLoanId, conditions: buildConditions() })}><ShieldCheck size={14} /> Save conditions</button>
            {conditions.map((condition, index) => condition.status !== "MET" && <button key={`m-${condition.type}-${index}`} className="secondary-button" type="button"
              onClick={() => meetCondition.mutate({ loanId: selectedLoanId, type: condition.type as any, status: "MET" })}>
              <Check size={13} /> Met: {condition.label.trim() || disbursementConditionLabel(condition.type as any)}
            </button>)}
          </div>
        </div>}
      </section>

      <section className="lend-panel">
        <div className="lend-panel-head"><h2>Live leaderboard</h2><span>{selectedLoanId ? `${(bidsQuery.data || []).length} live binds` : "No loan selected"}</span></div>
        {!selectedLoanId && <div className="lend-empty"><strong>Select a loan</strong><span>Choose a loan to watch its live borrower bids.</span></div>}
        {selectedLoanId && (bidsQuery.data || []).length === 0 && <div className="lend-leader-empty">No live bids yet.</div>}
        {selectedLoanId && (bidsQuery.data || []).length > 0 && <div className="lend-leader">
          {(bidsQuery.data || []).map((bid: any) => <div className={`lend-leader-row${bid.rank === 1 ? " is-top" : ""}`} key={bid.id}>
            <span className="lend-leader-rank">{bid.rank === 1 ? <Trophy size={12} /> : bid.rank}</span>
            <span className="lend-leader-name"><strong>{bid.borrowerLabel}</strong></span>
            <span className="lend-leader-amt">{money(bid.amountMinor)} · {bid.tenureMonths} mo</span>
            <span className="lend-leader-rate">{percent(bid.bidInterestBps)}</span>
          </div>)}
        </div>}
      </section>
    </div>}

    {tab === "settlement" && <section className="lend-panel">
      <div className="lend-panel-head"><h2>Disburse &amp; settle</h2><span>{settlement.length} loan(s) in the queue</span></div>
      <p className="lend-modal-note">Allocated loans can be disbursed once their required conditions are met; disbursed loans can be settled as repaid, repaid late, defaulted or written off.</p>
      <div className="lend-table">
        <div className="lend-table-head" style={{ gridTemplateColumns: "minmax(0,1.8fr) 0.9fr 1fr 1fr auto" }}><span>Loan</span><span>Stage</span><span>Amount</span><span>Winner</span><span>Actions</span></div>
        {settlement.length === 0 && <div className="lend-empty"><strong>Nothing to settle</strong><span>Loans appear here once a bid is allocated.</span></div>}
        {settlement.map((row) => <div className="lend-table-row" key={row.loanId} style={{ gridTemplateColumns: "minmax(0,1.8fr) 0.9fr 1fr 1fr auto" }}>
          <div><strong>{row.title}</strong><div className="lend-loan-sub">{row.borrower} · {row.loanId}</div></div>
          <span className="lend-badge lend-badge--live"><Coins size={12} /> {lendingStageLabel(row.stage)}</span>
          <span className="lend-mono">{money(row.principalMinor ?? row.committedMinor, row.currency)}</span>
          <span className="lend-mono">{row.winnerLabel || "—"}</span>
          <div className="lend-row-actions">
            <button type="button" onClick={() => { setSelectedLoanId(row.loanId); void bidsQuery.refetch(); }}>Bids</button>
            {row.stage === "ALLOCATED" && <button type="button" onClick={() => disburse.mutate({ loanId: row.loanId, idempotencyKey: newKey() })}><Banknote size={13} /> Disburse</button>}
            {(row.stage === "DISBURSED" || row.stage === "REPAYING") && <>
              <select className="lend-select" value={settlementOutcome[row.loanId] || "REPAID"} onChange={(e) => setSettlementOutcome((prev) => ({ ...prev, [row.loanId]: e.target.value }))}>
                {LENDING_OUTCOMES.map((value) => <option key={value} value={value}>{lendingOutcomeLabel(value)}</option>)}
              </select>
              <button type="button" onClick={() => settle.mutate({ loanId: row.loanId, outcome: ((settlementOutcome[row.loanId] || "REPAID") as any), reason: settlementReason[row.loanId] || undefined, idempotencyKey: newKey() })}><Gavel size={13} /> Settle</button>
            </>}
          </div>
        </div>)}
      </div>
      <div className="lend-detail-block">
        <span>Settlement note (optional, applied to the next settle)</span>
        <input className="lend-input" placeholder="Reason recorded on the audit trail" value={settlementReason[selectedLoanId] || ""} onChange={(e) => setSettlementReason((prev) => ({ ...prev, [selectedLoanId]: e.target.value }))} />
      </div>
    </section>}

    <footer className="lend-banner"><ScrollText size={15} /><span>Every loan, reserve, schedule, condition, disbursement and settlement is validated server-side and recorded on the audit trail. Loan economics are yours; nothing is invented.</span></footer>
  </div>;
}
