import { useMemo, useState } from "react";
import {
  AlertTriangle, BadgePercent, Check, Coins, RefreshCw, ScrollText, ShieldCheck, Sprout, Trash2,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { COUNTRY_OPTIONS, flagFor } from "@shared/country-options";
import {
  AGRO_DOSSIER_STATUSES,
  AGRO_OUTCOMES,
  AGRO_RISK_GRADES,
  AGRO_SECTORS,
  AGRO_STAGES,
  AGRO_TERRITORY_BANDS,
  AGRO_TYPE_GROUPS,
  agroTypeLabel,
  defaultAgroMilestones,
  outcomeLabel,
  riskGradeLabel,
  sectorLabel,
  stageLabel,
  statusLabel,
  territoryBandLabel,
  type AgroInvestmentType,
  type AgroStage,
} from "@shared/agro-investment-catalogue";
import "./agro-investment.css";

const RISK_OPTIONS = AGRO_RISK_GRADES;
const STATUS_OPTIONS = AGRO_DOSSIER_STATUSES;
const STAGE_OPTIONS = AGRO_STAGES;

/**
 * Neutral template scenarios. Public sources publish agriculture context but no
 * deal economics, so an administrator must model the three outcomes by hand;
 * this template is only a starting point and probabilities must sum to 100%.
 */
const TEMPLATE_SCENARIOS = [
  { outcome: "STRONG_SEASON", label: "Strong season", probabilityPercent: "30", grossRevenueUsd: "", durationMonths: "18", funderMultiple: "2.20" },
  { outcome: "ON_PLAN", label: "On plan", probabilityPercent: "50", grossRevenueUsd: "", durationMonths: "18", funderMultiple: "1.20" },
  { outcome: "WRITE_OFF", label: "Write-off", probabilityPercent: "20", grossRevenueUsd: "", durationMonths: "18", funderMultiple: "0.00" },
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

/** Agriculture types, grouped into the desk's four lanes for the type picker. */
function AgroTypeOptions() {
  return <>{AGRO_TYPE_GROUPS.map((group) => <optgroup label={group.label} key={group.label}>
    {group.types.map((value) => <option key={value} value={value}>{agroTypeLabel(value)}</option>)}
  </optgroup>)}</>;
}

type DossierForm = {
  title: string; operator: string; agroType: string; sector: string; offtaker: string;
  countryCode: string; territory: string; territoryBand: string; dealType: string;
  description: string; revenueSharesPercent: string; expectedMultiple: string; expectedDurationMonths: string;
  projectedRevenueUsd: string; capitalAtRiskUsd: string; fundingAskUsd: string;
  minimumInvestmentUsd: string; unitPriceUsd: string; eventDate: string; fundingDeadline: string;
  stage: string; status: string; riskGrade: string; highlightsText: string;
  source: string; sourceUrl: string; asOf: string; reason: string;
};

const emptyDossier = (): DossierForm => ({
  title: "", operator: "", agroType: "ROW_CROP", sector: "GRAINS", offtaker: "",
  countryCode: "US", territory: "", territoryBand: "NATIONAL", dealType: "",
  description: "", revenueSharesPercent: "", expectedMultiple: "", expectedDurationMonths: "",
  projectedRevenueUsd: "", capitalAtRiskUsd: "", fundingAskUsd: "",
  minimumInvestmentUsd: "", unitPriceUsd: "", eventDate: "", fundingDeadline: "",
  stage: "FUNDING", status: "FUNDING", riskGrade: "", highlightsText: "",
  source: "", sourceUrl: "", asOf: "", reason: "",
});

type ScenarioForm = { outcome: string; label: string; probabilityPercent: string; grossRevenueUsd: string; durationMonths: string; funderMultiple: string };
type MilestoneForm = { stage: string; label: string; releasePercent: string; status: string };

/**
 * Administrator console for the Agro Investment desk. This desk is
 * agriculture-only: an administrator posts a new agriculture opportunity — row
 * crops, orchard & vineyard, livestock, dairy, poultry, aquaculture, greenhouse,
 * farmland, irrigation & water, farm machinery, storage & logistics, agri
 * inputs, agritech or processing — by selecting its type and publishing the
 * sourced economics. This console is the primary source of investable
 * opportunities, and it also records revenue distributions against funded
 * opportunities and settles or writes them off.
 */
export function AdminAgroInvestment() {
  const utils = trpc.useUtils();
  const dossiersQuery = trpc.adminOperations.agroDossiers.useQuery(undefined, { refetchInterval: 20000 });
  const openInstrumentsQuery = trpc.adminOperations.agroOpenInstruments.useQuery(undefined, { refetchInterval: 20000 });

  const [tab, setTab] = useState<"dossiers" | "distributions" | "settle">("dossiers");
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
    defaultAgroMilestones().map((item) => ({ stage: item.stage, label: item.label, releasePercent: String(item.releaseBps / 100), status: item.status })));

  const report = (kind: "success" | "error", text: string) => { setMessageKind(kind); setMessage(text); };
  const onError = (error: { message: string }) => report("error", error.message);
  const invalidate = () => {
    void utils.adminOperations.agroDossiers.invalidate();
    void utils.adminOperations.agroOpenInstruments.invalidate();
    void utils.customer.agroInvestment.market.invalidate();
  };

  const createDossier = trpc.adminOperations.createAgroDossier.useMutation({ onSuccess: (row: any) => { resetDossierForm(); invalidate(); report("success", `Published opportunity ${row.dossierId} “${row.title}”.`); }, onError });
  const updateDossier = trpc.adminOperations.updateAgroDossier.useMutation({ onSuccess: (row: any) => { resetDossierForm(); invalidate(); report("success", `Updated opportunity ${row.dossierId}.`); }, onError });
  const toggleDossier = trpc.adminOperations.setAgroDossierEnabled.useMutation({ onSuccess: (row: any) => { invalidate(); report("success", `${row.title} is now ${row.enabled ? "enabled on" : "disabled from"} the customer desk.`); }, onError });
  const setStatus = trpc.adminOperations.setAgroDossierStatus.useMutation({ onSuccess: (row: any) => { invalidate(); report("success", `${row.title} status set to ${statusLabel(row.status)}.`); }, onError });
  const reachMilestone = trpc.adminOperations.reachAgroMilestone.useMutation({ onSuccess: (row: any) => { invalidate(); report("success", `${row.title} advanced to ${stageLabel(row.stage)}.`); }, onError });
  const deleteDossier = trpc.adminOperations.deleteAgroDossier.useMutation({ onSuccess: (result: any) => { invalidate(); report("success", `Deleted ${result.dossierId}.`); }, onError });

  const recordDistribution = trpc.adminOperations.recordAgroDistribution.useMutation({
    onSuccess: (result: any) => {
      setDistributionForms((current) => { const next = { ...current }; delete next[result.instrumentId]; return next; });
      invalidate();
      report("success", `Distribution recorded on “${result.instrumentName}”: ${money(result.creditedMinor)} split across ${result.positions} open position(s).`);
    },
    onError,
  });
  const settleInstrument = trpc.adminOperations.settleAgroInstrument.useMutation({
    onSuccess: (result: any) => {
      setSettleForms((current) => { const next = { ...current }; delete next[result.instrumentId]; return next; });
      invalidate();
      report("success", `Settled “${result.instrumentName}” as ${outcomeLabel(result.outcome)} at ${multiple(result.funderMultipleBps)}: ${money(result.paidMinor)} paid, ${money(result.writtenOffMinor)} written off.`);
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
    setMilestones(defaultAgroMilestones().map((item) => ({ stage: item.stage, label: item.label, releasePercent: String(item.releaseBps / 100), status: item.status })));
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
    && /^\d{4}-\d{2}-\d{2}$/.test(dossier.asOf.trim())
    && !scenarioErrors
    && !milestoneErrors;

  const buildDossierPayload = () => {
    const payload: any = {
      title: dossier.title.trim(),
      operator: dossier.operator.trim(),
      agroType: dossier.agroType,
      sector: dossier.sector,
      countryCode: dossier.countryCode.toUpperCase(),
      stage: dossier.stage,
      status: dossier.status,
      description: dossier.description.trim(),
      highlights: lines(dossier.highlightsText, 12),
      asOf: dossier.asOf.trim(),
    };
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
    if (dossier.minimumInvestmentUsd.trim()) payload.minimumInvestmentMinor = toMinor(dossier.minimumInvestmentUsd);
    if (dossier.unitPriceUsd.trim()) payload.unitPriceMinor = toMinor(dossier.unitPriceUsd);
    if (dossier.eventDate.trim()) payload.eventDate = dossier.eventDate.trim();
    if (dossier.fundingDeadline.trim()) payload.fundingDeadline = dossier.fundingDeadline.trim();
    if (dossier.riskGrade) payload.riskGrade = dossier.riskGrade;
    if (dossier.source.trim()) payload.source = dossier.source.trim();
    if (dossier.sourceUrl.trim()) payload.sourceUrl = dossier.sourceUrl.trim();
    if (dossier.reason.trim()) payload.reason = dossier.reason.trim();
    if (modelScenarios) {
      payload.scenarios = scenarios.map((item) => ({
        outcome: item.outcome,
        label: item.label.trim() || outcomeLabel(item.outcome as any),
        probabilityBps: toBpsFromPercent(item.probabilityPercent),
        grossRevenueMinor: toMinor(item.grossRevenueUsd) ?? 0,
        durationMonths: toInt(item.durationMonths) ?? 0,
        funderMultipleBps: Math.round((Number(item.funderMultiple) || 0) * 10_000),
      }));
    }
    if (modelMilestones) {
      payload.milestones = milestones.map((item, index) => ({
        stage: item.stage,
        label: item.label.trim() || stageLabel(item.stage as AgroStage),
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
      title: row.title || "", operator: row.operator || "", agroType: row.agroType || "ROW_CROP", sector: row.sector || "GRAINS",
      offtaker: row.offtaker || "", countryCode: row.countryCode || "US", territory: row.territory || "",
      territoryBand: row.territoryBand || "NATIONAL", dealType: row.dealType || "",
      description: row.description || "", revenueSharesPercent: fromBpsToPercent(row.revenueSharesBps),
      expectedMultiple: row.expectedMultipleBps === null || row.expectedMultipleBps === undefined ? "" : String(Number(row.expectedMultipleBps) / 10_000),
      expectedDurationMonths: row.expectedDurationMonths === null || row.expectedDurationMonths === undefined ? "" : String(row.expectedDurationMonths),
      projectedRevenueUsd: fromMinor(row.projectedRevenueMinor), capitalAtRiskUsd: fromMinor(row.capitalAtRiskMinor),
      fundingAskUsd: fromMinor(row.fundingAskMinor), minimumInvestmentUsd: fromMinor(row.minimumInvestmentMinor),
      unitPriceUsd: fromMinor(row.unitPriceMinor), eventDate: row.eventDate || "", fundingDeadline: row.fundingDeadline || "",
      stage: row.stage || "FUNDING", status: row.status || "FUNDING", riskGrade: row.riskGrade || "",
      highlightsText: Array.isArray(row.highlights) ? row.highlights.join("\n") : "",
      source: row.source || "", sourceUrl: row.sourceUrl || "", asOf: row.asOf || "", reason: "",
    });
    if (Array.isArray(row.scenarios) && row.scenarios.length) {
      setModelScenarios(true);
      setScenarios(TEMPLATE_SCENARIOS.map((template) => {
        const match = row.scenarios.find((item: any) => item.outcome === template.outcome) || row.scenarios.shift?.();
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
    // Preserve any reachedAt on milestones being edited.
    if (Array.isArray(row.milestones) && row.milestones.length) {
      setModelMilestones(true);
      setMilestones(row.milestones.map((item: any) => ({
        stage: item.stage,
        label: item.label || stageLabel(item.stage),
        releasePercent: String(Number(item.releaseBps || 0) / 100),
        status: item.status === "REACHED" ? "REACHED" : "PENDING",
        ...(item.reachedAt ? { reachedAt: item.reachedAt } : {}),
      })) as MilestoneForm[]);
    } else {
      setModelMilestones(false);
      setMilestones(defaultAgroMilestones().map((item) => ({ stage: item.stage, label: item.label, releasePercent: String(item.releaseBps / 100), status: item.status })));
    }
  };

  const dossierRows: any[] = dossiersQuery.data || [];
  const openInstrumentRows: any[] = openInstrumentsQuery.data || [];
  const fundableCount = useMemo(() => dossierRows.filter((row) => row.status === "FUNDING" && row.scenarios.length > 0 && row.fundingAskMinor > 0 && !row.outcome).length, [dossierRows]);
  const cropsAndLandCount = useMemo(() => dossierRows.filter((row) => ["ROW_CROP", "ORCHARD_VINEYARD", "GREENHOUSE", "FARMLAND"].includes(row.agroType)).length, [dossierRows]);
  const openCommittedMinor = useMemo(() => openInstrumentRows.reduce((sum, row) => sum + Number(row.committedMinor || 0), 0), [openInstrumentRows]);

  const distributionFormFor = (row: any) => distributionForms[row.instrumentId] || { amountUsd: "", note: "" };
  const setDistributionForm = (row: any, key: "amountUsd" | "note", value: string) => setDistributionForms((current) => ({ ...current, [row.instrumentId]: { ...(current[row.instrumentId] || { amountUsd: "", note: "" }), [key]: value } }));
  const runDistribution = (row: any) => {
    const form = distributionFormFor(row);
    const amountMinor = toMinor(form.amountUsd) ?? 0;
    if (amountMinor <= 0) { report("error", "Enter a distribution amount above zero."); return; }
    recordDistribution.mutate({ instrumentId: row.instrumentId, amountMinor, note: form.note.trim() || undefined, idempotencyKey: crypto.randomUUID() });
  };

  const settleFormFor = (row: any) => settleForms[row.instrumentId] || { outcome: "STRONG_SEASON", multiplePercent: "180", reason: "" };
  const setSettleForm = (row: any, key: "outcome" | "multiplePercent" | "reason", value: string) => setSettleForms((current) => ({ ...current, [row.instrumentId]: { ...(current[row.instrumentId] || { outcome: "STRONG_SEASON", multiplePercent: "180", reason: "" }), [key]: value } }));
  const runSettle = (row: any) => {
    const form = settleFormFor(row);
    const funderMultipleBps = form.outcome === "WRITE_OFF" ? 0 : toBpsFromPercent(form.multiplePercent);
    if (form.outcome !== "WRITE_OFF" && funderMultipleBps <= 0) { report("error", "Set a completion multiple above 0.00x for a strong season or on-plan outcome."); return; }
    const confirmText = `Settle “${row.instrumentName}” as ${outcomeLabel(form.outcome as any)} at ${form.outcome === "WRITE_OFF" ? "0.00x" : multiple(funderMultipleBps)}? This releases locked principal and pays or writes off all ${row.openPositions} open position(s) across ${money(row.committedMinor)} committed. It cannot be undone.`;
    if (!window.confirm(confirmText)) return;
    settleInstrument.mutate({ instrumentId: row.instrumentId, outcome: form.outcome as any, funderMultipleBps, reason: form.reason.trim() || "Administrator settlement" });
  };

  return <div className="arb-page portal-page ag-page">
    <header className="ag-hero" aria-label="Agro Investment console">
      <div className="ag-hero-glow" aria-hidden="true" />
      <div className="ag-masthead">
        <div className="ag-masthead-lead">
          <span className="ag-eyebrow ag-eyebrow--gold">Agro investment · Opportunity publishing</span>
          <h1 className="ag-title">Agro Investment console</h1>
          <p className="ag-lede">Post a new agriculture opportunity by selecting its type and publishing the sourced economics — the operator or agribusiness, the deal type, the funding target, the modelled outcomes and the season window — as a dossier. This desk is agriculture-only, so this console is the primary source of investable opportunities customers can see. Record revenue distributions, advance a milestone, or settle a funded opportunity here.</p>
        </div>
        <div className="ag-masthead-side">
          <button className="ag-btn ag-btn--ghost ag-btn--sm" type="button" onClick={() => { void dossiersQuery.refetch(); void openInstrumentsQuery.refetch(); }} disabled={dossiersQuery.isFetching || openInstrumentsQuery.isFetching}>
            <RefreshCw size={14} className={dossiersQuery.isFetching ? "spin" : ""}/> Refresh
          </button>
        </div>
      </div>
      <div className="ag-figures">
        <div className="ag-figure ag-figure--green"><b>{dossierRows.length}</b><span>Published opportunities</span></div>
        <div className="ag-figure ag-figure--gold"><b>{cropsAndLandCount}</b><span>Crops &amp; land</span></div>
        <div className="ag-figure ag-figure--blue"><b>{fundableCount}</b><span>Open for investment</span></div>
        <div className="ag-figure ag-figure--red"><b>{money(openCommittedMinor)}</b><span>Open commitments</span></div>
      </div>
    </header>

    {message && <div className={`ag-notice${messageKind === "error" ? " is-error" : " is-success"}`} role={messageKind === "error" ? "alert" : "status"} aria-live="polite">
      <ShieldCheck size={15}/><div>{message}</div>
    </div>}

    <nav className="ag-tabs" aria-label="Agro Investment console sections">
      <button type="button" className={`ag-tab${tab === "dossiers" ? " is-active" : ""}`} onClick={() => setTab("dossiers")}><ScrollText size={14}/> Opportunities <span className="ag-tab-count">{dossierRows.length}</span></button>
      <button type="button" className={`ag-tab${tab === "distributions" ? " is-active" : ""}`} onClick={() => setTab("distributions")}><Coins size={14}/> Record distributions <span className="ag-tab-count">{openInstrumentRows.length}</span></button>
      <button type="button" className={`ag-tab${tab === "settle" ? " is-active" : ""}`} onClick={() => setTab("settle")}><BadgePercent size={14}/> Settle &amp; write off <span className="ag-tab-count">{openInstrumentRows.length}</span></button>
    </nav>

    {tab === "dossiers" && <div className="ag-admin">
      <div className="ag-admin-form">
        <div className="ag-section-head"><div><span className="ag-eyebrow ag-eyebrow--gold">{editingDossierId ? "Edit opportunity" : "Publish opportunity"}</span><h2>{editingDossierId ? editingDossierId : "New agriculture opportunity"}</h2></div>{editingDossierId && <button className="ag-btn ag-btn--ghost ag-btn--sm" type="button" onClick={resetDossierForm}>Cancel edit</button>}</div>

        <div className="ag-two">
          <div className="ag-field"><label>Opportunity title</label><input value={dossier.title} onChange={(e) => d("title", e.target.value)} placeholder="e.g. Rift Valley irrigated maize — 2027 season"/></div>
          <div className="ag-field"><label>Agriculture investment type</label><select value={dossier.agroType} onChange={(e) => d("agroType", e.target.value)}><AgroTypeOptions/></select><small>Pick the type: row crops, orchard &amp; vineyard, livestock, dairy, poultry, aquaculture, greenhouse, farmland, irrigation, machinery, storage &amp; logistics, agri inputs, agritech or processing.</small></div>
        </div>
        <div className="ag-two">
          <div className="ag-field"><label>Operator / farm / cooperative / agribusiness</label><input value={dossier.operator} onChange={(e) => d("operator", e.target.value)} placeholder="Who the opportunity is for"/></div>
          <div className="ag-field"><label>Sector</label><select value={dossier.sector} onChange={(e) => d("sector", e.target.value)}>{AGRO_SECTORS.map((value) => <option key={value} value={value}>{sectorLabel(value)}</option>)}</select></div>
        </div>
        <div className="ag-two">
          <div className="ag-field"><label>Off-taker / buyer (optional)</label><input value={dossier.offtaker} onChange={(e) => d("offtaker", e.target.value)} placeholder="e.g. Regional grain cooperative"/></div>
          <div className="ag-field"><label>Deal type (optional)</label><input value={dossier.dealType} onChange={(e) => d("dealType", e.target.value)} placeholder="e.g. Revenue share, equity, recoupable advance"/></div>
        </div>
        <div className="ag-two">
          <div className="ag-field"><label>Country</label>
            <select value={dossier.countryCode} onChange={(e) => d("countryCode", e.target.value)}>
              {COUNTRY_OPTIONS.map((country) => <option key={country.code} value={country.code}>{flagFor(country.code)} {country.name} ({country.code})</option>)}
            </select>
            <small>The flag is derived from this: <strong>{flagFor(dossier.countryCode)}</strong></small>
          </div>
          <div className="ag-field"><label>Territory band</label><select value={dossier.territoryBand} onChange={(e) => d("territoryBand", e.target.value)}>{AGRO_TERRITORY_BANDS.map((value) => <option key={value} value={value}>{territoryBandLabel(value)}</option>)}</select></div>
        </div>
        <div className="ag-field"><label>Territory label (optional)</label><input value={dossier.territory} onChange={(e) => d("territory", e.target.value)} placeholder="Defaults to the country name · e.g. East Africa"/></div>

        <div className="ag-two">
          <div className="ag-field"><label>Lifecycle stage</label><select value={dossier.stage} onChange={(e) => d("stage", e.target.value)}>{STAGE_OPTIONS.map((value) => <option key={value} value={value}>{stageLabel(value)}</option>)}</select></div>
          <div className="ag-field"><label>Status</label><select value={dossier.status} onChange={(e) => d("status", e.target.value)}>{STATUS_OPTIONS.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</select></div>
        </div>
        <div className="ag-two">
          <div className="ag-field"><label>Risk grade</label><select value={dossier.riskGrade} onChange={(e) => d("riskGrade", e.target.value)}><option value="">Not graded</option>{RISK_OPTIONS.map((value) => <option key={value} value={value}>{riskGradeLabel(value)}</option>)}</select></div>
          <div className="ag-field"><label>Investor revenue share (%)</label><input type="number" min="0" max="100" step="0.01" value={dossier.revenueSharesPercent} onChange={(e) => d("revenueSharesPercent", e.target.value)} placeholder="e.g. 45"/></div>
        </div>

        <div className="ag-three">
          <div className="ag-field"><label>Expected multiple (×)</label><input type="number" min="0" step="0.01" value={dossier.expectedMultiple} onChange={(e) => d("expectedMultiple", e.target.value)} placeholder="e.g. 1.55"/></div>
          <div className="ag-field"><label>Expected duration (months)</label><input type="number" min="0" step="1" value={dossier.expectedDurationMonths} onChange={(e) => d("expectedDurationMonths", e.target.value)} placeholder="e.g. 18"/></div>
          <div className="ag-field"><label>Projected revenue (USD)</label><input type="number" min="0" step="0.01" value={dossier.projectedRevenueUsd} onChange={(e) => d("projectedRevenueUsd", e.target.value)} placeholder="e.g. 2500000"/></div>
        </div>
        <div className="ag-three">
          <div className="ag-field"><label>Capital at risk (USD)</label><input type="number" min="0" step="0.01" value={dossier.capitalAtRiskUsd} onChange={(e) => d("capitalAtRiskUsd", e.target.value)} placeholder="e.g. 400000"/></div>
          <div className="ag-field"><label>Funding target (USD)</label><input type="number" min="0" step="0.01" value={dossier.fundingAskUsd} onChange={(e) => d("fundingAskUsd", e.target.value)} placeholder="e.g. 500000"/></div>
          <div className="ag-field"><label>Minimum investment (USD)</label><input type="number" min="0" step="0.01" value={dossier.minimumInvestmentUsd} onChange={(e) => d("minimumInvestmentUsd", e.target.value)} placeholder="e.g. 1000"/></div>
        </div>
        <div className="ag-three">
          <div className="ag-field"><label>Unit price (USD, optional)</label><input type="number" min="0" step="0.01" value={dossier.unitPriceUsd} onChange={(e) => d("unitPriceUsd", e.target.value)} placeholder="e.g. 100"/></div>
          <div className="ag-field"><label>Season date (planting / harvest)</label><input type="date" value={dossier.eventDate} onChange={(e) => d("eventDate", e.target.value)}/></div>
          <div className="ag-field"><label>Funding deadline</label><input type="date" value={dossier.fundingDeadline} onChange={(e) => d("fundingDeadline", e.target.value)}/></div>
        </div>

        <div className="ag-field"><label>Description (required)</label><textarea rows={3} maxLength={2000} value={dossier.description} onChange={(e) => d("description", e.target.value)} placeholder="Describe the opportunity, the operation and why it is fundable."/></div>
        <div className="ag-field"><label>Highlights (optional, one per line)</label><textarea rows={3} value={dossier.highlightsText} onChange={(e) => d("highlightsText", e.target.value)} placeholder={"1,200 ha under centre-pivot irrigation\nSigned off-take agreement with a regional buyer"}/></div>

        <div className="ag-field">
          <label className="ag-checkbox"><input type="checkbox" checked={modelScenarios} onChange={(e) => setModelScenarios(e.target.checked)}/> Model the outcomes (required to make the opportunity fundable)</label>
          <small>Publishing outcomes requires a funding target and a cited source URL. Probabilities must sum to exactly 100%; the full write-off case is always shown to customers.</small>
        </div>
        {modelScenarios && <div className="ag-admin-list">
          {scenarios.map((scenario, index) => <div className="ag-admin-row" key={`${scenario.outcome}-${index}`}>
            <div className="ag-admin-row-head"><strong>{outcomeLabel(scenario.outcome as any)}</strong><span className="ag-chip">{percent(toBpsFromPercent(scenario.probabilityPercent))}</span></div>
            <div className="ag-three">
              <div className="ag-field"><label>Label</label><input value={scenario.label} onChange={(e) => setScenario(index, "label", e.target.value)}/></div>
              <div className="ag-field"><label>Probability %</label><input type="number" min="0" max="100" step="0.01" value={scenario.probabilityPercent} onChange={(e) => setScenario(index, "probabilityPercent", e.target.value)}/></div>
              <div className="ag-field"><label>Duration (months)</label><input type="number" min="0" step="1" value={scenario.durationMonths} onChange={(e) => setScenario(index, "durationMonths", e.target.value)}/></div>
            </div>
            <div className="ag-two">
              <div className="ag-field"><label>Gross revenue (USD)</label><input type="number" min="0" step="0.01" value={scenario.grossRevenueUsd} onChange={(e) => setScenario(index, "grossRevenueUsd", e.target.value)}/></div>
              <div className="ag-field"><label>Funder multiple (×)</label><input type="number" min="0" step="0.01" value={scenario.funderMultiple} onChange={(e) => setScenario(index, "funderMultiple", e.target.value)}/></div>
            </div>
          </div>)}
          <div className={`ag-notice${scenarioBpsTotal === 10_000 ? " is-success" : " is-error"}`}><div>Outcome probabilities: {percent(scenarioBpsTotal)} of 100%{scenarioBpsTotal === 10_000 ? " — complete" : " — must sum to exactly 100%"}.</div></div>
        </div>}

        <div className="ag-field">
          <label className="ag-checkbox"><input type="checkbox" checked={modelMilestones} onChange={(e) => setModelMilestones(e.target.checked)}/> Model funding milestones (optional)</label>
          <small>Each milestone releases a share of the held principal. Releases must sum to exactly 100%. A milestone marked REACHED is shown to customers as achieved.</small>
        </div>
        {modelMilestones && <div className="ag-admin-list">
          {milestones.map((milestone, index) => <div className="ag-admin-row" key={`${milestone.stage}-${index}`}>
            <div className="ag-two">
              <div className="ag-field"><label>Stage</label><select value={milestone.stage} onChange={(e) => setMilestone(index, "stage", e.target.value)}>{STAGE_OPTIONS.map((value) => <option key={value} value={value}>{stageLabel(value)}</option>)}</select></div>
              <div className="ag-field"><label>Label</label><input value={milestone.label} onChange={(e) => setMilestone(index, "label", e.target.value)}/></div>
            </div>
            <div className="ag-two">
              <div className="ag-field"><label>Escrow release %</label><input type="number" min="0" max="100" step="0.01" value={milestone.releasePercent} onChange={(e) => setMilestone(index, "releasePercent", e.target.value)}/></div>
              <div className="ag-field"><label>Status</label><select value={milestone.status} onChange={(e) => setMilestone(index, "status", e.target.value)}><option value="PENDING">Pending</option><option value="REACHED">Reached</option></select></div>
            </div>
          </div>)}
          <div className={`ag-notice${milestoneBpsTotal === 10_000 ? " is-success" : " is-error"}`}><div>Milestone releases: {percent(milestoneBpsTotal)} of 100%{milestoneBpsTotal === 10_000 ? " — complete" : " — must sum to exactly 100%"}.</div></div>
        </div>}

        <div className="ag-two">
          <div className="ag-field"><label>Source label (optional)</label><input value={dossier.source} onChange={(e) => d("source", e.target.value)} placeholder="e.g. Co-operative harvest statement / off-take contract"/></div>
          <div className="ag-field"><label>Source URL {modelScenarios ? "(required when modelled)" : "(optional)"}</label><input value={dossier.sourceUrl} onChange={(e) => d("sourceUrl", e.target.value)} placeholder="https://public-source.example/opportunity"/></div>
        </div>
        <div className="ag-two">
          <div className="ag-field"><label>As-of date (required)</label><input type="date" value={dossier.asOf} onChange={(e) => d("asOf", e.target.value)}/></div>
          <div className="ag-field"><label>Audit reason (optional)</label><input value={dossier.reason} onChange={(e) => d("reason", e.target.value)} placeholder="Reason recorded with this change"/></div>
        </div>

        {(scenarioErrors || milestoneErrors) && <div className="ag-notice is-error" role="alert"><AlertTriangle size={15}/><div>{scenarioErrors}{milestoneErrors}</div></div>}

        <div className="ag-admin-actions">
          <button className="ag-btn ag-btn--invest" type="button" disabled={!dossierValid || pending} onClick={submitDossier}>
            {pending ? "Saving…" : editingDossierId ? "Save changes" : "Publish opportunity"} <Check size={14}/>
          </button>
          <span className="ag-card-meta"><ShieldCheck size={13}/> New opportunities are enabled on publish. An opportunity becomes fundable once it is FUNDING status, carries a funding target and has modelled outcomes summing to 100%.</span>
        </div>
      </div>

      <div className="ag-admin-list">
        <div className="ag-section-head"><span className="ag-eyebrow">Published opportunities ({dossierRows.length}) · {fundableCount} open for investment</span></div>
        {!dossierRows.length && <div className="ag-empty"><Sprout size={16}/> No agriculture opportunities yet. Publish one above to open it for investment on the customer desk.</div>}
        {dossierRows.map((row) => {
          const fundable = row.status === "FUNDING" && row.scenarios.length > 0 && row.fundingAskMinor > 0 && !row.outcome;
          return <div className="ag-admin-row" key={row.dossierId}>
            <div className="ag-admin-row-head">
              <div>
                <strong>{row.flag} {row.title}</strong>
                <div className="ag-card-meta"><span>{row.operator}</span><span>{row.territory} · {sectorLabel(row.sector)}</span></div>
              </div>
              <div className="ag-tags">
                <span className="ag-chip ag-chip--type">{agroTypeLabel(row.agroType)}</span>
                {row.riskGrade && <span className={`ag-chip ag-chip--risk-${String(row.riskGrade).toLowerCase()}`}>{riskGradeLabel(row.riskGrade)}</span>}
                <span className={`ag-chip ag-chip--status-${String(row.status).toLowerCase()}`}>{statusLabel(row.status)}</span>
                <span className="ag-chip">{stageLabel(row.stage)}</span>
                <span className="ag-chip">{row.enabled ? "Enabled" : "Disabled"}</span>
              </div>
            </div>
            <div className="ag-card-meta">
              <span>Target {money(row.fundingAskMinor)} · committed {money(row.committedMinor)}</span>
              <span>Distributed {money(row.distributedMinor)}</span>
              <span>Expected {multiple(row.expectedMultipleBps)}{row.expectedDurationMonths ? ` · ${row.expectedDurationMonths}mo` : ""}</span>
              {row.revenueSharesBps !== null && row.revenueSharesBps !== undefined && <span>Revenue share {percent(row.revenueSharesBps)}</span>}
              {row.eventDate ? <span>Season {row.eventDate}</span> : null}
              <span>{row.scenarios.length ? `${row.scenarios.length} outcomes` : "Not modelled"}</span>
              {row.outcome && <span className="ag-chip">Outcome {outcomeLabel(row.outcome)}</span>}
              <span>As of {row.asOf}</span>
              <span>ID {row.dossierId}</span>
            </div>
            {row.scenarios.length > 0 && <div className="ag-scenarios">{row.scenarios.map((scenario: any, index: number) => <div className={`ag-scenario ag-scenario--${String(scenario.outcome).toLowerCase()}`} key={`${scenario.outcome}-${index}`}><span className="ag-scenario-head">{scenario.label}</span><span>{percent(scenario.probabilityBps)} · {money(scenario.grossRevenueMinor)} gross · {scenario.durationMonths}mo · {multiple(scenario.funderMultipleBps)}</span></div>)}</div>}

            <div className="ag-admin-actions">
              <button className="ag-btn ag-btn--ghost ag-btn--sm" type="button" disabled={Boolean(row.outcome)} onClick={() => beginEditDossier(row)}>Edit</button>
              <button className="ag-btn ag-btn--ghost ag-btn--sm" type="button" disabled={toggleDossier.isPending} onClick={() => toggleDossier.mutate({ dossierId: row.dossierId, enabled: !row.enabled })}>{row.enabled ? "Disable" : "Enable"}</button>
              <select value="" aria-label="Set status" disabled={setStatus.isPending} onChange={(e) => { if (e.target.value) setStatus.mutate({ dossierId: row.dossierId, status: e.target.value as any, reason: "Administrator status change" }); }}>
                <option value="">Set status…</option>
                {STATUS_OPTIONS.filter((value) => value !== row.status).map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}
              </select>
              <select value="" aria-label="Reach milestone" disabled={reachMilestone.isPending} onChange={(e) => { if (e.target.value) reachMilestone.mutate({ dossierId: row.dossierId, stage: e.target.value as any, reason: "Administrator milestone" }); }}>
                <option value="">Reach milestone…</option>
                {STAGE_OPTIONS.filter((value) => value !== row.stage).map((value) => <option key={value} value={value}>{stageLabel(value)}</option>)}
              </select>
              <button className="ag-btn ag-btn--danger ag-btn--sm" type="button" disabled={deleteDossier.isPending || row.committedMinor > 0} onClick={() => { if (window.confirm(`Delete opportunity “${row.title}”? It is removed from the customer desk.`)) deleteDossier.mutate({ dossierId: row.dossierId }); }}><Trash2 size={13}/> Delete</button>
            </div>
            {!fundable && !row.outcome && row.scenarios.length > 0 && <div className="ag-reference-note"><AlertTriangle size={13}/> Not currently fundable — status is {statusLabel(row.status)} or the funding target is unset.</div>}
            {!row.scenarios.length && <div className="ag-reference-note"><AlertTriangle size={13}/> Not modelled — customers can still invest, but the funding progress and the settlement multiple stay unset until the outcomes and a funding target are published with a cited source.</div>}
          </div>;
        })}
      </div>
    </div>}

    {tab === "distributions" && <div className="ag-admin">
      <div className="ag-admin-list">
        <div className="ag-section-head"><div><span className="ag-eyebrow ag-eyebrow--gold">Record distributions ({openInstrumentRows.length}) · {money(openCommittedMinor)} committed</span><h2>Credit an agriculture revenue distribution</h2></div></div>
        <div className="ag-notice">
          <Coins size={15}/>
          <div>The amount you record is split pro-rata across every open position on the opportunity by its principal and credited to each funder's settlement wallet as a withdrawable internal-ledger entry. Principal stays held during the term. It is idempotent per submit, and historical entries are never edited.</div>
        </div>
        {!openInstrumentRows.length && <div className="ag-empty"><Coins size={16}/> No opportunities carry open commitments right now. Funded opportunities appear here for distributions.</div>}
        {openInstrumentRows.map((row) => {
          const form = distributionFormFor(row);
          const previewMinor = toMinor(form.amountUsd) ?? 0;
          return <div className="ag-admin-row" key={row.instrumentId}>
            <div className="ag-admin-row-head">
              <div><strong>{row.instrumentName}</strong><div className="ag-card-meta"><span className="ag-mono">{row.agroType || "Agriculture"} · {row.instrumentId}</span></div></div>
              <div className="ag-tags"><span className="ag-chip">{row.openPositions} open position{row.openPositions === 1 ? "" : "s"}</span><span className="ag-chip">{money(row.committedMinor)} committed</span></div>
            </div>
            <div className="ag-two">
              <div className="ag-field"><label>Distribution amount ({row.currency || "USD"})</label><input type="number" min="0" step="0.01" value={form.amountUsd} onChange={(e) => setDistributionForm(row, "amountUsd", e.target.value)} placeholder="e.g. 12000"/></div>
              <div className="ag-field"><label>Note (optional)</label><input value={form.note} onChange={(e) => setDistributionForm(row, "note", e.target.value)} placeholder="e.g. Q1 2027 harvest statement"/></div>
            </div>
            <div className="ag-card-meta"><span>Preview {money(previewMinor)} split pro-rata across {row.openPositions} position(s)</span></div>
            <div className="ag-admin-actions">
              <button className="ag-btn ag-btn--invest" type="button" disabled={recordDistribution.isPending || previewMinor <= 0} onClick={() => runDistribution(row)}>
                {recordDistribution.isPending ? "Recording…" : `Record ${money(previewMinor)} distribution`} <Check size={14}/>
              </button>
            </div>
          </div>;
        })}
      </div>
    </div>}

    {tab === "settle" && <div className="ag-admin">
      <div className="ag-admin-list">
        <div className="ag-section-head"><div><span className="ag-eyebrow ag-eyebrow--gold">Settle &amp; write off ({openInstrumentRows.length}) · {money(openCommittedMinor)} committed</span><h2>Resolve a funded agriculture opportunity</h2></div></div>
        <div className="ag-notice">
          <AlertTriangle size={15}/>
          <div>Choose the outcome and the completion multiple here to release held principal and pay or write off every open position. A strong season or on-plan outcome pays principal × the multiple you set; a write-off pays nothing and releases the lock without fabricating a credit. Payouts and write-offs are internal-ledger compensating entries and are never edited. This cannot be undone.</div>
        </div>
        {!openInstrumentRows.length && <div className="ag-empty"><BadgePercent size={16}/> No opportunities carry open commitments right now. Funded opportunities appear here for settlement.</div>}
        {openInstrumentRows.map((row) => {
          const form = settleFormFor(row);
          const payoutPreview = form.outcome === "WRITE_OFF" ? 0 : Math.round((Number(row.committedMinor || 0) * toBpsFromPercent(form.multiplePercent)) / 10_000);
          return <div className="ag-admin-row" key={row.instrumentId}>
            <div className="ag-admin-row-head">
              <div><strong>{row.instrumentName}</strong><div className="ag-card-meta"><span className="ag-mono">{row.agroType || "Agriculture"} · {row.instrumentId}</span></div></div>
              <div className="ag-tags"><span className="ag-chip">{row.openPositions} open position{row.openPositions === 1 ? "" : "s"}</span><span className="ag-chip">{money(row.committedMinor)} committed</span></div>
            </div>
            <div className="ag-two">
              <div className="ag-field"><label>Outcome</label>
                <select value={form.outcome} onChange={(e) => setSettleForm(row, "outcome", e.target.value)}>
                  {AGRO_OUTCOMES.map((value) => <option key={value} value={value}>{outcomeLabel(value)}</option>)}
                </select>
              </div>
              <div className="ag-field"><label>Completion multiple (%)</label>
                <input type="number" min="0" step="1" value={form.multiplePercent} disabled={form.outcome === "WRITE_OFF"} onChange={(e) => setSettleForm(row, "multiplePercent", e.target.value)}/>
                <small>{form.outcome === "WRITE_OFF" ? "A write-off pays nothing; every principal is written off." : `Funders receive principal × ${multiple(toBpsFromPercent(form.multiplePercent))}.`}</small>
              </div>
            </div>
            <div className="ag-field"><label>Reason (optional)</label><input value={form.reason} onChange={(e) => setSettleForm(row, "reason", e.target.value)} placeholder="e.g. Harvest completed at 1.80x on 2027-09-01"/></div>
            <div className="ag-card-meta">
              <span>Payout preview {money(payoutPreview)} of {money(row.committedMinor)} committed</span>
              {form.outcome === "WRITE_OFF" && <span>{money(row.committedMinor)} written off</span>}
            </div>
            <div className="ag-admin-actions">
              <button className="ag-btn ag-btn--invest" type="button" disabled={settleInstrument.isPending} onClick={() => runSettle(row)}>
                {settleInstrument.isPending ? "Settling…" : `Settle as ${outcomeLabel(form.outcome as any)} at ${form.outcome === "WRITE_OFF" ? "0.00x" : multiple(toBpsFromPercent(form.multiplePercent))}`} <Check size={14}/>
              </button>
            </div>
          </div>;
        })}
      </div>
    </div>}

    <div className="ag-notice">
      <ShieldCheck size={15}/>
      <div>This console writes the agriculture opportunity dossiers, records distributions and settles funded opportunities to the platform database. This desk is agriculture-only — IP royalties, NFTs, music royalties, green energy and carbon credits belong to their own menus and are excluded here. The discovery layer surfaces real, cited public agriculture sources (the keyless World Bank Open Data feed), but those references are never fundable: only an administrator-published dossier with sourced economics is open for investment. Every change is audited, publishing outcomes requires a funding target with a cited source URL and a 100% probability split, and no agriculture economics figure is ever invented here.</div>
    </div>
  </div>;
}
