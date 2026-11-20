import {
  Activity,
  BadgeCheck,
  BookOpen,
  Bell,
  CircleDollarSign,
  Clock3,
  Coins,
  Cpu,
  FileCheck2,
  FileClock,
  FileText,
  Gauge,
  Globe2,
  History,
  Layers3,
  Mail,
  MessageSquare,
  PackageCheck,
  Palette,
  PlugZap,
  ReceiptText,
  Search,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  TicketCheck,
  Users,
  WalletCards,
  Zap,
  type LucideIcon,
} from "lucide-react";

export type AdminNavigationItem = {
  id: string;
  target: string;
  focus?: string;
  label: string;
  detail: string;
  icon: LucideIcon;
  children?: Array<{ label: string; detail: string }>;
};

export type AdminNavigationGroup = {
  id: string;
  label: string;
  detail: string;
  items: AdminNavigationItem[];
};

/** Canonical destination registry. Drawer actions deep-link to target and never render a second page. */
export const adminNavigationGroups: AdminNavigationGroup[] = [
  { id: "overview", label: "Overview", detail: "Read-mostly operational summary", items: [
    { id: "overview-dashboard", target: "overview", label: "Dashboard", detail: "Health, totals, alerts and live summaries", icon: Gauge },
  ]},
  { id: "customers", label: "Customers", detail: "Accounts, access and customer controls", items: [
    { id: "customer-directory", target: "customers", label: "Customer Directory", detail: "Search, create and manage customer accounts", icon: Users, children: [
      { label: "Add Customer", detail: "Create a database-backed account" },
      { label: "Customer Profile", detail: "Summary, access, verification, risk, notes and activity" },
    ]},
  ]},
  { id: "finance", label: "Finance", detail: "Wallets, ledger and asset controls", items: [
    { id: "wallet-ledger", target: "transactionReview", focus: "ledger", label: "Wallet & Ledger", detail: "Read-only wallet balances and transaction history", icon: WalletCards },
    { id: "credit-adjustment", target: "credit", label: "Credit Adjustment", detail: "Auditable wallet credit action", icon: CircleDollarSign },
    { id: "debit-adjustment", target: "debit", label: "Debit Adjustment", detail: "Validated wallet debit action", icon: ReceiptText },
    { id: "currencies-assets", target: "currencies", label: "Currencies & Assets", detail: "Currency registry and valuation rates", icon: Coins },
  ]},
  { id: "mining", label: "Crypto Mining", detail: "Dedicated mining control room: packages, engine speed, earnings, customer contracts and ledger", items: [
    { id: "mining-overview", target: "miningOverview", label: "Mining Overview", detail: "Live engine status, KPIs, price feeds and readiness", icon: Cpu, children: [
      { label: "Engine Status", detail: "Administrator hashpower preview and reward-processing state" },
      { label: "Price Feeds & Readiness", detail: "Trusted provider snapshots and the internal conversion reference" },
      { label: "Reconciliation", detail: "Journal integrity checks and eligible snapshot rebuilds" },
    ]},
    { id: "mining-packages", target: "miningPackages", label: "Mining Packages", detail: "Create, version, publish, pause and clone customer packages", icon: PackageCheck, children: [
      { label: "Package Catalogue", detail: "Draft and published versions with price, TH/s, term and availability" },
      { label: "Create, Version or Clone", detail: "New package, new version, or clone an existing package as a draft" },
    ]},
    { id: "mining-controls", target: "miningControls", label: "Speed & Economics", detail: "Mining speed multiplier, earning method, boosts, swaps and fees", icon: SlidersHorizontal, children: [
      { label: "Mining Speed Multiplier", detail: "One control scaling the animated fan/turbine speed and CKI mined per eligible second" },
      { label: "Earning Method & Rate", detail: "Fixed daily CKI per package or package TH/s × CKI per TH/s per day" },
      { label: "Boosts, Swaps & Fees", detail: "Boost cycles and bonuses, swap limits and fee basis points" },
    ]},
    { id: "mining-coin-branding", target: "miningCoinBranding", label: "Coin & Branding", detail: "Rename the coin, upload its icon and choose the fixed or live rate per dollar", icon: Palette, children: [
      { label: "Coin Name & Symbol", detail: "Display-only rename; the internal ledger denomination stays CKI" },
      { label: "Coin Icon / Logo", detail: "https image URL or inline data:image used across the customer portal" },
      { label: "Rate per Dollar", detail: "Administrator-configured internal reference, or an instantly updated live market rate" },
    ]},
    { id: "mining-customers", target: "miningCustomers", label: "Customer Mining", detail: "Find customers, control live entitlements and adjust balances", icon: Users, children: [
      { label: "Customer Detail & Entitlements", detail: "Pause, resume, extend or stop one customer's mining" },
      { label: "Balance Adjustment", detail: "Audited CKI or wallet credit/debit" },
      { label: "Adjustment Approvals", detail: "Dual-control queue for high-value changes" },
    ]},
    { id: "mining-bulk-ops", target: "miningBulkOperations", label: "Bulk CKI Operations", detail: "Credit or debit every customer's CKI in one audited, reported batch", icon: Coins, children: [
      { label: "Credit All / Debit All", detail: "One amount applied to every open customer with a per-customer report" },
      { label: "Bulk Operation History", detail: "Durable header and itemised outcome for each batch" },
    ]},
    { id: "mining-audit", target: "miningAudit", label: "Mining Audit Trail", detail: "Recent administrative mining actions, actors and reasons", icon: FileClock, children: [
      { label: "Recent Actions", detail: "Who changed what, when and with what recorded reason" },
    ]},
  ]},
  { id: "trade-settings", label: "Trade Settings", detail: "One place for tier rules, opportunity delivery, trade records and system health", items: [
    { id: "trade-settings-overview", target: "tradeSystemOverview", label: "Trading Overview", detail: "View current delivery, open work and system status", icon: Gauge },
    { id: "trade-package-configuration", target: "tradePackageConfiguration", label: "Package Configuration", detail: "Manage package-policy controls and the system-wide allocation safety gate", icon: Settings2 },
    { id: "trade-tiers-eligibility", target: "packages", focus: "tiers", label: "Tiers & Eligibility", detail: "Create and edit admin-managed tiers, thresholds, duration and assigned entitlements", icon: PackageCheck },
    { id: "trade-daily-delivery-caps", target: "packages", focus: "quotas", label: "Per-tier Daily Delivery Caps", detail: "Set per-tier hard pop-up ceilings, simultaneous display limits and counting windows", icon: Layers3 },
    { id: "trade-delivery-policy", target: "packages", focus: "policy", label: "Per-tier Offer Rules & Capital Limits", detail: "Configure per-tier capital bounds and published offer limits; ON/OFF switches stay in the shared Trading controls panel", icon: SlidersHorizontal },
    { id: "trade-opportunity-publishing", target: "opportunity", label: "Opportunity Generation & Management", detail: "Approve reusable templates, monitor automatic worker batches and inspect customer-specific package assignments", icon: Zap },
    { id: "trade-delivery-schedule", target: "packages", focus: "delivery", label: "Per-tier Delivery Schedule", detail: "Set per-tier spacing between pop-ups; global default timing is managed under Global Trade Timing & Settlement", icon: Clock3 },
    { id: "trade-duration-closing", target: "tradeDurationRules", label: "Global Trade Timing & Settlement", detail: "Manage global settlement, wallet-credit, cooldown and pop-up timing defaults", icon: Clock3 },
    { id: "trade-popup-display", target: "tradeCustomerDisplay", label: "Post-completion Display Delay", detail: "Set the short per-tier completed-card display delay; opportunity expiry and popup countdown use the package duration range", icon: SlidersHorizontal },
    { id: "trade-company-rotation", target: "packages", focus: "rotation", label: "Per-tier Company Rotation Rules", detail: "Set per-tier approved-company filters and repeat-avoidance rules for pop-ups", icon: Globe2 },
    { id: "trade-company-catalogue", target: "companyCatalogue", label: "Company Catalogue", detail: "Search and manage the saved company reference records and approval status", icon: Search },
    { id: "trade-capital-funding", target: "transactionReview", focus: "capital", label: "Capital & Wallet Funding Rules", detail: "Funding queue unavailable; read-only status, no payout or settlement actions", icon: WalletCards },
    { id: "trade-fees-earnings", target: "transactionReview", focus: "fees", label: "Fees & Earnings Limits", detail: "Review the legacy global fee record; active fee editing is package-owned under Tiers & Eligibility", icon: CircleDollarSign },
    { id: "trade-retries", target: "tradeRetryPolicy", label: "Retries & Carry-Forward", detail: "Configure the single shared delivery retry policy and review carry-forward availability", icon: Activity },
    { id: "trade-active-pending", target: "deliveryMonitor", label: "Active & Pending Opportunities", detail: "Review opportunities waiting for delivery, customer action or further processing", icon: Activity },
    { id: "trade-opportunity-usage-reset", target: "tradeOpportunityReset", label: "Opportunity Usage Reset", detail: "Reset one customer’s or all customers’ opportunity usage with audit logging and financial safeguards", icon: Activity },
    { id: "trade-manual-payouts", target: "manualPayouts", label: "Manual Payouts", detail: "Review and resolve manual payout requests; external transfers happen outside Arbitrade", icon: CircleDollarSign },
    { id: "trade-settlement", target: "transactionReview", focus: "reconciliation", label: "Settlement & Reconciliation", detail: "Confirm trade outcomes and reconcile trade settlement records only", icon: ReceiptText },
    { id: "trade-history", target: "tradeHistory", label: "Trading History", detail: "Read-only bounded history of persisted trade lifecycle and confirmed-result evidence", icon: History },
    { id: "trade-worker-health", target: "tradeWorkerHealth", label: "Worker Health & Recovery", detail: "Check background worker heartbeats, delayed work and recovery queues", icon: Activity },
    { id: "trade-audit-policy-history", target: "audit", label: "Audit & Policy History", detail: "Review who changed Trading settings, why they changed and the saved versions", icon: FileText },
    { id: "trade-admin-guide", target: "tradeAdminGuide", label: "Trade Settings Guide", detail: "Read the menu guide and explanations for each Trading control", icon: BookOpen },
  ]},
  { id: "verification-risk", label: "Verification & Risk", detail: "KYC, review, risk and session oversight", items: [
    { id: "kyc-overview", target: "kycCenter", label: "KYC Overview", detail: "Stages, metrics, settings and review posture", icon: ShieldCheck },
    { id: "verification-queue", target: "verificationOversight", label: "Verification Queue", detail: "Human decisions and verification status", icon: FileCheck2 },
    { id: "customer-verification", target: "verificationOversight", label: "Customer Verification", detail: "Searchable customer verification directory", icon: BadgeCheck },
    { id: "risk-watchlist", target: "riskWatchlist", label: "Risk Watchlist", detail: "Risk tiers, alerts and account state", icon: ShieldAlert },
    { id: "alert-governance", target: "riskWatchlist", label: "Alert Governance", detail: "Review and govern risk signals", icon: Bell },
    { id: "session-device-oversight", target: "riskWatchlist", label: "Session & Device Oversight", detail: "Review and revoke customer sessions", icon: ShieldAlert },
    { id: "device-oversight", target: "deviceOversight", label: "Device Oversight", detail: "All registered devices and the devices each customer has blocked", icon: ShieldAlert },
    { id: "kyc-audit-trail", target: "kycCenter", label: "KYC Audit Trail", detail: "Signed KYC chain and minimized events", icon: FileText },
  ]},
  { id: "communications", label: "Communications", detail: "Email operations and support work", items: [
    { id: "email-activity-queue", target: "emailCenter", label: "Email Activity & Queue", detail: "Customer communications and queued actions", icon: Mail },
    { id: "smtp-transport", target: "smtpCenter", label: "Email & SMTP Settings", detail: "Configure local mail, SendGrid, Amazon SES or another SMTP provider", icon: Mail },
    { id: "compose-email", target: "smtpCenter", label: "Compose Email", detail: "Recipients, rich text and attachments", icon: Mail },
    { id: "support-tickets", target: "suiteTickets", label: "Support Tickets", detail: "Canonical customer support queue", icon: TicketCheck },
    { id: "customer-notifications", target: "notificationCenter", label: "Announcements & Notifications", detail: "Publish customer updates and review operational alerts", icon: Bell },
    { id: "communication-settings", target: "communicationSettings", label: "Message Templates & WhatsApp", detail: "Configure WhatsApp contact, customer message copy and planned wallet-provider details", icon: MessageSquare },
  ]},
  { id: "platform-configuration", label: "Platform Configuration", detail: "Signup, security and shared preferences", items: [
    { id: "signup-onboarding", target: "signup", label: "Signup & Onboarding", detail: "Signup rules, gates and jurisdiction matrix", icon: Globe2 },
    { id: "security-policies", target: "policies", label: "Security Policies", detail: "KYC, withdrawals, 2FA and facial defaults", icon: ShieldCheck },
    { id: "privacy-management", target: "privacyManagement", label: "Privacy Management", detail: "Publish privacy notices and review customer privacy requests", icon: FileText },
    { id: "general-settings", target: "settings", label: "General Settings", detail: "Shared operational settings", icon: Settings2 },
    { id: "sound-notifications", target: "sound", label: "Sound & Notifications", detail: "Notification sound and preference controls", icon: Bell },
    { id: "branding-identity", target: "branding", label: "Branding & Identity", detail: "Brand and identity presentation", icon: Settings2 },
    { id: "appearance-themes", target: "appearance", label: "Appearance & Themes", detail: "Default theme, previews and customer theme permissions", icon: Palette },
  ]},
  { id: "integrations", label: "Integrations", detail: "Providers and operational readiness", items: [
    { id: "provider-registry", target: "apis", label: "Provider Registry", detail: "API, market, payment and identity adapters", icon: PlugZap },
    { id: "provider-details", target: "apis", label: "Provider Details", detail: "Connection state and setup readiness", icon: Search },
    { id: "readiness-approval", target: "apis", label: "Readiness & Approval", detail: "Sandbox, permissions and activation gates", icon: ShieldCheck },
  ]},
  { id: "governance-reports", label: "Governance & Reports", detail: "Audit records and operational exports", items: [
    { id: "reports-exports", target: "reportsExports", label: "Reports & Exports", detail: "Customer, finance, KYC and admin records", icon: FileText },
  ]},
];

/** Groups shown in the right-side secondary navigation drawer. */
export const adminSecondaryNavigationGroupIds = [
  "verification-risk",
  "communications",
  "platform-configuration",
  "integrations",
  "governance-reports",
] as const;

export const adminSecondaryNavigationGroups = adminNavigationGroups.filter((group) =>
  adminSecondaryNavigationGroupIds.includes(group.id as typeof adminSecondaryNavigationGroupIds[number])
);

export const adminPrimaryNavigationGroups = adminNavigationGroups.filter((group) =>
  !adminSecondaryNavigationGroupIds.includes(group.id as typeof adminSecondaryNavigationGroupIds[number])
);

export const allAdminNavigationItems = adminNavigationGroups.flatMap((group) => group.items);
