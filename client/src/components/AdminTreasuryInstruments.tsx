import { useMemo, useState } from "react";
import { Check, Gauge, Landmark, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { COUNTRY_OPTIONS, findCountry, flagFor } from "@shared/country-options";
import { ECONOMICS_BOUNDS, INVESTMENT_CURRENCIES, currencyByCode, currencyMinorToUsdMinor, profitRateIsPublished } from "@shared/investment-economics";
import { visibilityAwareRefetchInterval } from "../visibility-aware-polling";

const CATEGORY_OPTIONS = [
  { id: "BILL", label: "Bill (short-dated)" },
  { id: "NOTE", label: "Note" },
  { id: "BOND", label: "Bond" },
  { id: "TIPS", label: "Inflation-linked" },
  { id: "FRN", label: "Floating rate" },
  { id: "BENCHMARK", label: "Benchmark" },
  { id: "SOVEREIGN", label: "Sovereign" },
];

const FREQUENCY_OPTIONS = ["Monthly", "Quarterly", "Semi-annual", "Annual", "At maturity"];

const emptyForm = () => ({
  name: "",
  issuer: "",
  countryCode: "US",
  category: "NOTE",
  tenorYears: "10",
  tenorLabel: "",
  couponRatePct: "",
  couponFrequency: "Annual",
  nativeCurrency: "USD",
  minAmountUsd: "",
  creditQuality: "",
  riskLabel: "",
  paymentMethod: "",
  summary: "",
  highlightsText: "",
  reason: "",
});

type FormState = ReturnType<typeof emptyForm>;

function money(minor: number, currency = "USD") {
  const value = Number(minor || 0) / 100;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}

const percent = (bps: number | null | undefined) => (bps === null || bps === undefined ? "—" : `${(Number(bps) / 100).toFixed(Number(bps) % 100 === 0 ? 0 : 1)}%`);
const toBpsFromPercent = (value: string): number => Math.round((Number(value) || 0) * 100);
const fromBpsToPercent = (bps: number | null | undefined): string => (bps === null || bps === undefined ? "" : String(Number(bps) / 100));

/** Administrator-editable economic profile for one instrument (major units / percent / whole days). */
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
 * Administrator console for manually publishing treasury-bond instruments.
 * Everything an instrument needs (country, issuer, category, rate, tenor,
 * minimum and presentation copy) is entered here; the country flag is derived
 * from the selected country. Saved instruments are enabled immediately and
 * appear on the customer desk with the same purchase button as live data.
 */
export function AdminTreasuryInstruments() {
  const utils = trpc.useUtils();
  const query = trpc.adminOperations.treasuryInstruments.useQuery(undefined, { refetchInterval: (query) => visibilityAwareRefetchInterval(20000, query.state.fetchFailureCount) });
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">("success");
  const [tab, setTab] = useState<"instruments" | "economics">("instruments");
  const [econForms, setEconForms] = useState<Record<string, EconForm>>({});

  // Every administrator-published instrument is a candidate for an auto-assigned
  // economic profile the administrator can review and override.
  const economicsIds = useMemo(
    () => (query.data || []).map((row: any) => String(row.instrumentId)).filter(Boolean),
    [query.data],
  );
  const economicsQuery = trpc.adminOperations.deskEconomicsBatch.useQuery(
    { desk: "treasury", instrumentIds: economicsIds },
    { enabled: economicsIds.length > 0, refetchInterval: (query) => visibilityAwareRefetchInterval(30000, query.state.fetchFailureCount) },
  );

  const onSaved = (text: string) => {
    setMessageKind("success");
    setMessage(text);
    utils.adminOperations.treasuryInstruments.invalidate();
    void utils.customer.treasuryBonds.market.invalidate();
  };
  const onFailed = (error: { message: string }) => {
    setMessageKind("error");
    setMessage(error.message);
  };
  const invalidateEconomics = () => {
    void utils.adminOperations.deskEconomicsBatch.invalidate();
    void utils.customer.treasuryBonds.market.invalidate();
  };

  const create = trpc.adminOperations.createTreasuryInstrument.useMutation({
    onSuccess: (row: any) => { setForm(emptyForm()); onSaved(`Published “${row.name}” (${row.instrumentId}). It is enabled and now visible on the customer desk.`); },
    onError: onFailed,
  });
  const update = trpc.adminOperations.updateTreasuryInstrument.useMutation({
    onSuccess: (row: any) => { setEditingId(null); setForm(emptyForm()); onSaved(`Updated “${row.name}” and re-derived its country flag.`); },
    onError: onFailed,
  });
  const toggle = trpc.adminOperations.setTreasuryInstrumentEnabled.useMutation({
    onSuccess: (row: any) => onSaved(`${row.name} is now ${row.enabled ? "enabled on" : "removed from"} the customer desk.`),
    onError: onFailed,
  });
  const remove = trpc.adminOperations.deleteTreasuryInstrument.useMutation({
    onSuccess: (result: any) => onSaved(`Deleted ${result.instrumentId}.`),
    onError: onFailed,
  });
  const saveEconomics = trpc.adminOperations.setDeskEconomics.useMutation({
    onSuccess: (row: any) => { setEconForms((current) => { const next = { ...current }; delete next[row.instrumentId]; return next; }); invalidateEconomics(); onSaved(`Economic profile saved for ${row.instrumentId}.`); },
    onError: onFailed,
  });
  const reassignEconomics = trpc.adminOperations.reassignDeskEconomics.useMutation({
    onSuccess: (row: any) => { invalidateEconomics(); onSaved(row.source === "ADMIN" ? `${row.instrumentId} keeps its administrator profile.` : `Re-rolled the auto profile for ${row.instrumentId}.`); },
    onError: onFailed,
  });

  const patch = (key: keyof FormState, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const selectCountry = (code: string) => {
    const country = findCountry(code);
    setForm((current) => ({ ...current, countryCode: code, nativeCurrency: country?.currency || current.nativeCurrency }));
  };
  const beginEdit = (row: any) => {
    setEditingId(row.instrumentId);
    setMessage("");
    setForm({
      name: row.name, issuer: row.issuer, countryCode: row.countryCode, category: row.category,
      tenorYears: String(row.tenorYears), tenorLabel: row.tenorLabel || "", couponRatePct: String(row.couponRatePct),
      couponFrequency: row.couponFrequency || "Annual", nativeCurrency: row.nativeCurrency || "USD",
      minAmountUsd: String((Number(row.minInvestmentMinor || 0) / 100) || ""), creditQuality: row.creditQuality || "",
      riskLabel: row.riskLabel || "", paymentMethod: row.paymentMethod || "", summary: row.summary || "",
      highlightsText: Array.isArray(row.highlights) ? row.highlights.join("\n") : "", reason: "",
    });
  };
  const cancelEdit = () => { setEditingId(null); setForm(emptyForm()); setMessage(""); };

  const rateValue = Number(form.couponRatePct);
  const tenorValue = Number(form.tenorYears);
  const minAmountValue = Number(form.minAmountUsd);
  const valid = form.name.trim().length >= 3 && form.issuer.trim().length >= 2 && /^[A-Za-z]{2}$/.test(form.countryCode)
    && form.category && Number.isFinite(tenorValue) && tenorValue > 0 && tenorValue <= 60
    && Number.isFinite(rateValue) && rateValue >= 0 && rateValue <= 100
    && Number.isFinite(minAmountValue) && minAmountValue >= 1 && minAmountValue <= 1_000_000;

  const submit = () => {
    const payload = {
      name: form.name.trim(),
      issuer: form.issuer.trim(),
      countryCode: form.countryCode.toUpperCase(),
      category: form.category as any,
      tenorYears: tenorValue,
      tenorLabel: form.tenorLabel.trim() || undefined,
      couponRatePct: rateValue,
      couponFrequency: form.couponFrequency || undefined,
      nativeCurrency: form.nativeCurrency.trim().toUpperCase() || undefined,
      minInvestmentMinor: Math.round(minAmountValue * 100),
      creditQuality: form.creditQuality.trim() || undefined,
      riskLabel: form.riskLabel.trim() || undefined,
      paymentMethod: form.paymentMethod.trim() || undefined,
      summary: form.summary.trim() || undefined,
      highlights: form.highlightsText.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 8),
      reason: form.reason.trim() || undefined,
    };
    if (editingId) update.mutate({ instrumentId: editingId, ...payload });
    else create.mutate(payload);
  };

  const pending = create.isPending || update.isPending;
  const rows: any[] = query.data || [];

  const econById = useMemo(() => {
    const map = new Map<string, any>();
    for (const row of (economicsQuery.data || []) as any[]) map.set(String(row.instrumentId), row);
    return map;
  }, [economicsQuery.data]);
  const econNameFor = (id: string) => rows.find((row) => String(row.instrumentId) === id)?.name || id;
  // An instrument whose coupon rate the source already publishes carries its own
  // interest rate, so the desk must not set a new profit rate on it.
  const econSourceRated = (id: string): boolean => {
    const row = rows.find((item) => String(item.instrumentId) === id);
    return profitRateIsPublished(row?.couponRatePct);
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
    if (form.profitPercent.trim() && !econSourceRated(id)) patch.profitBps = toBpsFromPercent(form.profitPercent);
    if (form.termDays.trim()) patch.termDays = Math.round(Number(form.termDays));
    if (form.platformFeePercent.trim()) patch.platformFeeBps = toBpsFromPercent(form.platformFeePercent);
    patch.settlementDelayDays = form.settlementDelay.trim() === "" ? null : Math.round(Number(form.settlementDelay));
    if (form.closeDate.trim()) patch.closeDate = form.closeDate.trim();
    if (form.maturityDate.trim()) patch.maturityDate = form.maturityDate.trim();
    saveEconomics.mutate({ desk: "treasury", instrumentId: id, ...patch });
  };
  const runReassignEconomics = (id: string) => {
    if (!window.confirm(`Re-roll the auto-assigned economic profile for ${id}? An administrator profile is not affected.`)) return;
    reassignEconomics.mutate({ desk: "treasury", instrumentId: id, salt: `${Date.now()}-${Math.round(Math.random() * 1e6)}` });
  };

  return (
    <div className="arb-page portal-page">
      <div className="portal-page-top">
        <div>
          <div className="eyebrow">Instrument publishing · Treasury desk</div>
          <h1>Treasury instruments</h1>
          <p>Create treasury-bond instruments manually and publish them straight to the customer desk with a purchase button. The country flag is generated from the country you select.</p>
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

      <div className="settings-tabs" role="tablist" aria-label="Treasury console sections">
        <button type="button" role="tab" aria-selected={tab === "instruments"} className={tab === "instruments" ? "active" : ""} onClick={() => setTab("instruments")}>
          <Landmark size={13} /> Instruments <span>{rows.length}</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === "economics"} className={tab === "economics" ? "active" : ""} onClick={() => setTab("economics")}>
          <Gauge size={13} /> Economic profiles <span>{economicsIds.length}</span>
        </button>
      </div>

      {tab === "instruments" && <>
      <div className="settings-card">
        <div className="eyebrow">{editingId ? "Edit instrument" : "Create instrument"}</div>
        <h2>{editingId ? `Editing ${editingId}` : "New treasury instrument"}</h2>

        <div className="form-two">
          <label>Instrument name<input value={form.name} onChange={(e) => patch("name", e.target.value)} placeholder="e.g. 10-Year Government Bond" /></label>
          <label>Issuer<input value={form.issuer} onChange={(e) => patch("issuer", e.target.value)} placeholder="e.g. Ministry of Finance" /></label>
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
          <label>Category
            <select value={form.category} onChange={(e) => patch("category", e.target.value)}>
              {CATEGORY_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </label>
        </div>

        <div className="form-two">
          <label>Interest rate (% per year)<input type="number" min="0" max="100" step="0.001" value={form.couponRatePct} onChange={(e) => patch("couponRatePct", e.target.value)} placeholder="e.g. 5.25" /></label>
          <label>Tenor (years)<input type="number" min="0.02" max="60" step="0.25" value={form.tenorYears} onChange={(e) => patch("tenorYears", e.target.value)} placeholder="e.g. 10" /></label>
        </div>

        <div className="form-two">
          <label>Tenor label (optional)<input value={form.tenorLabel} onChange={(e) => patch("tenorLabel", e.target.value)} placeholder="Auto, e.g. 10 years" /></label>
          <label>Coupon frequency
            <select value={form.couponFrequency} onChange={(e) => patch("couponFrequency", e.target.value)}>
              {FREQUENCY_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
        </div>

        <div className="form-two">
          <label>Native currency<input value={form.nativeCurrency} onChange={(e) => patch("nativeCurrency", e.target.value.toUpperCase())} placeholder="e.g. USD" /></label>
          <label>Minimum purchase (USD)<input type="number" min="1" max="1000000" step="0.01" value={form.minAmountUsd} onChange={(e) => patch("minAmountUsd", e.target.value)} placeholder="e.g. 1000" /></label>
        </div>

        <div className="form-two">
          <label>Credit quality (optional)<input value={form.creditQuality} onChange={(e) => patch("creditQuality", e.target.value)} placeholder="Default: Investment grade" /></label>
          <label>Risk label (optional)<input value={form.riskLabel} onChange={(e) => patch("riskLabel", e.target.value)} placeholder="Default: Low credit risk" /></label>
        </div>

        <div className="form-two">
          <label>Payment method (optional)<input value={form.paymentMethod} onChange={(e) => patch("paymentMethod", e.target.value)} placeholder="Default: Wallet balance" /></label>
          <label>Audit reason (optional)<input value={form.reason} onChange={(e) => patch("reason", e.target.value)} placeholder="Reason recorded with this change" /></label>
        </div>

        <label>Description (optional)<textarea rows={3} maxLength={2000} value={form.summary} onChange={(e) => patch("summary", e.target.value)} placeholder="A short description customers will read. Left blank, a description is generated." /></label>
        <label>Highlights (optional, one per line)<textarea rows={3} value={form.highlightsText} onChange={(e) => patch("highlightsText", e.target.value)} placeholder={"Issuer: Ministry of Finance\nHighly liquid secondary market"} /></label>

        <div className="form-two" style={{ alignItems: "center" }}>
          <button className="primary-button" disabled={!valid || pending} onClick={submit}>
            {pending ? "Saving…" : editingId ? "Save changes" : "Publish instrument"} <Check size={14} />
          </button>
          {editingId
            ? <button className="secondary-button" type="button" onClick={cancelEdit}>Cancel edit</button>
            : <span className="admin-note"><ShieldCheck size={13} /> New instruments are enabled on publish.</span>}
        </div>
      </div>

      <div className="admin-table-card">
        <div className="eyebrow">Published instruments ({rows.length})</div>
        {rows.length === 0 && <div className="empty-records" role="status">No administrator instruments yet. Publish one above to add it to the customer desk.</div>}
        {rows.map((row) => (
          <div className="customer-table-row" key={row.instrumentId}>
            <span>
              <strong>{row.flag} {row.name}</strong>
              <small>{row.country} · {row.issuer} · {row.category} · {row.tenorLabel} · {Number(row.couponRatePct).toFixed(3)}% · min {money(row.minInvestmentMinor, "USD")}</small>
              <small>ID {row.instrumentId} · updated {new Date(row.updatedAt).toLocaleString()}</small>
            </span>
            <b>{row.enabled ? "Enabled" : "Disabled"}</b>
            <button className="secondary-button" type="button" disabled={toggle.isPending || remove.isPending} onClick={() => toggle.mutate({ instrumentId: row.instrumentId, enabled: !row.enabled })}>
              {row.enabled ? "Disable" : "Enable"}
            </button>
            <button className="secondary-button" type="button" onClick={() => beginEdit(row)}>Edit</button>
            <button className="secondary-button" type="button" disabled={remove.isPending} onClick={() => { if (window.confirm(`Delete ${row.name}? This removes it from the customer desk.`)) remove.mutate({ instrumentId: row.instrumentId }); }}>
              <Trash2 size={13} /> Delete
            </button>
          </div>
        ))}
      </div>

      <div className="admin-note">
        <Landmark size={14} />
        <span>Instruments published here are stored in the platform database and merged with the live public-data catalogue. Customers can purchase them with the same wallet-ledger flow as every other treasury bond.</span>
      </div>
      </>}

      {tab === "economics" && <div className="admin-table-card">
        <div className="eyebrow">Auto-assigned economics ({economicsIds.length})</div>
        <h2>Amount, profit, term, currency &amp; platform fee</h2>
        <div className="test-notice" role="note">
          <Gauge size={14} />
          <span>Every instrument gets a deterministic economic profile the moment it appears on the customer desk — an investable amount from {money(ECONOMICS_BOUNDS.ticketMinMinorUsd)}, a {percent(ECONOMICS_BOUNDS.profitMinBps)}–{percent(ECONOMICS_BOUNDS.profitMaxBps)} profit, a term of {ECONOMICS_BOUNDS.termMinDays}–{ECONOMICS_BOUNDS.termMaxDays} days, a presentation currency and a {percent(ECONOMICS_BOUNDS.platformFeeMinBps)}–{percent(ECONOMICS_BOUNDS.platformFeeMaxBps)} platform fee. Override any value here; a saved profile is marked administrator-authored and is never re-rolled automatically.</span>
        </div>
        {!economicsIds.length && <div className="empty-records" role="status"><Gauge size={16} /> No instruments to profile yet. Publish an instrument above and its economic profile appears here.</div>}
        {economicsIds.map((id) => {
          const econForm = econFormFor(id);
          const profile = econById.get(id);
          const scale = econScale(econForm.currency);
          const ticketMinor = toMinorScaled(econForm.ticketMin, scale);
          const targetMinor = toMinorScaled(econForm.fundingTarget, scale);
          const sourceRated = econSourceRated(id);
          return <div className="settings-card" key={id} style={{ marginTop: "14px" }}>
            <div className="customer-table-row" style={{ border: 0, padding: 0 }}>
              <span>
                <strong>{econNameFor(id)}</strong>
                <small>ID {id}</small>
              </span>
              <b>{profile?.source === "ADMIN" ? "Administrator profile" : "Auto-assigned"}</b>
              {profile?.currency && <b>{profile.currency}</b>}
            </div>
            <div className="form-two">
              <label>Presentation currency
                <select value={econForm.currency} onChange={(e) => setEconForm(id, "currency", e.target.value)}>
                  {INVESTMENT_CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
                </select>
                <small>USD is the dominant choice; the others are for display.</small>
              </label>
              <label>Minimum ticket
                <input type="number" min="0" step="1" value={econForm.ticketMin} onChange={(e) => setEconForm(id, "ticketMin", e.target.value)} />
                <small>{ticketMinor !== null ? `${money(currencyMinorToUsdMinor(ticketMinor, econForm.currency))} USD equivalent · ${scale} decimal place${scale === 1 ? "" : "s"}` : `Enter the amount in ${econForm.currency}`}</small>
              </label>
            </div>
            <div className="form-two">
              <label>Funding target
                <input type="number" min="0" step="1" value={econForm.fundingTarget} onChange={(e) => setEconForm(id, "fundingTarget", e.target.value)} />
                <small>{targetMinor !== null ? `${money(currencyMinorToUsdMinor(targetMinor, econForm.currency))} USD equivalent` : "The capital target"}</small>
              </label>
              <label>Profit (%)
                <input type="number" min="25" max="38" step="0.25" disabled={sourceRated} value={sourceRated ? "" : econForm.profitPercent} onChange={(e) => setEconForm(id, "profitPercent", e.target.value)} placeholder={sourceRated ? "Set by source" : ""} />
                <small>{sourceRated
                  ? "Not set — this instrument's interest rate is published by the source."
                  : `Between ${percent(ECONOMICS_BOUNDS.profitMinBps)} and ${percent(ECONOMICS_BOUNDS.profitMaxBps)}.`}</small>
              </label>
            </div>
            <div className="form-two">
              <label>Term (days)
                <input type="number" min="30" max="365" step="1" value={econForm.termDays} onChange={(e) => setEconForm(id, "termDays", e.target.value)} />
                <small>Days from funding close to realising the profit ({ECONOMICS_BOUNDS.termMinDays}–{ECONOMICS_BOUNDS.termMaxDays}).</small>
              </label>
              <label>Platform fee (%)
                <input type="number" min="7" max="10" step="0.25" value={econForm.platformFeePercent} onChange={(e) => setEconForm(id, "platformFeePercent", e.target.value)} />
                <small>Between {percent(ECONOMICS_BOUNDS.platformFeeMinBps)} and {percent(ECONOMICS_BOUNDS.platformFeeMaxBps)}.</small>
              </label>
            </div>
            <div className="form-two">
              <label>Investment closes
                <input type="date" value={econForm.closeDate} onChange={(e) => setEconForm(id, "closeDate", e.target.value)} />
              </label>
              <label>Profit realised
                <input type="date" value={econForm.maturityDate} onChange={(e) => setEconForm(id, "maturityDate", e.target.value)} />
              </label>
            </div>
            <label>System settlement delay (days — blank for none)
              <input type="number" min="0" max="365" step="1" value={econForm.settlementDelay} onChange={(e) => setEconForm(id, "settlementDelay", e.target.value)} placeholder="e.g. 5" />
              <small>A bolt-on delay applied to some instruments only, so a delayed payout reads as a real exception.</small>
            </label>
            <div className="form-two" style={{ alignItems: "center" }}>
              <button className="primary-button" type="button" disabled={saveEconomics.isPending} onClick={() => runSaveEconomics(id)}>
                {saveEconomics.isPending ? "Saving…" : "Save economic profile"} <Check size={14} />
              </button>
              <button className="secondary-button" type="button" disabled={reassignEconomics.isPending} onClick={() => runReassignEconomics(id)}>
                <RefreshCw size={14} /> Re-roll auto profile
              </button>
            </div>
          </div>;
        })}
      </div>}
    </div>
  );
}
