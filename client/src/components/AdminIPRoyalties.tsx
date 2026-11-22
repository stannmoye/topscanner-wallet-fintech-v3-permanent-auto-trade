import { useMemo, useState } from "react";
import {
  AlertTriangle, BadgePercent, Check, Coins, Gauge, Layers3, RefreshCw, ScrollText, ShieldCheck, Trash2,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { COUNTRY_OPTIONS, flagFor } from "@shared/country-options";
import { ECONOMICS_BOUNDS, INVESTMENT_CURRENCIES, currencyByCode, currencyMinorToUsdMinor } from "@shared/investment-economics";
import {
  IP_ROYALTY_BASES,
  IP_ROYALTY_CADENCES,
  IP_ROYALTY_DOSSIER_STATUSES,
  IP_ROYALTY_OUTCOMES,
  IP_ROYALTY_RISK_GRADES,
  IP_ROYALTY_SECTORS,
  SECTOR_RIGHT_TYPES,
  basisLabel,
  cadenceLabel,
  outcomeLabel,
  riskGradeLabel,
  rightTypeLabel,
  sectorForRightType,
  sectorLabel,
  statusLabel,
} from "@shared/ip-royalties-catalogue";
import "./ip-royalties.css";

const RISK_OPTIONS = IP_ROYALTY_RISK_GRADES;
const STATUS_OPTIONS = IP_ROYALTY_DOSSIER_STATUSES;

/**
 * Neutral template scenarios. Public IP registers publish ownership, not royalty
 * economics, so an administrator must model the distribution stream by hand;
 * this template is only a starting point and probabilities must sum to 100%.
 */
const TEMPLATE_SCENARIOS = [
  { label: "Base case", probabilityPercent: "60", expectedAnnualDistributionUsd: "", durationMonths: "60", funderMultiple: "1.60" },
  { label: "Stressed", probabilityPercent: "30", expectedAnnualDistributionUsd: "", durationMonths: "60", funderMultiple: "1.10" },
  { label: "Downside", probabilityPercent: "10", expectedAnnualDistributionUsd: "", durationMonths: "60", funderMultiple: "0.00" },
];

const lines = (value: string, max: number) => value.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, max);
const toMinor = (value: string): number | null => (value.trim() === "" ? null : Math.round(Number(value) * 100));
const fromMinor = (value: number | null | undefined): string => (value === null || value === undefined ? "" : String(Number(value) / 100));
const toInt = (value: string): number | null => (value.trim() === "" ? null : Math.round(Number(value)));
const toBpsFromPercent = (value: string): number => Math.round((Number(value) || 0) * 100);
const fromBpsToPercent = (bps: number | null | undefined): string => (bps === null || bps === undefined ? "" : String(Number(bps) / 100));
const money = (minor: number | null | undefined) => {
  const value = Number(minor || 0) / 100;
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value); }
  catch { return `USD ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
};
const multiple = (bps: number | null | undefined) => (bps === null || bps === undefined ? "—" : `${(Number(bps) / 10_000).toFixed(2)}x`);
const percent = (bps: number | null | undefined) => (bps === null || bps === undefined ? "—" : `${(Number(bps) / 100).toFixed(Number(bps) % 100 === 0 ? 0 : 1)}%`);

/** Right types, grouped into the desk's three sectors (Registered IP / Creative & media / Business & tech). */
function RightTypeOptions() {
  return <>{IP_ROYALTY_SECTORS.map((sector) => <optgroup label={sectorLabel(sector)} key={sector}>
    {SECTOR_RIGHT_TYPES[sector].map((value) => <option key={value} value={value}>{rightTypeLabel(value)}</option>)}
  </optgroup>)}</>;
}

type DossierForm = {
  rightName: string; rightType: string; licensor: string; licenseeSummary: string; assetClass: string;
  countryCode: string; jurisdiction: string;
  royaltyBasis: string; royaltyRatePercent: string; perUnitUsd: string; cadence: string; termMonths: string;
  minimumGuaranteeUsd: string; licenseeCount: string; topLicenseeConcentrationPercent: string;
  riskGrade: string; capitalAtRiskUsd: string; expectedAnnualDistributionUsd: string; expectedMultiple: string;
  expectedDurationMonths: string; fundingAskUsd: string; fundingDeadline: string; status: string;
  problem: string; highlightsText: string;
  source: string; sourceUrl: string; asOf: string; reason: string;
};

const emptyDossier = (): DossierForm => ({
  rightName: "", rightType: "PATENT", licensor: "", licenseeSummary: "", assetClass: "",
  countryCode: "US", jurisdiction: "",
  royaltyBasis: "PERCENT_OF_NET_SALES", royaltyRatePercent: "", perUnitUsd: "", cadence: "QUARTERLY", termMonths: "",
  minimumGuaranteeUsd: "", licenseeCount: "", topLicenseeConcentrationPercent: "",
  riskGrade: "", capitalAtRiskUsd: "", expectedAnnualDistributionUsd: "", expectedMultiple: "",
  expectedDurationMonths: "", fundingAskUsd: "", fundingDeadline: "", status: "FUNDING",
  problem: "", highlightsText: "",
  source: "", sourceUrl: "", asOf: "", reason: "",
});

type ScenarioForm = { label: string; probabilityPercent: string; expectedAnnualDistributionUsd: string; durationMonths: string; funderMultiple: string };
type PaymentHistoryForm = { onTimePercent: string; averageCollectionDays: string; periodsObserved: string };

type PortfolioForm = {
  name: string; rightType: string; jurisdiction: string; riskGrade: string;
  targetUsd: string; unitPriceUsd: string; unitCount: string; rightIdsText: string; allocationsText: string;
  expectedMultiple: string; expectedDurationMonths: string; expectedAnnualDistributionUsd: string;
  summary: string; source: string; sourceUrl: string; asOf: string; reason: string;
};

const emptyPortfolio = (): PortfolioForm => ({
  name: "", rightType: "PATENT", jurisdiction: "", riskGrade: "BALANCED",
  targetUsd: "", unitPriceUsd: "", unitCount: "", rightIdsText: "", allocationsText: "",
  expectedMultiple: "", expectedDurationMonths: "", expectedAnnualDistributionUsd: "",
  summary: "", source: "", sourceUrl: "", asOf: "", reason: "",
});

/** Administrator-editable economic profile for one right (major units / percent / whole days). */
type EconForm = {
  currency: string; ticketMin: string; fundingTarget: string; profitPercent: string;
  termDays: string; platformFeePercent: string; settlementDelay: string; closeDate: string; maturityDate: string;
};

const econScale = (code: string) => currencyByCode(code)?.scale ?? 2;
const toMinorScaled = (value: string, scale: number): number | null => (value.trim() === "" ? null : Math.round(Number(value) * Math.pow(10, scale)));
const fromMinorScaled = (minor: number | null | undefined, scale: number): string =>
  minor === null || minor === undefined ? "" : String(Number(minor) / Math.pow(10, scale));

const emptyEcon = (): EconForm => ({
  currency: "USD", ticketMin: "", fundingTarget: "", profitPercent: "",
  termDays: "", platformFeePercent: "", settlementDelay: "", closeDate: "", maturityDate: "",
});

/**
 * Administrator console for the IP Royalties desk. Every right cited on the desk
 * is fundable without a dossier — the gate is simply that the right exists.
 * Public IP registers publish ownership, not royalty economics, so an
 * administrator reviews a right and publishes the sourced economics (basis,
 * term, modelled distribution scenarios) as a DOSSIER, which *enriches* the
 * right with fixed economics but is not required to fund it. The console also
 * pools rights into PORTFOLIOS, records recurring distributions against funded
 * instruments, and settles or writes off funded rights and portfolios directly.
 */
export function AdminIPRoyalties() {
  const utils = trpc.useUtils();
  const dossiersQuery = trpc.adminOperations.ipRoyaltyDossiers.useQuery(undefined, { refetchInterval: 20000 });
  const portfoliosQuery = trpc.adminOperations.ipRoyaltyPortfolios.useQuery(undefined, { refetchInterval: 20000 });
  const openInstrumentsQuery = trpc.adminOperations.ipRoyaltyOpenInstruments.useQuery(undefined, { refetchInterval: 20000 });

  // Every right the console knows about — published dossiers plus anything
  // carrying open commitments — is a candidate for an auto-assigned economic
  // profile the administrator can review and override.
  const economicsIds = useMemo(() => {
    const ids = new Set<string>();
    for (const row of (dossiersQuery.data || []) as any[]) if (row?.dossierId) ids.add(String(row.dossierId));
    for (const row of (openInstrumentsQuery.data || []) as any[]) if (row?.instrumentId) ids.add(String(row.instrumentId));
    return [...ids];
  }, [dossiersQuery.data, openInstrumentsQuery.data]);
  const economicsQuery = trpc.adminOperations.deskEconomicsBatch.useQuery(
    { desk: "ipRoyalty", instrumentIds: economicsIds },
    { enabled: economicsIds.length > 0, refetchInterval: 30000 },
  );

  const [tab, setTab] = useState<"dossiers" | "portfolios" | "distributions" | "settle" | "economics">("dossiers");
  const [econForms, setEconForms] = useState<Record<string, EconForm>>({});
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">("success");
  const [distributionForms, setDistributionForms] = useState<Record<string, { amountUsd: string; note: string }>>({});
  const [settleForms, setSettleForms] = useState<Record<string, { outcome: string; multiplePercent: string; reason: string }>>({});

  const [dossier, setDossier] = useState<DossierForm>(emptyDossier);
  const [editingDossierId, setEditingDossierId] = useState<string | null>(null);
  const [modelScenarios, setModelScenarios] = useState(false);
  const [scenarios, setScenarios] = useState<ScenarioForm[]>(() => TEMPLATE_SCENARIOS.map((item) => ({ ...item })));
  const [modelPaymentHistory, setModelPaymentHistory] = useState(false);
  const [paymentHistory, setPaymentHistory] = useState<PaymentHistoryForm>({ onTimePercent: "", averageCollectionDays: "", periodsObserved: "" });

  const [portfolio, setPortfolio] = useState<PortfolioForm>(emptyPortfolio);
  const [editingPortfolioId, setEditingPortfolioId] = useState<string | null>(null);

  const report = (kind: "success" | "error", text: string) => { setMessageKind(kind); setMessage(text); };
  const onError = (error: { message: string }) => report("error", error.message);
  const invalidate = () => {
    void utils.adminOperations.ipRoyaltyDossiers.invalidate();
    void utils.adminOperations.ipRoyaltyPortfolios.invalidate();
    void utils.adminOperations.ipRoyaltyOpenInstruments.invalidate();
    void utils.adminOperations.deskEconomicsBatch.invalidate();
    void utils.customer.ipRoyalties.market.invalidate();
  };

  const createDossier = trpc.adminOperations.createIpRoyaltyDossier.useMutation({ onSuccess: (row: any) => { resetDossierForm(); invalidate(); report("success", `Published dossier ${row.dossierId} “${row.rightName}”.`); }, onError });
  const updateDossier = trpc.adminOperations.updateIpRoyaltyDossier.useMutation({ onSuccess: (row: any) => { resetDossierForm(); invalidate(); report("success", `Updated dossier ${row.dossierId}.`); }, onError });
  const toggleDossier = trpc.adminOperations.setIpRoyaltyDossierEnabled.useMutation({ onSuccess: (row: any) => { invalidate(); report("success", `${row.rightName} is now ${row.enabled ? "enabled on" : "disabled from"} the customer desk.`); }, onError });
  const setStatus = trpc.adminOperations.setIpRoyaltyDossierStatus.useMutation({ onSuccess: (row: any) => { invalidate(); report("success", `${row.rightName} status set to ${row.status}.`); }, onError });
  const deleteDossier = trpc.adminOperations.deleteIpRoyaltyDossier.useMutation({ onSuccess: (result: any) => { invalidate(); report("success", `Deleted ${result.dossierId}.`); }, onError });

  const createPortfolio = trpc.adminOperations.createIpRoyaltyPortfolio.useMutation({ onSuccess: (row: any) => { resetPortfolioForm(); invalidate(); report("success", `Published portfolio ${row.portfolioId} “${row.name}”.`); }, onError });
  const updatePortfolio = trpc.adminOperations.updateIpRoyaltyPortfolio.useMutation({ onSuccess: (row: any) => { resetPortfolioForm(); invalidate(); report("success", `Updated portfolio ${row.portfolioId}.`); }, onError });
  const togglePortfolio = trpc.adminOperations.setIpRoyaltyPortfolioEnabled.useMutation({ onSuccess: (row: any) => { invalidate(); report("success", `${row.name} is now ${row.enabled ? "enabled on" : "disabled from"} the customer desk.`); }, onError });
  const deletePortfolio = trpc.adminOperations.deleteIpRoyaltyPortfolio.useMutation({ onSuccess: (result: any) => { invalidate(); report("success", `Deleted ${result.portfolioId}.`); }, onError });

  const recordDistribution = trpc.adminOperations.recordIpRoyaltyDistribution.useMutation({
    onSuccess: (result: any) => {
      setDistributionForms((current) => { const next = { ...current }; delete next[`${result.instrumentType}:${result.instrumentId}`]; return next; });
      invalidate();
      report("success", `Distribution recorded on “${result.instrumentName}”: ${money(result.distributedMinor)} split across ${result.positions} open position(s).`);
    },
    onError,
  });
  const settleInstrument = trpc.adminOperations.settleIpRoyaltyInstrument.useMutation({
    onSuccess: (result: any) => {
      setSettleForms((current) => { const next = { ...current }; delete next[`${result.instrumentType}:${result.instrumentId}`]; return next; });
      invalidate();
      report("success", `Settled “${result.instrumentName}” as ${outcomeLabel(result.outcome)} at ${multiple(result.funderMultipleBps)}: ${result.positions} position(s), ${money(result.paidMinor)} paid, ${money(result.writtenOffMinor)} written off.`);
    },
    onError,
  });

  const saveEconomics = trpc.adminOperations.setDeskEconomics.useMutation({
    onSuccess: (row: any) => { setEconForms((current) => { const next = { ...current }; delete next[row.instrumentId]; return next; }); invalidate(); report("success", `Economic profile saved for ${row.instrumentId}.`); },
    onError,
  });
  const reassignEconomics = trpc.adminOperations.reassignDeskEconomics.useMutation({
    onSuccess: (row: any) => { invalidate(); report("success", row.source === "ADMIN" ? `${row.instrumentId} keeps its administrator profile.` : `Re-rolled the auto profile for ${row.instrumentId}.`); },
    onError,
  });

  const pending = createDossier.isPending || updateDossier.isPending || createPortfolio.isPending || updatePortfolio.isPending;

  function resetDossierForm() {
    setEditingDossierId(null);
    setDossier(emptyDossier());
    setModelScenarios(false);
    setScenarios(TEMPLATE_SCENARIOS.map((item) => ({ ...item })));
    setModelPaymentHistory(false);
    setPaymentHistory({ onTimePercent: "", averageCollectionDays: "", periodsObserved: "" });
  }
  function resetPortfolioForm() {
    setEditingPortfolioId(null);
    setPortfolio(emptyPortfolio());
  }

  const d = (key: keyof DossierForm, value: string) => setDossier((current) => ({ ...current, [key]: value }));
  const p = (key: keyof PortfolioForm, value: string) => setPortfolio((current) => ({ ...current, [key]: value }));
  const setScenario = (index: number, key: keyof ScenarioForm, value: string) => setScenarios((current) => current.map((item, i) => (i === index ? { ...item, [key]: value } : item)));
  const h = (key: keyof PaymentHistoryForm, value: string) => setPaymentHistory((current) => ({ ...current, [key]: value }));

  const scenarioBpsTotal = scenarios.reduce((sum, item) => sum + toBpsFromPercent(item.probabilityPercent), 0);
  const scenarioErrors = modelScenarios
    ? (!dossier.fundingAskUsd.trim() ? "Set a funding target before modelling distribution scenarios. " : "")
      + (!dossier.sourceUrl.trim() ? "A modelled dossier must cite its source URL. " : "")
      + (scenarioBpsTotal !== 10_000 ? "Scenario probabilities must sum to exactly 100%. " : "")
    : "";

  const dossierValid = dossier.rightName.trim().length >= 3
    && dossier.licensor.trim().length >= 2
    && /^[A-Za-z]{2}$/.test(dossier.countryCode)
    && dossier.problem.trim().length >= 8
    && /^\d{4}-\d{2}-\d{2}$/.test(dossier.asOf.trim())
    && !scenarioErrors;

  const buildDossierPayload = () => {
    const payload: any = {
      rightName: dossier.rightName.trim(),
      rightType: dossier.rightType,
      licensor: dossier.licensor.trim(),
      countryCode: dossier.countryCode.toUpperCase(),
      royaltyBasis: dossier.royaltyBasis,
      cadence: dossier.cadence,
      status: dossier.status,
      problem: dossier.problem.trim(),
      highlights: lines(dossier.highlightsText, 12),
      asOf: dossier.asOf.trim(),
    };
    if (dossier.licenseeSummary.trim()) payload.licenseeSummary = dossier.licenseeSummary.trim();
    if (dossier.assetClass.trim()) payload.assetClass = dossier.assetClass.trim();
    if (dossier.jurisdiction.trim()) payload.jurisdiction = dossier.jurisdiction.trim();
    if (dossier.royaltyRatePercent.trim()) payload.royaltyRateBps = toBpsFromPercent(dossier.royaltyRatePercent);
    if (dossier.perUnitUsd.trim()) payload.perUnitMinor = toMinor(dossier.perUnitUsd);
    if (dossier.termMonths.trim()) payload.termMonths = toInt(dossier.termMonths);
    if (dossier.minimumGuaranteeUsd.trim()) payload.minimumGuaranteeMinor = toMinor(dossier.minimumGuaranteeUsd);
    if (dossier.licenseeCount.trim()) payload.licenseeCount = toInt(dossier.licenseeCount);
    if (dossier.topLicenseeConcentrationPercent.trim()) payload.topLicenseeConcentrationBps = toBpsFromPercent(dossier.topLicenseeConcentrationPercent);
    if (dossier.riskGrade) payload.riskGrade = dossier.riskGrade;
    if (dossier.capitalAtRiskUsd.trim()) payload.capitalAtRiskMinor = toMinor(dossier.capitalAtRiskUsd);
    if (dossier.expectedAnnualDistributionUsd.trim()) payload.expectedAnnualDistributionMinor = toMinor(dossier.expectedAnnualDistributionUsd);
    if (dossier.expectedMultiple.trim()) payload.expectedMultipleBps = Math.round(Number(dossier.expectedMultiple) * 10_000);
    if (dossier.expectedDurationMonths.trim()) payload.expectedDurationMonths = toInt(dossier.expectedDurationMonths);
    if (dossier.fundingAskUsd.trim()) payload.fundingAskMinor = toMinor(dossier.fundingAskUsd);
    if (dossier.fundingDeadline.trim()) payload.fundingDeadline = dossier.fundingDeadline.trim();
    if (dossier.source.trim()) payload.source = dossier.source.trim();
    if (dossier.sourceUrl.trim()) payload.sourceUrl = dossier.sourceUrl.trim();
    if (dossier.reason.trim()) payload.reason = dossier.reason.trim();
    if (modelPaymentHistory) {
      payload.paymentHistory = {
        onTimeBps: toBpsFromPercent(paymentHistory.onTimePercent),
        averageCollectionDays: toInt(paymentHistory.averageCollectionDays) ?? 0,
        periodsObserved: toInt(paymentHistory.periodsObserved) ?? 0,
      };
    }
    if (modelScenarios) {
      payload.scenarios = scenarios.map((item) => ({
        label: item.label.trim() || "Scenario",
        probabilityBps: toBpsFromPercent(item.probabilityPercent),
        expectedAnnualDistributionMinor: toMinor(item.expectedAnnualDistributionUsd) ?? 0,
        durationMonths: toInt(item.durationMonths) ?? 0,
        funderMultipleBps: Math.round((Number(item.funderMultiple) || 0) * 10_000),
      }));
    }
    return payload;
  };

  const submitDossier = () => {
    const payload = buildDossierPayload();
    if (editingDossierId) updateDossier.mutate({ dossierId: editingDossierId, ...payload });
    else createDossier.mutate(payload);
  };

  const beginEditDossier = (row: any) => {
    setTab("dossiers");
    setEditingDossierId(row.dossierId);
    setMessage("");
    setDossier({
      rightName: row.rightName || "", rightType: row.rightType || "PATENT", licensor: row.licensor || "",
      licenseeSummary: row.licenseeSummary || "", assetClass: row.assetClass || "",
      countryCode: row.countryCode || "US", jurisdiction: row.jurisdiction || "",
      royaltyBasis: row.royaltyBasis || "PERCENT_OF_NET_SALES", royaltyRatePercent: fromBpsToPercent(row.royaltyRateBps),
      perUnitUsd: fromMinor(row.perUnitMinor), cadence: row.cadence || "QUARTERLY",
      termMonths: row.termMonths === null || row.termMonths === undefined ? "" : String(row.termMonths),
      minimumGuaranteeUsd: fromMinor(row.minimumGuaranteeMinor),
      licenseeCount: row.licenseeCount === null || row.licenseeCount === undefined ? "" : String(row.licenseeCount),
      topLicenseeConcentrationPercent: fromBpsToPercent(row.topLicenseeConcentrationBps),
      riskGrade: row.riskGrade || "", capitalAtRiskUsd: fromMinor(row.capitalAtRiskMinor),
      expectedAnnualDistributionUsd: fromMinor(row.expectedAnnualDistributionMinor),
      expectedMultiple: row.expectedMultipleBps === null || row.expectedMultipleBps === undefined ? "" : String(Number(row.expectedMultipleBps) / 10_000),
      expectedDurationMonths: row.expectedDurationMonths === null || row.expectedDurationMonths === undefined ? "" : String(row.expectedDurationMonths),
      fundingAskUsd: fromMinor(row.fundingAskMinor), fundingDeadline: row.fundingDeadline || "",
      status: row.status || "FUNDING", problem: row.problem || "",
      highlightsText: Array.isArray(row.highlights) ? row.highlights.join("\n") : "",
      source: row.source || "", sourceUrl: row.sourceUrl || "", asOf: row.asOf || "", reason: "",
    });
    if (row.paymentHistory) {
      setModelPaymentHistory(true);
      setPaymentHistory({
        onTimePercent: fromBpsToPercent(row.paymentHistory.onTimeBps),
        averageCollectionDays: String(row.paymentHistory.averageCollectionDays ?? ""),
        periodsObserved: String(row.paymentHistory.periodsObserved ?? ""),
      });
    } else {
      setModelPaymentHistory(false);
      setPaymentHistory({ onTimePercent: "", averageCollectionDays: "", periodsObserved: "" });
    }
    if (Array.isArray(row.scenarios) && row.scenarios.length) {
      setModelScenarios(true);
      setScenarios(row.scenarios.map((item: any) => ({
        label: item.label || "",
        probabilityPercent: fromBpsToPercent(item.probabilityBps),
        expectedAnnualDistributionUsd: fromMinor(item.expectedAnnualDistributionMinor),
        durationMonths: String(item.durationMonths ?? 0),
        funderMultiple: String(Number(item.funderMultipleBps || 0) / 10_000),
      })));
    } else {
      setModelScenarios(false);
      setScenarios(TEMPLATE_SCENARIOS.map((item) => ({ ...item })));
    }
  };

  const parseAllocations = () => {
    const map: Record<string, number> = {};
    lines(portfolio.allocationsText, 50).forEach((line) => {
      const [rightId, bps] = line.split(/[=:]/).map((part) => part.trim());
      if (rightId && bps) map[rightId] = Math.round(Number(bps) || 0);
    });
    return map;
  };

  const portfolioRightIds = lines(portfolio.rightIdsText, 50);
  const portfolioAllocations = parseAllocations();
  const portfolioAllocationTotal = portfolioRightIds.reduce((sum, id) => sum + (portfolioAllocations[id] || 0), 0);
  const portfolioAllocationErrors = portfolioRightIds.length > 0 && portfolioAllocationTotal !== 10_000
    ? "Allocation weights must cover every right and sum to exactly 100%."
    : "";

  const portfolioValid = portfolio.name.trim().length >= 3
    && portfolio.jurisdiction.trim().length >= 2
    && (toMinor(portfolio.targetUsd) ?? 0) > 0
    && (toMinor(portfolio.unitPriceUsd) ?? 0) > 0
    && (toInt(portfolio.unitCount) ?? 0) > 0
    && portfolioRightIds.length > 0
    && !portfolioAllocationErrors;

  const buildPortfolioPayload = () => {
    const payload: any = {
      name: portfolio.name.trim(),
      rightType: portfolio.rightType,
      jurisdiction: portfolio.jurisdiction.trim(),
      riskGrade: portfolio.riskGrade,
      targetMinor: toMinor(portfolio.targetUsd) ?? 0,
      unitPriceMinor: toMinor(portfolio.unitPriceUsd) ?? 0,
      unitCount: toInt(portfolio.unitCount) ?? 0,
      rightIds: portfolioRightIds,
      allocationBpsByRight: portfolioAllocations,
      expectedMultipleBps: Math.round((Number(portfolio.expectedMultiple) || 0) * 10_000),
      asOf: portfolio.asOf.trim(),
    };
    if (portfolio.expectedDurationMonths.trim()) payload.expectedDurationMonths = toInt(portfolio.expectedDurationMonths);
    if (portfolio.expectedAnnualDistributionUsd.trim()) payload.expectedAnnualDistributionMinor = toMinor(portfolio.expectedAnnualDistributionUsd);
    if (portfolio.summary.trim()) payload.summary = portfolio.summary.trim();
    if (portfolio.source.trim()) payload.source = portfolio.source.trim();
    if (portfolio.sourceUrl.trim()) payload.sourceUrl = portfolio.sourceUrl.trim();
    if (portfolio.reason.trim()) payload.reason = portfolio.reason.trim();
    return payload;
  };

  const submitPortfolio = () => {
    const payload = buildPortfolioPayload();
    if (editingPortfolioId) updatePortfolio.mutate({ portfolioId: editingPortfolioId, ...payload });
    else createPortfolio.mutate(payload);
  };

  const beginEditPortfolio = (row: any) => {
    setTab("portfolios");
    setEditingPortfolioId(row.portfolioId);
    setMessage("");
    setPortfolio({
      name: row.name || "", rightType: row.rightType || "PATENT", jurisdiction: row.jurisdiction || "", riskGrade: row.riskGrade || "BALANCED",
      targetUsd: fromMinor(row.targetMinor), unitPriceUsd: fromMinor(row.unitPriceMinor), unitCount: String(row.unitCount ?? ""),
      rightIdsText: Array.isArray(row.rightIds) ? row.rightIds.join("\n") : "",
      allocationsText: Object.entries(row.allocationBpsByRight || {}).map(([rightId, bps]) => `${rightId}=${bps}`).join("\n"),
      expectedMultiple: String(Number(row.expectedMultipleBps || 0) / 10_000),
      expectedDurationMonths: row.expectedDurationMonths === null || row.expectedDurationMonths === undefined ? "" : String(row.expectedDurationMonths),
      expectedAnnualDistributionUsd: fromMinor(row.expectedAnnualDistributionMinor),
      summary: row.summary || "", source: row.source || "", sourceUrl: row.sourceUrl || "", asOf: row.asOf || "", reason: "",
    });
  };

  const dossierRows: any[] = dossiersQuery.data || [];
  const portfolioRows: any[] = portfoliosQuery.data || [];
  const openInstrumentRows: any[] = openInstrumentsQuery.data || [];
  const fundableCount = useMemo(() => dossierRows.filter((row) => row.status === "FUNDING" && row.scenarios.length > 0 && row.fundingAskMinor > 0 && !row.outcome).length, [dossierRows]);
  const openCommittedMinor = useMemo(() => openInstrumentRows.reduce((sum, row) => sum + Number(row.committedMinor || 0), 0), [openInstrumentRows]);

  const econById = useMemo(() => {
    const map = new Map<string, any>();
    for (const row of (economicsQuery.data || []) as any[]) map.set(String(row.instrumentId), row);
    return map;
  }, [economicsQuery.data]);
  const econNameFor = (id: string) => {
    const dossier = dossierRows.find((row) => String(row.dossierId) === id);
    if (dossier) return `${dossier.flag ? `${dossier.flag} ` : ""}${dossier.rightName}`;
    const instrument = openInstrumentRows.find((row) => String(row.instrumentId) === id);
    return instrument?.instrumentName || id;
  };
  const econFormFor = (id: string): EconForm => {
    const existing = econForms[id];
    if (existing) return existing;
    const profile = econById.get(id);
    if (!profile) return emptyEcon();
    const scale = econScale(profile.currency);
    return {
      currency: profile.currency,
      ticketMin: fromMinorScaled(profile.ticketMinMinor, scale),
      fundingTarget: fromMinorScaled(profile.fundingTargetMinor, scale),
      profitPercent: fromBpsToPercent(profile.profitBps),
      termDays: profile.termDays === null || profile.termDays === undefined ? "" : String(profile.termDays),
      platformFeePercent: fromBpsToPercent(profile.platformFeeBps),
      settlementDelay: profile.settlementDelayDays === null || profile.settlementDelayDays === undefined ? "" : String(profile.settlementDelayDays),
      closeDate: profile.closeDate || "",
      maturityDate: profile.maturityDate || "",
    };
  };
  const setEconForm = (id: string, key: keyof EconForm, value: string) => setEconForms((current) => ({ ...current, [id]: { ...econFormFor(id), [key]: value } }));
  const runSaveEconomics = (id: string) => {
    const form = econFormFor(id);
    const scale = econScale(form.currency);
    const patch: any = { currency: form.currency };
    const ticket = toMinorScaled(form.ticketMin, scale);
    if (ticket !== null) patch.ticketMinMinor = ticket;
    const target = toMinorScaled(form.fundingTarget, scale);
    if (target !== null) patch.fundingTargetMinor = target;
    if (form.profitPercent.trim()) patch.profitBps = toBpsFromPercent(form.profitPercent);
    if (form.termDays.trim()) patch.termDays = Math.round(Number(form.termDays));
    if (form.platformFeePercent.trim()) patch.platformFeeBps = toBpsFromPercent(form.platformFeePercent);
    patch.settlementDelayDays = form.settlementDelay.trim() === "" ? null : Math.round(Number(form.settlementDelay));
    if (form.closeDate.trim()) patch.closeDate = form.closeDate.trim();
    if (form.maturityDate.trim()) patch.maturityDate = form.maturityDate.trim();
    saveEconomics.mutate({ desk: "ipRoyalty", instrumentId: id, ...patch });
  };
  const runReassignEconomics = (id: string) => {
    if (!window.confirm(`Re-roll the auto-assigned economic profile for ${id}? An administrator profile is not affected.`)) return;
    reassignEconomics.mutate({ desk: "ipRoyalty", instrumentId: id, salt: `${Date.now()}-${Math.round(Math.random() * 1e6)}` });
  };

  const keyOf = (row: any) => `${row.instrumentType}:${row.instrumentId}`;
  const distributionFormFor = (row: any) => distributionForms[keyOf(row)] || { amountUsd: "", note: "" };
  const setDistributionForm = (row: any, key: "amountUsd" | "note", value: string) => setDistributionForms((current) => ({ ...current, [keyOf(row)]: { ...(current[keyOf(row)] || { amountUsd: "", note: "" }), [key]: value } }));
  const runDistribution = (row: any) => {
    const form = distributionFormFor(row);
    const amountMinor = toMinor(form.amountUsd) ?? 0;
    if (amountMinor <= 0) { report("error", "Enter a distribution amount above zero."); return; }
    recordDistribution.mutate({ instrumentType: row.instrumentType, instrumentId: row.instrumentId, amountMinor, note: form.note.trim() || undefined, idempotencyKey: crypto.randomUUID() });
  };

  const settleFormFor = (row: any) => settleForms[keyOf(row)] || { outcome: "BUYOUT", multiplePercent: "160", reason: "" };
  const setSettleForm = (row: any, key: "outcome" | "multiplePercent" | "reason", value: string) => setSettleForms((current) => ({ ...current, [keyOf(row)]: { ...(current[keyOf(row)] || { outcome: "BUYOUT", multiplePercent: "160", reason: "" }), [key]: value } }));
  const runSettle = (row: any) => {
    const form = settleFormFor(row);
    const funderMultipleBps = form.outcome === "WRITE_OFF" ? 0 : toBpsFromPercent(form.multiplePercent);
    if (form.outcome !== "WRITE_OFF" && funderMultipleBps <= 0) { report("error", "Set a completion multiple above 0.00x for a buyout or run-off."); return; }
    const confirmText = `Settle “${row.instrumentName}” as ${outcomeLabel(form.outcome as any)} at ${form.outcome === "WRITE_OFF" ? "0.00x" : multiple(funderMultipleBps)}? This releases locked principal and pays or writes off all ${row.openPositions} open position(s) across ${money(row.committedMinor)} committed. It cannot be undone.`;
    if (!window.confirm(confirmText)) return;
    settleInstrument.mutate({ instrumentType: row.instrumentType, instrumentId: row.instrumentId, outcome: form.outcome as any, funderMultipleBps, reason: form.reason.trim() || "Administrator settlement" });
  };

  return <div className="arb-page portal-page ipr-page">
    <header className="ipr-hero" aria-label="IP Royalties console">
      <div className="ipr-masthead">
        <div className="ipr-masthead-lead">
          <span className="eyebrow">IP royalties · Dossier publishing</span>
          <h1 className="ipr-title">IP Royalties console</h1>
          <p className="ipr-lede">Review a right and publish its sourced royalty economics — basis, rate, term, licensees, the modelled distribution scenarios and the funding target — as a dossier. Every cited right is already fundable without a dossier; publishing one only enriches the right with fixed economics and a funding target. Pool rights into a portfolio, record recurring distributions, or settle a funded instrument here.</p>
        </div>
        <div className="ipr-masthead-side">
          <button className="ipr-btn ipr-btn-sm" type="button" onClick={() => { void dossiersQuery.refetch(); void portfoliosQuery.refetch(); void openInstrumentsQuery.refetch(); }} disabled={dossiersQuery.isFetching || portfoliosQuery.isFetching || openInstrumentsQuery.isFetching}>
            <RefreshCw size={14} className={dossiersQuery.isFetching ? "spin" : ""}/> Refresh
          </button>
        </div>
      </div>
      <div className="ipr-figures">
        <div className="ipr-figure"><b>{dossierRows.length}</b><span>Dossiers</span></div>
        <div className="ipr-figure"><b>{fundableCount}</b><span>Fundable</span></div>
        <div className="ipr-figure"><b>{portfolioRows.length}</b><span>Portfolios</span></div>
        <div className="ipr-figure"><b>{money(openCommittedMinor)}</b><span>Open commitments</span></div>
      </div>
    </header>

    {message && <div className={`ipr-notice${messageKind === "error" ? " is-error" : " is-success"}`} role={messageKind === "error" ? "alert" : "status"} aria-live="polite">
      <ShieldCheck size={15}/><div>{message}</div>
    </div>}

    <div className="ipr-workspace">
      <aside className="ipr-rail" aria-label="IP Royalties console sections">
        <div className="ipr-rail-group">
          <span className="ipr-rail-label">Console</span>
          <button type="button" className={`ipr-rail-item${tab === "dossiers" ? " is-active" : ""}`} onClick={() => setTab("dossiers")}>Dossiers <span className="ipr-rail-count">{dossierRows.length}</span></button>
          <button type="button" className={`ipr-rail-item${tab === "portfolios" ? " is-active" : ""}`} onClick={() => setTab("portfolios")}>Portfolios <span className="ipr-rail-count">{portfolioRows.length}</span></button>
          <button type="button" className={`ipr-rail-item${tab === "distributions" ? " is-active" : ""}`} onClick={() => setTab("distributions")}>Record distributions <span className="ipr-rail-count">{openInstrumentRows.length}</span></button>
          <button type="button" className={`ipr-rail-item${tab === "settle" ? " is-active" : ""}`} onClick={() => setTab("settle")}>Settle &amp; write off <span className="ipr-rail-count">{openInstrumentRows.length}</span></button>
          <button type="button" className={`ipr-rail-item${tab === "economics" ? " is-active" : ""}`} onClick={() => setTab("economics")}>Economic profiles <span className="ipr-rail-count">{economicsIds.length}</span></button>
        </div>
        <div className="ipr-rail-foot">
          <span className="ipr-card-meta"><ShieldCheck size={13}/> Every change is audited; a dossier becomes fundable only with FUNDING status, a funding target and modelled scenarios.</span>
        </div>
      </aside>

      <div className="ipr-main">
    {tab === "dossiers" && <div className="ipr-admin">
      <div className="ipr-admin-form">
        <div className="ipr-section-head"><div><span className="eyebrow">{editingDossierId ? "Edit dossier" : "Publish dossier"}</span><h2>{editingDossierId ? editingDossierId : "New IP right dossier"}</h2></div>{editingDossierId && <button className="ipr-btn ipr-btn-sm" type="button" onClick={resetDossierForm}>Cancel edit</button>}</div>

        <div className="ipr-two">
          <div className="ipr-field"><label>Right name</label><input value={dossier.rightName} onChange={(e) => d("rightName", e.target.value)} placeholder="e.g. HydroSeal valve patent family" /></div>
          <div className="ipr-field"><label>Right type</label><select value={dossier.rightType} onChange={(e) => d("rightType", e.target.value)}><RightTypeOptions/></select></div>
        </div>
        <div className="ipr-two">
          <div className="ipr-field"><label>Licensor (rights owner)</label><input value={dossier.licensor} onChange={(e) => d("licensor", e.target.value)} placeholder="Who licenses the right" /></div>
          <div className="ipr-field"><label>Asset class (optional)</label><input value={dossier.assetClass} onChange={(e) => d("assetClass", e.target.value)} placeholder="e.g. Industrial engineering" /></div>
        </div>
        <div className="ipr-two">
          <div className="ipr-field"><label>Country / jurisdiction</label>
            <select value={dossier.countryCode} onChange={(e) => d("countryCode", e.target.value)}>
              {COUNTRY_OPTIONS.map((country) => <option key={country.code} value={country.code}>{flagFor(country.code)} {country.name} ({country.code})</option>)}
            </select>
            <small>The flag is derived from this: <strong>{flagFor(dossier.countryCode)}</strong></small>
          </div>
          <div className="ipr-field"><label>Jurisdiction label (optional)</label><input value={dossier.jurisdiction} onChange={(e) => d("jurisdiction", e.target.value)} placeholder="Defaults to the country name" /></div>
        </div>
        <div className="ipr-field"><label>Licensee summary (optional)</label><input value={dossier.licenseeSummary} onChange={(e) => d("licenseeSummary", e.target.value)} placeholder="e.g. 6 licensees across the EU and UK" /></div>

        <div className="ipr-two">
          <div className="ipr-field"><label>Royalty basis</label><select value={dossier.royaltyBasis} onChange={(e) => d("royaltyBasis", e.target.value)}>{IP_ROYALTY_BASES.map((value) => <option key={value} value={value}>{basisLabel(value)}</option>)}</select></div>
          <div className="ipr-field"><label>Distribution cadence</label><select value={dossier.cadence} onChange={(e) => d("cadence", e.target.value)}>{IP_ROYALTY_CADENCES.map((value) => <option key={value} value={value}>{cadenceLabel(value)}</option>)}</select></div>
        </div>
        <div className="ipr-three">
          <div className="ipr-field"><label>Royalty rate (% of net sales)</label><input type="number" min="0" max="100" step="0.01" value={dossier.royaltyRatePercent} onChange={(e) => d("royaltyRatePercent", e.target.value)} placeholder="e.g. 4.5"/></div>
          <div className="ipr-field"><label>Per-unit royalty (USD)</label><input type="number" min="0" step="0.01" value={dossier.perUnitUsd} onChange={(e) => d("perUnitUsd", e.target.value)} placeholder="e.g. 1.25"/></div>
          <div className="ipr-field"><label>Term (months)</label><input type="number" min="0" step="1" value={dossier.termMonths} onChange={(e) => d("termMonths", e.target.value)} placeholder="e.g. 84"/></div>
        </div>
        <div className="ipr-three">
          <div className="ipr-field"><label>Minimum guarantee (USD)</label><input type="number" min="0" step="0.01" value={dossier.minimumGuaranteeUsd} onChange={(e) => d("minimumGuaranteeUsd", e.target.value)} placeholder="e.g. 250000"/></div>
          <div className="ipr-field"><label>Licensee count</label><input type="number" min="0" step="1" value={dossier.licenseeCount} onChange={(e) => d("licenseeCount", e.target.value)} placeholder="e.g. 6"/></div>
          <div className="ipr-field"><label>Top-licensee concentration (%)</label><input type="number" min="0" max="100" step="0.01" value={dossier.topLicenseeConcentrationPercent} onChange={(e) => d("topLicenseeConcentrationPercent", e.target.value)} placeholder="e.g. 42"/></div>
        </div>
        <div className="ipr-two">
          <div className="ipr-field"><label>Risk grade</label><select value={dossier.riskGrade} onChange={(e) => d("riskGrade", e.target.value)}><option value="">Not graded</option>{RISK_OPTIONS.map((value) => <option key={value} value={value}>{riskGradeLabel(value)}</option>)}</select></div>
          <div className="ipr-field"><label>Status</label><select value={dossier.status} onChange={(e) => d("status", e.target.value)}>{STATUS_OPTIONS.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</select></div>
        </div>
        <div className="ipr-two">
          <div className="ipr-field"><label>Expected annual distribution (USD)</label><input type="number" min="0" step="0.01" value={dossier.expectedAnnualDistributionUsd} onChange={(e) => d("expectedAnnualDistributionUsd", e.target.value)} placeholder="e.g. 120000"/></div>
          <div className="ipr-field"><label>Expected multiple (×)</label><input type="number" min="0" step="0.01" value={dossier.expectedMultiple} onChange={(e) => d("expectedMultiple", e.target.value)} placeholder="e.g. 1.55"/></div>
        </div>
        <div className="ipr-two">
          <div className="ipr-field"><label>Capital at risk (USD)</label><input type="number" min="0" step="0.01" value={dossier.capitalAtRiskUsd} onChange={(e) => d("capitalAtRiskUsd", e.target.value)} placeholder="e.g. 400000"/></div>
          <div className="ipr-field"><label>Expected duration (months)</label><input type="number" min="0" step="1" value={dossier.expectedDurationMonths} onChange={(e) => d("expectedDurationMonths", e.target.value)} placeholder="e.g. 60"/></div>
        </div>
        <div className="ipr-two">
          <div className="ipr-field"><label>Funding target (USD)</label><input type="number" min="0" step="0.01" value={dossier.fundingAskUsd} onChange={(e) => d("fundingAskUsd", e.target.value)} placeholder="e.g. 500000"/></div>
          <div className="ipr-field"><label>Funding deadline</label><input type="date" value={dossier.fundingDeadline} onChange={(e) => d("fundingDeadline", e.target.value)}/></div>
        </div>

        <div className="ipr-field"><label>Synopsis (required)</label><textarea rows={3} maxLength={4000} value={dossier.problem} onChange={(e) => d("problem", e.target.value)} placeholder="Describe the right, the licence and why the royalty stream is fundable."/></div>
        <div className="ipr-field"><label>Highlights (optional, one per line)</label><textarea rows={3} value={dossier.highlightsText} onChange={(e) => d("highlightsText", e.target.value)} placeholder={"Multi-year licences renewed twice\nRoyalty audited by an independent firm"}/></div>

        <div className="ipr-field">
          <label className="ipr-checkbox"><input type="checkbox" checked={modelPaymentHistory} onChange={(e) => setModelPaymentHistory(e.target.checked)}/> Record observed payment history (optional)</label>
          <small>Only include this when you have actually observed the licensee's royalty payments; it is shown to customers as a payment-history indicator.</small>
        </div>
        {modelPaymentHistory && <div className="ipr-three">
          <div className="ipr-field"><label>On-time payment rate (%)</label><input type="number" min="0" max="100" step="0.01" value={paymentHistory.onTimePercent} onChange={(e) => h("onTimePercent", e.target.value)} placeholder="e.g. 96"/></div>
          <div className="ipr-field"><label>Average collection (days)</label><input type="number" min="0" step="1" value={paymentHistory.averageCollectionDays} onChange={(e) => h("averageCollectionDays", e.target.value)} placeholder="e.g. 24"/></div>
          <div className="ipr-field"><label>Periods observed</label><input type="number" min="0" step="1" value={paymentHistory.periodsObserved} onChange={(e) => h("periodsObserved", e.target.value)} placeholder="e.g. 12"/></div>
        </div>}

        <div className="ipr-field">
          <label className="ipr-checkbox"><input type="checkbox" checked={modelScenarios} onChange={(e) => setModelScenarios(e.target.checked)}/> Model distribution scenarios (required to make the right fundable)</label>
          <small>Publishing scenarios requires a funding target and a cited source URL. Probabilities must sum to exactly 100%; the full downside scenario is always shown to customers.</small>
        </div>
        {modelScenarios && <div className="ipr-admin-list">
          {scenarios.map((scenario, index) => <div className="ipr-admin-row" key={`${scenario.label}-${index}`}>
            <div className="ipr-admin-row-head"><strong>{scenario.label || "Scenario"}</strong><span className="ipr-badge">{percent(toBpsFromPercent(scenario.probabilityPercent))}</span></div>
            <div className="ipr-two">
              <div className="ipr-field"><label>Label</label><input value={scenario.label} onChange={(e) => setScenario(index, "label", e.target.value)}/></div>
              <div className="ipr-field"><label>Probability %</label><input type="number" min="0" max="100" step="0.01" value={scenario.probabilityPercent} onChange={(e) => setScenario(index, "probabilityPercent", e.target.value)}/></div>
            </div>
            <div className="ipr-three">
              <div className="ipr-field"><label>Expected annual distribution (USD)</label><input type="number" min="0" step="0.01" value={scenario.expectedAnnualDistributionUsd} onChange={(e) => setScenario(index, "expectedAnnualDistributionUsd", e.target.value)}/></div>
              <div className="ipr-field"><label>Duration (months)</label><input type="number" min="0" step="1" value={scenario.durationMonths} onChange={(e) => setScenario(index, "durationMonths", e.target.value)}/></div>
              <div className="ipr-field"><label>Funder multiple (×)</label><input type="number" min="0" step="0.01" value={scenario.funderMultiple} onChange={(e) => setScenario(index, "funderMultiple", e.target.value)}/></div>
            </div>
          </div>)}
          <div className={`ipr-notice${scenarioBpsTotal === 10_000 ? " is-success" : " is-error"}`}><div>Scenario probabilities: {percent(scenarioBpsTotal)} of 100%{scenarioBpsTotal === 10_000 ? " — complete" : " — must sum to exactly 100%"}.</div></div>
        </div>}

        <div className="ipr-two">
          <div className="ipr-field"><label>Source label (optional)</label><input value={dossier.source} onChange={(e) => d("source", e.target.value)} placeholder="e.g. USPTO assignment register" /></div>
          <div className="ipr-field"><label>Source URL {modelScenarios ? "(required when modelled)" : "(optional)"}</label><input value={dossier.sourceUrl} onChange={(e) => d("sourceUrl", e.target.value)} placeholder="https://public-source.example/register"/></div>
        </div>
        <div className="ipr-two">
          <div className="ipr-field"><label>As-of date (required)</label><input type="date" value={dossier.asOf} onChange={(e) => d("asOf", e.target.value)}/></div>
          <div className="ipr-field"><label>Audit reason (optional)</label><input value={dossier.reason} onChange={(e) => d("reason", e.target.value)} placeholder="Reason recorded with this change"/></div>
        </div>

        {scenarioErrors && <div className="ipr-notice is-error" role="alert"><AlertTriangle size={15}/><div>{scenarioErrors}</div></div>}

        <div className="ipr-admin-actions">
          <button className="ipr-btn primary" type="button" disabled={!dossierValid || pending} onClick={submitDossier}>
            {pending ? "Saving…" : editingDossierId ? "Save changes" : "Publish dossier"} <Check size={14}/>
          </button>
          <span className="ipr-card-meta"><ShieldCheck size={13}/> New dossiers are enabled on publish. A dossier only becomes fundable once it is FUNDING status, carries a funding target and has modelled scenarios.</span>
        </div>
      </div>

      <div className="ipr-admin-list">
        <div className="ipr-section-head"><span className="eyebrow">Published dossiers ({dossierRows.length}) · {fundableCount} fundable</span></div>
        {!dossierRows.length && <div className="ipr-empty"><ScrollText size={16}/> No administrator dossiers yet. Publish one above to make a reviewed right fundable.</div>}
        {dossierRows.map((row) => {
          const fundable = row.status === "FUNDING" && row.scenarios.length > 0 && row.fundingAskMinor > 0 && !row.outcome;
          return <div className="ipr-admin-row" key={row.dossierId}>
            <div className="ipr-admin-row-head">
              <div>
                <strong>{row.flag} {row.rightName}</strong>
                <div className="ipr-card-meta"><span>{row.licensor}</span><span>{row.jurisdiction} · {basisLabel(row.royaltyBasis)}</span></div>
              </div>
              <div className="ipr-badges">
                <span className="ipr-badge ipr-badge--sector">{sectorLabel(sectorForRightType(row.rightType))}</span>
                <span className="ipr-badge ipr-badge--type">{rightTypeLabel(row.rightType)}</span>
                {row.riskGrade && <span className={`ipr-badge ipr-badge--risk-${String(row.riskGrade).toLowerCase()}`}>{riskGradeLabel(row.riskGrade)}</span>}
                <span className={`ipr-badge ipr-badge--status-${String(row.status).toLowerCase()}`}>{statusLabel(row.status)}</span>
                <span className="ipr-badge ipr-badge--cadence">{cadenceLabel(row.cadence)}</span>
                <span className="ipr-badge">{row.enabled ? "Enabled" : "Disabled"}</span>
              </div>
            </div>
            <div className="ipr-card-meta">
              <span>Target {money(row.fundingAskMinor)} · committed {money(row.committedMinor)}</span>
              <span>Distributed {money(row.distributedMinor)}</span>
              <span>Expected {multiple(row.expectedMultipleBps)}{row.expectedDurationMonths ? ` · ${row.expectedDurationMonths}mo` : ""}</span>
              {row.royaltyRateBps !== null && row.royaltyRateBps !== undefined && <span>Rate {percent(row.royaltyRateBps)}</span>}
              {row.termMonths ? <span>Term {row.termMonths}mo</span> : null}
              {row.licenseeCount ? <span>{row.licenseeCount} licensee{row.licenseeCount === 1 ? "" : "s"}</span> : null}
              <span>{row.scenarios.length ? `${row.scenarios.length} scenarios` : "Not modelled"}</span>
              {row.outcome && <span className="ipr-badge">Outcome {outcomeLabel(row.outcome)}</span>}
              <span>As of {row.asOf}</span>
              <span>ID {row.dossierId}</span>
            </div>
            {row.scenarios.length > 0 && <div className="ipr-scenarios">{row.scenarios.map((scenario: any, index: number) => <div className={`ipr-scenario ipr-scenario--${index === 0 ? "base" : index === row.scenarios.length - 1 ? "downside" : "stressed"}`} key={`${scenario.label}-${index}`}><span className="ipr-scenario-head">{scenario.label}</span><span>{percent(scenario.probabilityBps)} · {money(scenario.expectedAnnualDistributionMinor)}/yr · {scenario.durationMonths}mo · {multiple(scenario.funderMultipleBps)}</span></div>)}</div>}

            <div className="ipr-admin-actions">
              <button className="ipr-btn ipr-btn-sm" type="button" disabled={Boolean(row.outcome)} onClick={() => beginEditDossier(row)}>Edit</button>
              <button className="ipr-btn ipr-btn-sm" type="button" disabled={toggleDossier.isPending} onClick={() => toggleDossier.mutate({ dossierId: row.dossierId, enabled: !row.enabled })}>{row.enabled ? "Disable" : "Enable"}</button>
              <select value="" aria-label="Set status" disabled={setStatus.isPending} onChange={(e) => { if (e.target.value) setStatus.mutate({ dossierId: row.dossierId, status: e.target.value as any, reason: "Administrator status change" }); }}>
                <option value="">Set status…</option>
                {STATUS_OPTIONS.filter((value) => value !== row.status).map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}
              </select>
              <button className="ipr-btn ipr-btn-sm danger" type="button" disabled={deleteDossier.isPending || row.committedMinor > 0} onClick={() => { if (window.confirm(`Delete dossier “${row.rightName}”? It is removed from the customer desk.`)) deleteDossier.mutate({ dossierId: row.dossierId }); }}><Trash2 size={13}/> Delete</button>
            </div>
            {!fundable && !row.outcome && row.scenarios.length > 0 && <div className="ipr-unfundable"><AlertTriangle size={13}/> Not currently fundable — status is {statusLabel(row.status)} or the funding target is unset.</div>}
            {!row.scenarios.length && <div className="ipr-unfundable"><AlertTriangle size={13}/> Not modelled — cannot be invested until distribution scenarios and a funding target are published with a cited source.</div>}
          </div>;
        })}
      </div>
    </div>}

    {tab === "portfolios" && <div className="ipr-admin">
      <div className="ipr-admin-form">
        <div className="ipr-section-head"><div><span className="eyebrow">{editingPortfolioId ? "Edit portfolio" : "Publish portfolio"}</span><h2>{editingPortfolioId ? editingPortfolioId : "New right portfolio"}</h2></div>{editingPortfolioId && <button className="ipr-btn ipr-btn-sm" type="button" onClick={resetPortfolioForm}>Cancel edit</button>}</div>

        <div className="ipr-two">
          <div className="ipr-field"><label>Portfolio name</label><input value={portfolio.name} onChange={(e) => p("name", e.target.value)} placeholder="e.g. Industrial patents income pool" /></div>
          <div className="ipr-field"><label>Right type</label><select value={portfolio.rightType} onChange={(e) => p("rightType", e.target.value)}><RightTypeOptions/></select></div>
        </div>
        <div className="ipr-two">
          <div className="ipr-field"><label>Jurisdiction</label><input value={portfolio.jurisdiction} onChange={(e) => p("jurisdiction", e.target.value)} placeholder="e.g. European Union"/></div>
          <div className="ipr-field"><label>Risk grade</label><select value={portfolio.riskGrade} onChange={(e) => p("riskGrade", e.target.value)}>{RISK_OPTIONS.map((value) => <option key={value} value={value}>{riskGradeLabel(value)}</option>)}</select></div>
        </div>
        <div className="ipr-three">
          <div className="ipr-field"><label>Funding target (USD)</label><input type="number" min="0" step="0.01" value={portfolio.targetUsd} onChange={(e) => p("targetUsd", e.target.value)} placeholder="e.g. 2500000"/></div>
          <div className="ipr-field"><label>Unit price (USD)</label><input type="number" min="0" step="0.01" value={portfolio.unitPriceUsd} onChange={(e) => p("unitPriceUsd", e.target.value)} placeholder="e.g. 1000"/></div>
          <div className="ipr-field"><label>Total units</label><input type="number" min="1" step="1" value={portfolio.unitCount} onChange={(e) => p("unitCount", e.target.value)} placeholder="e.g. 2500"/></div>
        </div>
        <div className="ipr-two">
          <div className="ipr-field"><label>Expected multiple (×)</label><input type="number" min="0" step="0.01" value={portfolio.expectedMultiple} onChange={(e) => p("expectedMultiple", e.target.value)} placeholder="e.g. 1.45"/></div>
          <div className="ipr-field"><label>Expected duration (months)</label><input type="number" min="0" step="1" value={portfolio.expectedDurationMonths} onChange={(e) => p("expectedDurationMonths", e.target.value)} placeholder="e.g. 72"/></div>
        </div>
        <div className="ipr-field"><label>Expected annual distribution (USD)</label><input type="number" min="0" step="0.01" value={portfolio.expectedAnnualDistributionUsd} onChange={(e) => p("expectedAnnualDistributionUsd", e.target.value)} placeholder="e.g. 180000"/></div>

        <div className="ipr-field"><label>Right ids (required, one per line)</label><textarea rows={3} value={portfolio.rightIdsText} onChange={(e) => p("rightIdsText", e.target.value)} placeholder={"admin-hydroseal-valve-a1b2\nadmin-lumenoptical-c3d4"}/></div>
        <div className="ipr-field"><label>Per-right allocation weights (required, <span className="ipr-mono">rightId=bps</span> per line, must sum to 10000)</label><textarea rows={3} value={portfolio.allocationsText} onChange={(e) => p("allocationsText", e.target.value)} placeholder={"admin-hydroseal-valve-a1b2=6000\nadmin-lumenoptical-c3d4=4000"}/><small>Every right listed above needs a positive weight here, and the weights must sum to exactly 10000 (100%).</small></div>
        {(portfolioAllocationErrors || (portfolioRightIds.length > 0 && portfolioAllocationTotal === 10_000)) && <div className={`ipr-notice${portfolioAllocationErrors ? " is-error" : " is-success"}`} role={portfolioAllocationErrors ? "alert" : "status"}><div>Allocation weights: {percent(portfolioAllocationTotal)} of 100%{portfolioAllocationErrors ? ` — ${portfolioAllocationErrors}` : " — complete"}.</div></div>}

        <div className="ipr-field"><label>Summary (optional)</label><textarea rows={2} maxLength={2000} value={portfolio.summary} onChange={(e) => p("summary", e.target.value)} placeholder="A short description customers will read."/></div>
        <div className="ipr-two">
          <div className="ipr-field"><label>Source label (optional)</label><input value={portfolio.source} onChange={(e) => p("source", e.target.value)} placeholder="Source of the right set"/></div>
          <div className="ipr-field"><label>Source URL (optional)</label><input value={portfolio.sourceUrl} onChange={(e) => p("sourceUrl", e.target.value)} placeholder="https://public-source.example/pool"/></div>
        </div>
        <div className="ipr-two">
          <div className="ipr-field"><label>As-of date (required)</label><input type="date" value={portfolio.asOf} onChange={(e) => p("asOf", e.target.value)}/></div>
          <div className="ipr-field"><label>Audit reason (optional)</label><input value={portfolio.reason} onChange={(e) => p("reason", e.target.value)} placeholder="Reason recorded with this change"/></div>
        </div>

        <div className="ipr-admin-actions">
          <button className="ipr-btn primary" type="button" disabled={!portfolioValid || pending} onClick={submitPortfolio}>{pending ? "Saving…" : editingPortfolioId ? "Save changes" : "Publish portfolio"} <Check size={14}/></button>
          <span className="ipr-card-meta"><Layers3 size={13}/> Funders receive a pro-rata share of distributions, allocated per right by the weights above.</span>
        </div>
      </div>

      <div className="ipr-admin-list">
        <div className="ipr-section-head"><span className="eyebrow">Published portfolios ({portfolioRows.length})</span></div>
        {!portfolioRows.length && <div className="ipr-empty"><Layers3 size={16}/> No portfolios yet. Publish one above to pool rights for customers.</div>}
        {portfolioRows.map((row) => {
          const fundedBps = row.targetMinor > 0 ? Math.min(10_000, Math.round((row.committedMinor * 10_000) / row.targetMinor)) : 0;
          return <div className="ipr-admin-row" key={row.portfolioId}>
            <div className="ipr-admin-row-head">
              <div><strong>{row.name}</strong><div className="ipr-card-meta"><span>{row.jurisdiction}</span><span>{rightTypeLabel(row.rightType)}</span></div></div>
              <div className="ipr-badges"><span className={`ipr-badge ipr-badge--risk-${String(row.riskGrade).toLowerCase()}`}>{riskGradeLabel(row.riskGrade)}</span><span className="ipr-badge">{row.enabled ? "Enabled" : "Disabled"}</span></div>
            </div>
            <div className="ipr-card-meta">
              <span>Target {money(row.targetMinor)} · committed {money(row.committedMinor)} ({percent(fundedBps)})</span>
              <span>Unit {money(row.unitPriceMinor)} × {Number(row.unitCount).toLocaleString()}</span>
              <span>Expected {multiple(row.expectedMultipleBps)}</span>
              <span>ID {row.portfolioId}</span>
            </div>
            <div className="ipr-alloc">
              <span>{row.rightIds.length} right{row.rightIds.length === 1 ? "" : "s"}:</span>
              {row.rightIds.map((rightId: string) => <span className="ipr-badge" key={rightId}>{rightId} · {percent(row.allocationBpsByRight[rightId] || 0)}</span>)}
            </div>
            <div className="ipr-admin-actions">
              <button className="ipr-btn ipr-btn-sm" type="button" onClick={() => beginEditPortfolio(row)}>Edit</button>
              <button className="ipr-btn ipr-btn-sm" type="button" disabled={togglePortfolio.isPending} onClick={() => togglePortfolio.mutate({ portfolioId: row.portfolioId, enabled: !row.enabled })}>{row.enabled ? "Disable" : "Enable"}</button>
              <button className="ipr-btn ipr-btn-sm danger" type="button" disabled={deletePortfolio.isPending || row.committedMinor > 0} onClick={() => { if (window.confirm(`Delete portfolio “${row.name}”?`)) deletePortfolio.mutate({ portfolioId: row.portfolioId }); }}><Trash2 size={13}/> Delete</button>
            </div>
          </div>;
        })}
      </div>
    </div>}

    {tab === "distributions" && <div className="ipr-admin">
      <div className="ipr-admin-list">
        <div className="ipr-section-head"><div><span className="eyebrow">Record distributions ({openInstrumentRows.length}) · {money(openCommittedMinor)} committed</span><h2>Credit a royalty distribution</h2></div></div>
        <div className="ipr-notice">
          <Coins size={15}/>
          <div>The amount you record is split pro-rata across every open position on the instrument by its principal and credited to each funder's settlement wallet as a withdrawable internal-ledger entry. Principal stays locked during the term. It is idempotent per submit, and historical entries are never edited.</div>
        </div>
        {!openInstrumentRows.length && <div className="ipr-empty"><Coins size={16}/> No instruments carry open commitments right now. Funded rights and portfolios appear here for distributions.</div>}
        {openInstrumentRows.map((row) => {
          const form = distributionFormFor(row);
          const previewMinor = toMinor(form.amountUsd) ?? 0;
          return <div className="ipr-admin-row" key={keyOf(row)}>
            <div className="ipr-admin-row-head">
              <div><strong>{row.instrumentName}</strong><div className="ipr-card-meta"><span className="ipr-mono">{row.instrumentType} · {row.instrumentId}</span></div></div>
              <div className="ipr-badges"><span className="ipr-badge">{row.openPositions} open position{row.openPositions === 1 ? "" : "s"}</span><span className="ipr-badge">{money(row.committedMinor)} committed</span><span className="ipr-badge">Distributed {money(row.distributedMinor)}</span></div>
            </div>
            <div className="ipr-two">
              <div className="ipr-field"><label>Distribution amount ({row.currency || "USD"})</label><input type="number" min="0" step="0.01" value={form.amountUsd} onChange={(e) => setDistributionForm(row, "amountUsd", e.target.value)} placeholder="e.g. 12000"/></div>
              <div className="ipr-field"><label>Note (optional)</label><input value={form.note} onChange={(e) => setDistributionForm(row, "note", e.target.value)} placeholder="e.g. Q1 2026 royalty statement"/></div>
            </div>
            <div className="ipr-card-meta"><span>Preview {money(previewMinor)} split pro-rata across {row.openPositions} position(s)</span></div>
            <div className="ipr-admin-actions">
              <button className="ipr-btn primary" type="button" disabled={recordDistribution.isPending || previewMinor <= 0} onClick={() => runDistribution(row)}>
                {recordDistribution.isPending ? "Recording…" : `Record ${money(previewMinor)} distribution`} <Check size={14}/>
              </button>
            </div>
          </div>;
        })}
      </div>
    </div>}

    {tab === "settle" && <div className="ipr-admin">
      <div className="ipr-admin-list">
        <div className="ipr-section-head"><div><span className="eyebrow">Settle &amp; write off ({openInstrumentRows.length}) · {money(openCommittedMinor)} committed</span><h2>Resolve a funded instrument</h2></div></div>
        <div className="ipr-notice">
          <AlertTriangle size={15}/>
          <div>Choose the outcome and the completion multiple here to release locked principal and pay or write off every open position. A buyout or run-off pays principal × the multiple you set; a write-off pays nothing and releases the lock without fabricating a credit. Payouts and write-offs are internal-ledger compensating entries and are never edited. This cannot be undone.</div>
        </div>
        {!openInstrumentRows.length && <div className="ipr-empty"><BadgePercent size={16}/> No instruments carry open commitments right now. Funded rights and portfolios appear here for settlement.</div>}
        {openInstrumentRows.map((row) => {
          const form = settleFormFor(row);
          const payoutPreview = form.outcome === "WRITE_OFF" ? 0 : Math.round((Number(row.committedMinor || 0) * toBpsFromPercent(form.multiplePercent)) / 10_000);
          return <div className="ipr-admin-row" key={keyOf(row)}>
            <div className="ipr-admin-row-head">
              <div><strong>{row.instrumentName}</strong><div className="ipr-card-meta"><span className="ipr-mono">{row.instrumentType} · {row.instrumentId}</span></div></div>
              <div className="ipr-badges"><span className="ipr-badge">{row.openPositions} open position{row.openPositions === 1 ? "" : "s"}</span><span className="ipr-badge">{money(row.committedMinor)} committed</span></div>
            </div>
            <div className="ipr-two">
              <div className="ipr-field"><label>Outcome</label>
                <select value={form.outcome} onChange={(e) => setSettleForm(row, "outcome", e.target.value)}>
                  {IP_ROYALTY_OUTCOMES.map((value) => <option key={value} value={value}>{outcomeLabel(value)}</option>)}
                </select>
              </div>
              <div className="ipr-field"><label>Completion multiple (%)</label>
                <input type="number" min="0" step="1" value={form.multiplePercent} disabled={form.outcome === "WRITE_OFF"} onChange={(e) => setSettleForm(row, "multiplePercent", e.target.value)}/>
                <small>{form.outcome === "WRITE_OFF" ? "A write-off pays nothing; every principal is written off." : `Funders receive principal × ${multiple(toBpsFromPercent(form.multiplePercent))}.`}</small>
              </div>
            </div>
            <div className="ipr-field"><label>Reason (optional)</label><input value={form.reason} onChange={(e) => setSettleForm(row, "reason", e.target.value)} placeholder="e.g. Buyout agreed at 1.60x on 2026-05-01"/></div>
            <div className="ipr-card-meta">
              <span>Payout preview {money(payoutPreview)} of {money(row.committedMinor)} committed</span>
              {form.outcome === "WRITE_OFF" && <span>{money(row.committedMinor)} written off</span>}
            </div>
            <div className="ipr-admin-actions">
              <button className="ipr-btn primary" type="button" disabled={settleInstrument.isPending} onClick={() => runSettle(row)}>
                {settleInstrument.isPending ? "Settling…" : `Settle as ${outcomeLabel(form.outcome as any)} at ${form.outcome === "WRITE_OFF" ? "0.00x" : multiple(toBpsFromPercent(form.multiplePercent))}`} <Check size={14}/>
              </button>
            </div>
          </div>;
        })}
      </div>
    </div>}

    {tab === "economics" && <div className="ipr-admin">
      <div className="ipr-admin-list">
        <div className="ipr-section-head"><div><span className="eyebrow">Auto-assigned economics ({economicsIds.length})</span><h2>Amount, profit, term, currency &amp; platform fee</h2></div></div>
        <div className="ipr-notice">
          <Gauge size={15}/>
          <div>Every right gets a deterministic economic profile the moment it appears on the customer desk — an investable amount from {money(ECONOMICS_BOUNDS.ticketMinMinorUsd)}, a {percent(ECONOMICS_BOUNDS.profitMinBps)}–{percent(ECONOMICS_BOUNDS.profitMaxBps)} profit, a term of {ECONOMICS_BOUNDS.termMinDays}–{ECONOMICS_BOUNDS.termMaxDays} days, a presentation currency and a {percent(ECONOMICS_BOUNDS.platformFeeMinBps)}–{percent(ECONOMICS_BOUNDS.platformFeeMaxBps)} platform fee. Override any value here; a saved profile is marked administrator-authored and is never re-rolled automatically.</div>
        </div>
        {!economicsIds.length && <div className="ipr-empty"><Gauge size={16}/> No rights to profile yet. Publish a dossier or fund a right and its economic profile appears here.</div>}
        {economicsIds.map((id) => {
          const form = econFormFor(id);
          const profile = econById.get(id);
          const scale = econScale(form.currency);
          const ticketMinor = toMinorScaled(form.ticketMin, scale);
          const targetMinor = toMinorScaled(form.fundingTarget, scale);
          return <div className="ipr-admin-row" key={id}>
            <div className="ipr-admin-row-head">
              <div><strong>{econNameFor(id)}</strong><div className="ipr-card-meta"><span className="ipr-mono">{id}</span></div></div>
              <div className="ipr-badges">
                <span className="ipr-badge">{profile?.source === "ADMIN" ? "Administrator profile" : "Auto-assigned"}</span>
                {profile?.currency && <span className="ipr-badge ipr-badge--type">{profile.currency}</span>}
              </div>
            </div>
            <div className="ipr-two">
              <div className="ipr-field"><label>Presentation currency</label>
                <select value={form.currency} onChange={(e) => setEconForm(id, "currency", e.target.value)}>
                  {INVESTMENT_CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
                </select>
                <small>USD is the dominant choice; the others are for display.</small>
              </div>
              <div className="ipr-field"><label>Minimum ticket</label>
                <input type="number" min="0" step="1" value={form.ticketMin} onChange={(e) => setEconForm(id, "ticketMin", e.target.value)}/>
                <small>{ticketMinor !== null ? `${money(currencyMinorToUsdMinor(ticketMinor, form.currency))} USD equivalent · ${scale} decimal place${scale === 1 ? "" : "s"}` : `Enter the amount in ${form.currency}`}</small>
              </div>
            </div>
            <div className="ipr-two">
              <div className="ipr-field"><label>Funding target</label>
                <input type="number" min="0" step="1" value={form.fundingTarget} onChange={(e) => setEconForm(id, "fundingTarget", e.target.value)}/>
                <small>{targetMinor !== null ? `${money(currencyMinorToUsdMinor(targetMinor, form.currency))} USD equivalent` : "The capital target"}</small>
              </div>
              <div className="ipr-field"><label>Profit (%)</label>
                <input type="number" min="25" max="38" step="0.25" value={form.profitPercent} onChange={(e) => setEconForm(id, "profitPercent", e.target.value)}/>
                <small>Between {percent(ECONOMICS_BOUNDS.profitMinBps)} and {percent(ECONOMICS_BOUNDS.profitMaxBps)}.</small>
              </div>
            </div>
            <div className="ipr-two">
              <div className="ipr-field"><label>Term (days)</label>
                <input type="number" min="30" max="365" step="1" value={form.termDays} onChange={(e) => setEconForm(id, "termDays", e.target.value)}/>
                <small>Days from funding close to realising the profit ({ECONOMICS_BOUNDS.termMinDays}–{ECONOMICS_BOUNDS.termMaxDays}).</small>
              </div>
              <div className="ipr-field"><label>Platform fee (%)</label>
                <input type="number" min="7" max="10" step="0.25" value={form.platformFeePercent} onChange={(e) => setEconForm(id, "platformFeePercent", e.target.value)}/>
                <small>Between {percent(ECONOMICS_BOUNDS.platformFeeMinBps)} and {percent(ECONOMICS_BOUNDS.platformFeeMaxBps)}.</small>
              </div>
            </div>
            <div className="ipr-two">
              <div className="ipr-field"><label>Investment closes</label>
                <input type="date" value={form.closeDate} onChange={(e) => setEconForm(id, "closeDate", e.target.value)}/>
              </div>
              <div className="ipr-field"><label>Profit realised</label>
                <input type="date" value={form.maturityDate} onChange={(e) => setEconForm(id, "maturityDate", e.target.value)}/>
              </div>
            </div>
            <div className="ipr-field"><label>System settlement delay (days — blank for none)</label>
              <input type="number" min="0" max="365" step="1" value={form.settlementDelay} onChange={(e) => setEconForm(id, "settlementDelay", e.target.value)} placeholder="e.g. 5"/>
              <small>A bolt-on delay applied to some rights only, so a delayed payout reads as a real exception.</small>
            </div>
            <div className="ipr-admin-actions">
              <button className="ipr-btn primary" type="button" disabled={saveEconomics.isPending} onClick={() => runSaveEconomics(id)}>
                {saveEconomics.isPending ? "Saving…" : "Save economic profile"} <Check size={14}/>
              </button>
              <button className="ipr-btn ipr-btn-sm" type="button" disabled={reassignEconomics.isPending} onClick={() => runReassignEconomics(id)}>
                <RefreshCw size={14}/> Re-roll auto profile
              </button>
            </div>
          </div>;
        })}
      </div>
    </div>}
      </div>
    </div>

    <div className="ipr-notice">
      <ShieldCheck size={15}/>
      <div>The discovery layer surfaces real, cited public IP registers grouped into the desk&apos;s three sectors — {sectorLabel("REGISTERED_IP")}, {sectorLabel("CREATIVE_MEDIA")} and {sectorLabel("BUSINESS_TECH")} — and every cited right is open for funding. Public registers publish ownership rather than royalty economics, so a discovered right carries no dated numbers of its own; a dossier only enriches it. Music royalties, NFTs, agro investment, green energy and carbon credits belong to their own menus and are excluded here. This console writes administrator dossiers and portfolios, records distributions and settles instruments to the platform database. Every change is audited, publishing economics requires a funding target and a cited source URL with scenarios that sum to 100%, and no royalty figure is ever invented here.</div>
    </div>
  </div>;
}
