import { useMemo, useState } from "react";
import {
  AlertTriangle, Check, Gavel, Layers, RefreshCw, Scale, ShieldCheck, Trash2,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { COUNTRY_OPTIONS, flagFor } from "@shared/country-options";
import {
  LITIGATION_CASE_CLASSES,
  LITIGATION_VALUE_BANDS,
  caseClassLabel,
  valueBandLabel,
  isInsolvency,
  type LitigationRiskGrade,
} from "@shared/litigation-funds-catalogue";
import "./litigation-funds.css";

const STAGE_OPTIONS = ["FILED", "DISCOVERY", "MEDIATION", "TRIAL", "JUDGMENT", "ENFORCEMENT", "DISTRIBUTION"];
const STATUS_OPTIONS = ["FUNDING", "ESCROW", "ACTIVE", "RESOLVED", "WITHDRAWN"];
const MERIT_OPTIONS = ["", "A", "B", "C", "D", "E"];
const RISK_OPTIONS: LitigationRiskGrade[] = ["PRIME", "BALANCED", "SPECULATIVE", "HIGH_RISK"];
const OUTCOME_OPTIONS = ["SETTLE", "WIN", "LOSE"];

const STAGE_LABELS: Record<string, string> = {
  FILED: "Filed", DISCOVERY: "Discovery", MEDIATION: "Mediation", TRIAL: "Trial",
  JUDGMENT: "Judgment", ENFORCEMENT: "Enforcement", DISTRIBUTION: "Distribution",
};

/** Neutral template weights that sum to 100% of escrow across the seven stages. */
const DEFAULT_MILESTONES = [
  { stage: "FILED", label: "Filed", releasePercent: "10" },
  { stage: "DISCOVERY", label: "Discovery", releasePercent: "20" },
  { stage: "MEDIATION", label: "Mediation", releasePercent: "15" },
  { stage: "TRIAL", label: "Trial", releasePercent: "15" },
  { stage: "JUDGMENT", label: "Judgment", releasePercent: "20" },
  { stage: "ENFORCEMENT", label: "Enforcement", releasePercent: "15" },
  { stage: "DISTRIBUTION", label: "Distribution", releasePercent: "5" },
];

const TEMPLATE_SCENARIOS = [
  { outcome: "SETTLE", label: "Settle before trial", probabilityPercent: "50", grossRecoveryUsd: "", durationMonths: "18", funderMultiple: "1.40" },
  { outcome: "WIN", label: "Win at trial", probabilityPercent: "25", grossRecoveryUsd: "", durationMonths: "30", funderMultiple: "1.90" },
  { outcome: "LOSE", label: "Lose at trial", probabilityPercent: "25", grossRecoveryUsd: "0", durationMonths: "30", funderMultiple: "0.00" },
];

const lines = (value: string, max: number) => value.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, max);
const toMinor = (value: string): number | null => (value.trim() === "" ? null : Math.round(Number(value) * 100));
const fromMinor = (value: number | null | undefined): string => (value === null || value === undefined ? "" : String(Number(value) / 100));
const toBpsFromPercent = (value: string): number => Math.round((Number(value) || 0) * 100);
const fromBpsToPercent = (bps: number | undefined): string => String((Number(bps) || 0) / 100);
const money = (minor: number | null | undefined) => {
  const value = Number(minor || 0) / 100;
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value); }
  catch { return `USD ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
};
const multiple = (bps: number | null | undefined) => (bps === null || bps === undefined ? "—" : `${(Number(bps) / 10_000).toFixed(2)}x`);
const percent = (bps: number | null | undefined) => (bps === null || bps === undefined ? "—" : `${(Number(bps) / 100).toFixed(Number(bps) % 100 === 0 ? 0 : 1)}%`);

type DossierForm = {
  caseName: string; claimant: string; defendant: string; claimType: string; countryCode: string; court: string; counsel: string;
  caseClass: string; causeOfAction: string; caseNumber: string; filedAt: string; courtDetail: string; claimValueBand: string;
  meritGrade: string; riskGrade: string;
  estimatedDamagesUsd: string; capitalAtRiskUsd: string; expectedMultiple: string; expectedDurationMonths: string; fundingAskUsd: string;
  fundingDeadline: string; stage: string; status: string; problem: string; highlightsText: string; bundleId: string;
  source: string; sourceUrl: string; asOf: string; reason: string;
};

const emptyDossier = (): DossierForm => ({
  caseName: "", claimant: "", defendant: "", claimType: "", countryCode: "US", court: "", counsel: "",
  caseClass: "", causeOfAction: "", caseNumber: "", filedAt: "", courtDetail: "", claimValueBand: "",
  meritGrade: "", riskGrade: "",
  estimatedDamagesUsd: "", capitalAtRiskUsd: "", expectedMultiple: "", expectedDurationMonths: "", fundingAskUsd: "",
  fundingDeadline: "", stage: "FILED", status: "FUNDING", problem: "", highlightsText: "", bundleId: "",
  source: "", sourceUrl: "", asOf: "", reason: "",
});

type BundleForm = {
  name: string; claimType: string; jurisdiction: string; riskGrade: LitigationRiskGrade;
  targetUsd: string; unitPriceUsd: string; unitCount: string; caseIdsText: string;
  expectedMultiple: string; expectedDurationMonths: string; summary: string; source: string; asOf: string; reason: string;
};

const emptyBundle = (): BundleForm => ({
  name: "", claimType: "", jurisdiction: "", riskGrade: "BALANCED",
  targetUsd: "", unitPriceUsd: "", unitCount: "", caseIdsText: "",
  expectedMultiple: "", expectedDurationMonths: "", summary: "", source: "", asOf: "", reason: "",
});

type ScenarioForm = { outcome: string; label: string; probabilityPercent: string; grossRecoveryUsd: string; durationMonths: string; funderMultiple: string };
type MilestoneForm = { stage: string; label: string; releasePercent: string };

/**
 * Administrator console for the Litigation Funds desk. An administrator reviews
 * real, cited public court records (the discovery layer) and may publish the
 * dossier economics for a case: merit, damages, capital at risk, the funding
 * target, the three outcome scenarios and the escrow milestones. Every cited
 * case is fundable without a dossier — a dossier only enriches the case with
 * fixed economics. The console also settles any funded case directly, choosing
 * an outcome and a funder multiple to pay out or write off open positions.
 */
export function AdminLitigationFunds() {
  const utils = trpc.useUtils();
  const dossiersQuery = trpc.adminOperations.litigationDossiers.useQuery(undefined, { refetchInterval: 20000 });
  const bundlesQuery = trpc.adminOperations.litigationBundles.useQuery(undefined, { refetchInterval: 20000 });
  const openCasesQuery = trpc.adminOperations.litigationOpenCases.useQuery(undefined, { refetchInterval: 20000 });

  const [tab, setTab] = useState<"dossiers" | "bundles" | "settle">("dossiers");
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">("success");
  const [settleForms, setSettleForms] = useState<Record<string, { outcome: string; multiplePercent: string; reason: string }>>({});

  const [dossier, setDossier] = useState<DossierForm>(emptyDossier);
  const [editingDossierId, setEditingDossierId] = useState<string | null>(null);
  const [modelOutcomes, setModelOutcomes] = useState(false);
  const [scenarios, setScenarios] = useState<ScenarioForm[]>(() => TEMPLATE_SCENARIOS.map((item) => ({ ...item })));
  const [modelMilestones, setModelMilestones] = useState(false);
  const [milestones, setMilestones] = useState<MilestoneForm[]>(() => DEFAULT_MILESTONES.map((item) => ({ ...item })));

  const [bundle, setBundle] = useState<BundleForm>(emptyBundle);
  const [editingBundleId, setEditingBundleId] = useState<string | null>(null);
  const [allocationsText, setAllocationsText] = useState("");

  const report = (kind: "success" | "error", text: string) => { setMessageKind(kind); setMessage(text); };
  const onError = (error: { message: string }) => report("error", error.message);
  const invalidate = () => {
    void utils.adminOperations.litigationDossiers.invalidate();
    void utils.adminOperations.litigationBundles.invalidate();
    void utils.adminOperations.litigationOpenCases.invalidate();
    void utils.customer.litigationFunds.market.invalidate();
  };

  const createDossier = trpc.adminOperations.createLitigationDossier.useMutation({ onSuccess: (row: any) => { resetDossierForm(); invalidate(); report("success", `Published dossier ${row.dossierId} “${row.caseName}”.`); }, onError });
  const updateDossier = trpc.adminOperations.updateLitigationDossier.useMutation({ onSuccess: (row: any) => { resetDossierForm(); invalidate(); report("success", `Updated dossier ${row.dossierId}.`); }, onError });
  const toggleDossier = trpc.adminOperations.setLitigationDossierEnabled.useMutation({ onSuccess: (row: any) => { invalidate(); report("success", `${row.caseName} is now ${row.enabled ? "enabled on" : "disabled from"} the customer desk.`); }, onError });
  const setStatus = trpc.adminOperations.setLitigationDossierStatus.useMutation({ onSuccess: (row: any) => { invalidate(); report("success", `${row.caseName} status set to ${row.status}.`); }, onError });
  const reachMilestone = trpc.adminOperations.reachLitigationMilestone.useMutation({ onSuccess: (row: any) => { invalidate(); report("success", `Milestone recorded on ${row.caseName}.`); }, onError });
  const recordOutcome = trpc.adminOperations.recordLitigationOutcome.useMutation({ onSuccess: (result: any) => { invalidate(); report("success", `Outcome ${result.outcome} recorded: ${result.positions} position(s), ${money(result.paidMinor)} paid, ${money(result.writtenOffMinor)} written off.`); }, onError });
  const deleteDossier = trpc.adminOperations.deleteLitigationDossier.useMutation({ onSuccess: (result: any) => { invalidate(); report("success", `Deleted ${result.dossierId}.`); }, onError });
  const settleCase = trpc.adminOperations.settleLitigationCase.useMutation({
    onSuccess: (result: any) => {
      setSettleForms((current) => { const next = { ...current }; delete next[result.instrumentId]; return next; });
      invalidate();
      report("success", `Settled “${result.caseName}” as ${result.outcome} at ${multiple(result.funderMultipleBps)}: ${result.positions} position(s), ${money(result.paidMinor)} paid, ${money(result.writtenOffMinor)} written off.`);
    },
    onError,
  });

  const createBundle = trpc.adminOperations.createLitigationBundle.useMutation({ onSuccess: (row: any) => { resetBundleForm(); invalidate(); report("success", `Published bundle ${row.bundleId} “${row.name}”.`); }, onError });
  const updateBundle = trpc.adminOperations.updateLitigationBundle.useMutation({ onSuccess: (row: any) => { resetBundleForm(); invalidate(); report("success", `Updated bundle ${row.bundleId}.`); }, onError });
  const toggleBundle = trpc.adminOperations.setLitigationBundleEnabled.useMutation({ onSuccess: (row: any) => { invalidate(); report("success", `${row.name} is now ${row.enabled ? "enabled on" : "disabled from"} the customer desk.`); }, onError });
  const deleteBundle = trpc.adminOperations.deleteLitigationBundle.useMutation({ onSuccess: (result: any) => { invalidate(); report("success", `Deleted ${result.bundleId}.`); }, onError });

  const pending = createDossier.isPending || updateDossier.isPending || createBundle.isPending || updateBundle.isPending;

  function resetDossierForm() {
    setEditingDossierId(null);
    setDossier(emptyDossier());
    setModelOutcomes(false);
    setScenarios(TEMPLATE_SCENARIOS.map((item) => ({ ...item })));
    setModelMilestones(false);
    setMilestones(DEFAULT_MILESTONES.map((item) => ({ ...item })));
  }
  function resetBundleForm() {
    setEditingBundleId(null);
    setBundle(emptyBundle());
    setAllocationsText("");
  }

  const d = (key: keyof DossierForm, value: string) => setDossier((current) => ({ ...current, [key]: value }));
  const b = (key: keyof BundleForm, value: string) => setBundle((current) => ({ ...current, [key]: value }));

  const setScenario = (index: number, key: keyof ScenarioForm, value: string) => setScenarios((current) => current.map((item, i) => (i === index ? { ...item, [key]: value } : item)));
  const setMilestone = (index: number, key: keyof MilestoneForm, value: string) => setMilestones((current) => current.map((item, i) => (i === index ? { ...item, [key]: value } : item)));

  const scenarioBpsTotal = scenarios.reduce((sum, item) => sum + toBpsFromPercent(item.probabilityPercent), 0);
  const milestoneBpsTotal = milestones.reduce((sum, item) => sum + toBpsFromPercent(item.releasePercent), 0);

  const scenarioErrors = modelOutcomes
    ? (!dossier.fundingAskUsd.trim() ? "Set a funding target before modelling outcomes. " : "")
      + (!dossier.sourceUrl.trim() ? "A modelled dossier must cite its source URL. " : "")
      + (scenarioBpsTotal !== 10_000 ? "Scenario probabilities must sum to exactly 100%. " : "")
    : "";

  const milestoneErrors = modelMilestones && milestoneBpsTotal !== 10_000 ? "Milestone release weights must sum to exactly 100% of escrow. " : "";

  const dossierValid = dossier.caseName.trim().length >= 3
    && dossier.claimant.trim().length >= 2
    && dossier.defendant.trim().length >= 2
    && dossier.claimType.trim().length >= 2
    && /^[A-Za-z]{2}$/.test(dossier.countryCode)
    && dossier.court.trim().length >= 2
    && dossier.problem.trim().length >= 8
    && !scenarioErrors && !milestoneErrors;

  const buildDossierPayload = () => {
    const payload: any = {
      caseName: dossier.caseName.trim(),
      claimant: dossier.claimant.trim(),
      defendant: dossier.defendant.trim(),
      claimType: dossier.claimType.trim(),
      countryCode: dossier.countryCode.toUpperCase(),
      court: dossier.court.trim(),
      meritGrade: dossier.meritGrade ? dossier.meritGrade : null,
      riskGrade: dossier.riskGrade ? dossier.riskGrade : null,
      estimatedDamagesMinor: toMinor(dossier.estimatedDamagesUsd),
      capitalAtRiskMinor: toMinor(dossier.capitalAtRiskUsd),
      expectedMultipleBps: dossier.expectedMultiple.trim() ? Math.round(Number(dossier.expectedMultiple) * 10_000) : null,
      expectedDurationMonths: dossier.expectedDurationMonths.trim() ? Math.round(Number(dossier.expectedDurationMonths)) : null,
      fundingAskMinor: toMinor(dossier.fundingAskUsd),
      stage: dossier.stage,
      status: dossier.status,
      problem: dossier.problem.trim(),
      highlights: lines(dossier.highlightsText, 8),
    };
    if (dossier.counsel.trim()) payload.counsel = dossier.counsel.trim();
    if (dossier.caseClass) payload.caseClass = dossier.caseClass;
    if (dossier.claimValueBand) payload.claimValueBand = dossier.claimValueBand;
    if (dossier.causeOfAction.trim()) payload.causeOfAction = dossier.causeOfAction.trim();
    if (dossier.caseNumber.trim()) payload.caseNumber = dossier.caseNumber.trim();
    if (dossier.filedAt.trim()) payload.filedAt = dossier.filedAt.trim();
    if (dossier.courtDetail.trim()) payload.courtDetail = dossier.courtDetail.trim();
    if (dossier.fundingDeadline.trim()) payload.fundingDeadline = dossier.fundingDeadline.trim();
    if (dossier.bundleId.trim()) payload.bundleId = dossier.bundleId.trim();
    if (dossier.source.trim()) payload.source = dossier.source.trim();
    if (dossier.sourceUrl.trim()) payload.sourceUrl = dossier.sourceUrl.trim();
    if (dossier.asOf.trim()) payload.asOf = dossier.asOf.trim();
    if (dossier.reason.trim()) payload.reason = dossier.reason.trim();
    if (modelOutcomes) {
      payload.scenarios = scenarios.map((item) => ({
        outcome: item.outcome,
        label: item.label.trim() || item.outcome,
        probabilityBps: toBpsFromPercent(item.probabilityPercent),
        grossRecoveryMinor: toMinor(item.grossRecoveryUsd) ?? 0,
        durationMonths: Math.round(Number(item.durationMonths) || 0),
        funderMultipleBps: Math.round((Number(item.funderMultiple) || 0) * 10_000),
      }));
    }
    if (modelMilestones) {
      payload.milestones = milestones.map((item) => ({
        stage: item.stage,
        label: item.label.trim() || item.stage,
        releaseBps: toBpsFromPercent(item.releasePercent),
        status: "PENDING",
        reachedAt: null,
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
      caseName: row.caseName || "", claimant: row.claimant || "", defendant: row.defendant || "", claimType: row.claimType || "",
      countryCode: row.countryCode || "US", court: row.court || "", counsel: row.counsel || "",
      caseClass: row.caseClass || "", causeOfAction: row.causeOfAction || "", caseNumber: row.caseNumber || "",
      filedAt: row.filedAt || "", courtDetail: row.courtDetail || "", claimValueBand: row.claimValueBand || "",
      meritGrade: row.meritGrade || "", riskGrade: row.riskGrade || "",
      estimatedDamagesUsd: fromMinor(row.estimatedDamagesMinor), capitalAtRiskUsd: fromMinor(row.capitalAtRiskMinor),
      expectedMultiple: row.expectedMultipleBps === null || row.expectedMultipleBps === undefined ? "" : String(Number(row.expectedMultipleBps) / 10_000),
      expectedDurationMonths: row.expectedDurationMonths === null || row.expectedDurationMonths === undefined ? "" : String(row.expectedDurationMonths),
      fundingAskUsd: fromMinor(row.fundingAskMinor), fundingDeadline: row.fundingDeadline || "",
      stage: row.stage || "FILED", status: row.status || "FUNDING", problem: row.problem || "",
      highlightsText: Array.isArray(row.highlights) ? row.highlights.join("\n") : "",
      bundleId: row.bundleId || "", source: row.source || "", sourceUrl: row.sourceUrl || "",
      asOf: row.asOf || "", reason: "",
    });
    if (Array.isArray(row.scenarios) && row.scenarios.length) {
      setModelOutcomes(true);
      setScenarios(row.scenarios.map((item: any) => ({
        outcome: item.outcome, label: item.label || "", probabilityPercent: fromBpsToPercent(item.probabilityBps),
        grossRecoveryUsd: fromMinor(item.grossRecoveryMinor), durationMonths: String(item.durationMonths ?? 0),
        funderMultiple: String(Number(item.funderMultipleBps || 0) / 10_000),
      })));
    } else {
      setModelOutcomes(false);
      setScenarios(TEMPLATE_SCENARIOS.map((item) => ({ ...item })));
    }
    if (Array.isArray(row.milestones) && row.milestones.length) {
      setModelMilestones(true);
      setMilestones(row.milestones.map((item: any) => ({ stage: item.stage, label: item.label || item.stage, releasePercent: fromBpsToPercent(item.releaseBps) })));
    } else {
      setModelMilestones(false);
      setMilestones(DEFAULT_MILESTONES.map((item) => ({ ...item })));
    }
  };

  const buildBundlePayload = () => {
    const caseIds = lines(bundle.caseIdsText, 50);
    const allocationBpsByCase: Record<string, number> = {};
    lines(allocationsText, 50).forEach((line) => {
      const [caseId, bps] = line.split(/[=:]/).map((part) => part.trim());
      if (caseId && bps) allocationBpsByCase[caseId] = Math.round(Number(bps) || 0);
    });
    const payload: any = {
      name: bundle.name.trim(),
      claimType: bundle.claimType.trim(),
      jurisdiction: bundle.jurisdiction.trim(),
      riskGrade: bundle.riskGrade,
      targetMinor: toMinor(bundle.targetUsd) ?? 0,
      unitPriceMinor: toMinor(bundle.unitPriceUsd) ?? 0,
      unitCount: Math.round(Number(bundle.unitCount) || 0),
      expectedMultipleBps: Math.round((Number(bundle.expectedMultiple) || 0) * 10_000),
      expectedDurationMonths: bundle.expectedDurationMonths.trim() ? Math.round(Number(bundle.expectedDurationMonths)) : null,
    };
    if (caseIds.length) payload.caseIds = caseIds;
    if (Object.keys(allocationBpsByCase).length) payload.allocationBpsByCase = allocationBpsByCase;
    if (bundle.summary.trim()) payload.summary = bundle.summary.trim();
    if (bundle.source.trim()) payload.source = bundle.source.trim();
    if (bundle.asOf.trim()) payload.asOf = bundle.asOf.trim();
    if (bundle.reason.trim()) payload.reason = bundle.reason.trim();
    return payload;
  };

  const bundleValid = bundle.name.trim().length >= 3
    && bundle.claimType.trim().length >= 2
    && bundle.jurisdiction.trim().length >= 2
    && (toMinor(bundle.targetUsd) ?? 0) > 0
    && (toMinor(bundle.unitPriceUsd) ?? 0) > 0
    && Math.round(Number(bundle.unitCount) || 0) > 0;

  const submitBundle = () => {
    const payload = buildBundlePayload();
    if (editingBundleId) updateBundle.mutate({ bundleId: editingBundleId, ...payload });
    else createBundle.mutate(payload);
  };

  const beginEditBundle = (row: any) => {
    setTab("bundles");
    setEditingBundleId(row.bundleId);
    setMessage("");
    setBundle({
      name: row.name || "", claimType: row.claimType || "", jurisdiction: row.jurisdiction || "", riskGrade: row.riskGrade || "BALANCED",
      targetUsd: fromMinor(row.targetMinor), unitPriceUsd: fromMinor(row.unitPriceMinor), unitCount: String(row.unitCount ?? ""),
      caseIdsText: Array.isArray(row.caseIds) ? row.caseIds.join("\n") : "",
      expectedMultiple: String(Number(row.expectedMultipleBps || 0) / 10_000),
      expectedDurationMonths: row.expectedDurationMonths === null || row.expectedDurationMonths === undefined ? "" : String(row.expectedDurationMonths),
      summary: row.summary || "", source: row.source || "", asOf: row.asOf || "", reason: "",
    });
    const allocation: Record<string, number> = row.allocationBpsByCase || {};
    setAllocationsText(Object.entries(allocation).map(([caseId, bps]) => `${caseId}=${bps}`).join("\n"));
  };

  const dossierRows: any[] = dossiersQuery.data || [];
  const bundleRows: any[] = bundlesQuery.data || [];
  const openCaseRows: any[] = openCasesQuery.data || [];
  const fundableCount = useMemo(() => dossierRows.filter((row) => row.status === "FUNDING" && row.scenarios.length > 0 && row.fundingAskMinor > 0).length, [dossierRows]);
  const settleTotalMinor = useMemo(() => openCaseRows.reduce((sum, row) => sum + Number(row.committedMinor || 0), 0), [openCaseRows]);

  const settleFormFor = (instrumentId: string) => settleForms[instrumentId] || { outcome: "SETTLE", multiplePercent: "150", reason: "" };
  const setSettleForm = (instrumentId: string, key: "outcome" | "multiplePercent" | "reason", value: string) => setSettleForms((current) => ({ ...current, [instrumentId]: { ...(current[instrumentId] || { outcome: "SETTLE", multiplePercent: "150", reason: "" }), [key]: value } }));
  const runSettleCase = (row: any) => {
    const form = settleFormFor(row.instrumentId);
    const funderMultipleBps = form.outcome === "LOSE" ? 0 : toBpsFromPercent(form.multiplePercent);
    if (form.outcome !== "LOSE" && funderMultipleBps <= 0) { report("error", "Set a funder multiple above 0.00x for a settle or win."); return; }
    const confirmText = `Settle “${row.caseName}” as ${form.outcome} at ${multiple(funderMultipleBps)}? This releases escrow and pays or writes off all ${row.openPositions} open position(s) across ${money(row.committedMinor)} committed. It cannot be undone.`;
    if (!window.confirm(confirmText)) return;
    settleCase.mutate({ instrumentId: row.instrumentId, outcome: form.outcome as any, funderMultipleBps, reason: form.reason.trim() || "Administrator settlement" });
  };

  return <div className="arb-page portal-page lf-page">
    <div className="portal-page-top">
      <div>
        <div className="eyebrow">Litigation desk · Case publishing</div>
        <h1>Litigation Funds console</h1>
        <p>Review real, cited public court records, then optionally publish the reviewed economics for a case — merit, damages, capital at risk, funding target, the settle / win / lose scenarios and the escrow milestones. Every cited case is fundable without a dossier; a published dossier only enriches the case with fixed economics. Use the Settle open cases tab to resolve a funded case directly.</p>
      </div>
      <button className="lf-btn" type="button" onClick={() => { void dossiersQuery.refetch(); void bundlesQuery.refetch(); void openCasesQuery.refetch(); }} disabled={dossiersQuery.isFetching || bundlesQuery.isFetching || openCasesQuery.isFetching}>
        <RefreshCw size={14} className={dossiersQuery.isFetching ? "spin" : ""}/> Refresh
      </button>
    </div>

    {message && <div className={`lf-notice${messageKind === "error" ? " is-error" : " is-success"}`} role={messageKind === "error" ? "alert" : "status"} aria-live="polite">
      <ShieldCheck size={15}/><div>{message}</div>
    </div>}

    <nav className="lf-tabs" aria-label="Admin litigation sections">
      <button type="button" className={`lf-tab${tab === "dossiers" ? " is-active" : ""}`} onClick={() => setTab("dossiers")}>Dossiers <span className="lf-tab-count">{dossierRows.length}</span></button>
      <button type="button" className={`lf-tab${tab === "bundles" ? " is-active" : ""}`} onClick={() => setTab("bundles")}>Bundles <span className="lf-tab-count">{bundleRows.length}</span></button>
      <button type="button" className={`lf-tab${tab === "settle" ? " is-active" : ""}`} onClick={() => setTab("settle")}>Settle open cases <span className="lf-tab-count">{openCaseRows.length}</span></button>
    </nav>

    {tab === "dossiers" && <div className="lf-admin">
      <div className="lf-admin-form">
        <div className="lf-section-head"><div><span className="eyebrow">{editingDossierId ? "Edit dossier" : "Publish dossier"}</span><h2>{editingDossierId ? editingDossierId : "New case dossier"}</h2></div>{editingDossierId && <button className="lf-btn lf-btn-sm" type="button" onClick={resetDossierForm}>Cancel edit</button>}</div>

        <div className="lf-two">
          <div className="lf-field"><label>Case name</label><input value={dossier.caseName} onChange={(e) => d("caseName", e.target.value)} placeholder="e.g. Okafor v Northwind Logistics Ltd" /></div>
          <div className="lf-field"><label>Claim type</label><input value={dossier.claimType} onChange={(e) => d("claimType", e.target.value)} placeholder="e.g. Commercial contract claim" /></div>
        </div>
        <div className="lf-two">
          <div className="lf-field"><label>Claimant / class</label><input value={dossier.claimant} onChange={(e) => d("claimant", e.target.value)} placeholder="Who is claiming" /></div>
          <div className="lf-field"><label>Defendant</label><input value={dossier.defendant} onChange={(e) => d("defendant", e.target.value)} placeholder="Who is being claimed against" /></div>
        </div>
        <div className="lf-two">
          <div className="lf-field"><label>Country / jurisdiction</label>
            <select value={dossier.countryCode} onChange={(e) => d("countryCode", e.target.value)}>
              {COUNTRY_OPTIONS.map((country) => <option key={country.code} value={country.code}>{flagFor(country.code)} {country.name} ({country.code})</option>)}
            </select>
            <small>Jurisdiction label and flag are derived from this: <strong>{flagFor(dossier.countryCode)}</strong></small>
          </div>
          <div className="lf-field"><label>Court / tribunal</label><input value={dossier.court} onChange={(e) => d("court", e.target.value)} placeholder="e.g. High Court of England & Wales" /></div>
        </div>
        <div className="lf-two">
          <div className="lf-field"><label>Counsel (optional)</label><input value={dossier.counsel} onChange={(e) => d("counsel", e.target.value)} placeholder="Counsel or firm" /></div>
          <div className="lf-field"><label>Bundle id (optional)</label><input value={dossier.bundleId} onChange={(e) => d("bundleId", e.target.value)} placeholder="Attach to a published bundle" /></div>
        </div>
        <div className="lf-two">
          <div className="lf-field"><label>Case class</label>
            <select value={dossier.caseClass} onChange={(e) => d("caseClass", e.target.value)}>
              <option value="">Auto-classify from the claim wording</option>
              {LITIGATION_CASE_CLASSES.map((value) => <option key={value} value={value}>{caseClassLabel(value)}</option>)}
            </select>
            <small>Separates a company litigating a claim from an insolvency estate. Insolvency is one class among many.</small>
          </div>
          <div className="lf-field"><label>Claim-value band</label>
            <select value={dossier.claimValueBand} onChange={(e) => d("claimValueBand", e.target.value)}>
              <option value="">Derive from estimated damages</option>
              {LITIGATION_VALUE_BANDS.map((value) => <option key={value} value={value}>{valueBandLabel(value)}</option>)}
            </select>
          </div>
        </div>
        <div className="lf-two">
          <div className="lf-field"><label>Cause of action (optional)</label><input value={dossier.causeOfAction} onChange={(e) => d("causeOfAction", e.target.value)} placeholder="e.g. Patent infringement" /></div>
          <div className="lf-field"><label>Case / docket number (optional)</label><input value={dossier.caseNumber} onChange={(e) => d("caseNumber", e.target.value)} placeholder="e.g. [2025] EWHC 123 (Comm)" /></div>
        </div>
        <div className="lf-two">
          <div className="lf-field"><label>Filing date (optional)</label><input type="date" value={dossier.filedAt} onChange={(e) => d("filedAt", e.target.value)} /></div>
          <div className="lf-field"><label>Court detail (optional)</label><input value={dossier.courtDetail} onChange={(e) => d("courtDetail", e.target.value)} placeholder="Division, judge or chamber" /></div>
        </div>
        <div className="lf-two">
          <div className="lf-field"><label>Merit grade</label><select value={dossier.meritGrade} onChange={(e) => d("meritGrade", e.target.value)}>{MERIT_OPTIONS.map((grade) => <option key={grade || "none"} value={grade}>{grade ? `Grade ${grade}` : "Not graded"}</option>)}</select></div>
          <div className="lf-field"><label>Risk grade</label><select value={dossier.riskGrade} onChange={(e) => d("riskGrade", e.target.value)}><option value="">Not graded</option>{RISK_OPTIONS.map((grade) => <option key={grade} value={grade}>{grade.replace("_", " ")}</option>)}</select></div>
        </div>
        <div className="lf-two">
          <div className="lf-field"><label>Estimated damages (USD)</label><input type="number" min="0" step="0.01" value={dossier.estimatedDamagesUsd} onChange={(e) => d("estimatedDamagesUsd", e.target.value)} placeholder="e.g. 4500000" /></div>
          <div className="lf-field"><label>Capital at risk (USD)</label><input type="number" min="0" step="0.01" value={dossier.capitalAtRiskUsd} onChange={(e) => d("capitalAtRiskUsd", e.target.value)} placeholder="e.g. 750000" /></div>
        </div>
        <div className="lf-two">
          <div className="lf-field"><label>Expected multiple (×)</label><input type="number" min="0" step="0.01" value={dossier.expectedMultiple} onChange={(e) => d("expectedMultiple", e.target.value)} placeholder="e.g. 1.75" /></div>
          <div className="lf-field"><label>Expected duration (months)</label><input type="number" min="0" step="1" value={dossier.expectedDurationMonths} onChange={(e) => d("expectedDurationMonths", e.target.value)} placeholder="e.g. 24" /></div>
        </div>
        <div className="lf-two">
          <div className="lf-field"><label>Funding target (USD)</label><input type="number" min="0" step="0.01" value={dossier.fundingAskUsd} onChange={(e) => d("fundingAskUsd", e.target.value)} placeholder="e.g. 550000" /></div>
          <div className="lf-field"><label>Funding deadline</label><input type="date" value={dossier.fundingDeadline} onChange={(e) => d("fundingDeadline", e.target.value)} /></div>
        </div>
        <div className="lf-two">
          <div className="lf-field"><label>Stage</label><select value={dossier.stage} onChange={(e) => d("stage", e.target.value)}>{STAGE_OPTIONS.map((stage) => <option key={stage} value={stage}>{STAGE_LABELS[stage]}</option>)}</select></div>
          <div className="lf-field"><label>Status</label><select value={dossier.status} onChange={(e) => d("status", e.target.value)}>{STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}</select></div>
        </div>
        <div className="lf-two">
          <div className="lf-field"><label>Source label (optional)</label><input value={dossier.source} onChange={(e) => d("source", e.target.value)} placeholder="e.g. Find Case Law (The National Archives)" /></div>
          <div className="lf-field"><label>Source URL {modelOutcomes ? "(required when modelled)" : "(optional)"}</label><input value={dossier.sourceUrl} onChange={(e) => d("sourceUrl", e.target.value)} placeholder="https://public-source.example/judgment" /></div>
        </div>
        <div className="lf-two">
          <div className="lf-field"><label>As of date (optional)</label><input type="date" value={dossier.asOf} onChange={(e) => d("asOf", e.target.value)} /></div>
          <div className="lf-field"><label>Audit reason (optional)</label><input value={dossier.reason} onChange={(e) => d("reason", e.target.value)} placeholder="Reason recorded with this change" /></div>
        </div>

        <div className="lf-field"><label>Problem summary (required)</label><textarea rows={3} maxLength={2000} value={dossier.problem} onChange={(e) => d("problem", e.target.value)} placeholder="Describe the claim, the parties and why the economics are fundable." /></div>
        <div className="lf-field"><label>Highlights (optional, one per line)</label><textarea rows={3} value={dossier.highlightsText} onChange={(e) => d("highlightsText", e.target.value)} placeholder={"Merit reviewed by counsel\nEnforcement already initiated"} /></div>

        <div className="lf-field">
          <label className="cd-checkbox"><input type="checkbox" checked={modelOutcomes} onChange={(e) => setModelOutcomes(e.target.checked)} /> Model outcome scenarios (required to make the case fundable)</label>
          <small>Publishing scenarios requires a funding target and a cited source URL. Probabilities must sum to exactly 100%; the full loss scenario is always shown to customers.</small>
        </div>
        {modelOutcomes && <div className="lf-admin-list">
          {scenarios.map((scenario, index) => <div className="lf-admin-row" key={scenario.outcome}>
            <div className="lf-admin-row-head"><strong>{scenario.outcome}</strong><span className="lf-badge">{percent(toBpsFromPercent(scenario.probabilityPercent))}</span></div>
            <div className="lf-two">
              <div className="lf-field"><label>Label</label><input value={scenario.label} onChange={(e) => setScenario(index, "label", e.target.value)} /></div>
              <div className="lf-field"><label>Probability %</label><input type="number" min="0" max="100" step="0.01" value={scenario.probabilityPercent} onChange={(e) => setScenario(index, "probabilityPercent", e.target.value)} /></div>
            </div>
            <div className="lf-two">
              <div className="lf-field"><label>Gross recovery (USD)</label><input type="number" min="0" step="0.01" value={scenario.grossRecoveryUsd} onChange={(e) => setScenario(index, "grossRecoveryUsd", e.target.value)} /></div>
              <div className="lf-field"><label>Funder multiple (×)</label><input type="number" min="0" step="0.01" value={scenario.funderMultiple} onChange={(e) => setScenario(index, "funderMultiple", e.target.value)} /></div>
            </div>
            <div className="lf-field"><label>Duration (months)</label><input type="number" min="0" step="1" value={scenario.durationMonths} onChange={(e) => setScenario(index, "durationMonths", e.target.value)} /></div>
          </div>)}
          <div className={`lf-notice${scenarioBpsTotal === 10_000 ? " is-success" : " is-error"}`}><div>Scenario probabilities: {percent(scenarioBpsTotal)} of 100%{scenarioBpsTotal === 10_000 ? " — complete" : " — must sum to exactly 100%"}.</div></div>
        </div>}

        <div className="lf-field">
          <label className="cd-checkbox"><input type="checkbox" checked={modelMilestones} onChange={(e) => setModelMilestones(e.target.checked)} /> Customise escrow milestones</label>
          <small>Leave off to use the platform default milestone schedule. When on, release weights must sum to exactly 100% of escrow.</small>
        </div>
        {modelMilestones && <div className="lf-admin-list">
          {milestones.map((milestone, index) => <div className="lf-two" key={milestone.stage}>
            <div className="lf-field"><label>{STAGE_LABELS[milestone.stage] || milestone.stage}</label><input value={milestone.label} onChange={(e) => setMilestone(index, "label", e.target.value)} /></div>
            <div className="lf-field"><label>Release %</label><input type="number" min="0" max="100" step="0.01" value={milestone.releasePercent} onChange={(e) => setMilestone(index, "releasePercent", e.target.value)} /></div>
          </div>)}
          <div className={`lf-notice${milestoneBpsTotal === 10_000 ? " is-success" : " is-error"}`}><div>Escrow release weights: {percent(milestoneBpsTotal)} of 100%{milestoneBpsTotal === 10_000 ? " — complete" : " — must sum to exactly 100%"}.</div></div>
        </div>}

        {(scenarioErrors || milestoneErrors) && <div className="lf-notice is-error" role="alert"><AlertTriangle size={15}/><div>{scenarioErrors}{milestoneErrors}</div></div>}

        <div className="lf-admin-actions">
          <button className="lf-btn primary" type="button" disabled={!dossierValid || pending} onClick={submitDossier}>
            {pending ? "Saving…" : editingDossierId ? "Save changes" : "Publish dossier"} <Check size={14}/>
          </button>
          <span className="lf-card-meta"><ShieldCheck size={13}/> New dossiers are enabled on publish and appear on the customer desk beside the live cited records.</span>
        </div>
      </div>

      <div className="lf-admin-list">
        <div className="lf-section-head"><span className="eyebrow">Published dossiers ({dossierRows.length}) · {fundableCount} fundable</span></div>
        {!dossierRows.length && <div className="lf-empty"><Gavel size={16}/> No administrator dossiers yet. Publish one above to make a cited case fundable.</div>}
        {dossierRows.map((row) => {
          const reached = (row.milestones || []).filter((milestone: any) => milestone.status === "REACHED").length;
          const pendingMilestones = (row.milestones || []).filter((milestone: any) => milestone.status !== "REACHED");
          const fundable = row.status === "FUNDING" && row.scenarios.length > 0 && row.fundingAskMinor > 0;
          return <div className="lf-admin-row" key={row.dossierId}>
            <div className="lf-admin-row-head">
              <div>
                <strong>{row.flag} {row.caseName}</strong>
                <div className="lf-card-meta"><span>{row.claimant} v {row.defendant}</span><span>{row.jurisdiction} · {row.court}</span></div>
              </div>
              <div className="lf-badges">
                {row.caseClass && <span className={`lf-badge lf-badge--class${isInsolvency(row) ? " lf-badge--insolvency" : ""}`}>{caseClassLabel(row.caseClass)}</span>}
                {row.meritGrade && <span className={`lf-badge lf-badge--merit-${String(row.meritGrade).toLowerCase()}`}>Merit {row.meritGrade}</span>}
                <span className={`lf-badge lf-badge--status-${String(row.status).toLowerCase()}`}>{row.status}</span>
                <span className="lf-badge lf-badge--stage">{STAGE_LABELS[row.stage] || row.stage}</span>
                <span className={`lf-badge`}>{row.enabled ? "Enabled" : "Disabled"}</span>
              </div>
            </div>
            <div className="lf-card-meta">
              <span>Target {money(row.fundingAskMinor)} · committed {money(row.committedMinor)}</span>
              <span>Expected {multiple(row.expectedMultipleBps)}{row.expectedDurationMonths ? ` · ${row.expectedDurationMonths}mo` : ""}</span>
              {row.claimValueBand && <span>Claim {valueBandLabel(row.claimValueBand)}</span>}
              {row.causeOfAction && <span>{row.causeOfAction}</span>}
              {row.caseNumber && <span className="lf-mono">{row.caseNumber}</span>}
              {row.filedAt && <span>Filed {row.filedAt}</span>}
              {row.courtDetail && <span>{row.courtDetail}</span>}
              <span>{row.scenarios.length ? `${row.scenarios.length} scenarios` : "Not modelled"}</span>
              <span>{reached} of {(row.milestones || []).length} milestones reached</span>
              {row.outcome && <span className="lf-badge">Outcome {row.outcome}</span>}
              <span>ID {row.dossierId}</span>
            </div>
            {row.scenarios.length > 0 && <div className="lf-scenarios">{row.scenarios.map((scenario: any) => <div className={`lf-scenario lf-scenario--${String(scenario.outcome).toLowerCase()}`} key={scenario.outcome}><span className="lf-scenario-head">{scenario.outcome}</span><span>{percent(scenario.probabilityBps)} · {money(scenario.grossRecoveryMinor)} · {scenario.durationMonths}mo · {multiple(scenario.funderMultipleBps)}</span></div>)}</div>}

            <div className="lf-admin-actions">
              <button className="lf-btn lf-btn-sm" type="button" onClick={() => beginEditDossier(row)}>Edit</button>
              <button className="lf-btn lf-btn-sm" type="button" disabled={toggleDossier.isPending} onClick={() => toggleDossier.mutate({ dossierId: row.dossierId, enabled: !row.enabled })}>{row.enabled ? "Disable" : "Enable"}</button>
              <select value="" aria-label="Set status" disabled={setStatus.isPending} onChange={(e) => { if (e.target.value) setStatus.mutate({ dossierId: row.dossierId, status: e.target.value as any, reason: "Administrator status change" }); }}>
                <option value="">Set status…</option>
                {STATUS_OPTIONS.filter((status) => status !== row.status).map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
              {pendingMilestones.length > 0 && <select value="" aria-label="Reach milestone" disabled={reachMilestone.isPending} onChange={(e) => { if (e.target.value) reachMilestone.mutate({ dossierId: row.dossierId, stage: e.target.value as any, reason: "Administrator milestone update" }); }}>
                <option value="">Reach milestone…</option>
                {pendingMilestones.map((milestone: any) => <option key={milestone.stage} value={milestone.stage}>{milestone.label}</option>)}
              </select>}
              {row.scenarios.length > 0 && !row.outcome && <select value="" aria-label="Record outcome" disabled={recordOutcome.isPending} onChange={(e) => { const outcome = e.target.value; if (outcome && window.confirm(`Record ${outcome} for “${row.caseName}”? This pays or writes off every funder and can never be undone.`)) recordOutcome.mutate({ dossierId: row.dossierId, outcome: outcome as any, reason: "Administrator outcome" }); }}>
                <option value="">Record outcome…</option>
                {OUTCOME_OPTIONS.map((outcome) => <option key={outcome} value={outcome}>{outcome}</option>)}
              </select>}
              <button className="lf-btn lf-btn-sm danger" type="button" disabled={deleteDossier.isPending} onClick={() => { if (window.confirm(`Delete dossier “${row.caseName}”? It is removed from the customer desk.`)) deleteDossier.mutate({ dossierId: row.dossierId }); }}><Trash2 size={13}/> Delete</button>
            </div>
            {!fundable && row.scenarios.length > 0 && <div className="lf-unfundable"><AlertTriangle size={13}/> Not currently fundable — status is {row.status} or the target is unset.</div>}
            {!row.scenarios.length && <div className="lf-unfundable"><AlertTriangle size={13}/> Not modelled — cannot be invested until scenarios and a funding target are published.</div>}
          </div>;
        })}
      </div>
    </div>}

    {tab === "bundles" && <div className="lf-admin">
      <div className="lf-admin-form">
        <div className="lf-section-head"><div><span className="eyebrow">{editingBundleId ? "Edit bundle" : "Publish bundle"}</span><h2>{editingBundleId ? editingBundleId : "New case bundle"}</h2></div>{editingBundleId && <button className="lf-btn lf-btn-sm" type="button" onClick={resetBundleForm}>Cancel edit</button>}</div>

        <div className="lf-two">
          <div className="lf-field"><label>Bundle name</label><input value={bundle.name} onChange={(e) => b("name", e.target.value)} placeholder="e.g. UK Commercial Claims 2026" /></div>
          <div className="lf-field"><label>Claim type</label><input value={bundle.claimType} onChange={(e) => b("claimType", e.target.value)} placeholder="e.g. Commercial contract" /></div>
        </div>
        <div className="lf-two">
          <div className="lf-field"><label>Jurisdiction</label><input value={bundle.jurisdiction} onChange={(e) => b("jurisdiction", e.target.value)} placeholder="e.g. England & Wales" /></div>
          <div className="lf-field"><label>Risk grade</label><select value={bundle.riskGrade} onChange={(e) => b("riskGrade", e.target.value)}>{RISK_OPTIONS.map((grade) => <option key={grade} value={grade}>{grade.replace("_", " ")}</option>)}</select></div>
        </div>
        <div className="lf-two">
          <div className="lf-field"><label>Funding target (USD)</label><input type="number" min="0" step="0.01" value={bundle.targetUsd} onChange={(e) => b("targetUsd", e.target.value)} placeholder="e.g. 2000000" /></div>
          <div className="lf-field"><label>Unit price (USD)</label><input type="number" min="0" step="0.01" value={bundle.unitPriceUsd} onChange={(e) => b("unitPriceUsd", e.target.value)} placeholder="e.g. 1000" /></div>
        </div>
        <div className="lf-two">
          <div className="lf-field"><label>Total units</label><input type="number" min="1" step="1" value={bundle.unitCount} onChange={(e) => b("unitCount", e.target.value)} placeholder="e.g. 2000" /></div>
          <div className="lf-field"><label>Expected multiple (×)</label><input type="number" min="0" step="0.01" value={bundle.expectedMultiple} onChange={(e) => b("expectedMultiple", e.target.value)} placeholder="e.g. 1.35" /></div>
        </div>
        <div className="lf-field"><label>Expected duration (months)</label><input type="number" min="0" step="1" value={bundle.expectedDurationMonths} onChange={(e) => b("expectedDurationMonths", e.target.value)} placeholder="e.g. 30" /></div>

        <div className="lf-field"><label>Case ids (optional, one per line)</label><textarea rows={3} value={bundle.caseIdsText} onChange={(e) => b("caseIdsText", e.target.value)} placeholder={"admin-okafor-v-northwind-a1b2\nus-fr-2026-1234"} /></div>
        <div className="lf-field"><label>Per-case allocation weights (optional, <span className="lf-mono">caseId=bps</span> per line, must sum to 10000)</label><textarea rows={3} value={allocationsText} onChange={(e) => setAllocationsText(e.target.value)} placeholder={"admin-okafor-v-northwind-a1b2=6000\nus-fr-2026-1234=4000"} /></div>

        <div className="lf-field"><label>Summary (optional)</label><textarea rows={2} maxLength={2000} value={bundle.summary} onChange={(e) => b("summary", e.target.value)} placeholder="A short description customers will read. Left blank, a summary is generated." /></div>
        <div className="lf-two">
          <div className="lf-field"><label>Source label (optional)</label><input value={bundle.source} onChange={(e) => b("source", e.target.value)} placeholder="Source of the case set" /></div>
          <div className="lf-field"><label>As of date (optional)</label><input type="date" value={bundle.asOf} onChange={(e) => b("asOf", e.target.value)} /></div>
        </div>
        <div className="lf-field"><label>Audit reason (optional)</label><input value={bundle.reason} onChange={(e) => b("reason", e.target.value)} placeholder="Reason recorded with this change" /></div>

        <div className="lf-admin-actions">
          <button className="lf-btn primary" type="button" disabled={!bundleValid || pending} onClick={submitBundle}>{pending ? "Saving…" : editingBundleId ? "Save changes" : "Publish bundle"} <Check size={14}/></button>
          <span className="lf-card-meta"><Layers size={13}/> Funders receive a pro-rata share of realised recoveries, allocated per case by the weights above.</span>
        </div>
      </div>

      <div className="lf-admin-list">
        <div className="lf-section-head"><span className="eyebrow">Published bundles ({bundleRows.length})</span></div>
        {!bundleRows.length && <div className="lf-empty"><Layers size={16}/> No bundles yet. Publish one above to pool claims for customers.</div>}
        {bundleRows.map((row) => {
          const fundedBps = row.targetMinor > 0 ? Math.min(10_000, Math.round((row.committedMinor * 10_000) / row.targetMinor)) : 0;
          return <div className="lf-admin-row" key={row.bundleId}>
            <div className="lf-admin-row-head">
              <div><strong>{row.name}</strong><div className="lf-card-meta"><span>{row.jurisdiction} · {row.claimType}</span></div></div>
              <div className="lf-badges"><span className={`lf-badge lf-badge--risk-${String(row.riskGrade).toLowerCase()}`}>{String(row.riskGrade).replace("_", " ")}</span><span className="lf-badge">{row.enabled ? "Enabled" : "Disabled"}</span></div>
            </div>
            <div className="lf-card-meta">
              <span>Target {money(row.targetMinor)} · committed {money(row.committedMinor)} ({percent(fundedBps)})</span>
              <span>Unit {money(row.unitPriceMinor)} × {Number(row.unitCount).toLocaleString()}</span>
              <span>Expected {multiple(row.expectedMultipleBps)}</span>
              <span>ID {row.bundleId}</span>
            </div>
            <div className="lf-bundle-alloc">
              <span>{row.caseIds.length} case{row.caseIds.length === 1 ? "" : "s"}:</span>
              {row.caseIds.map((caseId: string) => <span className="lf-badge" key={caseId}>{caseId} · {percent(row.allocationBpsByCase[caseId] || 0)}</span>)}
            </div>
            <div className="lf-admin-actions">
              <button className="lf-btn lf-btn-sm" type="button" onClick={() => beginEditBundle(row)}>Edit</button>
              <button className="lf-btn lf-btn-sm" type="button" disabled={toggleBundle.isPending} onClick={() => toggleBundle.mutate({ bundleId: row.bundleId, enabled: !row.enabled })}>{row.enabled ? "Disable" : "Enable"}</button>
              <button className="lf-btn lf-btn-sm danger" type="button" disabled={deleteBundle.isPending} onClick={() => { if (window.confirm(`Delete bundle “${row.name}”?`)) deleteBundle.mutate({ bundleId: row.bundleId }); }}><Trash2 size={13}/> Delete</button>
            </div>
          </div>;
        })}
      </div>
    </div>}

    {tab === "settle" && <div className="lf-admin">
      <div className="lf-admin-list">
        <div className="lf-section-head"><div><span className="eyebrow">Settle open cases ({openCaseRows.length}) · {money(settleTotalMinor)} committed</span><h2>Resolve funded cases directly</h2></div></div>
        <div className="lf-notice">
          <Gavel size={15}/>
          <div>Every cited case on the desk is fundable without a dossier, so a case can carry customer commitments even when no administrator economics were ever published. Choose the outcome and the funder multiple here to release escrow and pay or write off every open position on the case. Positions locked as principal are released, a payout is credited as a withdrawable ledger entry, and a loss writes the principal off. This cannot be undone.</div>
        </div>
        {!openCaseRows.length && <div className="lf-empty"><Gavel size={16}/> No cases carry open commitments right now. Funded cases appear here for settlement.</div>}
        {openCaseRows.map((row) => {
          const form = settleFormFor(row.instrumentId);
          const payoutPreview = form.outcome === "LOSE" ? 0 : Math.round((Number(row.committedMinor || 0) * toBpsFromPercent(form.multiplePercent)) / 10_000);
          return <div className="lf-admin-row" key={row.instrumentId}>
            <div className="lf-admin-row-head">
              <div>
                <strong>{row.caseName}</strong>
                <div className="lf-card-meta"><span className="lf-mono">ID {row.instrumentId}</span></div>
              </div>
              <div className="lf-badges"><span className="lf-badge">{row.openPositions} open position{row.openPositions === 1 ? "" : "s"}</span><span className="lf-badge">{money(row.committedMinor)} committed</span></div>
            </div>
            <div className="lf-two">
              <div className="lf-field"><label>Outcome</label>
                <select value={form.outcome} onChange={(e) => setSettleForm(row.instrumentId, "outcome", e.target.value)}>
                  {OUTCOME_OPTIONS.map((outcome) => <option key={outcome} value={outcome}>{outcome === "SETTLE" ? "Settle" : outcome === "WIN" ? "Win" : "Lose"}</option>)}
                </select>
              </div>
              <div className="lf-field"><label>Funder multiple (%)</label>
                <input type="number" min="0" step="1" value={form.multiplePercent} disabled={form.outcome === "LOSE"} onChange={(e) => setSettleForm(row.instrumentId, "multiplePercent", e.target.value)} />
                <small>{form.outcome === "LOSE" ? "A loss writes every principal off; no multiple is applied." : `Funders receive principal × ${multiple(toBpsFromPercent(form.multiplePercent))}.`}</small>
              </div>
            </div>
            <div className="lf-field"><label>Reason (optional)</label><input value={form.reason} onChange={(e) => setSettleForm(row.instrumentId, "reason", e.target.value)} placeholder="e.g. Settlement approved at 1.40x on 2026-05-01" /></div>
            <div className="lf-card-meta">
              <span>Payout preview {money(payoutPreview)} of {money(row.committedMinor)} committed</span>
              {form.outcome === "LOSE" && <span>{money(row.committedMinor)} written off</span>}
            </div>
            <div className="lf-admin-actions">
              <button className="lf-btn primary" type="button" disabled={settleCase.isPending} onClick={() => runSettleCase(row)}>
                {settleCase.isPending ? "Settling…" : `Settle as ${form.outcome} at ${form.outcome === "LOSE" ? "0.00x" : multiple(toBpsFromPercent(form.multiplePercent))}`} <Check size={14}/>
              </button>
            </div>
          </div>;
        })}
      </div>
    </div>}

    <div className="lf-notice">
      <Scale size={15}/>
      <div>The discovery layer (real, cited public court records) is read-only here and served live from the platform catalogue. This console writes administrator dossiers and bundles, and settles funded cases, to the platform database. Every change is audited. Publishing economics requires a cited source URL, scenarios that sum to 100% and include the loss case; a case can be funded without one. Settlement releases escrow and pays or writes off every open position exactly once — payouts and write-offs are internal-ledger compensating entries and are never edited afterwards.</div>
    </div>
  </div>;
}
