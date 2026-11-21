import { useState } from "react";
import { Building2, Check, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { COUNTRY_OPTIONS, flagFor } from "@shared/country-options";

const STATUS_OPTIONS = [
  { id: "INSOLVENT", label: "Insolvent" },
  { id: "WINDING_UP", label: "Winding up" },
  { id: "DISTRESSED", label: "Distressed" },
  { id: "DISSOLVED", label: "Dissolved" },
  { id: "SEEKING_ACQUIRER", label: "Seeking acquirer" },
  { id: "STARTUP", label: "Start-up" },
];

const SEVERITY_OPTIONS = [
  { id: "CRITICAL", label: "Critical (litigation imminent)" },
  { id: "HIGH", label: "High" },
  { id: "ELEVATED", label: "Elevated" },
  { id: "WATCH", label: "Watch" },
];

const COUNTDOWN_DIRECTIONS = [
  { id: "until", label: "Countdown until the date" },
  { id: "since", label: "Count-up since the date" },
];

const emptyForm = () => ({
  name: "",
  legalName: "",
  countryCode: "US",
  city: "",
  state: "",
  region: "",
  foundedYear: "",
  foundedMonth: "",
  foundersText: "",
  keyPeopleText: "",
  companyType: "",
  sectorsText: "",
  regulator: "",
  problem: "",
  staffCount: "",
  staffRange: "",
  financialStatus: "",
  netWorthNote: "",
  regulatorStatus: "",
  status: "DISTRESSED",
  severity: "HIGH",
  countdownLabel: "",
  countdownDate: "",
  countdownDirection: "",
  ownershipOpportunity: "",
  capitalAskUsd: "",
  sourceUrl: "",
  summary: "",
  highlightsText: "",
  registrationNumber: "",
  lei: "",
  ticker: "",
  cik: "",
  reason: "",
});

type FormState = ReturnType<typeof emptyForm>;

const lines = (value: string, max: number) =>
  value.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, max);

function money(minor: number | null, currency = "USD") {
  const value = Number(minor || 0) / 100;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}

/**
 * Administrator console for publishing Cooperate Dept companies. Everything the
 * customer desk shows (country, distress status, countdown, finances, founders,
 * regulator, capital requirement and presentation copy) is entered here. The
 * country flag is derived from the selected country and the record is enabled on
 * publish, so it appears on the customer desk beside the live public-register
 * companies with the same wallet-ledger commitment flow.
 */
export function AdminCooperateDept() {
  const utils = trpc.useUtils();
  const query = trpc.adminOperations.cooperateDeptCompanies.useQuery(undefined, { refetchInterval: 20000 });
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">("success");

  const onSaved = (text: string) => {
    setMessageKind("success");
    setMessage(text);
    utils.adminOperations.cooperateDeptCompanies.invalidate();
    void utils.customer.cooperateDept.market.invalidate();
  };
  const onFailed = (error: { message: string }) => {
    setMessageKind("error");
    setMessage(error.message);
  };

  const create = trpc.adminOperations.createCooperateDeptCompany.useMutation({
    onSuccess: (row: any) => { setForm(emptyForm()); onSaved(`Published “${row.name}” (${row.companyId}). It is enabled and now visible on the customer desk.`); },
    onError: onFailed,
  });
  const update = trpc.adminOperations.updateCooperateDeptCompany.useMutation({
    onSuccess: (row: any) => { setEditingId(null); setForm(emptyForm()); onSaved(`Updated “${row.name}” and re-derived its country flag.`); },
    onError: onFailed,
  });
  const toggle = trpc.adminOperations.setCooperateDeptCompanyEnabled.useMutation({
    onSuccess: (row: any) => onSaved(`${row.name} is now ${row.enabled ? "enabled on" : "removed from"} the customer desk.`),
    onError: onFailed,
  });
  const remove = trpc.adminOperations.deleteCooperateDeptCompany.useMutation({
    onSuccess: (result: any) => onSaved(`Deleted ${result.companyId}.`),
    onError: onFailed,
  });

  const patch = (key: keyof FormState, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const selectCountry = (code: string) => setForm((current) => ({ ...current, countryCode: code }));

  const beginEdit = (row: any) => {
    setEditingId(row.companyId);
    setMessage("");
    setForm({
      name: row.name,
      legalName: row.legalName === row.name ? "" : row.legalName || "",
      countryCode: row.countryCode,
      city: row.city || "",
      state: row.state || "",
      region: row.region || "",
      foundedYear: row.foundedYear === null || row.foundedYear === undefined ? "" : String(row.foundedYear),
      foundedMonth: row.foundedMonth === null || row.foundedMonth === undefined ? "" : String(row.foundedMonth),
      foundersText: Array.isArray(row.founders) ? row.founders.join("\n") : "",
      keyPeopleText: Array.isArray(row.keyPeople) ? row.keyPeople.join("\n") : "",
      companyType: row.companyType || "",
      sectorsText: Array.isArray(row.sectors) ? row.sectors.join("\n") : "",
      regulator: row.regulator || "",
      problem: row.problem || "",
      staffCount: row.staffCount === null || row.staffCount === undefined ? "" : String(row.staffCount),
      staffRange: row.staffRange || "",
      financialStatus: row.financialStatus || "",
      netWorthNote: row.netWorthNote || "",
      regulatorStatus: row.regulatorStatus || "",
      status: row.status,
      severity: row.severity,
      countdownLabel: row.countdownLabel || "",
      countdownDate: row.countdownDate || "",
      countdownDirection: row.countdownDirection || "",
      ownershipOpportunity: row.ownershipOpportunity || "",
      capitalAskUsd: row.capitalAskMinor === null || row.capitalAskMinor === undefined ? "" : String(Number(row.capitalAskMinor) / 100 || ""),
      sourceUrl: row.sourceUrl || "",
      summary: row.summary || "",
      highlightsText: Array.isArray(row.highlights) ? row.highlights.join("\n") : "",
      registrationNumber: row.identity?.registrationNumber || "",
      lei: row.identity?.lei || "",
      ticker: row.identity?.ticker || "",
      cik: row.identity?.cik || "",
      reason: "",
    });
  };
  const cancelEdit = () => { setEditingId(null); setForm(emptyForm()); setMessage(""); };

  const foundedYearValue = form.foundedYear.trim() ? Number(form.foundedYear) : null;
  const foundedMonthValue = form.foundedMonth.trim() ? Number(form.foundedMonth) : null;
  const staffCountValue = form.staffCount.trim() ? Number(form.staffCount) : null;
  const capitalValue = form.capitalAskUsd.trim() ? Number(form.capitalAskUsd) : null;

  const countdownDateValid = !form.countdownDate.trim() ? !form.countdownDirection : /^\d{4}-\d{2}-\d{2}$/.test(form.countdownDate.trim()) && Boolean(form.countdownDirection);

  const valid = form.name.trim().length >= 3
    && /^[A-Za-z]{2}$/.test(form.countryCode)
    && form.companyType.trim().length >= 2
    && form.problem.trim().length >= 8
    && form.financialStatus.trim().length >= 2
    && form.ownershipOpportunity.trim().length >= 3
    && (foundedYearValue === null || (Number.isInteger(foundedYearValue) && foundedYearValue >= 1500 && foundedYearValue <= 2100))
    && (foundedMonthValue === null || (Number.isInteger(foundedMonthValue) && foundedMonthValue >= 1 && foundedMonthValue <= 12))
    && !(foundedMonthValue !== null && foundedYearValue === null)
    && (staffCountValue === null || (Number.isInteger(staffCountValue) && staffCountValue >= 0))
    && (capitalValue === null || (Number.isFinite(capitalValue) && capitalValue >= 0 && capitalValue <= 1_000_000_000))
    && countdownDateValid;

  const submit = () => {
    const payload: any = {
      name: form.name.trim(),
      legalName: form.legalName.trim() || undefined,
      countryCode: form.countryCode.toUpperCase(),
      city: form.city.trim() || undefined,
      state: form.state.trim() || undefined,
      region: form.region.trim() || undefined,
      foundedYear: foundedYearValue,
      foundedMonth: foundedMonthValue,
      founders: lines(form.foundersText, 6),
      keyPeople: lines(form.keyPeopleText, 6),
      companyType: form.companyType.trim(),
      sectors: lines(form.sectorsText, 8),
      regulator: form.regulator.trim() || undefined,
      problem: form.problem.trim(),
      staffCount: staffCountValue,
      staffRange: form.staffRange.trim() || undefined,
      financialStatus: form.financialStatus.trim(),
      netWorthNote: form.netWorthNote.trim() || undefined,
      regulatorStatus: form.regulatorStatus.trim() || undefined,
      status: form.status as any,
      severity: form.severity as any,
      countdownLabel: form.countdownLabel.trim() || undefined,
      countdownDate: form.countdownDirection ? form.countdownDate.trim() : undefined,
      countdownDirection: form.countdownDirection ? (form.countdownDirection as "until" | "since") : undefined,
      ownershipOpportunity: form.ownershipOpportunity.trim(),
      capitalAskMinor: capitalValue === null ? null : Math.round(capitalValue * 100),
      sourceUrl: form.sourceUrl.trim() || undefined,
      summary: form.summary.trim() || undefined,
      highlights: lines(form.highlightsText, 8),
      registrationNumber: form.registrationNumber.trim() || undefined,
      lei: form.lei.trim() || undefined,
      ticker: form.ticker.trim() || undefined,
      cik: form.cik.trim() || undefined,
      reason: form.reason.trim() || undefined,
    };
    if (editingId) update.mutate({ companyId: editingId, ...payload });
    else create.mutate(payload);
  };

  const pending = create.isPending || update.isPending;
  const rows: any[] = query.data || [];

  return (
    <div className="arb-page portal-page">
      <div className="portal-page-top">
        <div>
          <div className="eyebrow">Company publishing · Cooperate Dept</div>
          <h1>Cooperate Dept companies</h1>
          <p>Publish distressed companies and start-ups that need investors to buy them, recapitalise them or take ownership. Everything shown on the customer desk is entered here; the country flag is generated from the country you select.</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => void query.refetch()} disabled={query.isFetching}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {message && (
        <div className={messageKind === "error" ? "test-notice error" : "test-notice"} role={messageKind === "error" ? "alert" : "status"} aria-live="polite">
          <ShieldCheck size={14} /><span>{message}</span>
        </div>
      )}

      <div className="settings-card">
        <div className="eyebrow">{editingId ? "Edit company" : "Create company"}</div>
        <h2>{editingId ? `Editing ${editingId}` : "New Cooperate Dept company"}</h2>

        <div className="form-two">
          <label>Company name<input value={form.name} onChange={(e) => patch("name", e.target.value)} placeholder="e.g. Northwind Logistics Ltd" /></label>
          <label>Legal name (optional)<input value={form.legalName} onChange={(e) => patch("legalName", e.target.value)} placeholder="Registered legal name" /></label>
        </div>

        <div className="form-two">
          <label>Country
            <select value={form.countryCode} onChange={(e) => selectCountry(e.target.value)}>
              {COUNTRY_OPTIONS.map((country) => (
                <option key={country.code} value={country.code}>{flagFor(country.code)} {country.name} ({country.code})</option>
              ))}
            </select>
            <small>Flag preview: <strong>{flagFor(form.countryCode)}</strong> · derived automatically from {form.countryCode.toUpperCase()}</small>
          </label>
          <label>Type of company<input value={form.companyType} onChange={(e) => patch("companyType", e.target.value)} placeholder="e.g. Private limited company" /></label>
        </div>

        <div className="form-two">
          <label>City<input value={form.city} onChange={(e) => patch("city", e.target.value)} placeholder="e.g. Manchester" /></label>
          <label>State / province<input value={form.state} onChange={(e) => patch("state", e.target.value)} placeholder="e.g. Bavaria" /></label>
        </div>

        <div className="form-two">
          <label>Region<input value={form.region} onChange={(e) => patch("region", e.target.value)} placeholder="e.g. Europe" /></label>
          <label>Regulator<input value={form.regulator} onChange={(e) => patch("regulator", e.target.value)} placeholder="e.g. Companies House" /></label>
        </div>

        <div className="form-two">
          <label>Founded year<input type="number" min="1500" max="2100" step="1" value={form.foundedYear} onChange={(e) => patch("foundedYear", e.target.value)} placeholder="e.g. 2016" /></label>
          <label>Founded month<input type="number" min="1" max="12" step="1" value={form.foundedMonth} onChange={(e) => patch("foundedMonth", e.target.value)} placeholder="1–12" /></label>
        </div>

        <div className="form-two">
          <label>Staff count<input type="number" min="0" step="1" value={form.staffCount} onChange={(e) => patch("staffCount", e.target.value)} placeholder="e.g. 240" /></label>
          <label>Staff range (optional)<input value={form.staffRange} onChange={(e) => patch("staffRange", e.target.value)} placeholder="e.g. 250 to 499" /></label>
        </div>

        <div className="form-two">
          <label>Financial status<input value={form.financialStatus} onChange={(e) => patch("financialStatus", e.target.value)} placeholder="e.g. Insolvent — administration filed" /></label>
          <label>Regulator status<input value={form.regulatorStatus} onChange={(e) => patch("regulatorStatus", e.target.value)} placeholder="e.g. Liquidation petition listed" /></label>
        </div>

        <div className="form-two">
          <label>Status
            <select value={form.status} onChange={(e) => patch("status", e.target.value)}>
              {STATUS_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </label>
          <label>Distress severity
            <select value={form.severity} onChange={(e) => patch("severity", e.target.value)}>
              {SEVERITY_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </label>
        </div>

        <div className="form-two">
          <label>Countdown label (optional)<input value={form.countdownLabel} onChange={(e) => patch("countdownLabel", e.target.value)} placeholder="e.g. First court hearing" /></label>
          <label>Countdown date<input type="date" value={form.countdownDate} onChange={(e) => patch("countdownDate", e.target.value)} /></label>
        </div>

        <div className="form-two">
          <label>Countdown direction
            <select value={form.countdownDirection} onChange={(e) => patch("countdownDirection", e.target.value)}>
              <option value="">No countdown</option>
              {COUNTDOWN_DIRECTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
            <small>Only dated events produce a live countdown. Leave blank if no date is published.</small>
          </label>
          <label>Ownership opportunity<input value={form.ownershipOpportunity} onChange={(e) => patch("ownershipOpportunity", e.target.value)} placeholder="e.g. Full ownership of the logistics fleet" /></label>
        </div>

        <div className="form-two">
          <label>Capital requirement (USD)<input type="number" min="0" max="1000000000" step="0.01" value={form.capitalAskUsd} onChange={(e) => patch("capitalAskUsd", e.target.value)} placeholder="e.g. 2500000" /></label>
          <label>Source URL (optional)<input value={form.sourceUrl} onChange={(e) => patch("sourceUrl", e.target.value)} placeholder="https://public-register.example/company" /></label>
        </div>

        <div className="form-two">
          <label>Registration number (optional)<input value={form.registrationNumber} onChange={(e) => patch("registrationNumber", e.target.value)} placeholder="e.g. 09988776" /></label>
          <label>LEI (optional)<input value={form.lei} onChange={(e) => patch("lei", e.target.value)} placeholder="20-character LEI" /></label>
        </div>

        <div className="form-two">
          <label>Ticker (optional)<input value={form.ticker} onChange={(e) => patch("ticker", e.target.value)} placeholder="e.g. NWL" /></label>
          <label>SEC CIK (optional)<input value={form.cik} onChange={(e) => patch("cik", e.target.value)} placeholder="e.g. 0001234567" /></label>
        </div>

        <div className="form-two">
          <label>Founders (optional, one per line)<textarea rows={2} value={form.foundersText} onChange={(e) => patch("foundersText", e.target.value)} placeholder={"Jane Okafor\nDaniel Reyes"} /></label>
          <label>Key people (optional, one per line)<textarea rows={2} value={form.keyPeopleText} onChange={(e) => patch("keyPeopleText", e.target.value)} placeholder={"CEO: Jane Okafor\nCFO: Ravi Menon"} /></label>
        </div>

        <label>Sectors (optional, one per line)<textarea rows={2} value={form.sectorsText} onChange={(e) => patch("sectorsText", e.target.value)} placeholder={"Freight & logistics\nWarehousing"} /></label>
        <label>Problem (required)<textarea rows={3} maxLength={2000} value={form.problem} onChange={(e) => patch("problem", e.target.value)} placeholder="Describe the distress: what went wrong and why the company is available." /></label>
        <label>Net-worth note (optional)<textarea rows={2} maxLength={1000} value={form.netWorthNote} onChange={(e) => patch("netWorthNote", e.target.value)} placeholder="Leave blank to use the standard note. No free register publishes a private company's net worth." /></label>
        <label>Summary (optional)<textarea rows={2} maxLength={2000} value={form.summary} onChange={(e) => patch("summary", e.target.value)} placeholder="A short description customers will read. Left blank, a summary is generated." /></label>
        <label>Highlights (optional, one per line)<textarea rows={3} value={form.highlightsText} onChange={(e) => patch("highlightsText", e.target.value)} placeholder={"Creditor pressure since 2025\nCourt hearing scheduled"} /></label>

        <div className="form-two">
          <label>Audit reason (optional)<input value={form.reason} onChange={(e) => patch("reason", e.target.value)} placeholder="Reason recorded with this change" /></label>
        </div>

        <div className="form-two" style={{ alignItems: "center" }}>
          <button className="primary-button" disabled={!valid || pending} onClick={submit}>
            {pending ? "Saving…" : editingId ? "Save changes" : "Publish company"} <Check size={14} />
          </button>
          {editingId
            ? <button className="secondary-button" type="button" onClick={cancelEdit}>Cancel edit</button>
            : <span className="admin-note"><ShieldCheck size={13} /> New companies are enabled on publish.</span>}
        </div>
      </div>

      <div className="admin-table-card">
        <div className="eyebrow">Published companies ({rows.length})</div>
        {rows.length === 0 && <div className="empty-records" role="status">No administrator companies yet. Publish one above to add it to the customer desk.</div>}
        {rows.map((row) => (
          <div className="customer-table-row" key={row.companyId}>
            <span>
              <strong>{row.flag} {row.name}</strong>
              <small>{row.country} · {row.companyType} · {row.status.replace(/_/g, " ")} · {row.severity}{row.capitalAskMinor !== null ? ` · ask ${money(row.capitalAskMinor, "USD")}` : ""}</small>
              <small>ID {row.companyId} · updated {new Date(row.updatedAt).toLocaleString()}</small>
            </span>
            <b>{row.enabled ? "Enabled" : "Disabled"}</b>
            <button className="secondary-button" type="button" disabled={toggle.isPending || remove.isPending} onClick={() => toggle.mutate({ companyId: row.companyId, enabled: !row.enabled })}>
              {row.enabled ? "Disable" : "Enable"}
            </button>
            <button className="secondary-button" type="button" onClick={() => beginEdit(row)}>Edit</button>
            <button className="secondary-button" type="button" disabled={remove.isPending} onClick={() => { if (window.confirm(`Delete ${row.name}? This removes it from the customer desk.`)) remove.mutate({ companyId: row.companyId }); }}>
              <Trash2 size={13} /> Delete
            </button>
          </div>
        ))}
      </div>

      <div className="admin-note">
        <Building2 size={14} />
        <span>Companies published here are stored in the platform database and merged with the live public-register catalogue. Customers can express interest with the same wallet-ledger commitment flow as every other Cooperate Dept company.</span>
      </div>
    </div>
  );
}
