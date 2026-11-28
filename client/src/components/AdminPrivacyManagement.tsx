import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Archive,
  ArrowDownToLine,
  CheckCircle2,
  ChevronDown,
  Clock3,
  FileClock,
  FileText,
  History,
  Inbox,
  LoaderCircle,
  LockKeyhole,
  MessageSquareText,
  Plus,
  Save,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { buildPrivacyHtmlDocument } from "@/lib/privacyHtml";
import { buildPrivacyRequestCsv, privacyRequestCsvFilename } from "@/lib/privacy-requests";
import {
  DEFAULT_PRIVACY_POLICY_SECTIONS,
  PRIVACY_REQUEST_REVIEW_TARGET_DAYS,
  PRIVACY_REQUEST_TYPES,
  canTransitionPrivacyRequest,
  countPrivacyRequestsByStatus,
  nextPrivacyVersion,
  privacyRequestAgeDays,
  privacyRequestAgingBand,
  privacyRequestAgingLabel,
  privacyRequestAgingSummary,
  privacyRequestGroupCounts,
  privacyRequestStatusLabel,
  sortPrivacyRequests,
  type PrivacyPolicySection,
  type PrivacyRequestSortOrder,
  type PrivacyRequestStatus,
} from "../../../shared/privacy";
import "./privacy-center.css";
import { visibilityAwareRefetchInterval } from "../visibility-aware-polling";

const REQUEST_STATUSES: PrivacyRequestStatus[] = [
  "submitted",
  "identity_check",
  "in_review",
  "awaiting_customer",
  "completed",
  "declined",
  "cancelled",
];

function formatAdminDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const starterSummary = "How information is handled across account services, financial records, security and customer rights.";

export function AdminPrivacyManagement() {
  const policyState = trpc.adminOperations.privacyPolicyState.useQuery(undefined, { retry: 3, staleTime: 15000, refetchInterval: (query) => visibilityAwareRefetchInterval(60000, query.state.fetchFailureCount), refetchOnWindowFocus: false });
  const [requestFilter, setRequestFilter] = useState<"all" | PrivacyRequestStatus>("all");
  const [queueQuery, setQueueQuery] = useState("");
  const [queueSort, setQueueSort] = useState<PrivacyRequestSortOrder>("newest");
  // Fetch the full queue once and filter in the browser so the status summary
  // counts stay accurate while a status filter is active.
  const requestQueue = trpc.adminOperations.privacyRequests.useQuery(undefined, { refetchInterval: (query) => visibilityAwareRefetchInterval(20000, query.state.fetchFailureCount) });
  const [selectedRequestId, setSelectedRequestId] = useState<number | null>(null);
  const requestDetail = trpc.adminOperations.privacyRequestDetail.useQuery(
    { requestId: selectedRequestId || 0 },
    { enabled: selectedRequestId !== null },
  );
  const utils = trpc.useUtils();
  const saveDraft = trpc.adminOperations.savePrivacyPolicyDraft.useMutation();
  const publishPolicy = trpc.adminOperations.publishPrivacyPolicy.useMutation();
  const updateRequest = trpc.adminOperations.updatePrivacyRequest.useMutation();

  const [draftId, setDraftId] = useState<number | undefined>();
  const [title, setTitle] = useState("Privacy Notice");
  const [summary, setSummary] = useState(starterSummary);
  const [controllerName, setControllerName] = useState("Not configured");
  const [controllerAddress, setControllerAddress] = useState("");
  const [privacyContact, setPrivacyContact] = useState("Use the Privacy Centre request form or authenticated Support Centre");
  const [applicableJurisdiction, setApplicableJurisdiction] = useState("");
  const [sections, setSections] = useState<PrivacyPolicySection[]>(DEFAULT_PRIVACY_POLICY_SECTIONS);
  const [htmlContent, setHtmlContent] = useState("");
  const [editorInitialized, setEditorInitialized] = useState(false);
  const [editorTouched, setEditorTouched] = useState(false);
  const editorTouchedFields = useRef(new Set<string>());

  const markEditorFieldTouched = (field: string) => {
    editorTouchedFields.current.add(field);
    setEditorTouched(true);
  };

  const resetEditorTouched = () => {
    editorTouchedFields.current.clear();
    setEditorTouched(false);
  };
  const [publicationReviewed, setPublicationReviewed] = useState(false);
  const [customerMessage, setCustomerMessage] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [requestStatus, setRequestStatus] = useState<PrivacyRequestStatus>("submitted");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [expandedSection, setExpandedSection] = useState<string | null>(DEFAULT_PRIVACY_POLICY_SECTIONS[0]?.id || null);

  useEffect(() => {
    if (editorInitialized) return;
    const draft = policyState.data?.draft;
    const current = policyState.data?.current;
    const source = draft || current;

    // Keep edits typed while the saved policy request was recovering. Populate
    // untouched fields from the server once the state becomes available.
    if (editorTouched) {
      if (policyState.data) {
        setDraftId(draft?.id);
        if (source) {
          if (!editorTouchedFields.current.has("title")) setTitle(source.title);
          if (!editorTouchedFields.current.has("summary")) setSummary(source.summary);
          if (!editorTouchedFields.current.has("controllerName")) setControllerName(source.controllerName || "Not configured");
          if (!editorTouchedFields.current.has("controllerAddress")) setControllerAddress(source.controllerAddress || "");
          if (!editorTouchedFields.current.has("privacyContact")) setPrivacyContact(source.privacyContact || "");
          if (!editorTouchedFields.current.has("applicableJurisdiction")) setApplicableJurisdiction(source.applicableJurisdiction || "");
          if (!editorTouchedFields.current.has("sections")) setSections(source.sections.map((section) => ({ ...section })));
          if (!editorTouchedFields.current.has("htmlContent")) setHtmlContent(source.htmlContent || "");
        } else if (!editorTouchedFields.current.has("sections")) {
          setSections(DEFAULT_PRIVACY_POLICY_SECTIONS.map((section) => ({ ...section })));
        }
        setPublicationReviewed(false);
        setEditorInitialized(true);
        setError("");
        setNotice("Saved policy state loaded. Local edits were preserved; review them before publishing.");
      }
      return;
    }

    if (source) {
      setDraftId(draft?.id);
      setTitle(source.title);
      setSummary(source.summary);
      setControllerName(source.controllerName || "Not configured");
      setControllerAddress(source.controllerAddress || "");
      setPrivacyContact(source.privacyContact || "");
      setApplicableJurisdiction(source.applicableJurisdiction || "");
      setSections(source.sections.map((section) => ({ ...section })));
      setHtmlContent(source.htmlContent || "");
      setPublicationReviewed(false);
      setEditorInitialized(true);
    } else if (policyState.isSuccess) {
      setSections(DEFAULT_PRIVACY_POLICY_SECTIONS.map((section) => ({ ...section })));
      setPublicationReviewed(false);
      setEditorInitialized(true);
    }
  }, [editorInitialized, editorTouched, policyState.data, policyState.isSuccess]);

  useEffect(() => {
    const detail = requestDetail.data;
    if (!detail) return;
    setRequestStatus(detail.status as PrivacyRequestStatus);
    setCustomerMessage("");
    setInternalNote("");
  }, [requestDetail.data?.id, requestDetail.data?.updatedAt, requestDetail.data?.status]);

  const refreshPolicy = async () => {
    await utils.adminOperations.privacyPolicyState.invalidate();
  };

  const handleSaveDraft = async () => {
    setNotice("");
    setError("");
    try {
      const result = await saveDraft.mutateAsync({
        ...(draftId ? { draftId } : {}),
        title,
        summary,
        controllerName,
        controllerAddress,
        privacyContact,
        applicableJurisdiction,
        sections,
        htmlContent,
      });
      setDraftId(result.draftId);
      resetEditorTouched();
      await refreshPolicy();
      setNotice("Draft saved. It remains unpublished until an administrator explicitly publishes it.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The privacy notice draft could not be saved.");
    }
  };

  const handleReloadSavedVersion = async () => {
    setNotice("");
    setError("");
    const refreshed = await policyState.refetch();
    const source = refreshed.data?.draft || refreshed.data?.current;
    if (!source) {
      setError("No saved draft or published notice could be loaded. Your current edits have been left unchanged.");
      return;
    }
    setDraftId(refreshed.data?.draft?.id);
    setTitle(source.title);
    setSummary(source.summary);
    setControllerName(source.controllerName || "Not configured");
    setControllerAddress(source.controllerAddress || "");
    setPrivacyContact(source.privacyContact || "");
    setApplicableJurisdiction(source.applicableJurisdiction || "");
    setSections(source.sections.map((section) => ({ ...section })));
    setHtmlContent(source.htmlContent || "");
    setExpandedSection(source.sections[0]?.id || null);
    setEditorInitialized(true);
    resetEditorTouched();
    setPublicationReviewed(false);
    setNotice("Loaded the latest saved version. Unsaved editor changes have been discarded.");
  };

  const handlePublish = async () => {
    setNotice("");
    setError("");
    try {
      const saved = await saveDraft.mutateAsync({
        ...(draftId ? { draftId } : {}),
        title,
        summary,
        controllerName,
        controllerAddress,
        privacyContact,
        applicableJurisdiction,
        sections,
        htmlContent,
      });
      setDraftId(saved.draftId);
      const result = await publishPolicy.mutateAsync({ draftId: saved.draftId, reviewAcknowledged: true });
      setPublicationReviewed(false);
      resetEditorTouched();
      setDraftId(undefined);
      await refreshPolicy();
      setNotice("Privacy Notice v" + result.versionLabel + " is published. The previous published version has been archived for historical reference.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The privacy notice could not be published.");
    }
  };

  const addSection = () => {
    if (sections.length >= 16) return;
    const suffix = globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const id = "custom-" + suffix.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
    markEditorFieldTouched("sections");
    setSections((existing) => [...existing, { id, title: "", body: "" }]);
    setExpandedSection(id);
    setPublicationReviewed(false);
  };

  const removeSection = (sectionId: string) => {
    if (sections.length <= 6) {
      setError("A published notice needs at least six sections. Add reviewed content before removing another section.");
      return;
    }
    markEditorFieldTouched("sections");
    setSections((existing) => existing.filter((section) => section.id !== sectionId));
    if (expandedSection === sectionId) setExpandedSection(null);
    setPublicationReviewed(false);
  };

  const updateSection = (sectionId: string, patch: Partial<PrivacyPolicySection>) => {
    markEditorFieldTouched("sections");
    setPublicationReviewed(false);
    setSections((existing) => existing.map((section) => section.id === sectionId ? { ...section, ...patch } : section));
  };

  const handleRequestUpdate = async () => {
    if (!selectedRequestId) return;
    setNotice("");
    setError("");
    try {
      const result = await updateRequest.mutateAsync({
        requestId: selectedRequestId,
        status: requestStatus,
        ...(customerMessage.trim() ? { customerMessage: customerMessage.trim() } : {}),
        ...(internalNote.trim() ? { internalNote: internalNote.trim() } : {}),
      });
      setNotice("Request " + result.requestReference + " has been updated.");
      setCustomerMessage("");
      setInternalNote("");
      await Promise.all([
        utils.adminOperations.privacyRequestDetail.invalidate(),
        utils.adminOperations.privacyRequests.invalidate(),
        utils.adminOperations.privacyPolicyState.invalidate(),
      ]);
      await utils.adminOperations.privacyRequestDetail.refetch({ requestId: selectedRequestId });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The privacy request could not be updated.");
    }
  };

  const selectedRequest = requestDetail.data;
  const privacyRequests = requestQueue.data || [];
  const normalizedQueueQuery = queueQuery.trim().toLowerCase();
  const queueGroupCounts = privacyRequestGroupCounts(privacyRequests);
  const queueStatusCounts = countPrivacyRequestsByStatus(privacyRequests);
  const filteredQueue = privacyRequests.filter((request) => {
    if (requestFilter !== "all" && request.status !== requestFilter) return false;
    if (!normalizedQueueQuery) return true;
    return `${request.requestReference} ${request.subject} ${request.customerName || ""} ${request.customerEmail || ""}`.toLowerCase().includes(normalizedQueueQuery);
  });
  const queueFiltered = Boolean(normalizedQueueQuery) || requestFilter !== "all";
  const queueAging = privacyRequestAgingSummary(privacyRequests);
  const orderedQueue = sortPrivacyRequests(filteredQueue, queueSort);

  const exportQueue = () => {
    if (!orderedQueue.length) return;
    const rows = orderedQueue.map((request) => ({
      requestReference: request.requestReference,
      requestType: PRIVACY_REQUEST_TYPES.find((item) => item.value === request.requestType)?.label || request.requestType,
      status: privacyRequestStatusLabel(request.status as PrivacyRequestStatus),
      subject: request.subject,
      createdAt: formatAdminDate(request.createdAt),
      updatedAt: formatAdminDate(request.updatedAt),
      ageDays: privacyRequestAgeDays(request.createdAt),
      customerName: request.customerName || "Customer " + request.userId,
      customerEmail: request.customerEmail || "",
    }));
    const url = URL.createObjectURL(new Blob([buildPrivacyRequestCsv(rows)], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = privacyRequestCsvFilename();
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("Exported " + rows.length + " " + (rows.length === 1 ? "request" : "requests") + " from the current queue view.");
    setError("");
  };
  const hasHtmlNotice = Boolean(htmlContent.trim());
  const canPublish = Boolean(title.trim().length >= 5 && summary.trim().length >= 20 && controllerName.trim().length >= 3 && controllerName.trim().toLowerCase() !== "not configured" && privacyContact.trim().length >= 5 && (hasHtmlNotice || (sections.length >= 6 &&
    sections.every((section) => /^[a-z0-9-]{2,48}$/.test(section.id) && section.title.trim().length >= 3 && section.body.trim().length >= 40) &&
    new Set(sections.map((section) => section.id)).size === sections.length)));
  const published = policyState.data?.current;
  const draft = policyState.data?.draft;

  return (
    <div className="arb-page portal-page privacy-admin-page">
      <div className="portal-page-top privacy-page-top">
        <div>
          <div className="eyebrow">Governance &amp; compliance · Privacy</div>
          <h1>Privacy Management</h1>
          <p>Publish controlled privacy notices and review customer rights requests without exposing unrelated account controls.</p>
        </div>
        <span className="privacy-top-chip"><ShieldCheck size={14} /> Administrator workspace</span>
      </div>

      {notice && <div className="privacy-inline-notice is-success" role="status" aria-live="polite"><CheckCircle2 size={16} /><span>{notice}</span></div>}
      {error && <div className="privacy-inline-notice is-error" role="alert"><AlertCircle size={16} /><span>{error}</span></div>}

      <div className="privacy-overview-grid privacy-admin-overview">
        <div className="privacy-overview-card"><span className="privacy-overview-icon"><FileText size={17} /></span><span className="privacy-overview-label">Published version</span><strong>{published?.versionLabel || "Not published"}</strong><small>{published ? "Published " + formatAdminDate(published.publishedAt) : "A notice needs to be published."}</small></div>
        <div className="privacy-overview-card"><span className="privacy-overview-icon"><FileClock size={17} /></span><span className="privacy-overview-label">Draft status</span><strong>{draft ? "Draft available" : "No draft"}</strong><small>{draft ? "Last saved " + formatAdminDate(draft.updatedAt) : "Start a new revision below."}</small></div>
        <div className="privacy-overview-card"><span className="privacy-overview-icon"><Inbox size={17} /></span><span className="privacy-overview-label">Open requests</span><strong>{requestQueue.isLoading ? "…" : queueGroupCounts.open}</strong><small>{queueGroupCounts.total} total · {queueGroupCounts.closed} closed</small></div>
      </div>

      <section className="privacy-admin-panel" aria-labelledby="privacy-admin-editor">
        <div className="privacy-admin-panel-heading">
          <div className="privacy-admin-heading-icon"><FileText size={19} /></div>
          <div><span className="eyebrow">CONTROLLED PUBLICATION</span><h2 id="privacy-admin-editor">Privacy Notice editor</h2><p>Edits are saved as a draft. Publication creates a new immutable version and archives the previous published notice.</p></div>
        </div>
        {policyState.isLoading && <div className="privacy-loading-panel" role="status"><LoaderCircle size={17} className="privacy-loading-icon" /> Loading current policy state… You can edit fields while loading; local changes will be preserved.</div>}
        {policyState.isError && !policyState.data && <div className="privacy-inline-notice is-error" role="alert"><AlertCircle size={16} /><span>The saved policy state could not be loaded. You can keep editing, but saving and publishing stay disabled until the state loads. Retry to load it.</span><button type="button" className="privacy-secondary-button" onClick={() => void policyState.refetch()} disabled={policyState.isFetching}>{policyState.isFetching ? "Retrying…" : "Retry loading"}</button></div>}
        <>
          <fieldset className="privacy-editor-fieldset">
            <div className="privacy-editor-metadata">
              <label>Notice title<input value={title} onChange={(event) => { setTitle(event.target.value); markEditorFieldTouched("title"); setPublicationReviewed(false); }} maxLength={200} required /></label>
              <label>Customer-facing summary<textarea value={summary} onChange={(event) => { setSummary(event.target.value); markEditorFieldTouched("summary"); setPublicationReviewed(false); }} maxLength={700} rows={3} required /></label>
              <label>Responsible legal organization<input value={controllerName} onChange={(event) => { setControllerName(event.target.value); markEditorFieldTouched("controllerName"); setPublicationReviewed(false); }} maxLength={200} minLength={3} required placeholder="Registered legal entity name" /><small>Use the responsible legal entity name, not only a product or workspace name.</small></label>
              <label>Registered address <span className="privacy-optional-label">Optional</span><textarea value={controllerAddress} onChange={(event) => { setControllerAddress(event.target.value); markEditorFieldTouched("controllerAddress"); setPublicationReviewed(false); }} maxLength={500} rows={2} placeholder="Registered address or official correspondence address" /></label>
              <label>Privacy contact channel<input value={privacyContact} onChange={(event) => { setPrivacyContact(event.target.value); markEditorFieldTouched("privacyContact"); setPublicationReviewed(false); }} maxLength={320} minLength={5} required placeholder="Privacy email or authorized contact channel" /><small>Provide a monitored channel where privacy-related enquiries can be sent.</small></label>
              <label>Applicable jurisdiction <span className="privacy-optional-label">Optional</span><input value={applicableJurisdiction} onChange={(event) => { setApplicableJurisdiction(event.target.value); markEditorFieldTouched("applicableJurisdiction"); setPublicationReviewed(false); }} maxLength={180} placeholder="Applicable jurisdiction or jurisdictions" /></label>
            </div>
            <div className="privacy-html-editor-block">
              <label>Raw HTML notice content <span className="privacy-optional-label">Optional · overrides structured sections when provided</span>
                <textarea className="privacy-html-source" value={htmlContent} onChange={(event) => { setHtmlContent(event.target.value); markEditorFieldTouched("htmlContent"); setPublicationReviewed(false); }} rows={16} spellCheck={false} placeholder={"Paste a complete HTML document or an HTML fragment with embedded CSS. Example:\n<style>.notice-card{background:#10243a;color:#fff;padding:24px;border-radius:16px}</style>\n<section class=\"notice-card\"><h1>Privacy Notice</h1><p>Your notice content...</p></section>"} />
                <small>HTML and CSS are saved without an application word-count limit. Scripts and external resources are blocked in preview and on the customer page for security. Use embedded CSS and self-contained assets.</small>
              </label>
              {hasHtmlNotice && <div className="privacy-html-preview-wrap"><div className="privacy-section-editor-heading"><strong>HTML preview</strong><span>Sandboxed preview · scripts disabled</span></div><iframe className="privacy-html-preview-frame" title="Privacy notice HTML preview" sandbox="" srcDoc={buildPrivacyHtmlDocument(htmlContent)} /></div>}
            </div>
            <div className="privacy-section-editor-heading"><div><strong>Structured notice sections</strong><span>{sections.length} sections · used when raw HTML is empty</span></div><div className="privacy-section-editor-actions"><span className="privacy-version-preview">Next version: {nextPrivacyVersion(published?.versionLabel)}</span><button type="button" className="privacy-secondary-button privacy-add-section" onClick={addSection} disabled={sections.length >= 16 || saveDraft.isPending || publishPolicy.isPending}><Plus size={14} /> Add section</button></div></div>
            <div className="privacy-section-editor-list">
              {sections.map((section, index) => {
                const open = expandedSection === section.id;
                return <article className={"privacy-editor-section " + (open ? "is-open" : "")} key={section.id}>
                  <button type="button" className="privacy-editor-section-trigger" aria-expanded={open} onClick={() => setExpandedSection(open ? null : section.id)}>
                    <span className="privacy-section-index">{String(index + 1).padStart(2, "0")}</span><span className="privacy-editor-section-title">{section.title || "Untitled section"}</span><ChevronDown size={16} />
                  </button>
                  {open && <div className="privacy-editor-fields">
                    <label>Section heading<input value={section.title} onChange={(event) => updateSection(section.id, { title: event.target.value })} maxLength={160} required /></label>
                    <label>Section content<textarea value={section.body} onChange={(event) => updateSection(section.id, { body: event.target.value })} rows={6} required placeholder="Enter reviewed, customer-facing notice text without a word-count limit." /></label>
                    <div className="privacy-editor-section-actions"><button type="button" className="privacy-text-action privacy-remove-section" onClick={() => removeSection(section.id)} disabled={sections.length <= 6 || saveDraft.isPending || publishPolicy.isPending}><Trash2 size={13} /> Remove section</button></div>
                  </div>}
                </article>;
              })}
            </div>
            <div className="privacy-admin-editor-footer">
              <div className="privacy-publish-warning"><LockKeyhole size={15} /><span>Complete the responsible organization and privacy contact details, then review the notice for accuracy, actual provider relationships, applicable jurisdictions and the effective date. Publication does not itself certify legal compliance.</span></div>
              <label className="privacy-review-acknowledgement"><input type="checkbox" checked={publicationReviewed} onChange={(event) => setPublicationReviewed(event.target.checked)} disabled={saveDraft.isPending || publishPolicy.isPending} /><span><strong>Publication review confirmed</strong><small>I have reviewed the notice, confirmed the responsible legal organization and privacy contact, and checked the services described, applicable jurisdictions, and effective date.</small></span></label>
              <div className="privacy-form-actions">
                <button type="button" className="privacy-secondary-button" onClick={() => void handleReloadSavedVersion()} disabled={!policyState.data || policyState.isFetching || saveDraft.isPending || publishPolicy.isPending}><History size={14} /> Reload saved version</button>
                <button type="button" className="privacy-secondary-button" onClick={() => void handleSaveDraft()} disabled={!policyState.data || !canPublish || saveDraft.isPending || publishPolicy.isPending}><Save size={15} /> {saveDraft.isPending ? "Saving…" : "Save draft"}</button>
                <button type="button" className="privacy-primary-button" onClick={() => void handlePublish()} disabled={!policyState.data || !canPublish || !publicationReviewed || saveDraft.isPending || publishPolicy.isPending}><Send size={15} /> {publishPolicy.isPending ? "Publishing…" : "Publish notice"}</button>
              </div>
            </div>
          </fieldset>
        </>
      </section>

      <section className="privacy-admin-panel" aria-labelledby="privacy-admin-queue">
        <div className="privacy-admin-panel-heading">
          <div className="privacy-admin-heading-icon"><Users size={19} /></div>
          <div><span className="eyebrow">CUSTOMER RIGHTS WORKFLOW</span><h2 id="privacy-admin-queue">Privacy request queue</h2><p>Customer requests are distinct from generic support tickets and account-closure decisions. Internal review notes are never shown to the customer.</p></div>
        </div>
        <div className="privacy-admin-queue-layout">
          <div className="privacy-admin-queue-list">
            <div className="privacy-admin-queue-tools">
              <div className="privacy-queue-search" role="search">
                <Search size={14} aria-hidden="true" />
                <input type="search" value={queueQuery} onChange={(event) => setQueueQuery(event.target.value)} placeholder="Search reference, subject or customer" aria-label="Search privacy requests" />
              </div>
              <button type="button" className="privacy-secondary-button privacy-queue-export" onClick={exportQueue} disabled={!filteredQueue.length}>
                <ArrowDownToLine size={14} /> Export
              </button>
            </div>
            <div className="privacy-admin-filter-row">
              <label htmlFor="privacy-queue-filter">Filter by status</label>
              <select id="privacy-queue-filter" value={requestFilter} onChange={(event) => { setRequestFilter(event.target.value as "all" | PrivacyRequestStatus); setSelectedRequestId(null); }}>
                <option value="all">All statuses</option>
                {REQUEST_STATUSES.map((status) => <option value={status} key={status}>{privacyRequestStatusLabel(status)}</option>)}
              </select>
              <label htmlFor="privacy-queue-sort">Sort</label>
              <select id="privacy-queue-sort" value={queueSort} onChange={(event) => setQueueSort(event.target.value as PrivacyRequestSortOrder)}>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="longest_open">Longest open first</option>
              </select>
              <button type="button" className="privacy-icon-button" aria-label="Refresh privacy request queue" onClick={() => requestQueue.refetch()} disabled={requestQueue.isFetching}><History size={15} /></button>
            </div>
            <div className="privacy-admin-status-summary" role="group" aria-label="Privacy request status summary">
              <button type="button" className={"privacy-summary-chip " + (requestFilter === "all" ? "is-active" : "")} aria-pressed={requestFilter === "all"} onClick={() => { setRequestFilter("all"); setSelectedRequestId(null); }}>All<span>{queueGroupCounts.total}</span></button>
              {REQUEST_STATUSES.map((status) => (
                <button type="button" key={status} className={"privacy-summary-chip " + (requestFilter === status ? "is-active" : "")} aria-pressed={requestFilter === status} onClick={() => { setRequestFilter(status); setSelectedRequestId(null); }}>{privacyRequestStatusLabel(status)}<span>{queueStatusCounts[status]}</span></button>
              ))}
            </div>
            {queueAging.open > 0 && <p className={"privacy-admin-triage privacy-admin-triage-" + (queueAging.overdue > 0 ? "overdue" : queueAging.dueSoon > 0 ? "due_soon" : "on_track")} role="status">
              <Clock3 size={14} />
              <span>{queueAging.overdue} overdue · {queueAging.dueSoon} due soon · {queueAging.onTrack} on track within the {PRIVACY_REQUEST_REVIEW_TARGET_DAYS}-day review target.{queueAging.overdue + queueAging.dueSoon > 0 ? " Sort by longest open to triage first." : ""}</span>
            </p>}
            {requestQueue.isLoading ? <div className="privacy-loading-panel" role="status">Loading privacy requests…</div> :
              requestQueue.isError ? <div className="privacy-empty-state" role="alert"><span>The request queue could not be loaded.</span><button type="button" className="privacy-secondary-button" onClick={() => requestQueue.refetch()}>Retry</button></div> :
              privacyRequests.length === 0 ? <div className="privacy-empty-state privacy-empty-compact"><Inbox size={22} /><strong>No requests in this view.</strong><span>New customer privacy requests will appear here when submitted.</span></div> :
              orderedQueue.length === 0 ? <div className="privacy-empty-state privacy-empty-compact" role="status"><Search size={22} /><strong>No requests match your search.</strong><span>Try a different reference, subject or customer.</span><button type="button" className="privacy-secondary-button" onClick={() => setQueueQuery("")}>Clear search</button></div> :
              <>
                {queueFiltered && <p className="privacy-queue-count" role="status">Showing {orderedQueue.length} of {privacyRequests.length} requests.</p>}
                <div className="privacy-admin-request-list">{orderedQueue.map((request) => <button type="button" key={request.id} onClick={() => setSelectedRequestId(request.id)} className={"privacy-admin-request-row " + (selectedRequestId === request.id ? "is-selected" : "")}>
                  <span className="privacy-request-reference">{request.requestReference}</span><strong>{request.subject}</strong><span>{request.customerName || request.customerEmail || "Customer " + request.userId}</span>
                  <span className={"privacy-status-pill privacy-status-" + request.status}>{privacyRequestStatusLabel(request.status as PrivacyRequestStatus)}</span>
                  <small className={"privacy-admin-age privacy-admin-age-" + privacyRequestAgingBand(privacyRequestAgeDays(request.createdAt))}>{formatAdminDate(request.createdAt)} · {privacyRequestAgingLabel(privacyRequestAgeDays(request.createdAt))}</small>
                </button>)}</div>
              </>}
          </div>

          <div className="privacy-admin-request-detail">
            {!selectedRequestId ? <div className="privacy-empty-state privacy-admin-select-state"><FileClock size={22} /><strong>Select a request to review.</strong><span>Request details, event history, customer messaging and internal notes appear in this panel.</span></div> :
              requestDetail.isLoading ? <div className="privacy-loading-panel" role="status">Loading request details…</div> :
              requestDetail.isError || !selectedRequest ? <div className="privacy-empty-state" role="alert"><span>This request could not be loaded.</span><button type="button" className="privacy-secondary-button" onClick={() => requestDetail.refetch()}>Retry</button></div> :
              <>
                <div className="privacy-request-detail-top"><div><span className="privacy-request-reference">{selectedRequest.requestReference}</span><h3>{selectedRequest.subject}</h3><p>{selectedRequest.customerName || "Customer " + selectedRequest.userId} · {selectedRequest.customerEmail || "No email on record"}</p></div><span className={"privacy-status-pill privacy-status-" + selectedRequest.status}>{privacyRequestStatusLabel(selectedRequest.status as PrivacyRequestStatus)}</span></div>
                <div className="privacy-detail-facts">
                  <div><span>Request category</span><strong>{PRIVACY_REQUEST_TYPES.find((item) => item.value === selectedRequest.requestType)?.label || selectedRequest.requestType}</strong></div>
                  <div><span>Submitted</span><strong>{formatAdminDate(selectedRequest.createdAt)}</strong></div>
                  <div><span>Last updated</span><strong>{formatAdminDate(selectedRequest.updatedAt)}</strong></div>
                  <div><span>Time open</span><strong>{privacyRequestAgingLabel(privacyRequestAgeDays(selectedRequest.createdAt))}</strong></div>
                </div>
                {selectedRequest.customerAccount && <div className="privacy-request-subject">
                  <strong className="privacy-request-subject-heading"><Users size={14} /> Customer account snapshot</strong>
                  <div className="privacy-detail-facts privacy-account-facts">
                    <div><span>Account ID</span><strong>#{selectedRequest.customerAccount.userId}</strong></div>
                    <div><span>Name</span><strong>{selectedRequest.customerAccount.name || "Not set"}</strong></div>
                    <div><span>Email</span><strong>{selectedRequest.customerAccount.email || "No email on record"}</strong></div>
                    <div><span>Package</span><strong>{selectedRequest.customerAccount.packageName}</strong></div>
                    <div><span>Account status</span><strong>{selectedRequest.customerAccount.accountStatus}</strong></div>
                    <div><span>Trading</span><strong>{selectedRequest.customerAccount.tradingEnabled ? "Enabled" : "Disabled"}</strong></div>
                    <div><span>KYC</span><strong>{selectedRequest.customerAccount.kycRequired ? "Required" : "Not required"}</strong></div>
                    <div><span>Risk tier</span><strong>{selectedRequest.customerAccount.riskTier}</strong></div>
                    <div><span>Member since</span><strong>{formatAdminDate(selectedRequest.customerAccount.accountCreatedAt)}</strong></div>
                    <div><span>Last sign-in</span><strong>{formatAdminDate(selectedRequest.customerAccount.lastSignedIn)}</strong></div>
                    <div><span>Privacy requests</span><strong>{selectedRequest.customerAccount.totalRequests} total · {selectedRequest.customerAccount.openRequests} open</strong></div>
                  </div>
                  {selectedRequest.requestType === "access" && <p className="privacy-muted-copy">This is an access request. Use this snapshot to prepare a full, reviewed disclosure of the eligible account records before completing the request.</p>}
                </div>}
                <div className="privacy-request-message-block"><span>Customer-provided context</span><p>{selectedRequest.details || "The customer did not provide additional context."}</p></div>
                <div className="privacy-request-history"><strong>Recorded event history</strong>{(selectedRequest.events || []).length === 0 ? <p>No additional events recorded yet.</p> : selectedRequest.events.map((event) => <div className="privacy-admin-event" key={event.id}><span>{formatAdminDate(event.createdAt)}</span><strong>{event.eventType.replaceAll(".", " ")}</strong>{event.customerMessage && <p><b>Customer-visible message:</b> {event.customerMessage}</p>}{event.internalNote && <p><b>Internal note:</b> {event.internalNote}</p>}</div>)}</div>
                <div className="privacy-review-form">
                  <label>Request status<select value={requestStatus} onChange={(event) => setRequestStatus(event.target.value as PrivacyRequestStatus)}>{REQUEST_STATUSES.map((status) => <option key={status} value={status} disabled={!canTransitionPrivacyRequest(selectedRequest.status as PrivacyRequestStatus, status)}>{privacyRequestStatusLabel(status)}</option>)}</select><small>Terminal states cannot be reopened from this screen. Unsupported transitions are also rejected by the server.</small></label>
                  <label>Message to customer<textarea rows={3} maxLength={1500} value={customerMessage} onChange={(event) => setCustomerMessage(event.target.value)} placeholder="Explain the review progress, request necessary information, or communicate the decision." /></label>
                  <label>Internal review note<textarea rows={3} maxLength={3000} value={internalNote} onChange={(event) => setInternalNote(event.target.value)} placeholder="Record decision rationale for authorized administrators. This note is not shown to the customer." /></label>
                  <button type="button" className="privacy-primary-button" onClick={() => void handleRequestUpdate()} disabled={updateRequest.isPending || (requestStatus === selectedRequest.status && !customerMessage.trim() && !internalNote.trim())}><Save size={15} /> {updateRequest.isPending ? "Saving review…" : "Save review update"}</button>
                </div>
              </>}
          </div>
        </div>
      </section>

      <section className="privacy-admin-panel" aria-labelledby="privacy-admin-history">
        <div className="privacy-admin-panel-heading"><div className="privacy-admin-heading-icon"><Archive size={18} /></div><div><span className="eyebrow">ACCOUNTABILITY</span><h2 id="privacy-admin-history">Publication history &amp; audit events</h2><p>Published versions are retained for reference, alongside administrative records of policy and request changes.</p></div></div>
        {policyState.isLoading ? <div className="privacy-loading-panel" role="status">Loading audit history…</div> :
          <div className="privacy-admin-history-grid">
            <div><h3><History size={15} /> Published versions</h3>{(policyState.data?.versions || []).length === 0 ? <p className="privacy-muted-copy">No published history found.</p> : (policyState.data?.versions || []).map((version) => <div className="privacy-admin-history-row" key={version.id}><span><FileText size={15} /></span><div><strong>{version.title} · v{version.versionLabel}</strong><small>Published {formatAdminDate(version.publishedAt)}</small></div><span className={"privacy-status-pill " + (version.status === "published" ? "privacy-status-in_review" : "privacy-status-cancelled")}>{version.status}</span></div>)}</div>
            <div><h3><LockKeyhole size={15} /> Recent audit events</h3>{(policyState.data?.recentAudit || []).length === 0 ? <p className="privacy-muted-copy">No privacy-specific administrative events are recorded yet.</p> : (policyState.data?.recentAudit || []).slice(0, 20).map((event) => <div className="privacy-admin-audit-row" key={event.id}><span className="privacy-audit-marker" /><div><strong>{event.action.replaceAll(".", " ")}</strong><small>{event.entityType}{event.entityId ? " · " + event.entityId : ""} · {formatAdminDate(event.createdAt)}</small></div></div>)}</div>
          </div>}
      </section>

      <div className="privacy-footer-note"><LockKeyhole size={14} /><span>Policy content and request decisions are persisted in dedicated database tables. Publication and review writes are restricted to administrator procedures and recorded in the privacy audit log.</span></div>
    </div>
  );
}
