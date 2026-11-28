import { useMemo, useState } from "react";
import {
  AlertTriangle, BadgePercent, Check, Coins, Compass, Gauge, RefreshCw, ScrollText, ShieldCheck, Trash2,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { COUNTRY_OPTIONS, flagFor } from "@shared/country-options";
import { ECONOMICS_BOUNDS, INVESTMENT_CURRENCIES, currencyByCode, currencyMinorToUsdMinor } from "@shared/investment-economics";
import {
  CARBON_CREDIT_TYPES,
  CARBON_DOSSIER_STATUSES,
  CARBON_OUTCOMES,
  CARBON_RISK_GRADES,
  CARBON_SECTORS,
  CARBON_STAGES,
  CARBON_STANDARDS,
  CARBON_TERRITORY_BANDS,
  CARBON_TYPE_GROUPS,
  carbonOutcomeLabel,
  carbonRegionLabel,
  carbonRegionOf,
  carbonRiskLabel,
  carbonSectorLabel,
  carbonStageLabel,
  carbonStandardLabel,
  carbonStatusLabel,
  carbonTerritoryBandLabel,
  carbonTypeLabel,
  defaultCarbonMilestones,
  type CarbonStage,
  type CarbonStandard,
} from "@shared/carbon-credit-catalogue";
import "./carbon-credit.css";
import { visibilityAwareRefetchInterval } from "../visibility-aware-polling";

const RISK_OPTIONS = CARBON_RISK_GRADES;
const STATUS_OPTIONS = CARBON_DOSSIER_STATUSES;
const STAGE_OPTIONS = CARBON_STAGES;

/**
 * Neutral template scenarios. Public sources publish carbon context but no deal
 * economics, so an administrator must model the three outcomes by hand; this
 * template is only a starting point and probabilities must sum to 100%.
 */
const TEMPLATE_SCENARIOS = [
  { outcome: "HIGH_ISSUANCE", label: "High issuance", probabilityPercent: "30", grossRevenueUsd: "", durationMonths: "24", funderMultiple: "2.20" },
  { outcome: "ON_PLAN", label: "On plan", probabilityPercent: "50", grossRevenueUsd: "", durationMonths: "24", funderMultiple: "1.20" },
  { outcome: "WRITE_OFF", label: "Write-off", probabilityPercent: "20", grossRevenueUsd: "", durationMonths: "24", funderMultiple: "0.00" },
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
const tonnes = (value: number | null | undefined) => (value === null || value === undefined ? "—" : `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })} tCO₂e`);

/** Carbon credit types, grouped into the desk's four lanes for the type picker. */
function CarbonTypeOptions() {
  return <>{CARBON_TYPE_GROUPS.map((group) => <optgroup label={group.label} key={group.label}>
    {group.types.map((value) => <option key={value} value={value}>{carbonTypeLabel(value)}</option>)}
  </optgroup>)}</>;
}

type DossierForm = {
  title: string; operator: string; creditType: string; sector: string; standard: string; offtaker: string;
  countryCode: string; territory: string; territoryBand: string; dealType: string;
  description: string; revenueSharesPercent: string; expectedMultiple: string; expectedDurationMonths: string;
  projectedRevenueUsd: string; capitalAtRiskUsd: string; fundingAskUsd: string;
  creditVolumeTonnes: string; pricePerTonneUsd: string;
  minimumInvestmentUsd: string; unitPriceUsd: string; eventDate: string; fundingDeadline: string;
  stage: string; status: string; riskGrade: string; highlightsText: string;
  source: string; sourceUrl: string; asOf: string; reason: string;
};

const emptyDossier = (): DossierForm => ({
  title: "", operator: "", creditType: "REFORESTATION", sector: "FORESTRY", standard: "", offtaker: "",
  countryCode: "BR", territory: "", territoryBand: "NATIONAL", dealType: "",
  description: "", revenueSharesPercent: "", expectedMultiple: "", expectedDurationMonths: "",
  projectedRevenueUsd: "", capitalAtRiskUsd: "", fundingAskUsd: "",
  creditVolumeTonnes: "", pricePerTonneUsd: "",
  minimumInvestmentUsd: "", unitPriceUsd: "", eventDate: "", fundingDeadline: "",
  stage: "FUNDING", status: "FUNDING", riskGrade: "", highlightsText: "",
  source: "", sourceUrl: "", asOf: "", reason: "",
});

type ScenarioForm = { outcome: string; label: string; probabilityPercent: string; grossRevenueUsd: string; durationMonths: string; funderMultiple: string };
type MilestoneForm = { stage: string; label: string; releasePercent: string; status: string; reachedAt?: string | null };

/** Administrator-editable economic profile for one opportunity (major units / percent / whole days). */
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
 * Administrator console for the Carbon Credit desk. This desk is carbon-only:
 * an administrator posts a new carbon opportunity — reforestation, forest
 * conservation, soil carbon, blue carbon, cookstoves, biochar, direct air
 * capture, BECCS, enhanced weathering, ocean alkalinity, renewable energy,
 * methane capture, waste management or industrial efficiency — by selecting its
 * type and verification standard and publishing the sourced economics. This
 * console is the primary source of investable opportunities, and it also records
 * revenue distributions against funded opportunities and settles or writes them
 * off.
 */
export function AdminCarbonCredit() {
  const utils = trpc.useUtils();
  const dossiersQuery = trpc.adminOperations.carbonDossiers.useQuery(undefined, { refetchInterval: (query) => visibilityAwareRefetchInterval(20000, query.state.fetchFailureCount) });
  const openInstrumentsQuery = trpc.adminOperations.carbonOpenInstruments.useQuery(undefined, { refetchInterval: (query) => visibilityAwareRefetchInterval(20000, query.state.fetchFailureCount) });

  // Every opportunity the console knows about — published dossiers plus anything
  // carrying open commitments — is a candidate for an auto-assigned economic
  // profile the administrator can review and override.
  const economicsIds = useMemo(() => {
    const ids = new Set<string>();
    for (const row of (dossiersQuery.data || []) as any[]) if (row?.dossierId) ids.add(String(row.dossierId));
    for (const row of (openInstrumentsQuery.data || []) as any[]) if (row?.instrumentId) ids.add(String(row.instrumentId));
    return [...ids];
  }, [dossiersQuery.data, openInstrumentsQuery.data]);
  const economicsQuery = trpc.adminOperations.deskEconomicsBatch.useQuery(
    { desk: "carbon", instrumentIds: economicsIds },
    { enabled: economicsIds.length > 0, refetchInterval: (query) => visibilityAwareRefetchInterval(30000, query.state.fetchFailureCount) },
  );

  const [tab, setTab] = useState<"dossiers" | "distributions" | "settle" | "economics">("dossiers");
  const [econForms, setEconForms] = useState<Record<string, EconForm>>({});
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">("success");
  const [distributionForms, setDistributionForms] = useState<Record<string, { amountUsd: string; note: string }>>({});
  const [settleForms, setSettleForms] = useState<Record<string, { outcome: string; multiplePercent: string; reason: string }>>({});

  const [dossier, setDossier] = useState<DossierForm>(emptyDossier);
  const [editingDossierId, setEditingDossierId] = useState<string | null>(null);
  const [modelScenarios, setModelScenarios] = useState(false);
  const [scenarios, setScenarios] = useState<ScenarioForm[]>(() => TEMPLATE_SCENARIOS.map((item) => ({ ...item })));
  const [modelMilestones, setModelMilestones] = useState(false);
  const [milestones, setMilestones] = useState<MilestoneForm[]>(() =>
    defaultCarbonMilestones().map((item) => ({ stage: item.stage, label: item.label, releasePercent: String(item.releaseBps / 100), status: item.status })));

  const report = (kind: "success" | "error", text: string) => { setMessageKind(kind); setMessage(text); };
  const onError = (error: { message: string }) => report("error", error.message);
  const invalidate = () => {
    void utils.adminOperations.carbonDossiers.invalidate();
    void utils.adminOperations.carbonOpenInstruments.invalidate();
    void utils.adminOperations.deskEconomicsBatch.invalidate();
    void utils.customer.carbonCredit.market.invalidate();
  };

  const createDossier = trpc.adminOperations.createCarbonDossier.useMutation({ onSuccess: (row: any) => { resetDossierForm(); invalidate(); report("success", `Published opportunity ${row.dossierId} “${row.title}”.`); }, onError });
  const updateDossier = trpc.adminOperations.updateCarbonDossier.useMutation({ onSuccess: (row: any) => { resetDossierForm(); invalidate(); report("success", `Updated opportunity ${row.dossierId}.`); }, onError });
  const toggleDossier = trpc.adminOperations.setCarbonDossierEnabled.useMutation({ onSuccess: (row: any) => { invalidate(); report("success", `${row.title} is now ${row.enabled ? "enabled on" : "disabled from"} the customer desk.`); }, onError });
  const setStatus = trpc.adminOperations.setCarbonDossierStatus.useMutation({ onSuccess: (row: any) => { invalidate(); report("success", `${row.title} status set to ${carbonStatusLabel(row.status)}.`); }, onError });
  const reachMilestone = trpc.adminOperations.reachCarbonMilestone.useMutation({ onSuccess: (row: any) => { invalidate(); report("success", `${row.title} advanced to ${carbonStageLabel(row.stage)}.`); }, onError });
  const deleteDossier = trpc.adminOperations.deleteCarbonDossier.useMutation({ onSuccess: (result: any) => { invalidate(); report("success", `Deleted ${result.dossierId}.`); }, onError });

  const saveEconomics = trpc.adminOperations.setDeskEconomics.useMutation({
    onSuccess: (row: any) => { setEconForms((current) => { const next = { ...current }; delete next[row.instrumentId]; return next; }); invalidate(); report("success", `Economic profile saved for ${row.instrumentId}.`); },
    onError,
  });
  const reassignEconomics = trpc.adminOperations.reassignDeskEconomics.useMutation({
    onSuccess: (row: any) => { invalidate(); report("success", row.source === "ADMIN" ? `${row.instrumentId} keeps its administrator profile.` : `Re-rolled the auto profile for ${row.instrumentId}.`); },
    onError,
  });

  const recordDistribution = trpc.adminOperations.recordCarbonDistribution.useMutation({
    onSuccess: (result: any) => {
      setDistributionForms((current) => { const next = { ...current }; delete next[result.instrumentId]; return next; });
      invalidate();
      report("success", `Distribution recorded on “${result.instrumentName}”: ${money(result.creditedMinor)} split across ${result.positions} open position(s).`);
    },
    onError,
  });
  const settleInstrument = trpc.adminOperations.settleCarbonInstrument.useMutation({
    onSuccess: (result: any) => {
      setSettleForms((current) => { const next = { ...current }; delete next[result.instrumentId]; return next; });
      invalidate();
      report("success", `Settled “${result.instrumentName}” as ${carbonOutcomeLabel(result.outcome)} at ${multiple(result.funderMultipleBps)}: ${money(result.paidMinor)} paid, ${money(result.writtenOffMinor)} written off.`);
    },
    onError,
  });

  const pending = createDossier.isPending || updateDossier.isPending;

  function resetDossierForm() {
    setEditingDossierId(null);
    setDossier(emptyDossier());
    setModelScenarios(false);
    setScenarios(TEMPLATE_SCENARIOS.map((item) => ({ ...item })));
    setModelMilestones(false);
    setMilestones(defaultCarbonMilestones().map((item) => ({ stage: item.stage, label: item.label, releasePercent: String(item.releaseBps / 100), status: item.status })));
  }

  const d = (key: keyof DossierForm, value: string) => setDossier((current) => ({ ...current, [key]: value }));
  const setScenario = (index: number, key: keyof ScenarioForm, value: string) => setScenarios((current) => current.map((item, i) => (i === index ? { ...item, [key]: value } : item)));
  const setMilestone = (index: number, key: keyof MilestoneForm, value: string) => setMilestones((current) => current.map((item, i) => (i === index ? { ...item, [key]: value } : item)));

  const scenarioBpsTotal = scenarios.reduce((sum, item) => sum + toBpsFromPercent(item.probabilityPercent), 0);
  const scenarioErrors = modelScenarios
    ? (!dossier.fundingAskUsd.trim() ? "Set a funding target before modelling the outcomes. " : "")
      + (!dossier.sourceUrl.trim() ? "A modelled opportunity must cite its source URL. " : "")
      + (scenarioBpsTotal !== 10_000 ? "Outcome probabilities must sum to exactly 100%. " : "")
    : "";

  const milestoneBpsTotal = milestones.reduce((sum, item) => sum + toBpsFromPercent(item.releasePercent), 0);
  const milestoneErrors = modelMilestones && milestoneBpsTotal !== 10_000
    ? "Milestone escrow releases must sum to exactly 100%."
    : "";

  const dossierValid = dossier.title.trim().length >= 3
    && dossier.operator.trim().length >= 2
    && /^[A-Za-z]{2}$/.test(dossier.countryCode)
    && dossier.description.trim().length >= 8
    && !scenarioErrors
    && !milestoneErrors;

  const buildDossierPayload = () => {
    const payload: any = {
      title: dossier.title.trim(),
      operator: dossier.operator.trim(),
      creditType: dossier.creditType,
      sector: dossier.sector,
      countryCode: dossier.countryCode.toUpperCase(),
      stage: dossier.stage,
      status: dossier.status,
      description: dossier.description.trim(),
      highlights: lines(dossier.highlightsText, 12),
    };
    if (dossier.standard) payload.standard = dossier.standard;
    if (dossier.offtaker.trim()) payload.offtaker = dossier.offtaker.trim();
    if (dossier.territory.trim()) payload.territory = dossier.territory.trim();
    if (dossier.territoryBand) payload.territoryBand = dossier.territoryBand;
    if (dossier.dealType.trim()) payload.dealType = dossier.dealType.trim();
    if (dossier.revenueSharesPercent.trim()) payload.revenueSharesBps = toBpsFromPercent(dossier.revenueSharesPercent);
    if (dossier.expectedMultiple.trim()) payload.expectedMultipleBps = Math.round(Number(dossier.expectedMultiple) * 10_000);
    if (dossier.expectedDurationMonths.trim()) payload.expectedDurationMonths = toInt(dossier.expectedDurationMonths);
    if (dossier.projectedRevenueUsd.trim()) payload.projectedRevenueMinor = toMinor(dossier.projectedRevenueUsd);
    if (dossier.capitalAtRiskUsd.trim()) payload.capitalAtRiskMinor = toMinor(dossier.capitalAtRiskUsd);
    if (dossier.fundingAskUsd.trim()) payload.fundingAskMinor = toMinor(dossier.fundingAskUsd);
    if (dossier.creditVolumeTonnes.trim()) payload.creditVolumeTonnes = toInt(dossier.creditVolumeTonnes);
    if (dossier.pricePerTonneUsd.trim()) payload.pricePerTonneMinor = toMinor(dossier.pricePerTonneUsd);
    if (dossier.minimumInvestmentUsd.trim()) payload.minimumInvestmentMinor = toMinor(dossier.minimumInvestmentUsd);
    if (dossier.unitPriceUsd.trim()) payload.unitPriceMinor = toMinor(dossier.unitPriceUsd);
    if (dossier.eventDate.trim()) payload.eventDate = dossier.eventDate.trim();
    if (dossier.fundingDeadline.trim()) payload.fundingDeadline = dossier.fundingDeadline.trim();
    if (dossier.riskGrade) payload.riskGrade = dossier.riskGrade;
    if (dossier.source.trim()) payload.source = dossier.source.trim();
    if (dossier.sourceUrl.trim()) payload.sourceUrl = dossier.sourceUrl.trim();
    if (dossier.asOf.trim()) payload.asOf = dossier.asOf.trim();
    if (dossier.reason.trim()) payload.reason = dossier.reason.trim();
    if (modelScenarios) {
      payload.scenarios = scenarios.map((item) => ({
        outcome: item.outcome,
        label: item.label.trim() || carbonOutcomeLabel(item.outcome as any),
        probabilityBps: toBpsFromPercent(item.probabilityPercent),
        grossRevenueMinor: toMinor(item.grossRevenueUsd) ?? 0,
        durationMonths: toInt(item.durationMonths) ?? 0,
        funderMultipleBps: Math.round((Number(item.funderMultiple) || 0) * 10_000),
      }));
    }
    if (modelMilestones) {
      payload.milestones = milestones.map((item, index) => ({
        stage: item.stage,
        label: item.label.trim() || carbonStageLabel(item.stage as CarbonStage),
        releaseBps: toBpsFromPercent(item.releasePercent),
        status: item.status,
        reachedAt: item.status === "REACHED" ? (dossier.asOf.trim() || new Date().toISOString().slice(0, 10)) : (milestones[index] as any).reachedAt ?? null,
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
      title: row.title || "", operator: row.operator || "", creditType: row.creditType || "REFORESTATION", sector: row.sector || "FORESTRY",
      standard: row.standard || "", offtaker: row.offtaker || "", countryCode: row.countryCode || "BR", territory: row.territory || "",
      territoryBand: row.territoryBand || "NATIONAL", dealType: row.dealType || "",
      description: row.description || "", revenueSharesPercent: fromBpsToPercent(row.revenueSharesBps),
      expectedMultiple: row.expectedMultipleBps === null || row.expectedMultipleBps === undefined ? "" : String(Number(row.expectedMultipleBps) / 10_000),
      expectedDurationMonths: row.expectedDurationMonths === null || row.expectedDurationMonths === undefined ? "" : String(row.expectedDurationMonths),
      projectedRevenueUsd: fromMinor(row.projectedRevenueMinor), capitalAtRiskUsd: fromMinor(row.capitalAtRiskMinor),
      fundingAskUsd: fromMinor(row.fundingAskMinor),
      creditVolumeTonnes: row.creditVolumeTonnes === null || row.creditVolumeTonnes === undefined ? "" : String(row.creditVolumeTonnes),
      pricePerTonneUsd: fromMinor(row.pricePerTonneMinor),
      minimumInvestmentUsd: fromMinor(row.minimumInvestmentMinor),
      unitPriceUsd: fromMinor(row.unitPriceMinor), eventDate: row.eventDate || "", fundingDeadline: row.fundingDeadline || "",
      stage: row.stage || "FUNDING", status: row.status || "FUNDING", riskGrade: row.riskGrade || "",
      highlightsText: Array.isArray(row.highlights) ? row.highlights.join("\n") : "",
      source: row.source || "", sourceUrl: row.sourceUrl || "", asOf: row.asOf || "", reason: "",
    });
    if (Array.isArray(row.scenarios) && row.scenarios.length) {
      setModelScenarios(true);
      setScenarios(TEMPLATE_SCENARIOS.map((template) => {
        const match = row.scenarios.find((item: any) => item.outcome === template.outcome);
        if (!match) return { ...template };
        return {
          outcome: match.outcome || template.outcome,
          label: match.label || template.label,
          probabilityPercent: fromBpsToPercent(match.probabilityBps),
          grossRevenueUsd: fromMinor(match.grossRevenueMinor),
          durationMonths: String(match.durationMonths ?? 0),
          funderMultiple: String(Number(match.funderMultipleBps || 0) / 10_000),
        };
      }));
    } else {
      setModelScenarios(false);
      setScenarios(TEMPLATE_SCENARIOS.map((item) => ({ ...item })));
    }
    if (Array.isArray(row.milestones) && row.milestones.length) {
      setModelMilestones(true);
      setMilestones(row.milestones.map((item: any) => ({
        stage: item.stage,
        label: item.label || carbonStageLabel(item.stage),
        releasePercent: String(Number(item.releaseBps || 0) / 100),
        status: item.status === "REACHED" ? "REACHED" : "PENDING",
        ...(item.reachedAt ? { reachedAt: item.reachedAt } : {}),
      })) as MilestoneForm[]);
    } else {
      setModelMilestones(false);
      setMilestones(defaultCarbonMilestones().map((item) => ({ stage: item.stage, label: item.label, releasePercent: String(item.releaseBps / 100), status: item.status })));
    }
  };

  const dossierRows: any[] = dossiersQuery.data || [];
  const openInstrumentRows: any[] = openInstrumentsQuery.data || [];
  const fundableCount = useMemo(() => dossierRows.filter((row) => row.status === "FUNDING" && row.scenarios.length > 0 && row.fundingAskMinor > 0 && !row.outcome).length, [dossierRows]);
  const natureBasedCount = useMemo(() => dossierRows.filter((row) => ["REFORESTATION", "FOREST_CONSERVATION", "SOIL_CARBON", "BLUE_CARBON"].includes(row.creditType)).length, [dossierRows]);
  const openCommittedMinor = useMemo(() => openInstrumentRows.reduce((sum, row) => sum + Number(row.committedMinor || 0), 0), [openInstrumentRows]);

  const econById = useMemo(() => {
    const map = new Map<string, any>();
    for (const row of (economicsQuery.data || []) as any[]) map.set(String(row.instrumentId), row);
    return map;
  }, [economicsQuery.data]);
  const econNameFor = (id: string) => {
    const dossier = dossierRows.find((row) => String(row.dossierId) === id);
    if (dossier) return `${dossier.flag ? `${dossier.flag} ` : ""}${dossier.title}`;
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
    saveEconomics.mutate({ desk: "carbon", instrumentId: id, ...patch });
  };
  const runReassignEconomics = (id: string) => {
    if (!window.confirm(`Re-roll the auto-assigned economic profile for ${id}? An administrator profile is not affected.`)) return;
    reassignEconomics.mutate({ desk: "carbon", instrumentId: id, salt: `${Date.now()}-${Math.round(Math.random() * 1e6)}` });
  };

  const distributionFormFor = (row: any) => distributionForms[row.instrumentId] || { amountUsd: "", note: "" };
  const setDistributionForm = (row: any, key: "amountUsd" | "note", value: string) => setDistributionForms((current) => ({ ...current, [row.instrumentId]: { ...(current[row.instrumentId] || { amountUsd: "", note: "" }), [key]: value } }));
  const runDistribution = (row: any) => {
    const form = distributionFormFor(row);
    const amountMinor = toMinor(form.amountUsd) ?? 0;
    if (amountMinor <= 0) { report("error", "Enter a distribution amount above zero."); return; }
    recordDistribution.mutate({ instrumentId: row.instrumentId, amountMinor, note: form.note.trim() || undefined, idempotencyKey: crypto.randomUUID() });
  };

  const settleFormFor = (row: any) => settleForms[row.instrumentId] || { outcome: "HIGH_ISSUANCE", multiplePercent: "180", reason: "" };
  const setSettleForm = (row: any, key: "outcome" | "multiplePercent" | "reason", value: string) => setSettleForms((current) => ({ ...current, [row.instrumentId]: { ...(current[row.instrumentId] || { outcome: "HIGH_ISSUANCE", multiplePercent: "180", reason: "" }), [key]: value } }));
  const runSettle = (row: any) => {
    const form = settleFormFor(row);
    const funderMultipleBps = form.outcome === "WRITE_OFF" ? 0 : toBpsFromPercent(form.multiplePercent);
    if (form.outcome !== "WRITE_OFF" && funderMultipleBps <= 0) { report("error", "Set a completion multiple above 0.00x for a high-issuance or on-plan outcome."); return; }
    const confirmText = `Settle “${row.instrumentName}” as ${carbonOutcomeLabel(form.outcome as any)} at ${form.outcome === "WRITE_OFF" ? "0.00x" : multiple(funderMultipleBps)}? This releases locked principal and pays or writes off all ${row.openPositions} open position(s) across ${money(row.committedMinor)} committed. It cannot be undone.`;
    if (!window.confirm(confirmText)) return;
    settleInstrument.mutate({ instrumentId: row.instrumentId, outcome: form.outcome as any, funderMultipleBps, reason: form.reason.trim() || "Administrator settlement" });
  };

  return <div className="arb-page portal-page cc-page">
    <header className="cc-hero" aria-label="Carbon Credit console">
      <div className="cc-hero-glow" aria-hidden="true" />
      <div className="cc-masthead">
        <div className="cc-masthead-lead">
          <span className="cc-eyebrow cc-eyebrow--teal">Carbon credit · Opportunity publishing</span>
          <h1 className="cc-title">Carbon Credit console</h1>
          <p className="cc-lede">Post a new carbon opportunity by selecting its credit type and verification standard and publishing the sourced economics — the project developer, the standard, the funding target, the expected credit volume and price per tonne, the modelled outcomes and the validation window — as a dossier. This desk is carbon-only, so this console is the primary source of investable opportunities customers see on the atlas. Record revenue distributions, advance a milestone, or settle a funded project here.</p>
        </div>
        <div className="cc-masthead-side">
          <button className="cc-btn cc-btn--ghost cc-btn--sm" type="button" onClick={() => { void dossiersQuery.refetch(); void openInstrumentsQuery.refetch(); }} disabled={dossiersQuery.isFetching || openInstrumentsQuery.isFetching}>
            <RefreshCw size={14} className={dossiersQuery.isFetching ? "spin" : ""}/> Refresh
          </button>
        </div>
      </div>
      <div className="cc-figures">
        <div className="cc-figure cc-figure--teal"><b>{dossierRows.length}</b><span>Published opportunities</span></div>
        <div className="cc-figure cc-figure--green"><b>{natureBasedCount}</b><span>Nature-based</span></div>
        <div className="cc-figure cc-figure--gold"><b>{fundableCount}</b><span>Open for investment</span></div>
        <div className="cc-figure cc-figure--red"><b>{money(openCommittedMinor)}</b><span>Open commitments</span></div>
      </div>
    </header>

    {message && <div className={`cc-notice${messageKind === "error" ? " is-error" : " is-success"}`} role={messageKind === "error" ? "alert" : "status"} aria-live="polite">
      <ShieldCheck size={15}/><div>{message}</div>
    </div>}

    <nav className="cc-tabs" aria-label="Carbon Credit console sections">
      <button type="button" className={`cc-tab${tab === "dossiers" ? " is-active" : ""}`} onClick={() => setTab("dossiers")}><ScrollText size={14}/> Opportunities <span className="cc-tab-count">{dossierRows.length}</span></button>
      <button type="button" className={`cc-tab${tab === "distributions" ? " is-active" : ""}`} onClick={() => setTab("distributions")}><Coins size={14}/> Record distributions <span className="cc-tab-count">{openInstrumentRows.length}</span></button>
      <button type="button" className={`cc-tab${tab === "settle" ? " is-active" : ""}`} onClick={() => setTab("settle")}><BadgePercent size={14}/> Settle &amp; write off <span className="cc-tab-count">{openInstrumentRows.length}</span></button>
      <button type="button" className={`cc-tab${tab === "economics" ? " is-active" : ""}`} onClick={() => setTab("economics")}><Gauge size={14}/> Economics <span className="cc-tab-count">{economicsIds.length}</span></button>
    </nav>

    {tab === "dossiers" && <div className="cc-admin">
      <div className="cc-admin-form">
        <div className="cc-section-head"><div><span className="cc-eyebrow cc-eyebrow--teal">{editingDossierId ? "Edit opportunity" : "Publish opportunity"}</span><h2>{editingDossierId ? editingDossierId : "New carbon opportunity"}</h2></div>{editingDossierId && <button className="cc-btn cc-btn--ghost cc-btn--sm" type="button" onClick={resetDossierForm}>Cancel edit</button>}</div>

        <div className="cc-two">
          <div className="cc-field"><label>Opportunity title</label><input value={dossier.title} onChange={(e) => d("title", e.target.value)} placeholder="e.g. Congo Basin REDD+ — Mai-Ndombe"/></div>
          <div className="cc-field"><label>Carbon credit type</label><select value={dossier.creditType} onChange={(e) => d("creditType", e.target.value)}><CarbonTypeOptions/></select><small>Pick the type: reforestation, forest conservation, soil carbon, blue carbon, cookstoves, biochar, direct air capture, BECCS, enhanced weathering, ocean alkalinity, renewable energy, methane capture, waste management or industrial efficiency.</small></div>
        </div>
        <div className="cc-two">
          <div className="cc-field"><label>Developer / operator / rights holder</label><input value={dossier.operator} onChange={(e) => d("operator", e.target.value)} placeholder="Who the project is for"/></div>
          <div className="cc-field"><label>Sector</label><select value={dossier.sector} onChange={(e) => d("sector", e.target.value)}>{CARBON_SECTORS.map((value) => <option key={value} value={value}>{carbonSectorLabel(value)}</option>)}</select></div>
        </div>
        <div className="cc-two">
          <div className="cc-field"><label>Verification standard</label><select value={dossier.standard} onChange={(e) => d("standard", e.target.value)}><option value="">Not yet verified</option>{CARBON_STANDARDS.map((value) => <option key={value} value={value}>{carbonStandardLabel(value)}</option>)}</select></div>
          <div className="cc-field"><label>Committed buyer / offtaker (optional)</label><input value={dossier.offtaker} onChange={(e) => d("offtaker", e.target.value)} placeholder="e.g. Corporate climate buyer"/></div>
        </div>
        <div className="cc-two">
          <div className="cc-field"><label>Deal type (optional)</label><input value={dossier.dealType} onChange={(e) => d("dealType", e.target.value)} placeholder="e.g. Revenue share, equity, recoupable advance"/></div>
          <div className="cc-field"><label>Atlas region (derived)</label><input value={carbonRegionLabel(carbonRegionOf(dossier.countryCode))} readOnly/><small>Derived from the country: <strong>{flagFor(dossier.countryCode)} {dossier.countryCode}</strong></small></div>
        </div>
        <div className="cc-two">
          <div className="cc-field"><label>Country</label>
            <select value={dossier.countryCode} onChange={(e) => d("countryCode", e.target.value)}>
              {COUNTRY_OPTIONS.map((country) => <option key={country.code} value={country.code}>{flagFor(country.code)} {country.name} ({country.code})</option>)}
            </select>
            <small>The flag and atlas pin are derived from this.</small>
          </div>
          <div className="cc-field"><label>Territory band</label><select value={dossier.territoryBand} onChange={(e) => d("territoryBand", e.target.value)}>{CARBON_TERRITORY_BANDS.map((value) => <option key={value} value={value}>{carbonTerritoryBandLabel(value)}</option>)}</select></div>
        </div>
        <div className="cc-field"><label>Territory label (optional)</label><input value={dossier.territory} onChange={(e) => d("territory", e.target.value)} placeholder="Defaults to the country name · e.g. Central Africa"/></div>

        <div className="cc-two">
          <div className="cc-field"><label>Lifecycle stage</label><select value={dossier.stage} onChange={(e) => d("stage", e.target.value)}>{STAGE_OPTIONS.map((value) => <option key={value} value={value}>{carbonStageLabel(value)}</option>)}</select></div>
          <div className="cc-field"><label>Status</label><select value={dossier.status} onChange={(e) => d("status", e.target.value)}>{STATUS_OPTIONS.map((value) => <option key={value} value={value}>{carbonStatusLabel(value)}</option>)}</select></div>
        </div>
        <div className="cc-two">
          <div className="cc-field"><label>Risk grade</label><select value={dossier.riskGrade} onChange={(e) => d("riskGrade", e.target.value)}><option value="">Not graded</option>{RISK_OPTIONS.map((value) => <option key={value} value={value}>{carbonRiskLabel(value)}</option>)}</select></div>
          <div className="cc-field"><label>Investor revenue share (%)</label><input type="number" min="0" max="100" step="0.01" value={dossier.revenueSharesPercent} onChange={(e) => d("revenueSharesPercent", e.target.value)} placeholder="e.g. 45"/></div>
        </div>

        <div className="cc-three">
          <div className="cc-field"><label>Expected multiple (×)</label><input type="number" min="0" step="0.01" value={dossier.expectedMultiple} onChange={(e) => d("expectedMultiple", e.target.value)} placeholder="e.g. 1.55"/></div>
          <div className="cc-field"><label>Expected duration (months)</label><input type="number" min="0" step="1" value={dossier.expectedDurationMonths} onChange={(e) => d("expectedDurationMonths", e.target.value)} placeholder="e.g. 24"/></div>
          <div className="cc-field"><label>Projected revenue (USD)</label><input type="number" min="0" step="0.01" value={dossier.projectedRevenueUsd} onChange={(e) => d("projectedRevenueUsd", e.target.value)} placeholder="e.g. 2500000"/></div>
        </div>
        <div className="cc-three">
          <div className="cc-field"><label>Expected credit volume (tCO₂e)</label><input type="number" min="0" step="1" value={dossier.creditVolumeTonnes} onChange={(e) => d("creditVolumeTonnes", e.target.value)} placeholder="e.g. 250000"/></div>
          <div className="cc-field"><label>Price per tonne (USD)</label><input type="number" min="0" step="0.01" value={dossier.pricePerTonneUsd} onChange={(e) => d("pricePerTonneUsd", e.target.value)} placeholder="e.g. 12.50"/></div>
          <div className="cc-field"><label>Capital at risk (USD)</label><input type="number" min="0" step="0.01" value={dossier.capitalAtRiskUsd} onChange={(e) => d("capitalAtRiskUsd", e.target.value)} placeholder="e.g. 400000"/></div>
        </div>
        <div className="cc-three">
          <div className="cc-field"><label>Funding target (USD)</label><input type="number" min="0" step="0.01" value={dossier.fundingAskUsd} onChange={(e) => d("fundingAskUsd", e.target.value)} placeholder="e.g. 500000"/></div>
          <div className="cc-field"><label>Minimum investment (USD)</label><input type="number" min="0" step="0.01" value={dossier.minimumInvestmentUsd} onChange={(e) => d("minimumInvestmentUsd", e.target.value)} placeholder="e.g. 1000"/></div>
          <div className="cc-field"><label>Unit price (USD, optional)</label><input type="number" min="0" step="0.01" value={dossier.unitPriceUsd} onChange={(e) => d("unitPriceUsd", e.target.value)} placeholder="e.g. 100"/></div>
        </div>
        <div className="cc-two">
          <div className="cc-field"><label>Validation / first-issuance date</label><input type="date" value={dossier.eventDate} onChange={(e) => d("eventDate", e.target.value)}/></div>
          <div className="cc-field"><label>Funding deadline</label><input type="date" value={dossier.fundingDeadline} onChange={(e) => d("fundingDeadline", e.target.value)}/></div>
        </div>

        <div className="cc-field"><label>Description (required)</label><textarea rows={3} maxLength={2000} value={dossier.description} onChange={(e) => d("description", e.target.value)} placeholder="Describe the project, its methodology and why it is investable."/></div>
        <div className="cc-field"><label>Highlights (optional, one per line)</label><textarea rows={3} value={dossier.highlightsText} onChange={(e) => d("highlightsText", e.target.value)} placeholder={"Verified against a recognised standard\nLong-term offtake with a corporate buyer"}/></div>

        <div className="cc-field">
          <label className="cc-checkbox"><input type="checkbox" checked={modelScenarios} onChange={(e) => setModelScenarios(e.target.checked)}/> Model the outcomes (required to make the opportunity fundable)</label>
          <small>Publishing outcomes requires a funding target and a cited source URL. Probabilities must sum to exactly 100%; the full write-off case is always shown to customers.</small>
        </div>
        {modelScenarios && <div className="cc-admin-list">
          {scenarios.map((scenario, index) => <div className="cc-admin-row" key={`${scenario.outcome}-${index}`}>
            <div className="cc-admin-row-head"><strong>{carbonOutcomeLabel(scenario.outcome as any)}</strong><span className="cc-chip">{percent(toBpsFromPercent(scenario.probabilityPercent))}</span></div>
            <div className="cc-three">
              <div className="cc-field"><label>Label</label><input value={scenario.label} onChange={(e) => setScenario(index, "label", e.target.value)}/></div>
              <div className="cc-field"><label>Probability %</label><input type="number" min="0" max="100" step="0.01" value={scenario.probabilityPercent} onChange={(e) => setScenario(index, "probabilityPercent", e.target.value)}/></div>
              <div className="cc-field"><label>Duration (months)</label><input type="number" min="0" step="1" value={scenario.durationMonths} onChange={(e) => setScenario(index, "durationMonths", e.target.value)}/></div>
            </div>
            <div className="cc-two">
              <div className="cc-field"><label>Gross revenue (USD)</label><input type="number" min="0" step="0.01" value={scenario.grossRevenueUsd} onChange={(e) => setScenario(index, "grossRevenueUsd", e.target.value)}/></div>
              <div className="cc-field"><label>Funder multiple (×)</label><input type="number" min="0" step="0.01" value={scenario.funderMultiple} onChange={(e) => setScenario(index, "funderMultiple", e.target.value)}/></div>
            </div>
          </div>)}
          <div className={`cc-notice${scenarioBpsTotal === 10_000 ? " is-success" : " is-error"}`}><div>Outcome probabilities: {percent(scenarioBpsTotal)} of 100%{scenarioBpsTotal === 10_000 ? " — complete" : " — must sum to exactly 100%"}.</div></div>
        </div>}

        <div className="cc-field">
          <label className="cc-checkbox"><input type="checkbox" checked={modelMilestones} onChange={(e) => setModelMilestones(e.target.checked)}/> Model funding milestones (optional)</label>
          <small>Each milestone releases a share of the held principal. Releases must sum to exactly 100%. A milestone marked REACHED is shown to customers as achieved.</small>
        </div>
        {modelMilestones && <div className="cc-admin-list">
          {milestones.map((milestone, index) => <div className="cc-admin-row" key={`${milestone.stage}-${index}`}>
            <div className="cc-two">
              <div className="cc-field"><label>Stage</label><select value={milestone.stage} onChange={(e) => setMilestone(index, "stage", e.target.value)}>{STAGE_OPTIONS.map((value) => <option key={value} value={value}>{carbonStageLabel(value)}</option>)}</select></div>
              <div className="cc-field"><label>Label</label><input value={milestone.label} onChange={(e) => setMilestone(index, "label", e.target.value)}/></div>
            </div>
            <div className="cc-two">
              <div className="cc-field"><label>Escrow release %</label><input type="number" min="0" max="100" step="0.01" value={milestone.releasePercent} onChange={(e) => setMilestone(index, "releasePercent", e.target.value)}/></div>
              <div className="cc-field"><label>Status</label><select value={milestone.status} onChange={(e) => setMilestone(index, "status", e.target.value)}><option value="PENDING">Pending</option><option value="REACHED">Reached</option></select></div>
            </div>
          </div>)}
          <div className={`cc-notice${milestoneBpsTotal === 10_000 ? " is-success" : " is-error"}`}><div>Milestone releases: {percent(milestoneBpsTotal)} of 100%{milestoneBpsTotal === 10_000 ? " — complete" : " — must sum to exactly 100%"}.</div></div>
        </div>}

        <div className="cc-two">
          <div className="cc-field"><label>Source label (optional)</label><input value={dossier.source} onChange={(e) => d("source", e.target.value)} placeholder="e.g. Registry project page / verification report"/></div>
          <div className="cc-field"><label>Source URL {modelScenarios ? "(required when modelled)" : "(optional)"}</label><input value={dossier.sourceUrl} onChange={(e) => d("sourceUrl", e.target.value)} placeholder="https://public-source.example/opportunity"/></div>
        </div>
        <div className="cc-two">
          <div className="cc-field"><label>As-of date (optional — defaults to today)</label><input type="date" value={dossier.asOf} onChange={(e) => d("asOf", e.target.value)}/></div>
          <div className="cc-field"><label>Audit reason (optional)</label><input value={dossier.reason} onChange={(e) => d("reason", e.target.value)} placeholder="Reason recorded with this change"/></div>
        </div>

        {(scenarioErrors || milestoneErrors) && <div className="cc-notice is-error" role="alert"><AlertTriangle size={15}/><div>{scenarioErrors}{milestoneErrors}</div></div>}

        <div className="cc-admin-actions">
          <button className="cc-btn cc-btn--invest" type="button" disabled={!dossierValid || pending} onClick={submitDossier}>
            {pending ? "Saving…" : editingDossierId ? "Save changes" : "Publish opportunity"} <Check size={14}/>
          </button>
          <span className="cc-card-meta"><ShieldCheck size={13}/> New opportunities are enabled on publish. An opportunity becomes fundable once it is FUNDING status, carries a funding target and has modelled outcomes summing to 100%.</span>
        </div>
      </div>

      <div className="cc-admin-list">
        <div className="cc-section-head"><span className="cc-eyebrow">Published opportunities ({dossierRows.length}) · {fundableCount} open for investment</span></div>
        {!dossierRows.length && <div className="cc-empty"><Compass size={16}/> No carbon opportunities yet. Publish one above to open it for investment on the customer atlas.</div>}
        {dossierRows.map((row) => {
          const fundable = row.status === "FUNDING" && row.scenarios.length > 0 && row.fundingAskMinor > 0 && !row.outcome;
          return <div className="cc-admin-row" key={row.dossierId}>
            <div className="cc-admin-row-head">
              <div>
                <strong>{row.flag} {row.title}</strong>
                <div className="cc-card-meta"><span>{row.operator}</span><span>{row.territory} · {carbonSectorLabel(row.sector)}</span></div>
              </div>
              <div className="cc-dossier-tags">
                <span className="cc-chip cc-chip--type">{carbonTypeLabel(row.creditType)}</span>
                <span className="cc-chip cc-chip--standard">{row.standard ? carbonStandardLabel(row.standard) : "Unverified"}</span>
                <span className="cc-chip">{carbonRegionLabel(carbonRegionOf(row.countryCode))}</span>
                {row.riskGrade && <span className={`cc-chip cc-chip--risk-${String(row.riskGrade).toLowerCase()}`}>{carbonRiskLabel(row.riskGrade)}</span>}
                <span className={`cc-chip cc-chip--status-${String(row.status).toLowerCase()}`}>{carbonStatusLabel(row.status)}</span>
                <span className="cc-chip">{carbonStageLabel(row.stage)}</span>
                <span className="cc-chip">{row.enabled ? "Enabled" : "Disabled"}</span>
              </div>
            </div>
            <div className="cc-card-meta">
              <span>Target {money(row.fundingAskMinor)} · committed {money(row.committedMinor)}</span>
              <span>Distributed {money(row.distributedMinor)}</span>
              <span>Issuance {tonnes(row.creditVolumeTonnes)}{row.pricePerTonneMinor ? ` · ${money(row.pricePerTonneMinor)}/t` : ""}</span>
              <span>Expected {multiple(row.expectedMultipleBps)}{row.expectedDurationMonths ? ` · ${row.expectedDurationMonths}mo` : ""}</span>
              {row.revenueSharesBps !== null && row.revenueSharesBps !== undefined && <span>Revenue share {percent(row.revenueSharesBps)}</span>}
              {row.eventDate ? <span>Validation {row.eventDate}</span> : null}
              <span>{row.scenarios.length ? `${row.scenarios.length} outcomes` : "Not modelled"}</span>
              {row.outcome && <span className="cc-chip">Outcome {carbonOutcomeLabel(row.outcome)}</span>}
              <span>As of {row.asOf}</span>
              <span>ID {row.dossierId}</span>
            </div>
            {row.scenarios.length > 0 && <div className="cc-scenarios">{row.scenarios.map((scenario: any, index: number) => <div className={`cc-scenario cc-scenario--${String(scenario.outcome).toLowerCase()}`} key={`${scenario.outcome}-${index}`}><span className="cc-scenario-head">{scenario.label}</span><span>{percent(scenario.probabilityBps)} · {money(scenario.grossRevenueMinor)} gross · {scenario.durationMonths}mo · {multiple(scenario.funderMultipleBps)}</span></div>)}</div>}

            <div className="cc-admin-actions">
              <button className="cc-btn cc-btn--ghost cc-btn--sm" type="button" disabled={Boolean(row.outcome)} onClick={() => beginEditDossier(row)}>Edit</button>
              <button className="cc-btn cc-btn--ghost cc-btn--sm" type="button" disabled={toggleDossier.isPending} onClick={() => toggleDossier.mutate({ dossierId: row.dossierId, enabled: !row.enabled })}>{row.enabled ? "Disable" : "Enable"}</button>
              <select value="" aria-label="Set status" disabled={setStatus.isPending} onChange={(e) => { if (e.target.value) setStatus.mutate({ dossierId: row.dossierId, status: e.target.value as any, reason: "Administrator status change" }); }}>
                <option value="">Set status…</option>
                {STATUS_OPTIONS.filter((value) => value !== row.status).map((value) => <option key={value} value={value}>{carbonStatusLabel(value)}</option>)}
              </select>
              <select value="" aria-label="Reach milestone" disabled={reachMilestone.isPending} onChange={(e) => { if (e.target.value) reachMilestone.mutate({ dossierId: row.dossierId, stage: e.target.value as any, reason: "Administrator milestone" }); }}>
                <option value="">Reach milestone…</option>
                {STAGE_OPTIONS.filter((value) => value !== row.stage).map((value) => <option key={value} value={value}>{carbonStageLabel(value)}</option>)}
              </select>
              <button className="cc-btn cc-btn--danger cc-btn--sm" type="button" disabled={deleteDossier.isPending || row.committedMinor > 0} onClick={() => { if (window.confirm(`Delete opportunity “${row.title}”? It is removed from the customer atlas.`)) deleteDossier.mutate({ dossierId: row.dossierId }); }}><Trash2 size={13}/> Delete</button>
            </div>
            {!fundable && !row.outcome && row.scenarios.length > 0 && <div className="cc-reference-note"><AlertTriangle size={13}/> Not currently fundable — status is {carbonStatusLabel(row.status)} or the funding target is unset.</div>}
            {!row.scenarios.length && <div className="cc-reference-note"><AlertTriangle size={13}/> Not modelled — customers can still invest, but the funding progress and the settlement multiple stay unset until the outcomes and a funding target are published with a cited source.</div>}
          </div>;
        })}
      </div>
    </div>}

    {tab === "distributions" && <div className="cc-admin">
      <div className="cc-admin-list">
        <div className="cc-section-head"><div><span className="cc-eyebrow cc-eyebrow--teal">Record distributions ({openInstrumentRows.length}) · {money(openCommittedMinor)} committed</span><h2>Credit a carbon revenue distribution</h2></div></div>
        <div className="cc-notice">
          <Coins size={15}/>
          <div>The amount you record is split pro-rata across every open position on the opportunity by its principal and credited to each funder's settlement wallet as a withdrawable internal-ledger entry. Principal stays held during the term. It is idempotent per submit, and historical entries are never edited.</div>
        </div>
        {!openInstrumentRows.length && <div className="cc-empty"><Coins size={16}/> No opportunities carry open commitments right now. Funded opportunities appear here for distributions.</div>}
        {openInstrumentRows.map((row) => {
          const form = distributionFormFor(row);
          const previewMinor = toMinor(form.amountUsd) ?? 0;
          return <div className="cc-admin-row" key={row.instrumentId}>
            <div className="cc-admin-row-head">
              <div><strong>{row.instrumentName}</strong><div className="cc-card-meta"><span className="cc-mono">{row.creditType ? carbonTypeLabel(row.creditType) : "Carbon"}{row.standard ? ` · ${carbonStandardLabel(row.standard)}` : ""} · {row.instrumentId}</span></div></div>
              <div className="cc-dossier-tags"><span className="cc-chip">{row.openPositions} open position{row.openPositions === 1 ? "" : "s"}</span><span className="cc-chip">{money(row.committedMinor)} committed</span></div>
            </div>
            <div className="cc-two">
              <div className="cc-field"><label>Distribution amount ({row.currency || "USD"})</label><input type="number" min="0" step="0.01" value={form.amountUsd} onChange={(e) => setDistributionForm(row, "amountUsd", e.target.value)} placeholder="e.g. 12000"/></div>
              <div className="cc-field"><label>Note (optional)</label><input value={form.note} onChange={(e) => setDistributionForm(row, "note", e.target.value)} placeholder="e.g. Q1 issuance statement"/></div>
            </div>
            <div className="cc-card-meta"><span>Preview {money(previewMinor)} split pro-rata across {row.openPositions} position(s)</span></div>
            <div className="cc-admin-actions">
              <button className="cc-btn cc-btn--invest" type="button" disabled={recordDistribution.isPending || previewMinor <= 0} onClick={() => runDistribution(row)}>
                {recordDistribution.isPending ? "Recording…" : `Record ${money(previewMinor)} distribution`} <Check size={14}/>
              </button>
            </div>
          </div>;
        })}
      </div>
    </div>}

    {tab === "settle" && <div className="cc-admin">
      <div className="cc-admin-list">
        <div className="cc-section-head"><div><span className="cc-eyebrow cc-eyebrow--teal">Settle &amp; write off ({openInstrumentRows.length}) · {money(openCommittedMinor)} committed</span><h2>Resolve a funded carbon opportunity</h2></div></div>
        <div className="cc-notice">
          <AlertTriangle size={15}/>
          <div>Choose the outcome and the completion multiple here to release held principal and pay or write off every open position. A high-issuance or on-plan outcome pays principal × the multiple you set; a write-off pays nothing and releases the lock without fabricating a credit. Payouts and write-offs are internal-ledger compensating entries and are never edited. This cannot be undone.</div>
        </div>
        {!openInstrumentRows.length && <div className="cc-empty"><BadgePercent size={16}/> No opportunities carry open commitments right now. Funded opportunities appear here for settlement.</div>}
        {openInstrumentRows.map((row) => {
          const form = settleFormFor(row);
          const payoutPreview = form.outcome === "WRITE_OFF" ? 0 : Math.round((Number(row.committedMinor || 0) * toBpsFromPercent(form.multiplePercent)) / 10_000);
          return <div className="cc-admin-row" key={row.instrumentId}>
            <div className="cc-admin-row-head">
              <div><strong>{row.instrumentName}</strong><div className="cc-card-meta"><span className="cc-mono">{row.creditType ? carbonTypeLabel(row.creditType) : "Carbon"}{row.standard ? ` · ${carbonStandardLabel(row.standard)}` : ""} · {row.instrumentId}</span></div></div>
              <div className="cc-dossier-tags"><span className="cc-chip">{row.openPositions} open position{row.openPositions === 1 ? "" : "s"}</span><span className="cc-chip">{money(row.committedMinor)} committed</span></div>
            </div>
            <div className="cc-two">
              <div className="cc-field"><label>Outcome</label>
                <select value={form.outcome} onChange={(e) => setSettleForm(row, "outcome", e.target.value)}>
                  {CARBON_OUTCOMES.map((value) => <option key={value} value={value}>{carbonOutcomeLabel(value)}</option>)}
                </select>
              </div>
              <div className="cc-field"><label>Completion multiple (%)</label>
                <input type="number" min="0" step="1" value={form.multiplePercent} disabled={form.outcome === "WRITE_OFF"} onChange={(e) => setSettleForm(row, "multiplePercent", e.target.value)}/>
                <small>{form.outcome === "WRITE_OFF" ? "A write-off pays nothing; every principal is written off." : `Funders receive principal × ${multiple(toBpsFromPercent(form.multiplePercent))}.`}</small>
              </div>
            </div>
            <div className="cc-field"><label>Reason (optional)</label><input value={form.reason} onChange={(e) => setSettleForm(row, "reason", e.target.value)} placeholder="e.g. Issuance completed at 1.80x on 2027-09-01"/></div>
            <div className="cc-card-meta">
              <span>Payout preview {money(payoutPreview)} of {money(row.committedMinor)} committed</span>
              {form.outcome === "WRITE_OFF" && <span>{money(row.committedMinor)} written off</span>}
            </div>
            <div className="cc-admin-actions">
              <button className="cc-btn cc-btn--invest" type="button" disabled={settleInstrument.isPending} onClick={() => runSettle(row)}>
                {settleInstrument.isPending ? "Settling…" : `Settle as ${carbonOutcomeLabel(form.outcome as any)} at ${form.outcome === "WRITE_OFF" ? "0.00x" : multiple(toBpsFromPercent(form.multiplePercent))}`} <Check size={14}/>
              </button>
            </div>
          </div>;
        })}
      </div>
    </div>}

    {tab === "economics" && <div className="cc-admin">
      <div className="cc-admin-list">
        <div className="cc-section-head"><div><span className="cc-eyebrow cc-eyebrow--teal">Auto-assigned economics ({economicsIds.length})</span><h2>Amount, profit, term, currency &amp; platform fee</h2></div></div>
        <div className="cc-notice">
          <Gauge size={15}/>
          <div>Every opportunity gets a deterministic economic profile the moment it appears on the customer desk — an investable amount from {money(ECONOMICS_BOUNDS.ticketMinMinorUsd)}, a {percent(ECONOMICS_BOUNDS.profitMinBps)}–{percent(ECONOMICS_BOUNDS.profitMaxBps)} profit, a term of {ECONOMICS_BOUNDS.termMinDays}–{ECONOMICS_BOUNDS.termMaxDays} days, a presentation currency and a {percent(ECONOMICS_BOUNDS.platformFeeMinBps)}–{percent(ECONOMICS_BOUNDS.platformFeeMaxBps)} platform fee. Override any value here; a saved profile is marked administrator-authored and is never re-rolled automatically.</div>
        </div>
        {!economicsIds.length && <div className="cc-empty"><Gauge size={16}/> No opportunities to profile yet. Publish an opportunity and its economic profile appears here.</div>}
        {economicsIds.map((id) => {
          const form = econFormFor(id);
          const profile = econById.get(id);
          const scale = econScale(form.currency);
          const ticketMinor = toMinorScaled(form.ticketMin, scale);
          const targetMinor = toMinorScaled(form.fundingTarget, scale);
          return <div className="cc-admin-row" key={id}>
            <div className="cc-admin-row-head">
              <div><strong>{econNameFor(id)}</strong><div className="cc-card-meta"><span className="cc-mono">{id}</span></div></div>
              <div className="cc-dossier-tags">
                <span className="cc-chip">{profile?.source === "ADMIN" ? "Administrator profile" : "Auto-assigned"}</span>
                {profile?.currency && <span className="cc-chip">{profile.currency}</span>}
              </div>
            </div>
            <div className="cc-two">
              <div className="cc-field"><label>Presentation currency</label>
                <select value={form.currency} onChange={(e) => setEconForm(id, "currency", e.target.value)}>
                  {INVESTMENT_CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
                </select>
                <small>USD is the dominant choice; the others are for display.</small>
              </div>
              <div className="cc-field"><label>Minimum ticket</label>
                <input type="number" min="0" step="1" value={form.ticketMin} onChange={(e) => setEconForm(id, "ticketMin", e.target.value)}/>
                <small>{ticketMinor !== null ? `${money(currencyMinorToUsdMinor(ticketMinor, form.currency))} USD equivalent · ${scale} decimal place${scale === 1 ? "" : "s"}` : `Enter the amount in ${form.currency}`}</small>
              </div>
            </div>
            <div className="cc-two">
              <div className="cc-field"><label>Funding target</label>
                <input type="number" min="0" step="1" value={form.fundingTarget} onChange={(e) => setEconForm(id, "fundingTarget", e.target.value)}/>
                <small>{targetMinor !== null ? `${money(currencyMinorToUsdMinor(targetMinor, form.currency))} USD equivalent` : "The capital target"}</small>
              </div>
              <div className="cc-field"><label>Profit (%)</label>
                <input type="number" min="25" max="38" step="0.25" value={form.profitPercent} onChange={(e) => setEconForm(id, "profitPercent", e.target.value)}/>
                <small>Between {percent(ECONOMICS_BOUNDS.profitMinBps)} and {percent(ECONOMICS_BOUNDS.profitMaxBps)}.</small>
              </div>
            </div>
            <div className="cc-two">
              <div className="cc-field"><label>Term (days)</label>
                <input type="number" min="30" max="365" step="1" value={form.termDays} onChange={(e) => setEconForm(id, "termDays", e.target.value)}/>
                <small>Days from funding close to realising the profit ({ECONOMICS_BOUNDS.termMinDays}–{ECONOMICS_BOUNDS.termMaxDays}).</small>
              </div>
              <div className="cc-field"><label>Platform fee (%)</label>
                <input type="number" min="7" max="10" step="0.25" value={form.platformFeePercent} onChange={(e) => setEconForm(id, "platformFeePercent", e.target.value)}/>
                <small>Between {percent(ECONOMICS_BOUNDS.platformFeeMinBps)} and {percent(ECONOMICS_BOUNDS.platformFeeMaxBps)}.</small>
              </div>
            </div>
            <div className="cc-two">
              <div className="cc-field"><label>Investment closes</label>
                <input type="date" value={form.closeDate} onChange={(e) => setEconForm(id, "closeDate", e.target.value)}/>
              </div>
              <div className="cc-field"><label>Profit realised</label>
                <input type="date" value={form.maturityDate} onChange={(e) => setEconForm(id, "maturityDate", e.target.value)}/>
              </div>
            </div>
            <div className="cc-field"><label>System settlement delay (days — blank for none)</label>
              <input type="number" min="0" max="365" step="1" value={form.settlementDelay} onChange={(e) => setEconForm(id, "settlementDelay", e.target.value)} placeholder="e.g. 5"/>
              <small>A bolt-on delay applied to some opportunities only, so a delayed payout reads as a real exception.</small>
            </div>
            <div className="cc-admin-actions">
              <button className="cc-btn cc-btn--invest" type="button" disabled={saveEconomics.isPending} onClick={() => runSaveEconomics(id)}>
                {saveEconomics.isPending ? "Saving…" : "Save economic profile"} <Check size={14}/>
              </button>
              <button className="cc-btn cc-btn--ghost" type="button" disabled={reassignEconomics.isPending} onClick={() => runReassignEconomics(id)}>
                <RefreshCw size={14}/> Re-roll auto profile
              </button>
            </div>
          </div>;
        })}
      </div>
    </div>}

    <div className="cc-notice">
      <ShieldCheck size={15}/>
      <div>This console writes the carbon opportunity dossiers, records distributions and settles funded opportunities to the platform database. This desk is carbon-only — IP royalties, NFTs, music royalties, green energy and agro investment belong to their own menus and are excluded here. The discovery layer surfaces real, cited public carbon sources (the keyless Eurostat and World Bank feeds), but those references are never fundable: only an administrator-published dossier with sourced economics is open for investment. Every change is audited, publishing outcomes requires a funding target with a cited source URL and a 100% probability split, and no carbon economics figure is ever invented here.</div>
    </div>
  </div>;
}
