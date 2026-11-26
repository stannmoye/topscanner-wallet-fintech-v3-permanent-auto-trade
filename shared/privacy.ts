export type PrivacyPolicySection = {
  id: string;
  title: string;
  body: string;
};

export type PrivacyPolicyDocument = {
  id: number;
  versionLabel: string;
  title: string;
  summary: string;
  controllerName: string;
  controllerAddress: string;
  privacyContact: string;
  applicableJurisdiction: string;
  sections: PrivacyPolicySection[];
  htmlContent?: string;
  status: "draft" | "published" | "archived";
  effectiveAt: Date | string | null;
  publishedAt: Date | string | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
};

export type PrivacyRequestType = "access" | "correction" | "deletion" | "restriction" | "objection" | "other";

export type PrivacyRequestStatus =
  | "submitted"
  | "identity_check"
  | "in_review"
  | "awaiting_customer"
  | "completed"
  | "declined"
  | "cancelled";

export const PRIVACY_REQUEST_TYPES: Array<{ value: PrivacyRequestType; label: string; description: string }> = [
  { value: "access", label: "Access my information", description: "Request access to eligible personal information and an explanation of how it is handled." },
  { value: "correction", label: "Correct my information", description: "Ask us to review information that may be inaccurate or incomplete." },
  { value: "deletion", label: "Request deletion", description: "Ask us to delete or anonymize information where permitted by applicable requirements." },
  { value: "restriction", label: "Restrict certain processing", description: "Ask us to review whether a particular use can be restricted." },
  { value: "objection", label: "Object or ask a question", description: "Raise an objection or question about how information is handled." },
  { value: "other", label: "Another privacy request", description: "Submit another privacy-related concern for review." },
];

export const DEFAULT_PRIVACY_POLICY_SECTIONS: PrivacyPolicySection[] = [
  {
    "id": "overview",
    "title": "Our privacy commitment",
    "body": "This Privacy Notice explains how information is handled in connection with your account and your use of this platform. Our approach is designed to use information for defined service, security and recordkeeping purposes, restrict access according to responsibility, and keep our practices understandable. The information and choices described below depend on the services available to your account and the requirements that apply to your circumstances. Where applicable privacy law provides additional rights, those rights remain available in accordance with that law."
  },
  {
    "id": "information",
    "title": "Information we handle",
    "body": "Depending on your account and the features you use, information may include your name, email address, account identifiers, profile details, identity-verification submissions and outcomes, financial account and activity records, service instructions, device and browser details, IP address information, session and authentication events, and messages you send to customer support. We aim to collect information relevant to the service or review being performed."
  },
  {
    "id": "purposes",
    "title": "How information is used",
    "body": "Information supports account administration, authentication, identity and eligibility reviews, fraud and misuse prevention, financial recordkeeping and reconciliation, customer service, security investigations, service reliability, required reporting, and the establishment or defence of legal rights. Where consent is required for a specific use, that use should not proceed until the appropriate consent has been obtained."
  },
  {
    "id": "financial-records",
    "title": "Financial records and account integrity",
    "body": "Records relating to account balances, financial activity, instructions, statements, and ledger or reconciliation history help maintain accurate customer records and support review, audit, dispute resolution, and applicable recordkeeping obligations. These records may be subject to retention requirements that differ from those applying to general profile preferences."
  },
  {
    "id": "sharing",
    "title": "When information may be shared",
    "body": "Information may be made available to authorized service providers supporting hosting, communications, identity verification, security, or other required platform functions; professional advisers and auditors with a legitimate role; public or regulatory authorities where disclosure is lawfully required; or other parties where you direct the disclosure or where a necessary legal, security, or dispute-resolution purpose permits it. Access should be limited to what is reasonably necessary and subject to appropriate safeguards."
  },
  {
    "id": "security",
    "title": "Safeguards and restricted access",
    "body": "The platform uses account authentication, password hashing, signed HTTP-only session cookies, role-based server-side authorization, and available additional-authentication controls. Access to sensitive information should be limited by role and operational need. Safeguards vary by information type and hosting or provider arrangement. No electronic system or method of transmission can be guaranteed to be completely secure."
  },
  {
    "id": "retention",
    "title": "Retention and deletion",
    "body": "Information is retained for as long as reasonably necessary for its stated purpose and to meet applicable legal, regulatory, security, accounting, audit, fraud-prevention, and dispute-resolution obligations. When information is no longer required, it should be securely deleted, anonymized, or otherwise disposed of where permitted. Account closure does not automatically mean that every associated record can be immediately erased."
  },
  {
    "id": "rights",
    "title": "Your privacy rights",
    "body": "Depending on the law that applies to you, you may be able to request access to, correction of, deletion of, or restriction of certain personal information, or raise an objection or question about its handling. Some requests may be limited by applicable retention obligations or other lawful exceptions. We may need to verify your identity before responding. Use the privacy request form in this Centre so your request receives a reference and a tracked review."
  },
  {
    "id": "storage",
    "title": "Cookies, sessions and preferences",
    "body": "Essential browser storage and session cookies support sign-in and core account functionality. The application may also remember preferences selected in the workspace. Clearing browser storage can sign you out or reset local preferences, but it does not itself erase records held in authorized account systems. Any optional tracking or storage must be described according to the features actually enabled and the choices required by applicable law."
  },
  {
    "id": "transfers",
    "title": "Service providers and processing locations",
    "body": "Information may be processed in locations where the platform operator or its authorized service providers operate. Where cross-border transfer requirements apply, the operator should use appropriate safeguards and provide any notices required by law. To ask which service providers or processing locations may apply to your account, submit a request through this Centre."
  },
  {
    "id": "updates-contact",
    "title": "Policy updates and privacy contact",
    "body": "This Notice may be revised when services, safeguards, or applicable requirements change. The published version, effective date, and revision history are shown in this Centre. Where required by applicable law, we will provide notice of material changes and request any necessary consent or renewed acknowledgement through the relevant process. For questions or requests, use the Privacy Centre request form or the authenticated Support Centre. Do not include passwords, authentication codes, or unnecessary sensitive documents in ordinary messages."
  }
];

const PRIVACY_REQUEST_TRANSITIONS: Record<PrivacyRequestStatus, readonly PrivacyRequestStatus[]> = {
  submitted: ["identity_check", "in_review", "declined", "cancelled"],
  identity_check: ["in_review", "awaiting_customer", "declined", "cancelled"],
  in_review: ["awaiting_customer", "completed", "declined", "cancelled"],
  awaiting_customer: ["in_review", "completed", "declined", "cancelled"],
  completed: [],
  declined: [],
  cancelled: [],
};

export function canTransitionPrivacyRequest(from: PrivacyRequestStatus, to: PrivacyRequestStatus): boolean {
  return from === to || PRIVACY_REQUEST_TRANSITIONS[from].includes(to);
}

export function nextPrivacyVersion(current: string | null | undefined): string {
  const match = /^(\d+)\.(\d+)$/.exec(String(current || ""));
  if (!match) return "1.0";
  return match[1] + "." + String(Number(match[2]) + 1);
}

export function privacyRequestStatusLabel(status: PrivacyRequestStatus): string {
  const labels: Record<PrivacyRequestStatus, string> = {
    submitted: "Submitted",
    identity_check: "Identity check",
    in_review: "In review",
    awaiting_customer: "Awaiting you",
    completed: "Completed",
    declined: "Declined",
    cancelled: "Cancelled",
  };
  return labels[status];
}

export type PrivacyRequestStatusGroup = "open" | "closed";

const CLOSED_PRIVACY_REQUEST_STATUSES: readonly PrivacyRequestStatus[] = ["completed", "declined", "cancelled"];

export function privacyRequestStatusGroup(status: PrivacyRequestStatus): PrivacyRequestStatusGroup {
  return CLOSED_PRIVACY_REQUEST_STATUSES.includes(status) ? "closed" : "open";
}

export function privacyRequestIsOpen(status: PrivacyRequestStatus): boolean {
  return privacyRequestStatusGroup(status) === "open";
}

// Review target used to surface requests that are approaching or past the
// accountable review window. It is a presentation aid, not a legal deadline.
export const PRIVACY_REQUEST_REVIEW_TARGET_DAYS = 30;

export type PrivacyRequestAgingBand = "on_track" | "due_soon" | "overdue";

// Whole days elapsed since submission, never negative and never NaN.
export function privacyRequestAgeDays(createdAt: Date | string | null | undefined, now: Date = new Date()): number {
  if (!createdAt) return 0;
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return 0;
  const elapsed = now.getTime() - created;
  return elapsed <= 0 ? 0 : Math.floor(elapsed / 86400000);
}

export function privacyRequestAgingBand(ageDays: number): PrivacyRequestAgingBand {
  if (!Number.isFinite(ageDays) || ageDays < 0) return "on_track";
  if (ageDays >= PRIVACY_REQUEST_REVIEW_TARGET_DAYS) return "overdue";
  if (ageDays >= Math.floor(PRIVACY_REQUEST_REVIEW_TARGET_DAYS / 2)) return "due_soon";
  return "on_track";
}

export function privacyRequestAgingLabel(ageDays: number): string {
  if (ageDays <= 0) return "Received today";
  return ageDays === 1 ? "1 day since submission" : ageDays + " days since submission";
}

export function privacyRequestGroupCounts(
  requests: ReadonlyArray<{ status: PrivacyRequestStatus }>,
): { total: number; open: number; closed: number } {
  let open = 0;
  let closed = 0;
  for (const request of requests) {
    if (privacyRequestIsOpen(request.status)) open += 1;
    else closed += 1;
  }
  return { total: requests.length, open, closed };
}

export function countPrivacyRequestsByStatus(
  requests: ReadonlyArray<{ status: PrivacyRequestStatus }>,
): Record<PrivacyRequestStatus, number> {
  const counts = {
    submitted: 0,
    identity_check: 0,
    in_review: 0,
    awaiting_customer: 0,
    completed: 0,
    declined: 0,
    cancelled: 0,
  } as Record<PrivacyRequestStatus, number>;
  for (const request of requests) counts[request.status] += 1;
  return counts;
}

// A request the customer must act on before the review can continue. This drives
// the "needs your input" prompts in the customer Privacy Centre.
export function privacyRequestNeedsCustomerAction(status: PrivacyRequestStatus): boolean {
  return status === "awaiting_customer";
}

export type PrivacyRequestAgingSummary = {
  open: number;
  onTrack: number;
  dueSoon: number;
  overdue: number;
};

// Aggregates the ageing bands of every open request so a portal can show a
// triage line without recomputing bands per row.
export function privacyRequestAgingSummary(
  requests: ReadonlyArray<{ status: PrivacyRequestStatus; createdAt: Date | string | null | undefined }>,
  now: Date = new Date(),
): PrivacyRequestAgingSummary {
  let onTrack = 0;
  let dueSoon = 0;
  let overdue = 0;
  for (const request of requests) {
    if (!privacyRequestIsOpen(request.status)) continue;
    const band = privacyRequestAgingBand(privacyRequestAgeDays(request.createdAt, now));
    if (band === "overdue") overdue += 1;
    else if (band === "due_soon") dueSoon += 1;
    else onTrack += 1;
  }
  return { open: onTrack + dueSoon + overdue, onTrack, dueSoon, overdue };
}

export type PrivacyRequestSortOrder = "newest" | "oldest" | "longest_open";

// Ordered copy of a request list. `longest_open` surfaces unanswered open
// requests first (oldest first) so administrators can triage them quickly.
export function sortPrivacyRequests<T extends { status: PrivacyRequestStatus; createdAt: Date | string | null | undefined }>(
  requests: ReadonlyArray<T>,
  order: PrivacyRequestSortOrder,
): T[] {
  const submittedAt = (value: Date | string | null | undefined): number => {
    if (!value) return 0;
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? 0 : time;
  };
  const copy = [...requests];
  if (order === "oldest") return copy.sort((a, b) => submittedAt(a.createdAt) - submittedAt(b.createdAt));
  if (order === "longest_open") {
    const group = (request: T) => (privacyRequestIsOpen(request.status) ? 0 : 1);
    return copy.sort((a, b) => group(a) - group(b) || submittedAt(a.createdAt) - submittedAt(b.createdAt));
  }
  return copy.sort((a, b) => submittedAt(b.createdAt) - submittedAt(a.createdAt));
}

export function privacyRequestStatusMessage(status: PrivacyRequestStatus): string {
  const messages: Record<PrivacyRequestStatus, string> = {
    submitted: "Your privacy request has been received and is awaiting review.",
    identity_check: "We need to verify your identity before we can continue with this request. Please follow any instructions sent through an authorized channel.",
    in_review: "Your request is being reviewed by an authorized team member.",
    awaiting_customer: "We need additional information from you before the review can continue. Check the message attached to this request.",
    completed: "The review of your privacy request has been completed. Refer to the message attached to this request for the outcome.",
    declined: "We could not fulfil this request as submitted. Review the message attached to this request for the reason and any available next steps.",
    cancelled: "This privacy request has been cancelled.",
  };
  return messages[status];
}
