import { useState } from "react";
import { Check, Landmark, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { COUNTRY_OPTIONS, findCountry, flagFor } from "@shared/country-options";

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

/**
 * Administrator console for manually publishing treasury-bond instruments.
 * Everything an instrument needs (country, issuer, category, rate, tenor,
 * minimum and presentation copy) is entered here; the country flag is derived
 * from the selected country. Saved instruments are enabled immediately and
 * appear on the customer desk with the same purchase button as live data.
 */
export function AdminTreasuryInstruments() {
  const utils = trpc.useUtils();
  const query = trpc.adminOperations.treasuryInstruments.useQuery(undefined, { refetchInterval: 20000 });
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">("success");

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
    </div>
  );
}
