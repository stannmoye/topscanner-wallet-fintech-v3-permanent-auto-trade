import { COOKIE_NAME } from "@shared/const";
import { decodeCompanyCatalogueSelection } from "@shared/company-catalogue-selection";
import { MINING_PACKAGE_THEME_KEYS } from "@shared/mining-package-themes";
import { parse as parseCookieHeader } from "cookie";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { listAdminTradeAuditHistory, listAdminTradingHistory, resetTradeOpportunityUsage, resolveCustomerPackageName, clearTradeRecords, previewTradeRecordClear } from "./db";
import { countCompanyReferences, findCompanyReferencesBySymbol, getCompanyReferenceById, getCompanyReferenceSummary, getRandomCompanyReference, searchCompanyReferences } from "./modules/company-catalogue-reference";
import { z } from "zod";
import { communicationSettingsInput, getAdminCommunicationSettings, getCustomerCommunicationOptions, saveAdminCommunicationSettings, validateCommunicationSettingsInput } from "./communicationSettings";
import { TRPCError } from "@trpc/server";
import { ACCOUNT_CLOSURE_TICKET_SUBJECT, AccountClosureDecisionError, applyAccountClosureDecision, assignSupportTicket, createAccountClosureTicket, listSupportAssignees, addTicketAttachment, addTicketMessage, adjustCustomerBalance, createAdminTradingPackage, broadcastCustomerNotification, listAdminNotificationCampaigns, retryNotificationCampaign, withdrawNotificationCampaign, createAdminCustomer, createNotification, createRiskReport, createTicket, deleteAdminCustomer, getCustomerTicket, getSupportTicketById, getAppSetting, getTradeSettlementPolicy, TradeTimingPolicyVersionConflictError, getTradeFeePolicy, getTradeAllocationControls, setTradeAllocationControls, listAdminTradingPackages, updateAdminTradingPackage, TradingPackageTermsVersionConflictError, getCustomerTradingEligibility, previewNextCustomerCompanySpotlight, getCustomerBalanceSummary, listCustomerWalletLedger, getCustomerWalletPreferences, getCustomerPayoutEligibility, getCustomerAuthenticatorStatus, startCustomerAuthenticatorEnrollment, confirmCustomerAuthenticatorEnrollment, generateCustomerAuthenticatorRecoveryCodes, startCustomerAuthenticatorRecoveryReplacement, startCustomerAuthenticatorReplacement, confirmCustomerAuthenticatorReplacement, createCustomerPayoutRequest, listCustomerPayoutRequests, cancelCustomerPayoutRequest, listAdminPayoutRequests, resolveCustomerPayoutRequest, getCustomerWithdrawalPinStatus, getCustomerWithdrawalPin, setCustomerWithdrawalPin, listCustomerWithdrawalPins, clearCustomerWithdrawalPin, manuallySettleTrade, listPendingSettlements, listTradeSettlementIntegrityIssues, listWalletLedgerReconciliation, markCustomerNotificationsRead, updateCustomerWalletPreferences, getCustomerPersonalDetails, updateCustomerPersonalDetails, getTicketUploadPolicy, setTradeSettlementPolicy, getNotificationCategoryVisibility, getCustomerNotificationUnreadCount, listCustomerNotificationPage, setNotificationCategoryVisibility, getUserById, getUserForSessionRevocation, listAdminCustomers, listAdminAuditEvents, listAdminRecentLedgerActivity, listAllTickets, listBalances, listCurrencies, listCustomerOpportunities, listCustomerSessions, listCustomerTickets, listCustomerNotifications, listNotifications, listNotificationEventCursor, listOpenOffers, listOpportunityPackagePolicies, listPersistedOpportunityPackagePolicies, listRiskReports, listTicketAttachments, listTicketMessages, listTrades, provisionSignupCredit, revokeCustomerSession, reopenSupportTicket, setAppSetting, updateCompanyCatalogueAdminState, updateAdminCustomer, updateCustomerControls, updateOpportunityPackagePolicies, upsertCustomerSession, upsertCurrency, listSettlementEvidence, submitSettlementEvidence, reviewSettlementEvidence } from "./db";
import { allocateStake, cancelStake, getStakeDashboard, projectStake } from "./stakeEarn";
import { getTreasuryBondDashboard, purchaseTreasuryBond, quoteTreasuryBondPurchase } from "./treasuryBonds";
import { projectTreasuryBondProfit } from "./treasuryBondProvider";
import { createAdminTreasuryBondInstrument, deleteAdminTreasuryBondInstrument, listAdminTreasuryBondInstruments, setAdminTreasuryBondInstrumentEnabled, updateAdminTreasuryBondInstrument, TREASURY_INSTRUMENT_CATEGORIES } from "./treasuryBondInstruments";
import { getCooperateDeptDashboard, purchaseCooperateDeptCompany, quoteCooperateDeptPurchase } from "./cooperateDept";
import { createAdminCooperateDeptCompany, deleteAdminCooperateDeptCompany, listAdminCooperateDeptCompanies, setAdminCooperateDeptCompanyEnabled, updateAdminCooperateDeptCompany } from "./cooperateDeptCompanies";
import { getLitigationFundsDashboard, listLitigationOpenCases, purchaseLitigationFund, quoteLitigationFundPurchase, recordLitigationOutcome, settleLitigationCase } from "./litigationFunds";
import { createAdminLitigationBundle, createAdminLitigationDossier, deleteAdminLitigationBundle, deleteAdminLitigationDossier, listAdminLitigationBundles, listAdminLitigationDossiers, reachAdminLitigationMilestone, setAdminLitigationBundleEnabled, setAdminLitigationDossierEnabled, setAdminLitigationDossierStatus, updateAdminLitigationBundle, updateAdminLitigationDossier } from "./litigationFundDossiers";
import { getIpRoyaltiesDashboard, listIpRoyaltyOpenInstruments, purchaseIpRoyalty, quoteIpRoyaltyPurchase, recordIpRoyaltyDistribution, settleIpRoyaltyInstrument } from "./ipRoyalties";
import { createAdminIpRoyaltyDossier, createAdminIpRoyaltyPortfolio, deleteAdminIpRoyaltyDossier, deleteAdminIpRoyaltyPortfolio, listAdminIpRoyaltyDossiers, listAdminIpRoyaltyPortfolios, setAdminIpRoyaltyDossierEnabled, setAdminIpRoyaltyDossierStatus, setAdminIpRoyaltyPortfolioEnabled, updateAdminIpRoyaltyDossier, updateAdminIpRoyaltyPortfolio } from "./ipRoyaltiesDossiers";
import { getMusicRoyaltiesDashboard, listMusicOpenInstruments, purchaseMusicOpportunity, quoteMusicPurchase, recordMusicDistribution, settleMusicInstrument } from "./musicRoyalties";
import { createAdminMusicDossier, deleteAdminMusicDossier, listAdminMusicDossiers, reachAdminMusicMilestone, setAdminMusicDossierEnabled, setAdminMusicDossierStatus, updateAdminMusicDossier } from "./musicRoyaltyDossiers";
import { getAgroInvestmentDashboard, listAgroOpenInstruments, purchaseAgroOpportunity, quoteAgroPurchase, recordAgroDistribution, settleAgroInstrument } from "./agroInvestments";
import { createAdminAgroDossier, deleteAdminAgroDossier, listAdminAgroDossiers, reachAdminAgroMilestone, setAdminAgroDossierEnabled, setAdminAgroDossierStatus, updateAdminAgroDossier } from "./agroInvestmentDossiers";
import { getDeskEconomicsMap, listDeskEconomics, reassignDeskEconomics, reassignDeskEconomicsBulk, setDeskEconomicsBulkOverride, setDeskEconomicsOverride } from "./deskEconomics";
import { syncDeskEconomicsFromSource } from "./deskEconomicsSources";
import { getCarbonInvestmentDashboard, listCarbonOpenInstruments, purchaseCarbonOpportunity, quoteCarbonPurchase, recordCarbonDistribution, settleCarbonInstrument } from "./carbonCredits";
import { createAdminCarbonDossier, deleteAdminCarbonDossier, listAdminCarbonDossiers, reachAdminCarbonMilestone, setAdminCarbonDossierEnabled, setAdminCarbonDossierStatus, updateAdminCarbonDossier } from "./carbonCreditDossiers";
import { getGreenEnergyInvestmentDashboard, listGreenEnergyOpenInstruments, purchaseGreenEnergyOpportunity, quoteGreenEnergyPurchase, recordGreenEnergyDistribution, settleGreenEnergyInstrument } from "./greenEnergy";
import { createAdminGreenEnergyDossier, deleteAdminGreenEnergyDossier, listAdminGreenEnergyDossiers, reachAdminGreenEnergyMilestone, setAdminGreenEnergyDossierEnabled, setAdminGreenEnergyDossierStatus, updateAdminGreenEnergyDossier } from "./greenEnergyDossiers";
import { disburseLendingLoan, fundLendingLoan, getLendingDesk, getLendingLoanView, listLendingLoanBids, listLendingLoansForSettlement, placeLendingBid, quoteLendingFunding, raiseLendingBid, settleLendingLoan, withdrawLendingBid } from "./lending";
import { createAdminLenderReserve, createAdminLendingLoan, deleteAdminLenderReserve, deleteAdminLendingLoan, listAdminLenderReserves, listAdminLendingLoans, meetAdminLendingCondition, seedExampleLendingDesk, setAdminLenderReserveEnabled, setAdminLendingConditions, setAdminLendingLoanEnabled, setAdminLendingLoanSchedule, setAdminLendingLoanStage, updateAdminLenderReserve, updateAdminLendingLoan } from "./lendingDossiers";
import {
  LENDING_CONDITION_STATUSES,
  LENDING_CONDITION_TYPES,
  LENDING_LOAN_TYPES,
  LENDING_OUTCOMES,
  LENDING_REPAYMENT_FREQUENCIES,
  LENDING_RISK_GRADES,
  LENDING_SECTORS,
  LENDING_STAGES,
  LENDING_TERRITORY_BANDS,
} from "@shared/lending-catalogue";
import { closeTransactionConsoleSession, listTransactionConsoleEvents, recordTransactionConsoleEvent, recordTransactionConsolePulse } from "./transactionConsole";
import { getOpportunityLifecycleSummary, runOpportunityRetention, updatePopupLifecycle, updatePopupDeliveryStatus } from "./opportunityLifecycle";
import { confirmEmailVerification, requestEmailVerification } from "./emailAuth";
import { enqueueAdminMessage, getCustomerEmailPreferences, updateCustomerEmailPreferences, sendEmailTest, getDailyDigestSchedule } from "./emailQueue";
import { isEmailDeliveryConfigured } from "./email";
import { ensureCustomerControls } from "./db";
import { changeCustomerPassword } from "./db";
import { adminAuditEvents, adminCustomerDirectory, adminDashboard, adminDecision, adminOverride, adminQueue, getAdminKycSettings, getCenter, issueEmail, issuePhone, recordConsent, recordFace as recordFaceVerification, startStage, submitAddress, submitDocument, updateAdminKycSettings, verifyAuditChain, verifyEmail, verifyPhone } from "./kyc";
import { isEmailAdminConfigured, listEmailRecipients, publicEmailConfig, runDailyEmailReports, saveEmailConfig, sendAdminComposedEmail, testEmailConnection } from "./emailAdmin";
import * as mining from "./mining";
import * as miningAdmin from "./mining-admin";
import { normalizeAppearanceSettings } from "./appearance-settings";
import { ADMIN_BROADCAST_CATEGORIES } from "./modules/notification-events";
import { stripCustomerFeedInternalObjects } from "./modules/customer-feed-payload";
import { isValidSupportAttachmentStorageKey } from "./_core/attachmentPolicy";
import { invalidateUserSessions } from "./authSessions";
import { getLocalSessionFromRequest, createLocalSession, passwordHash, verifyPassword } from "./_core/localAuth";
import * as privacyService from "./privacy";
import { adminRestoreDevice, blockDevice, getDeviceOversightSummary, listBlockedDevicesForAdmin, listDeviceEvents, listDevicesForAdmin, listTrustedDevices, renameDevice } from "./trusted-devices";
import { localIdentityService } from "./_core/localIdentityService";
import { createHeartbeatJob, deleteHeartbeatJob, listHeartbeatJobs, updateHeartbeatJob } from "./_core/heartbeat";
import { getWorkerHealthSummary, requeueDeadQualificationJob } from "./_core/workerHealth";
import { getVisitorAnalyticsReport } from "./site-analytics";
import { getTradeGlobalControls, setTradeGlobalControl, TradeGlobalControlVersionConflictError } from "./db";
import { getPackageFeePolicies, getPackageFeeHistory, updatePackageFeePolicy } from "./db";
import { getDeliveryRetryPolicy, updateDeliveryRetryPolicy, DeliveryRetryPolicyVersionConflictError } from "./db";
import { closeOpportunityOffer } from "./db";
import { getWalletFundingPriority, setWalletFundingPriority, WalletFundingPriorityVersionConflictError } from "./db";
import { getOpportunityGenerationControl, getOpportunityGenerationMonitor, listOpportunityGenerationTemplates, OpportunityGenerationControlVersionConflictError, saveOpportunityGenerationTemplate, setOpportunityGenerationControl } from "./db";
import { getSystemDiagnosticsReport } from "./_core/systemDiagnostics";
import { exportOpportunityDeliveryRecords, getOpportunityDeliveryCustomer, getOpportunityDeliveryDetails, getOpportunityDeliveryQueueDiagnostics, listOpportunityDeliveryRecords, searchOpportunityDeliveryCustomers } from "./opportunityDeliveryDiagnostics";
import { createAdminApiKey, getAdminApiOverview, listAdminApiCustomerOptions, listAdminApiKeys, listAdminApiRequests, listAdminApiWebhookDeliveries, revokeAdminApiKey, updateAdminApiKey } from "./customer-api/admin";
import { getCustomerApiSettings, updateCustomerApiSettings, ApiAccessPolicyError } from "./customer-api/settings";
import { ApiKeyError } from "./customer-api/keys";

/** Map customer-API domain validation failures onto a 400 for the admin console. */
async function runApiAccessAction<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof ApiKeyError || error instanceof ApiAccessPolicyError) {
      throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
    }
    throw error;
  }
}


const opportunityDeliveryFiltersSchema = z.object({
  customerName: z.string().trim().min(2).max(100).optional(),
  customerId: z.number().int().positive().max(2_147_483_647).optional(),
  opportunityId: z.number().int().positive().max(2_147_483_647).optional(),
  packageName: z.string().trim().min(1).max(80).optional(),
  companyName: z.string().trim().min(1).max(120).optional(),
  status: z.enum(["queued","in_progress","retry_wait","delivered","received","rendered","failed","dismissed","expired","generated","cancelled","queue_record_unavailable","unknown"]).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  failedOnly: z.boolean().optional(),
  failureAnalysisOnly: z.boolean().optional(),
  expiredOnly: z.boolean().optional(),
  queuedOnly: z.boolean().optional(),
  stalledOnly: z.boolean().optional(),
  minRetries: z.number().int().min(0).max(20).optional(),
}).strict().superRefine((value, context) => {
  if (value.from && value.to && Date.parse(value.from) > Date.parse(value.to)) {
    context.addIssue({ code: "custom", message: "Start date must not be after end date.", path: ["from"] });
  }
});

// "Clear Trade" maintenance tool. Balances, the ledger and customer data are
// never in scope; only the four record groups below can be cleared.
const tradeRecordClearCategoriesSchema = z.object({
  tradeHistory: z.boolean(),
  opportunityRecords: z.boolean(),
  customerNotifications: z.boolean(),
  notificationCampaigns: z.boolean(),
}).strict();
const tradeRecordClearPreviewSchema = z.object({
  from: z.string().datetime({ offset: true }).nullable().optional(),
  to: z.string().datetime({ offset: true }).nullable().optional(),
  categories: tradeRecordClearCategoriesSchema,
  userId: z.number().int().positive().nullable().optional(),
}).strict()
  .refine(value => Object.values(value.categories).some(Boolean), { message: "Select at least one record group to clear." })
  .refine(value => !value.from || !value.to || Date.parse(value.from) <= Date.parse(value.to), { message: "Start of the clear window must not be after the end." });
const tradeRecordClearInputSchema = z.object({
  from: z.string().datetime({ offset: true }).nullable().optional(),
  to: z.string().datetime({ offset: true }).nullable().optional(),
  categories: tradeRecordClearCategoriesSchema,
  userId: z.number().int().positive().nullable().optional(),
  operationId: z.string().uuid(),
}).strict()
  .refine(value => Object.values(value.categories).some(Boolean), { message: "Select at least one record group to clear." })
  .refine(value => !value.from || !value.to || Date.parse(value.from) <= Date.parse(value.to), { message: "Start of the clear window must not be after the end." });

// Administrator-authored treasury-bond instruments. Country, rate, tenor and
// minimum are all administrator-supplied and validated server-side; the flag is
// derived from the country code, never typed.
const treasuryInstrumentFieldsSchema = {
  name: z.string().trim().min(3).max(120),
  issuer: z.string().trim().min(2).max(120),
  countryCode: z.string().trim().length(2).regex(/^[A-Za-z]{2}$/),
  category: z.enum(TREASURY_INSTRUMENT_CATEGORIES),
  tenorYears: z.number().gt(0).max(60),
  tenorLabel: z.string().trim().max(40).optional(),
  couponRatePct: z.number().min(0).max(100),
  couponFrequency: z.string().trim().max(32).optional(),
  nativeCurrency: z.string().trim().max(12).optional(),
  minInvestmentMinor: z.number().int().min(100).max(100_000_000),
  creditQuality: z.string().trim().max(48).optional(),
  riskLabel: z.string().trim().max(80).optional(),
  paymentMethod: z.string().trim().max(64).optional(),
  summary: z.string().trim().max(2000).optional(),
  highlights: z.array(z.string().trim().min(1).max(160)).max(8).optional(),
  reason: z.string().trim().max(500).optional(),
};
const createTreasuryInstrumentSchema = z.object(treasuryInstrumentFieldsSchema);
const updateTreasuryInstrumentSchema = z.object({ instrumentId: z.string().trim().min(2).max(80), ...treasuryInstrumentFieldsSchema });

// Administrator-authored Cooperate Dept companies. Every displayed field is
// administrator-supplied and validated server-side; the country flag is derived
// from the country code, never typed.
const cooperateDeptCompanyFieldsSchema = {
  name: z.string().trim().min(3).max(160),
  legalName: z.string().trim().max(200).optional(),
  countryCode: z.string().trim().length(2).regex(/^[A-Za-z]{2}$/),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  region: z.string().trim().max(80).optional(),
  foundedYear: z.number().int().min(1500).max(2100).nullable().optional(),
  foundedMonth: z.number().int().min(1).max(12).nullable().optional(),
  founders: z.array(z.string().trim().min(1).max(120)).max(6).optional(),
  keyPeople: z.array(z.string().trim().min(1).max(120)).max(6).optional(),
  companyType: z.string().trim().min(2).max(80),
  sectors: z.array(z.string().trim().min(1).max(80)).max(8).optional(),
  regulator: z.string().trim().max(160).optional(),
  problem: z.string().trim().min(8).max(2000),
  staffCount: z.number().int().min(0).max(5_000_000).nullable().optional(),
  staffRange: z.string().trim().max(80).optional(),
  financialStatus: z.string().trim().min(2).max(120),
  netWorthNote: z.string().trim().max(1000).optional(),
  regulatorStatus: z.string().trim().max(120).optional(),
  status: z.enum(["INSOLVENT", "WINDING_UP", "DISTRESSED", "DISSOLVED", "SEEKING_ACQUIRER", "STARTUP"]),
  severity: z.enum(["CRITICAL", "HIGH", "ELEVATED", "WATCH"]),
  countdownLabel: z.string().trim().max(120).optional(),
  countdownDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  countdownDirection: z.enum(["until", "since"]).optional(),
  ownershipOpportunity: z.string().trim().min(3).max(160),
  capitalAskMinor: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
  sourceUrl: z.string().trim().url().max(300).optional(),
  summary: z.string().trim().max(2000).optional(),
  highlights: z.array(z.string().trim().min(1).max(160)).max(8).optional(),
  registrationNumber: z.string().trim().max(40).optional(),
  lei: z.string().trim().max(24).optional(),
  ticker: z.string().trim().max(12).optional(),
  cik: z.string().trim().max(12).optional(),
  reason: z.string().trim().max(500).optional(),
};
const createCooperateDeptCompanySchema = z.object(cooperateDeptCompanyFieldsSchema);
const updateCooperateDeptCompanySchema = z.object({ companyId: z.string().trim().min(2).max(80), ...cooperateDeptCompanyFieldsSchema });

// Administrator-authored Litigation Funds dossiers and bundles. Every displayed
// economics field is administrator-supplied and validated server-side; evidence
// must be cited. Scenarios, when present, must be complete and sum to 100%.
const litigationScenarioSchema = z.object({
  outcome: z.enum(["SETTLE", "WIN", "LOSE"]),
  label: z.string().trim().max(80).optional(),
  probabilityBps: z.number().int().min(0).max(10000),
  grossRecoveryMinor: z.number().int().min(0).max(100_000_000_000),
  durationMonths: z.number().int().min(0).max(600),
  funderMultipleBps: z.number().int().min(0).max(1_000_000),
});
const litigationMilestoneSchema = z.object({
  stage: z.enum(["FILED", "DISCOVERY", "MEDIATION", "TRIAL", "JUDGMENT", "ENFORCEMENT", "DISTRIBUTION"]),
  label: z.string().trim().min(1).max(60),
  releaseBps: z.number().int().min(0).max(10000),
  status: z.enum(["PENDING", "REACHED"]),
  reachedAt: z.string().trim().max(40).nullable(),
});
const litigationDossierFieldsSchema = {
  caseName: z.string().trim().min(3).max(200),
  claimant: z.string().trim().min(2).max(160),
  defendant: z.string().trim().min(2).max(160),
  claimType: z.string().trim().min(2).max(120),
  countryCode: z.string().trim().length(2).regex(/^[A-Za-z]{2}$/),
  court: z.string().trim().min(2).max(160),
  counsel: z.string().trim().max(160).optional(),
  caseClass: z.enum(["COMMERCIAL_CONTRACT", "SECURITIES", "ANTITRUST_COMPETITION", "IP_PATENT", "PRODUCT_LIABILITY", "FRAUD_RESTITUTION", "REGULATORY_ENFORCEMENT", "INSOLVENCY", "OTHER_CIVIL"]).nullable().optional(),
  causeOfAction: z.string().trim().max(160).optional(),
  caseNumber: z.string().trim().max(80).optional(),
  filedAt: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  courtDetail: z.string().trim().max(160).optional(),
  claimValueBand: z.enum(["UNDER_1M", "1M_10M", "10M_100M", "OVER_100M"]).nullable().optional(),
  meritGrade: z.enum(["A", "B", "C", "D", "E"]).nullable().optional(),
  riskGrade: z.enum(["PRIME", "BALANCED", "SPECULATIVE", "HIGH_RISK"]).nullable().optional(),
  estimatedDamagesMinor: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
  capitalAtRiskMinor: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
  expectedMultipleBps: z.number().int().min(0).max(1_000_000).nullable().optional(),
  expectedDurationMonths: z.number().int().min(0).max(600).nullable().optional(),
  fundingAskMinor: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
  fundingDeadline: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  stage: z.enum(["FILED", "DISCOVERY", "MEDIATION", "TRIAL", "JUDGMENT", "ENFORCEMENT", "DISTRIBUTION"]),
  status: z.enum(["FUNDING", "ESCROW", "ACTIVE", "RESOLVED", "WITHDRAWN"]),
  problem: z.string().trim().min(8).max(2000),
  highlights: z.array(z.string().trim().min(1).max(160)).max(8).optional(),
  scenarios: z.array(litigationScenarioSchema).max(3).optional(),
  milestones: z.array(litigationMilestoneSchema).max(10).optional(),
  bundleId: z.string().trim().max(80).optional(),
  source: z.string().trim().max(160).optional(),
  sourceUrl: z.string().trim().url().max(300).optional(),
  asOf: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  reason: z.string().trim().max(500).optional(),
};
const createLitigationDossierSchema = z.object(litigationDossierFieldsSchema);
const updateLitigationDossierSchema = z.object({ dossierId: z.string().trim().min(2).max(80), ...litigationDossierFieldsSchema });
const litigationBundleFieldsSchema = {
  name: z.string().trim().min(3).max(160),
  claimType: z.string().trim().min(2).max(120),
  jurisdiction: z.string().trim().min(2).max(120),
  riskGrade: z.enum(["PRIME", "BALANCED", "SPECULATIVE", "HIGH_RISK"]),
  targetMinor: z.number().int().min(1).max(100_000_000_000),
  unitPriceMinor: z.number().int().min(1).max(100_000_000_000),
  unitCount: z.number().int().min(1).max(1_000_000),
  caseIds: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  allocationBpsByCase: z.record(z.string(), z.number().int().min(0).max(10000)).optional(),
  expectedMultipleBps: z.number().int().min(0).max(1_000_000),
  expectedDurationMonths: z.number().int().min(0).max(600).nullable().optional(),
  summary: z.string().trim().max(2000).optional(),
  source: z.string().trim().max(160).optional(),
  asOf: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  reason: z.string().trim().max(500).optional(),
};
const createLitigationBundleSchema = z.object(litigationBundleFieldsSchema);
const updateLitigationBundleSchema = z.object({ bundleId: z.string().trim().min(2).max(80), ...litigationBundleFieldsSchema });

// Administrator-authored IP Royalties dossiers and portfolios. Public IP
// registers publish no royalty economics, so every displayed number is
// administrator-supplied, validated server-side and cited. Payment-history and
// distribution scenarios, when present, must be complete; scenarios must sum to 100%.
const ipRoyaltyScenarioSchema = z.object({
  label: z.string().trim().min(1).max(60),
  probabilityBps: z.number().int().min(0).max(10000),
  expectedAnnualDistributionMinor: z.number().int().min(0).max(100_000_000_000),
  durationMonths: z.number().int().min(0).max(600),
  funderMultipleBps: z.number().int().min(0).max(100_000),
});
const ipRoyaltyPaymentHistorySchema = z.object({
  onTimeBps: z.number().int().min(0).max(10000),
  averageCollectionDays: z.number().int().min(0).max(3650),
  periodsObserved: z.number().int().min(0).max(10000),
});
const ipRoyaltyDossierFieldsSchema = {
  rightName: z.string().trim().min(3).max(200),
  rightType: z.enum(["PATENT", "TRADEMARK", "BRAND", "COPYRIGHT", "SOFTWARE", "FILM_TV", "CHARACTER", "IMAGE_LIKENESS", "FRANCHISE", "KNOW_HOW", "DESIGN"]),
  licensor: z.string().trim().min(2).max(160),
  licenseeSummary: z.string().trim().max(200).optional(),
  assetClass: z.string().trim().max(120).optional(),
  countryCode: z.string().trim().length(2).regex(/^[A-Za-z]{2}$/),
  jurisdiction: z.string().trim().max(120).optional(),
  royaltyBasis: z.enum(["PERCENT_OF_NET_SALES", "PER_UNIT", "FIXED_FEE", "REVENUE_SHARE"]),
  royaltyRateBps: z.number().int().min(0).max(10000).nullable().optional(),
  perUnitMinor: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
  cadence: z.enum(["MONTHLY", "QUARTERLY", "SEMI_ANNUAL", "ANNUAL"]),
  termMonths: z.number().int().min(0).max(600).nullable().optional(),
  minimumGuaranteeMinor: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
  licenseeCount: z.number().int().min(0).max(100_000).nullable().optional(),
  topLicenseeConcentrationBps: z.number().int().min(0).max(10000).nullable().optional(),
  paymentHistory: ipRoyaltyPaymentHistorySchema.nullable().optional(),
  riskGrade: z.enum(["PRIME", "BALANCED", "SPECULATIVE", "HIGH_RISK"]).nullable().optional(),
  capitalAtRiskMinor: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
  expectedAnnualDistributionMinor: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
  expectedMultipleBps: z.number().int().min(0).max(100_000).nullable().optional(),
  expectedDurationMonths: z.number().int().min(0).max(600).nullable().optional(),
  fundingAskMinor: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
  fundingDeadline: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(["FUNDING", "ACTIVE", "DISTRIBUTING", "COMPLETED", "WITHDRAWN"]).optional(),
  problem: z.string().trim().min(8).max(4000),
  highlights: z.array(z.string().trim().min(1).max(300)).max(12).optional(),
  scenarios: z.array(ipRoyaltyScenarioSchema).max(4).optional(),
  source: z.string().trim().max(160).optional(),
  sourceUrl: z.string().trim().url().max(300).optional(),
  asOf: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().max(500).optional(),
};
const createIpRoyaltyDossierSchema = z.object(ipRoyaltyDossierFieldsSchema);
const updateIpRoyaltyDossierSchema = z.object({ dossierId: z.string().trim().min(2).max(80), ...ipRoyaltyDossierFieldsSchema });
const ipRoyaltyPortfolioFieldsSchema = {
  name: z.string().trim().min(3).max(160),
  rightType: z.enum(["PATENT", "TRADEMARK", "BRAND", "COPYRIGHT", "SOFTWARE", "FILM_TV", "CHARACTER", "IMAGE_LIKENESS", "FRANCHISE", "KNOW_HOW", "DESIGN"]),
  jurisdiction: z.string().trim().min(2).max(120),
  riskGrade: z.enum(["PRIME", "BALANCED", "SPECULATIVE", "HIGH_RISK"]),
  targetMinor: z.number().int().min(1).max(100_000_000_000),
  unitPriceMinor: z.number().int().min(1).max(100_000_000_000),
  unitCount: z.number().int().min(1).max(1_000_000),
  rightIds: z.array(z.string().trim().min(1).max(80)).min(1).max(50),
  allocationBpsByRight: z.record(z.string(), z.number().int().min(0).max(10000)).optional(),
  expectedMultipleBps: z.number().int().min(0).max(100_000),
  expectedDurationMonths: z.number().int().min(0).max(600).nullable().optional(),
  expectedAnnualDistributionMinor: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
  summary: z.string().trim().max(2000).optional(),
  source: z.string().trim().max(160).optional(),
  sourceUrl: z.string().trim().url().max(300).optional(),
  asOf: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().max(500).optional(),
};
const createIpRoyaltyPortfolioSchema = z.object(ipRoyaltyPortfolioFieldsSchema);
const updateIpRoyaltyPortfolioSchema = z.object({ portfolioId: z.string().trim().min(2).max(80), ...ipRoyaltyPortfolioFieldsSchema });

// Administrator-authored Music Royalties dossiers. Music-only: every displayed
// economics field is administrator-supplied and validated server-side, evidence
// must be cited, and the three modelled outcomes (HIT / RECOUP / WRITE_OFF),
// when present, must be complete and sum to 100%.
const musicScenarioSchema = z.object({
  outcome: z.enum(["HIT", "RECOUP", "WRITE_OFF"]),
  label: z.string().trim().max(80).optional(),
  probabilityBps: z.number().int().min(0).max(10000),
  grossRevenueMinor: z.number().int().min(0).max(100_000_000_000),
  durationMonths: z.number().int().min(0).max(600),
  funderMultipleBps: z.number().int().min(0).max(1_000_000),
});
const musicMilestoneSchema = z.object({
  stage: z.enum(["ANNOUNCED", "FUNDING", "IN_PRODUCTION", "RELEASED", "TOURING", "PAYING", "CLOSED"]),
  label: z.string().trim().min(1).max(60),
  releaseBps: z.number().int().min(0).max(10000),
  status: z.enum(["PENDING", "REACHED"]),
  reachedAt: z.string().trim().max(40).nullable(),
});
const musicDossierFieldsSchema = {
  title: z.string().trim().min(3).max(200),
  artist: z.string().trim().min(2).max(160),
  musicType: z.enum(["SHOW_CONCERT", "FESTIVAL", "TOUR", "NEW_ARTIST", "NEW_ALBUM", "ENDORSEMENT_DEAL", "BRAND_LABEL", "MASTER_RIGHTS", "PUBLISHING_CATALOGUE", "SYNC_LICENSING", "MERCHANDISE", "MUSIC_VIDEO", "CATALOGUE_ACQUISITION", "ROYALTY_STREAM"]),
  genre: z.enum(["POP", "HIP_HOP", "ROCK", "ELECTRONIC", "R_AND_B", "COUNTRY", "JAZZ", "CLASSICAL", "LATIN", "AFROBEATS", "GOSPEL", "INDIE", "OTHER"]),
  countryCode: z.string().trim().length(2).regex(/^[A-Za-z]{2}$/),
  territory: z.string().trim().max(120).nullable().optional(),
  territoryBand: z.enum(["LOCAL", "REGIONAL", "NATIONAL", "GLOBAL"]).nullable().optional(),
  label: z.string().trim().max(160).nullable().optional(),
  description: z.string().trim().min(8).max(2000),
  dealType: z.string().trim().max(120).nullable().optional(),
  revenueSharesBps: z.number().int().min(0).max(10000).nullable().optional(),
  expectedMultipleBps: z.number().int().min(0).max(1_000_000).nullable().optional(),
  expectedDurationMonths: z.number().int().min(0).max(600).nullable().optional(),
  projectedRevenueMinor: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
  capitalAtRiskMinor: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
  fundingAskMinor: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
  minimumInvestmentMinor: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
  unitPriceMinor: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
  eventDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  fundingDeadline: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  stage: z.enum(["ANNOUNCED", "FUNDING", "IN_PRODUCTION", "RELEASED", "TOURING", "PAYING", "CLOSED"]),
  status: z.enum(["FUNDING", "ESCROW", "IN_PRODUCTION", "ACTIVE", "PAYING", "COMPLETED", "WITHDRAWN"]),
  riskGrade: z.enum(["PRIME", "BALANCED", "SPECULATIVE", "HIGH_RISK"]).nullable().optional(),
  highlights: z.array(z.string().trim().min(1).max(200)).max(12).nullable().optional(),
  scenarios: z.array(musicScenarioSchema).max(3).nullable().optional(),
  milestones: z.array(musicMilestoneSchema).max(10).nullable().optional(),
  source: z.string().trim().max(160).nullable().optional(),
  sourceUrl: z.string().trim().url().max(300).nullable().optional(),
  asOf: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  reason: z.string().trim().max(500).nullable().optional(),
};
const createMusicDossierSchema = z.object(musicDossierFieldsSchema);
const updateMusicDossierSchema = z.object({ dossierId: z.string().trim().min(2).max(80), ...musicDossierFieldsSchema });

// Administrator-authored Agro Investment dossiers. Agriculture-only: every
// displayed economics field is administrator-supplied and validated server-side,
// evidence must be cited, and the three modelled outcomes (STRONG_SEASON /
// ON_PLAN / WRITE_OFF), when present, must be complete and sum to 100%.
const agroScenarioSchema = z.object({
  outcome: z.enum(["STRONG_SEASON", "ON_PLAN", "WRITE_OFF"]),
  label: z.string().trim().max(80).optional(),
  probabilityBps: z.number().int().min(0).max(10000),
  grossRevenueMinor: z.number().int().min(0).max(100_000_000_000),
  durationMonths: z.number().int().min(0).max(600),
  funderMultipleBps: z.number().int().min(0).max(1_000_000),
});
const agroMilestoneSchema = z.object({
  stage: z.enum(["PLANNED", "FUNDING", "IN_PRODUCTION", "HARVESTING", "OFF_TAKE", "PAYING", "CLOSED"]),
  label: z.string().trim().min(1).max(60),
  releaseBps: z.number().int().min(0).max(10000),
  status: z.enum(["PENDING", "REACHED"]),
  reachedAt: z.string().trim().max(40).nullable(),
});
const agroDossierFieldsSchema = {
  title: z.string().trim().min(3).max(200),
  operator: z.string().trim().min(2).max(160),
  agroType: z.enum(["ROW_CROP", "ORCHARD_VINEYARD", "LIVESTOCK", "DAIRY", "POULTRY", "AQUACULTURE", "GREENHOUSE", "FARMLAND", "IRRIGATION_WATER", "FARM_MACHINERY", "STORAGE_LOGISTICS", "AGRI_INPUTS", "AGRITECH", "AGRI_PROCESSING"]),
  sector: z.enum(["GRAINS", "OILSEEDS", "PULSES", "VEGETABLES", "FRUIT_NUTS", "VITICULTURE", "SUGAR", "BEVERAGE_CROPS", "FIBRE", "LIVESTOCK", "DAIRY", "POULTRY", "AQUACULTURE", "FLORICULTURE", "OTHER"]),
  countryCode: z.string().trim().length(2).regex(/^[A-Za-z]{2}$/),
  territory: z.string().trim().max(120).nullable().optional(),
  territoryBand: z.enum(["LOCAL", "REGIONAL", "NATIONAL", "GLOBAL"]).nullable().optional(),
  offtaker: z.string().trim().max(160).nullable().optional(),
  description: z.string().trim().min(8).max(2000),
  dealType: z.string().trim().max(120).nullable().optional(),
  revenueSharesBps: z.number().int().min(0).max(10000).nullable().optional(),
  expectedMultipleBps: z.number().int().min(0).max(1_000_000).nullable().optional(),
  expectedDurationMonths: z.number().int().min(0).max(600).nullable().optional(),
  projectedRevenueMinor: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
  capitalAtRiskMinor: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
  fundingAskMinor: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
  minimumInvestmentMinor: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
  unitPriceMinor: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
  eventDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  fundingDeadline: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  stage: z.enum(["PLANNED", "FUNDING", "IN_PRODUCTION", "HARVESTING", "OFF_TAKE", "PAYING", "CLOSED"]),
  status: z.enum(["FUNDING", "ESCROW", "IN_PRODUCTION", "ACTIVE", "PAYING", "COMPLETED", "WITHDRAWN"]),
  riskGrade: z.enum(["PRIME", "BALANCED", "SPECULATIVE", "HIGH_RISK"]).nullable().optional(),
  highlights: z.array(z.string().trim().min(1).max(200)).max(12).nullable().optional(),
  scenarios: z.array(agroScenarioSchema).max(3).nullable().optional(),
  milestones: z.array(agroMilestoneSchema).max(10).nullable().optional(),
  source: z.string().trim().max(160).nullable().optional(),
  sourceUrl: z.string().trim().url().max(300).nullable().optional(),
  asOf: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  reason: z.string().trim().max(500).nullable().optional(),
};
const createAgroDossierSchema = z.object(agroDossierFieldsSchema);
const updateAgroDossierSchema = z.object({ dossierId: z.string().trim().min(2).max(80), ...agroDossierFieldsSchema });

// Administrator overrides for a desk opportunity's auto-assigned economics. The
// desk is assigned deterministic values by default; every field here is optional
// so an administrator can patch a single value from the admin portal. The zod
// ranges are deliberately loose at the edges and the shared ECONOMICS_BOUNDS
// validator is the single source of truth (it throws a readable reason for any
// out-of-band value, including non-integer or unsupported currency).
const DESK_KEY_VALUES = ["treasury", "litigation", "agro", "ipRoyalty", "music", "cooperate", "carbon", "greenEnergy", "lending"] as const;
const deskKeySchema = z.enum(DESK_KEY_VALUES);
const deskEconomicsOverrideSchema = {
  currency: z.string().trim().min(3).max(8).optional(),
  ticketMinMinor: z.number().int().min(1).max(100_000_000).optional(),
  fundingTargetMinor: z.number().int().min(1).max(1_000_000_000_000).optional(),
  profitBps: z.number().int().min(2_500).max(3_800).optional(),
  termDays: z.number().int().min(30).max(365).optional(),
  platformFeeBps: z.number().int().min(700).max(1_000).optional(),
  settlementDelayDays: z.number().int().min(0).max(365).nullable().optional(),
  closeDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  maturityDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
};

// Administrator-authored Carbon Credit dossiers. Carbon-only: every displayed
// economics field is administrator-supplied and validated server-side, evidence
// must be cited, and the three modelled outcomes (HIGH_ISSUANCE / ON_PLAN /
// WRITE_OFF), when present, must be complete and sum to 100%.
const carbonScenarioSchema = z.object({
  outcome: z.enum(["HIGH_ISSUANCE", "ON_PLAN", "WRITE_OFF"]),
  label: z.string().trim().max(80).optional(),
  probabilityBps: z.number().int().min(0).max(10000),
  grossRevenueMinor: z.number().int().min(0).max(100_000_000_000),
  durationMonths: z.number().int().min(0).max(600),
  funderMultipleBps: z.number().int().min(0).max(1_000_000),
});
const carbonMilestoneSchema = z.object({
  stage: z.enum(["PLANNED", "FUNDING", "DEVELOPMENT", "VALIDATION", "ISSUANCE", "RETIRING", "CLOSED"]),
  label: z.string().trim().min(1).max(60),
  releaseBps: z.number().int().min(0).max(10000),
  status: z.enum(["PENDING", "REACHED"]),
  reachedAt: z.string().trim().max(40).nullable(),
});
const carbonDossierFieldsSchema = {
  title: z.string().trim().min(3).max(200),
  operator: z.string().trim().min(2).max(160),
  creditType: z.enum(["REFORESTATION", "FOREST_CONSERVATION", "SOIL_CARBON", "BLUE_CARBON", "COOKSTOVES", "BIOCHAR", "DIRECT_AIR_CAPTURE", "BECCS", "ENHANCED_WEATHERING", "OCEAN_ALKALINITY", "RENEWABLE_ENERGY", "METHANE_CAPTURE", "WASTE_MANAGEMENT", "INDUSTRIAL_EFFICIENCY"]),
  sector: z.enum(["FORESTRY", "AGRICULTURE", "ENERGY", "WASTE", "INDUSTRIAL", "OCEAN", "GEOLOGICAL", "OTHER"]),
  standard: z.enum(["VERRA_VCS", "GOLD_STANDARD", "CDM", "ACR", "CAR", "PLAN_VIVO", "PURO_EARTH", "OTHER"]).nullable().optional(),
  countryCode: z.string().trim().length(2).regex(/^[A-Za-z]{2}$/),
  territory: z.string().trim().max(120).nullable().optional(),
  territoryBand: z.enum(["LOCAL", "REGIONAL", "NATIONAL", "GLOBAL"]).nullable().optional(),
  offtaker: z.string().trim().max(160).nullable().optional(),
  description: z.string().trim().min(8).max(2000),
  dealType: z.string().trim().max(120).nullable().optional(),
  revenueSharesBps: z.number().int().min(0).max(10000).nullable().optional(),
  expectedMultipleBps: z.number().int().min(0).max(1_000_000).nullable().optional(),
  expectedDurationMonths: z.number().int().min(0).max(600).nullable().optional(),
  projectedRevenueMinor: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
  capitalAtRiskMinor: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
  fundingAskMinor: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
  creditVolumeTonnes: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
  pricePerTonneMinor: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
  minimumInvestmentMinor: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
  unitPriceMinor: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
  eventDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  fundingDeadline: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  stage: z.enum(["PLANNED", "FUNDING", "DEVELOPMENT", "VALIDATION", "ISSUANCE", "RETIRING", "CLOSED"]),
  status: z.enum(["FUNDING", "ESCROW", "DEVELOPMENT", "ACTIVE", "ISSUING", "COMPLETED", "WITHDRAWN"]),
  riskGrade: z.enum(["PRIME", "BALANCED", "SPECULATIVE", "HIGH_RISK"]).nullable().optional(),
  highlights: z.array(z.string().trim().min(1).max(200)).max(12).nullable().optional(),
  scenarios: z.array(carbonScenarioSchema).max(3).nullable().optional(),
  milestones: z.array(carbonMilestoneSchema).max(10).nullable().optional(),
  source: z.string().trim().max(160).nullable().optional(),
  sourceUrl: z.string().trim().url().max(300).nullable().optional(),
  asOf: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  reason: z.string().trim().max(500).nullable().optional(),
};
const createCarbonDossierSchema = z.object(carbonDossierFieldsSchema);
const updateCarbonDossierSchema = z.object({ dossierId: z.string().trim().min(2).max(80), ...carbonDossierFieldsSchema });

// Administrator-authored Green Energy dossiers. Green-energy only: every displayed
// economics field is administrator-supplied and validated server-side, evidence
// must be cited, and the three modelled outcomes (OUTPERFORM / ON_PLAN /
// WRITE_OFF), when present, must be complete and sum to 100%.
const greenEnergyScenarioSchema = z.object({
  outcome: z.enum(["OUTPERFORM", "ON_PLAN", "WRITE_OFF"]),
  label: z.string().trim().max(80).optional(),
  probabilityBps: z.number().int().min(0).max(10000),
  grossRevenueMinor: z.number().int().min(0).max(100_000_000_000),
  durationMonths: z.number().int().min(0).max(600),
  funderMultipleBps: z.number().int().min(0).max(1_000_000),
});
const greenEnergyMilestoneSchema = z.object({
  stage: z.enum(["PLANNED", "FUNDING", "DEVELOPMENT", "CONSTRUCTION", "COMMISSIONING", "OPERATING", "CLOSED"]),
  label: z.string().trim().min(1).max(60),
  releaseBps: z.number().int().min(0).max(10000),
  status: z.enum(["PENDING", "REACHED"]),
  reachedAt: z.string().trim().max(40).nullable(),
});
const greenEnergyDossierFieldsSchema = {
  title: z.string().trim().min(3).max(200),
  operator: z.string().trim().min(2).max(160),
  energyType: z.enum(["SOLAR_PV", "CONCENTRATED_SOLAR", "ONSHORE_WIND", "OFFSHORE_WIND", "HYDROPOWER", "GEOTHERMAL", "TIDAL_WAVE", "BIOMASS_BIOENERGY", "BATTERY_STORAGE", "GREEN_HYDROGEN", "WASTE_TO_ENERGY", "GRID_INFRASTRUCTURE", "ENERGY_EFFICIENCY", "EV_CHARGING"]),
  sector: z.enum(["SOLAR", "WIND", "HYDRO", "GEOTHERMAL", "MARINE", "BIOENERGY", "STORAGE", "HYDROGEN", "GRID", "EFFICIENCY", "TRANSPORT", "OTHER"]),
  standard: z.enum(["IFC_PERFORMANCE", "EQUATOR_PRINCIPLES", "GOLD_STANDARD", "VERRA_VCS", "ISO_14064", "RE100", "SBTI", "OTHER"]).nullable().optional(),
  countryCode: z.string().trim().length(2).regex(/^[A-Za-z]{2}$/),
  territory: z.string().trim().max(120).nullable().optional(),
  territoryBand: z.enum(["LOCAL", "REGIONAL", "NATIONAL", "GLOBAL"]).nullable().optional(),
  offtaker: z.string().trim().max(160).nullable().optional(),
  description: z.string().trim().min(8).max(2000),
  dealType: z.string().trim().max(120).nullable().optional(),
  revenueSharesBps: z.number().int().min(0).max(10000).nullable().optional(),
  expectedMultipleBps: z.number().int().min(0).max(1_000_000).nullable().optional(),
  expectedDurationMonths: z.number().int().min(0).max(600).nullable().optional(),
  projectedRevenueMinor: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
  capitalAtRiskMinor: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
  fundingAskMinor: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
  capacityMw: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
  tariffPerMwhMinor: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
  minimumInvestmentMinor: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
  unitPriceMinor: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
  eventDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  fundingDeadline: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  stage: z.enum(["PLANNED", "FUNDING", "DEVELOPMENT", "CONSTRUCTION", "COMMISSIONING", "OPERATING", "CLOSED"]),
  status: z.enum(["FUNDING", "ESCROW", "DEVELOPMENT", "ACTIVE", "OPERATING", "COMPLETED", "WITHDRAWN"]),
  riskGrade: z.enum(["PRIME", "BALANCED", "SPECULATIVE", "HIGH_RISK"]).nullable().optional(),
  highlights: z.array(z.string().trim().min(1).max(200)).max(12).nullable().optional(),
  scenarios: z.array(greenEnergyScenarioSchema).max(3).nullable().optional(),
  milestones: z.array(greenEnergyMilestoneSchema).max(10).nullable().optional(),
  source: z.string().trim().max(160).nullable().optional(),
  sourceUrl: z.string().trim().url().max(300).nullable().optional(),
  asOf: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  reason: z.string().trim().max(500).nullable().optional(),
};
const createGreenEnergyDossierSchema = z.object(greenEnergyDossierFieldsSchema);
const updateGreenEnergyDossierSchema = z.object({ dossierId: z.string().trim().min(2).max(80), ...greenEnergyDossierFieldsSchema });

// Administrator-authored Lending loans and lender reserves. Lending only: every
// displayed field is administrator-supplied and validated server-side, the
// auction window and disbursement conditions are administrator controlled, and
// the lender reserve is the administrator's statement of a lender's capacity.
// The live borrower auction itself lives in server/lending.ts.
function lendingEnum<T extends string>(values: readonly T[]) {
  return z.enum(values as unknown as [T, ...T[]]);
}
const lendingDisbursementConditionSchema = z.object({
  type: lendingEnum(LENDING_CONDITION_TYPES),
  label: z.string().trim().max(90).nullable().optional(),
  required: z.boolean().optional(),
  status: lendingEnum(LENDING_CONDITION_STATUSES).nullable().optional(),
  detail: z.string().trim().max(240).nullable().optional(),
  metAt: z.string().trim().max(40).nullable().optional(),
});
const lendingLoanFieldsSchema = {
  title: z.string().trim().min(3).max(200),
  borrower: z.string().trim().min(2).max(160),
  loanType: lendingEnum(LENDING_LOAN_TYPES),
  sector: lendingEnum(LENDING_SECTORS),
  countryCode: z.string().trim().length(2).regex(/^[A-Za-z]{2}$/),
  territory: z.string().trim().max(120).nullable().optional(),
  territoryBand: lendingEnum(LENDING_TERRITORY_BANDS).nullable().optional(),
  purpose: z.string().trim().max(300).nullable().optional(),
  description: z.string().trim().min(8).max(2000),
  principalMinor: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
  currency: z.string().trim().min(3).max(12).nullable().optional(),
  startingInterestBps: z.number().int().min(0).max(100_000).nullable().optional(),
  minimumTenureMonths: z.number().int().min(0).max(600).nullable().optional(),
  maximumTenureMonths: z.number().int().min(0).max(600).nullable().optional(),
  repaymentFrequency: lendingEnum(LENDING_REPAYMENT_FREQUENCIES).nullable().optional(),
  platformFeeBps: z.number().int().min(0).max(100_000).nullable().optional(),
  riskGrade: lendingEnum(LENDING_RISK_GRADES).nullable().optional(),
  collateral: z.string().trim().max(300).nullable().optional(),
  highlights: z.array(z.string().trim().min(1).max(200)).max(12).nullable().optional(),
  conditions: z.array(lendingDisbursementConditionSchema).max(15).nullable().optional(),
  stage: lendingEnum(LENDING_STAGES),
  auctionOpensAt: z.string().trim().max(40).nullable().optional(),
  auctionClosesAt: z.string().trim().max(40).nullable().optional(),
  reserveId: z.string().trim().max(80).nullable().optional(),
  source: z.string().trim().max(160).nullable().optional(),
  sourceUrl: z.string().trim().url().max(300).nullable().optional(),
  asOf: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  reason: z.string().trim().max(500).nullable().optional(),
};
const createLendingLoanSchema = z.object(lendingLoanFieldsSchema);
const updateLendingLoanSchema = z.object({ loanId: z.string().trim().min(1).max(80), ...lendingLoanFieldsSchema });

const lenderReserveFieldsSchema = {
  lender: z.string().trim().min(2).max(160),
  capacityMinor: z.number().int().min(1).max(100_000_000_000),
  currency: z.string().trim().min(3).max(12).nullable().optional(),
  countryCode: z.string().trim().length(2).regex(/^[A-Za-z]{2}$/),
  territory: z.string().trim().max(120).nullable().optional(),
  minimumTicketMinor: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
  maximumTicketMinor: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
  minimumTenureMonths: z.number().int().min(0).max(600).nullable().optional(),
  maximumTenureMonths: z.number().int().min(0).max(600).nullable().optional(),
  startingInterestBps: z.number().int().min(0).max(100_000).nullable().optional(),
  loanTypes: z.array(lendingEnum(LENDING_LOAN_TYPES)).max(14).nullable().optional(),
  note: z.string().trim().max(300).nullable().optional(),
  enabled: z.boolean().optional(),
  source: z.string().trim().max(160).nullable().optional(),
  asOf: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  reason: z.string().trim().max(500).nullable().optional(),
};
const createLenderReserveSchema = z.object(lenderReserveFieldsSchema);
const updateLenderReserveSchema = z.object({ reserveId: z.string().trim().min(1).max(80), ...lenderReserveFieldsSchema });

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  appearanceConfig: publicProcedure.query(async () =>
    normalizeAppearanceSettings(await getAppSetting("appearance.settings"))
  ),

  companyCatalogueReference: router({
    // The complete source catalogue and its status controls are administrator-only.
    summary: adminProcedure.query(() => getCompanyReferenceSummary()),
    count: adminProcedure.input(z.object({
      search: z.string().trim().max(100).optional(),
      countryName: z.string().trim().min(1).max(100).optional(),
    }).optional()).query(({ input }) => countCompanyReferences(input ?? {})),
    search: adminProcedure.input(z.object({
      search: z.string().trim().max(100).optional(),
      countryName: z.string().trim().min(1).max(100).optional(),
      offset: z.number().int().min(0).max(1810).optional(),
      limit: z.number().int().min(1).max(1811).optional(),
    }).optional()).query(({ input }) => searchCompanyReferences(input ?? {})),
    adminState: adminProcedure.query(async () => {
      const raw = await getAppSetting("trade.companyCatalogue.adminState", "{}");
      try {
        const parsed = JSON.parse(raw || "{}") as { verifiedIds?: string[]; archivedIds?: string[]; disabledIds?: string[] };
        const verifiedIds = (parsed.verifiedIds ?? []).filter(id => /^logo-brand-\d{4}$/.test(id));
        const archivedIds = (parsed.archivedIds ?? []).filter(id => /^logo-brand-\d{4}$/.test(id));
        const disabledIds = (parsed.disabledIds ?? []).filter(id => /^logo-brand-\d{4}$/.test(id));
        const statusById: Record<string, { status: "verified" | "archived" | "disabled" }> = {};
        for (const id of verifiedIds) statusById[id] = { status: "verified" };
        for (const id of disabledIds) statusById[id] = { status: "disabled" };
        for (const id of archivedIds) statusById[id] = { status: "archived" };
        return { statusById };
      } catch {
        return { statusById: {} };
      }
    }),
    updateAdminState: adminProcedure.input(z.object({
      // Keep legacy ID-array clients compatible while current clients send a compact
      // 1,811-bit selection bitmap (304 base64 characters) through restrictive proxies.
      ids: z.array(z.string().regex(/^logo-brand-\d{4}$/)).min(1).max(1811).optional(),
      selectionBitmap: z.string().length(304).optional(),
      status: z.enum(["verified", "unverified", "archived", "restored", "disabled", "enabled"]),
      reason: z.string().trim().min(8).max(500),
    }).refine(input => Boolean(input.ids) !== Boolean(input.selectionBitmap), {
      message: "Provide exactly one company selection representation.",
    })).mutation(async ({ ctx, input }) => {
      const selectedIds = input.selectionBitmap
        ? decodeCompanyCatalogueSelection(input.selectionBitmap)
        : input.ids!;
      const ids = [...new Set(selectedIds)];
      if (ids.some(id => !getCompanyReferenceById(id))) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "One or more selected company IDs do not exist in the catalogue." });
      }
      return updateCompanyCatalogueAdminState({ ids, status: input.status, reason: input.reason, updatedBy: ctx.user.id });
    }),
    byId: adminProcedure.input(z.object({
      id: z.string().trim().min(1).max(180),
    })).query(({ input }) => getCompanyReferenceById(input.id) ?? null),
    bySymbol: adminProcedure.input(z.object({
      symbol: z.string().trim().min(1).max(40),
    })).query(({ input }) => findCompanyReferencesBySymbol(input.symbol)),
    random: adminProcedure.query(() => getRandomCompanyReference()),
    next: adminProcedure.input(z.object({
      excludeId: z.string().trim().min(1).max(180).optional(),
    }).optional()).mutation(({ input }) => getRandomCompanyReference(Math.random, input?.excludeId ? [input.excludeId] : [])),
  }),

  privacy: router({
    currentPolicy: protectedProcedure.query(({ ctx }) => {
      if (ctx.user.role !== "user") throw new TRPCError({ code: "FORBIDDEN", message: "Privacy Centre customer views require a customer account." });
      return privacyService.getCurrentPrivacyPolicy();
    }),
    policyHistory: protectedProcedure.query(({ ctx }) => {
      if (ctx.user.role !== "user") throw new TRPCError({ code: "FORBIDDEN", message: "Privacy Centre customer views require a customer account." });
      return privacyService.getPrivacyPolicyHistory();
    }),
    myRequests: protectedProcedure.query(({ ctx }) => {
      if (ctx.user.role !== "user") throw new TRPCError({ code: "FORBIDDEN", message: "Privacy requests are available to customer accounts." });
      return privacyService.listMyPrivacyRequests(ctx.user.id);
    }),
    createRequest: protectedProcedure.input(z.object({
      requestType: z.enum(["access", "correction", "deletion", "restriction", "objection", "other"]),
      subject: z.string().trim().min(5).max(180),
      details: z.string().max(3000).optional(),
      idempotencyKey: z.string().trim().min(8).max(80),
    })).mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "user") throw new TRPCError({ code: "FORBIDDEN", message: "Only customer accounts can submit privacy requests." });
      const result = await privacyService.createPrivacyRequest(ctx.user.id, input);
      if (!result.duplicate) {
        try {
          const admins = await privacyService.listAdminPrivacyRequesters();
          await Promise.allSettled(admins.map((admin) => createNotification(
            admin.id,
            "New privacy request",
            "A customer submitted privacy request " + result.requestReference + ". Open Privacy Management to review it.",
            {
              eventKey: "privacy-request-received:" + result.requestReference + ":" + admin.id,
              category: "account",
              priority: "normal",
              href: "/ops-console-7f3a",
            },
          )));
        } catch (error) {
          console.error("[Privacy] Administrator notification failed after request persistence:", error instanceof Error ? error.name : "UnknownError");
        }
      }
      return result;
    }),
    cancelRequest: protectedProcedure.input(z.object({ requestId: z.number().int().positive() })).mutation(({ ctx, input }) => {
      if (ctx.user.role !== "user") throw new TRPCError({ code: "FORBIDDEN", message: "Only the customer can cancel their privacy request." });
      return privacyService.cancelMyPrivacyRequest(ctx.user.id, input.requestId);
    }),
  }),

  auth: router({
    me: publicProcedure.query(async opts => {
      if (!opts.ctx.user) return null;
      const { passwordHash: _passwordHash, ...safeUser } = opts.ctx.user;
      // Item 64: the package name shown here must agree with customer.tradingEligibility.
      return { ...safeUser, packageName: await resolveCustomerPackageName(opts.ctx.user.id) };
    }),
    requestEmailVerification: protectedProcedure.mutation(({ ctx }) => requestEmailVerification(ctx.user.id)),
    confirmEmailVerification: protectedProcedure.input(z.object({ code: z.string().regex(/^\d{8}$/) })).mutation(({ ctx, input }) => confirmEmailVerification(ctx.user.id, input.code)),
    logout: publicProcedure.mutation(async ({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      let user = ctx.user;
      let shouldRevoke = Boolean(ctx.user);

      // Recover a valid token when context construction could not attach its user.
      if (!user) {
        const localSession = getLocalSessionFromRequest(ctx.req);
        if (localSession) {
          const localUser = await getUserById(localSession.userId);
          if (localUser) {
            user = localUser;
            shouldRevoke = localUser.loginMethod !== "closed" &&
              Number(localSession.authVersion) === Number(localUser.authVersion ?? 0);
          }
        } else {
          const cookies = parseCookieHeader(ctx.req.headers.cookie ?? "");
          const cookieToken = cookies[COOKIE_NAME];
          const authHeader = ctx.req.headers.authorization;
          const bearerToken = typeof authHeader === "string" && authHeader.startsWith("Bearer ")
            ? authHeader.slice(7)
            : undefined;
          let session = await localIdentityService.verifySession(cookieToken);
          if (!session && bearerToken && bearerToken !== cookieToken) {
            session = await localIdentityService.verifySession(bearerToken);
          }

          if (session) {
            // Never auto-provision an OAuth identity just because logout was requested.
            const sessionUser = await getUserForSessionRevocation(session.openId);
            if (!sessionUser) {
              throw new Error("Could not verify the account associated with this session. Retry logout.");
            }
            user = sessionUser;
            shouldRevoke = sessionUser.loginMethod !== "closed" &&
              !sessionUser.openId.startsWith("closed:") &&
              Number(session.authVersion ?? 0) === Number(sessionUser.authVersion ?? 0);
          }
        }
      }

      if (user) {
        // A stale or closed token is already invalid. If lookup or revocation fails,
        // do not clear the cookie; the customer's retry action needs the current token.
        if (shouldRevoke) await invalidateUserSessions(user.id);
        try {
          await closeTransactionConsoleSession(ctx.req, ctx.res, user.id);
        } catch (error) {
          // Auxiliary console cleanup must not undo successful revocation.
          console.error(
            "[Auth] Transaction-console cleanup failed after logout",
            error instanceof Error ? error.name : "UnknownError",
          );
        }
      }

      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  customer: router({
    tradingEligibility: protectedProcedure.query(({ ctx }) => {
      if (ctx.user.role !== "user") throw new TRPCError({ code: "FORBIDDEN", message: "Trading eligibility is available to customer accounts." });
      return getCustomerTradingEligibility(ctx.user.id);
    }),
    companySpotlightPreview: protectedProcedure.query(({ ctx }) => {
      if (ctx.user.role !== "user") throw new TRPCError({ code: "FORBIDDEN", message: "Company spotlight preview is available to customer accounts." });
      return previewNextCustomerCompanySpotlight(ctx.user.id);
    }),
    communicationOptions: protectedProcedure.query(({ ctx }) => getCustomerCommunicationOptions(ctx.user.name, ctx.user.email)),
    changePassword: protectedProcedure.input(z.object({
      currentPassword: z.string().min(1).max(200),
      newPassword: z.string().min(12).max(200),
    })).mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "user") throw new TRPCError({ code: "FORBIDDEN", message: "Password changes are available to customer accounts." });
      if (!ctx.user.passwordHash || !verifyPassword(input.currentPassword, ctx.user.passwordHash)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Your current password is incorrect." });
      }
      if (input.newPassword === input.currentPassword) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Your new password must be different from your current password." });
      }
      const { authVersion } = await changeCustomerPassword(ctx.user.id, passwordHash(input.newPassword));
      // Keep the device that performed the change signed in; every other session is now invalid.
      const currentDevice = getLocalSessionFromRequest(ctx.req)?.deviceKey;
      ctx.res.cookie(COOKIE_NAME, createLocalSession(ctx.user.id, authVersion, currentDevice), { ...getSessionCookieOptions(ctx.req), maxAge: 30 * 24 * 60 * 60 * 1000 });
      return { success: true as const };
    }),
    authenticatorStatus: protectedProcedure.query(({ ctx }) => getCustomerAuthenticatorStatus(ctx.user.id)),
    startAuthenticatorEnrollment: protectedProcedure.mutation(({ ctx }) => startCustomerAuthenticatorEnrollment(ctx.user.id)),
    confirmAuthenticatorEnrollment: protectedProcedure.input(z.object({ code: z.string().regex(/^\d{6}$/) })).mutation(({ ctx, input }) => confirmCustomerAuthenticatorEnrollment(ctx.user.id, input.code)),
    generateAuthenticatorRecoveryCodes: protectedProcedure.input(z.object({ currentCode: z.string().regex(/^\d{6}$/) })).mutation(({ ctx, input }) => generateCustomerAuthenticatorRecoveryCodes(ctx.user.id, input.currentCode)),
    startAuthenticatorRecovery: protectedProcedure.input(z.object({ recoveryCode: z.string().trim().min(16).max(40) })).mutation(({ ctx, input }) => startCustomerAuthenticatorRecoveryReplacement(ctx.user.id, input.recoveryCode)),
    startAuthenticatorReplacement: protectedProcedure.input(z.object({ currentCode: z.string().regex(/^\d{6}$/) })).mutation(({ ctx, input }) => startCustomerAuthenticatorReplacement(ctx.user.id, input.currentCode)),
    confirmAuthenticatorReplacement: protectedProcedure.input(z.object({ code: z.string().regex(/^\d{6}$/) })).mutation(({ ctx, input }) => confirmCustomerAuthenticatorReplacement(ctx.user.id, input.code)),
    kycCenter: protectedProcedure.query(({ ctx }) => getCenter(ctx.user.id)),
    kycStartStage: protectedProcedure.input(z.object({ stage: z.enum(["EMAIL", "PHONE", "ADDRESS", "IDENTITY_DOCUMENT", "FACE_LIVENESS"]), idempotencyKey: z.string().min(8).max(160), deviceMetadata: z.record(z.string(), z.unknown()).optional() })).mutation(async ({ ctx, input }) => { try { return await startStage(ctx.user.id, input.stage, input.idempotencyKey, input.deviceMetadata); } catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "This KYC stage is not available yet." }); } }),
    kycIssueEmail: protectedProcedure.mutation(({ ctx }) => issueEmail(ctx.user.id)),
    kycVerifyEmail: protectedProcedure.input(z.object({ token: z.string().min(8).max(128) })).mutation(({ ctx, input }) => verifyEmail(ctx.user.id, input.token)),
    kycIssuePhone: protectedProcedure.input(z.object({ phone: z.string().min(7).max(40) })).mutation(({ ctx, input }) => issuePhone(ctx.user.id, input.phone)),
    kycVerifyPhone: protectedProcedure.input(z.object({ otp: z.string().regex(/^\d{6}$/) })).mutation(({ ctx, input }) => verifyPhone(ctx.user.id, input.otp)),
    kycSubmitAddress: protectedProcedure.input(z.object({ countryCode: z.string().min(2).max(8), stateProvince: z.string().max(120).optional(), city: z.string().min(1).max(120), district: z.string().max(120).optional(), addressLine: z.string().min(3).max(255), postalCode: z.string().max(40).optional(), method: z.enum(["DECLARATION", "PROOF_DOCUMENT", "ADMIN", "PROVIDER"]).optional() })).mutation(({ ctx, input }) => submitAddress(ctx.user.id, input)),
    kycConsent: protectedProcedure.input(z.object({ purpose: z.string().min(3).max(120), version: z.string().min(1).max(40) })).mutation(({ ctx, input }) => recordConsent(ctx.user.id, input.purpose, input.version, ctx.req.ip)),
    kycSubmitDocument: protectedProcedure.input(z.object({ documentType: z.string().min(2).max(80), countryCode: z.string().min(2).max(8), frontStorageKey: z.string().min(1).max(512), backStorageKey: z.string().max(512).optional(), documentNumber: z.string().max(120).optional(), fields: z.record(z.string(), z.unknown()).optional() })).mutation(({ ctx, input }) => submitDocument(ctx.user.id, input)),
    kycRecordFace: protectedProcedure.input(z.object({ sessionId: z.string().min(16).max(64), challenge: z.record(z.string(), z.unknown()).optional(), demo: z.boolean().optional(), demoOutcome: z.enum(["pass", "fail", "review"]).optional() })).mutation(({ ctx, input }) => recordFaceVerification(ctx.user.id, input)),
    session: protectedProcedure.input(z.object({ deviceLabel: z.string().max(160), countryCode: z.string().max(8).optional() })).mutation(async ({ ctx, input }) => {
      // Express resolves the client IP using the explicitly configured trusted-proxy topology.
      // Never trust a caller-supplied X-Forwarded-For value directly in audit records.
      const ipAddress = ctx.req.ip || ctx.req.socket.remoteAddress;
      const deviceLabel = input.deviceLabel || "Authenticated browser";
      await upsertCustomerSession(ctx.user.id, { deviceLabel, ipAddress, countryCode: input.countryCode, userAgent: ctx.req.headers["user-agent"] });
      return listCustomerSessions(ctx.user.id);
    }),
    sessions: protectedProcedure.query(({ ctx }) => listCustomerSessions(ctx.user.id)),
    revokeSession: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const sessions = await listCustomerSessions(ctx.user.id);
      const target = sessions.find((session: any) => Number(session.id) === input.id);
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
      await revokeCustomerSession(ctx.user.id, input.id);
      // The security action is authoritative; notification delivery is best-effort.
      // The last-seen cursor distinguishes a later revocation after this session is reused.
      const sessionCursor = target.lastSeenAt instanceof Date
        ? target.lastSeenAt.getTime()
        : String(target.lastSeenAt || "unknown");
      try {
        await createNotification(ctx.user.id, "Security: session revoked",
          "A device session was revoked from your account security settings.", {
            eventKey: `security-session-revoked:${input.id}:${sessionCursor}`,
            category: "security",
            priority: "high",
            href: "/customer",
          });
      } catch (error) {
        console.error("[Notifications] Session revocation notice failed after security change:", error instanceof Error ? error.name : "UnknownError");
      }
      return { success: true };
    }),
    trustedDevices: protectedProcedure.query(({ ctx }) => listTrustedDevices(ctx.user.id, getLocalSessionFromRequest(ctx.req)?.deviceKey)),
    renameTrustedDevice: protectedProcedure.input(z.object({ id: z.number().int().positive(), deviceName: z.string().trim().min(1).max(120) })).mutation(async ({ ctx, input }) => {
      await renameDevice(ctx.user.id, input.id, input.deviceName, "customer").then(
        () => undefined,
        (error) => { throw new TRPCError({ code: "NOT_FOUND", message: error instanceof Error ? error.message : "Device not found" }); },
      );
      return { success: true as const };
    }),
    blockTrustedDevice: protectedProcedure.input(z.object({ id: z.number().int().positive(), reason: z.string().trim().min(3).max(255) })).mutation(async ({ ctx, input }) => {
      const target = await blockDevice(ctx.user.id, input.id, {
        reason: input.reason,
        actorRole: "customer",
        actorId: ctx.user.id,
        ipAddress: ctx.req.ip || ctx.req.socket.remoteAddress,
        userAgent: ctx.req.headers["user-agent"],
      }).then(
        (value) => value,
        (error) => { throw new TRPCError({ code: "NOT_FOUND", message: error instanceof Error ? error.message : "Device not found" }); },
      );
      // The security action is authoritative; the notification is best-effort.
      try {
        await createNotification(ctx.user.id, "Security: device blocked",
          `${target.deviceName} was blocked and signed out. It can no longer access the portal until an administrator restores it.`, {
            eventKey: `device-blocked:${input.id}:${Date.now()}`,
            category: "security",
            priority: "high",
            href: "/customer",
          });
      } catch (error) {
        console.error("[Notifications] Device block notice failed after security change:", error instanceof Error ? error.name : "UnknownError");
      }
      return { success: true as const };
    }),
    deviceAccessEvents: protectedProcedure.query(({ ctx }) => listDeviceEvents(ctx.user.id, 40)),
    requestDeviceUnblock: protectedProcedure.input(z.object({ deviceId: z.number().int().positive(), reason: z.string().trim().min(10).max(1000) })).mutation(async ({ ctx, input }) => {
      const { devices } = await listTrustedDevices(ctx.user.id);
      const device = devices.find((item) => Number(item.id) === input.deviceId);
      if (!device) throw new TRPCError({ code: "NOT_FOUND", message: "Device not found" });
      return createTicket(ctx.user.id, {
        subject: `Restore access for blocked device: ${device.deviceName}`.slice(0, 200),
        body: [
          "An administrator is requested to review and restore a blocked device.",
          "",
          `Device name: ${device.deviceName}`,
          `Device ID: ${device.deviceIdShort}`,
          `Type: ${device.deviceType} · ${device.platform} · ${device.browser}`,
          `Last seen IP: ${device.lastIpAddress ?? "unknown"}`,
          `Blocked reason on file: ${device.blockedReason ?? "reported by the customer as unrecognised"}`,
          "",
          "Customer explanation:",
          input.reason,
        ].join("\n"),
        priority: "high",
        category: "security",
      });
    }),
    requestRiskReport: protectedProcedure.input(z.object({ title: z.string().min(3).max(200), requestedFor: z.string().max(200).optional() })).mutation(({ ctx, input }) => createRiskReport(ctx.user.id, input.title, input.requestedFor)),
    riskReports: protectedProcedure.query(({ ctx }) => listRiskReports(ctx.user.id)),
    requestAccountClosure: protectedProcedure.input(z.object({
      reasons: z.array(z.enum(["not-using", "experience", "fees", "privacy", "support"]))
        .min(3, "Select at least three closure reasons.")
        .max(5)
        .refine(reasons => new Set(reasons).size === reasons.length, "Each closure reason can only be selected once."),
      acknowledged: z.literal(true),
    })).mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "user") throw new TRPCError({ code: "FORBIDDEN", message: "Only customer accounts can request closure." });
      return createAccountClosureTicket(ctx.user.id, input.reasons);
    }),
    createTicket: protectedProcedure.input(z.object({ subject: z.string().min(3).max(200), body: z.string().min(1).max(20000), category: z.enum(["account","wallet","opportunity","security","technical"]).default("account"), priority: z.enum(["low", "normal", "high", "urgent"]) })).mutation(async ({ ctx, input }) => {
      if (/^\s*account closure request\b/i.test(input.subject)) throw new TRPCError({ code: "BAD_REQUEST", message: "Use the dedicated account-closure request form." });
      const created=await createTicket(ctx.user.id,input); return created;
    }),
    tickets: protectedProcedure.query(({ ctx }) => listCustomerTickets(ctx.user.id)),
    ticketMessages: protectedProcedure.input(z.object({ ticketId: z.number().int().positive() })).query(async ({ ctx, input }) => { if (!(await getCustomerTicket(ctx.user.id,input.ticketId))) throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found" }); return listTicketMessages(input.ticketId); }),
    ticketAttachments: protectedProcedure.input(z.object({ ticketId: z.number().int().positive() })).query(async ({ ctx, input }) => { if (!(await getCustomerTicket(ctx.user.id,input.ticketId))) throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found" }); return listTicketAttachments(input.ticketId); }),
    replyTicket: protectedProcedure.input(z.object({ ticketId: z.number().int().positive(), body: z.string().trim().min(1).max(20000) })).mutation(async ({ ctx, input }) => { if (!(await getCustomerTicket(ctx.user.id,input.ticketId))) throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found" }); await addTicketMessage(ctx.user.id,input.ticketId,input.body); return { success:true }; }),
    reopenTicket: protectedProcedure.input(z.object({ ticketId: z.number().int().positive() })).mutation(({ ctx, input }) => reopenSupportTicket(ctx.user.id,input.ticketId)),
    addAttachment: protectedProcedure.input(z.object({ ticketId: z.number().int().positive(), fileName: z.string().max(255), mimeType: z.string().max(160), sizeBytes: z.number().int().positive().max(25_000_000), storageKey: z.string().max(512) })).mutation(({ ctx, input }) => { if (!isValidSupportAttachmentStorageKey(input.storageKey)) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid support attachment storage key" }); return addTicketAttachment(ctx.user.id, input); }),
    uploadPolicy: protectedProcedure.query(() => getTicketUploadPolicy()),
    balances: protectedProcedure.query(({ ctx }) => getCustomerBalanceSummary(ctx.user.id)),
    walletLedger: protectedProcedure.query(({ ctx }) => {
      if (ctx.user.role !== "user") throw new TRPCError({ code: "FORBIDDEN", message: "Wallet ledger history is available only to customer accounts." });
      return listCustomerWalletLedger(ctx.user.id);
    }),
    payoutEligibility: protectedProcedure.query(({ ctx }) => getCustomerPayoutEligibility(ctx.user.id)),
    payoutRequests: protectedProcedure.input(z.object({ cursor: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/).optional(), pageSize: z.number().int().min(1).max(100).optional() }).strict().optional()).query(({ ctx, input }) => listCustomerPayoutRequests(ctx.user.id, input ?? {})),
    withdrawalPinStatus: protectedProcedure.query(({ ctx }) => getCustomerWithdrawalPinStatus(ctx.user.id)),
    revealWithdrawalPin: protectedProcedure.query(({ ctx }) => getCustomerWithdrawalPin(ctx.user.id)),
    setWithdrawalPin: protectedProcedure.input(z.object({ pin: z.string().regex(/^\d{6}$/) })).mutation(({ ctx, input }) => setCustomerWithdrawalPin(ctx.user.id, input.pin)),
    requestPayout: protectedProcedure.input(z.object({
      currency: z.enum(["USD", "EUR", "GBP", "BTC", "ETH", "USDT"]),
      amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      destinationType: z.enum(["bank_transfer", "crypto_transfer"]),
      destinationDetails: z.string().trim().min(8).max(1000),
      idempotencyKey: z.string().trim().min(8).max(160),
      pin: z.string().regex(/^\d{6}$/),
      totpCode: z.string().regex(/^\d{6}$/).optional(),
    })).mutation(({ ctx, input }) => createCustomerPayoutRequest(ctx.user.id, input)),
    cancelPayoutRequest: protectedProcedure.input(z.object({ requestId: z.number().int().positive() }))
      .mutation(({ ctx, input }) => cancelCustomerPayoutRequest(ctx.user.id, input.requestId)),
    walletPreferences: protectedProcedure.query(({ ctx }) => getCustomerWalletPreferences(ctx.user.id)),
    updateWalletPreferences: protectedProcedure.input(z.object({ tradingCurrency: z.string().min(2).max(32).optional(), swapCurrency: z.string().min(2).max(32).optional(), autoTopUpEnabled: z.boolean().optional(), withdrawalWhitelistEnabled: z.boolean().optional() })).mutation(({ ctx, input }) => updateCustomerWalletPreferences(ctx.user.id, input)),
    personalDetails: protectedProcedure.query(({ ctx }) => getCustomerPersonalDetails(ctx.user.id)),
    updatePersonalDetails: protectedProcedure.input(z.object({ firstName: z.string().trim().max(80).optional(), lastName: z.string().trim().max(80).optional(), gender: z.enum(["Male", "Female", "Other", "Prefer not to say"]).optional(), country: z.string().trim().max(80).optional(), state: z.string().trim().max(120).optional(), address: z.string().trim().max(255).optional(), telephone: z.string().trim().max(40).optional() })).mutation(({ ctx, input }) => updateCustomerPersonalDetails(ctx.user.id, input)),
    soundSettings: protectedProcedure.query(async () => { const raw = await getAppSetting("sound.settings"); try { return JSON.parse(raw || "{}"); } catch { return {}; } }),
    transactionConsole: protectedProcedure.query(({ ctx }) => listTransactionConsoleEvents(ctx.user.id, ctx.req)),
    transactionConsolePulse: protectedProcedure.mutation(({ ctx }) => recordTransactionConsolePulse(ctx.user.id, ctx.req)),
    popupLifecycle: protectedProcedure.input(z.object({ eventId: z.number().int().positive(), action: z.enum(["noticed","opened","dismissed"]) }).strict()).mutation(({ ctx, input }) => updatePopupLifecycle(ctx.user.id, input.eventId, input.action)),
    popupDeliveryStatus: protectedProcedure.input(z.object({ eventId: z.number().int().positive(), status: z.enum(["received","rendered"]), leaseToken: z.string().uuid() }).strict()).mutation(({ ctx, input }) => updatePopupDeliveryStatus(ctx.user.id, input.eventId, input.status, input.leaseToken)),
    opportunities: protectedProcedure.query(async ({ ctx }) => { const result=await listCustomerOpportunities(ctx.user.id,{customerSessionExecution:true,allowAutomaticExecution:true,consumeDelivery:true}); for (const trade of result.autoTrades||[]) { await recordTransactionConsoleEvent(ctx.user.id,ctx.req,{eventType:"DEBIT",status:"COMPLETED",title:"Automatic wallet debit posted",message:`${trade.symbol} available balance was debited for an automatic allocation under the saved controls.`,transactionCode:`auto-debit:${trade.tradeId}`,amountMinor:-trade.amountMinor,asset:trade.currency}); await recordTransactionConsoleEvent(ctx.user.id,ctx.req,{eventType:"INVESTMENT",status:"COMPLETED",title:"Automatic investment confirmed",message:`${trade.symbol} was allocated automatically from the available wallet balance under the saved customer and administrator controls.`,transactionCode:`auto-investment:${trade.tradeId}`,amountMinor:trade.amountMinor,asset:trade.currency}); const allocationNoticeResults=await Promise.allSettled([createNotification(ctx.user.id,"Automatic trading allocation confirmed",`${trade.symbol} was allocated from your available ${trade.currency} balance.`,{eventKey:`auto-trade-allocation:${trade.tradeId}`,category:"trading",priority:"normal"}),createNotification(ctx.user.id,"Balance debited",`Capital locked into trade: ${trade.amountMinor} minor units of ${trade.currency} were deducted from available balance.`,{eventKey:`auto-trade-debit:${trade.tradeId}`,category:"ledger_debit",priority:"normal"})]); if(allocationNoticeResults.some(outcome=>outcome.status==="rejected")) console.error("[Notifications] Automatic allocation notices failed after ledger commit."); } for (const settlement of result.settled||[]) { await recordTransactionConsoleEvent(ctx.user.id,ctx.req,{eventType:"CREDIT",status:"COMPLETED",title:"Trade earnings credited",message:`Trade ${settlement.tradeId} matured and ${settlement.rewardMinor} minor units of earnings were credited to the ${settlement.currency} wallet.`,transactionCode:`trade-reward:${settlement.tradeId}`,amountMinor:settlement.rewardMinor,asset:settlement.currency}); await recordTransactionConsoleEvent(ctx.user.id,ctx.req,{eventType:"TRADE_SETTLEMENT",status:"COMPLETED",title:"Trade principal released",message:`Trade ${settlement.tradeId} completed its duration and released principal plus earnings through the wallet ledger.`,transactionCode:`trade-settlement:${settlement.tradeId}`,amountMinor:settlement.totalMinor,asset:settlement.currency}); const settlementNoticeResults=await Promise.allSettled([createNotification(ctx.user.id,"Trading reward confirmed",`Trade ${settlement.tradeId} completed and the recorded reward was credited to your ${settlement.currency} wallet.`,{eventKey:`trade-reward:${settlement.tradeId}`,category:"trading_reward",priority:"high"}),createNotification(ctx.user.id,"Balance credited",`Trade ${settlement.tradeId} settlement was recorded for ${settlement.currency}.`,{eventKey:`trade-settlement-credit:${settlement.tradeId}`,category:"ledger_credit",priority:"normal"})]); if(settlementNoticeResults.some(outcome=>outcome.status==="rejected")) console.error("[Notifications] Automatic settlement notices failed after ledger commit."); } for (const missed of result.missed||[]) await recordTransactionConsoleEvent(ctx.user.id,ctx.req,{eventType:"MISSED_OPPORTUNITY",status:"MISSED",title:`Missed opportunity · ${missed.symbol}`,message:`The opportunity was recorded because the required wallet balance was unavailable. Estimated reward only; no ledger debit occurred.`,transactionCode:`missed-opportunity:${missed.id}`,amountMinor:missed.potentialRewardMinor,asset:missed.currency}); const safeObject=(value:any)=>{if(!value||typeof value!=="object")return value;const safe:any=stripCustomerFeedInternalObjects(value);delete safe.packageName;delete safe.packageId;delete safe.packageSubscriptionId;delete safe.activationKey;delete safe.packageTermsVersion;delete safe.termsSnapshotJson;delete safe.qualifyingBalanceUsdMinor;delete safe.packageMinimumTradeMinor;delete safe.packageMaximumTradeMinor;delete safe.packageQuota;return safe;}; return {...result,offers:result.offers.map(safeObject),missed:result.missed.map(safeObject),autoTrades:result.autoTrades.map(safeObject),settled:result.settled.map(safeObject),delivery:safeObject(result.delivery)}; }),
    trades: protectedProcedure.query(async ({ ctx }) => (await listTrades(ctx.user.id)).map((value:any) => { const safe:any=stripCustomerFeedInternalObjects(value); delete safe.packageName; delete safe.packageId; delete safe.packageSubscriptionId; delete safe.activationKey; delete safe.packageTermsVersion; delete safe.termsSnapshotJson; delete safe.qualifyingBalanceUsdMinor; delete safe.packageMinimumTradeMinor; delete safe.packageMaximumTradeMinor; delete safe.packageQuota; return safe; })),
    settle: protectedProcedure.input(z.object({ tradeId: z.number().int().positive() })).mutation(async () => { throw new TRPCError({ code: "FORBIDDEN", message: "Settlement is performed manually by an administrator after the external payment is confirmed." }); }),
    notifications: protectedProcedure.query(({ ctx }) => listCustomerNotifications(ctx.user.id)),
    notificationHistory: protectedProcedure.input(z.object({ cursor: z.string().max(100).optional(), limit: z.number().int().min(1).max(100).optional() }).optional()).query(({ ctx, input }) => listCustomerNotificationPage(ctx.user.id, input?.cursor, input?.limit)),
    notificationUnreadCount: protectedProcedure.query(({ ctx }) => getCustomerNotificationUnreadCount(ctx.user.id)),
    notificationCategoryVisibility: protectedProcedure.query(() => getNotificationCategoryVisibility()),
    notificationEventCursor: protectedProcedure.query(({ ctx }) => listNotificationEventCursor(ctx.user.id)),
    markNotificationsRead: protectedProcedure.input(z.object({ id: z.number().int().positive().optional() }).optional()).mutation(({ ctx, input }) => markCustomerNotificationsRead(ctx.user.id, input?.id)),
    emailPreferences: protectedProcedure.query(({ ctx }) => getCustomerEmailPreferences(ctx.user.id)),
    updateEmailPreferences: protectedProcedure.input(z.object({ dailyTradingReports: z.boolean().optional(), systemAlerts: z.boolean().optional(), transactionAlerts: z.boolean().optional(), adminMessages: z.boolean().optional() })).mutation(({ ctx, input }) => updateCustomerEmailPreferences(ctx.user.id, input)),
    emailStatus: protectedProcedure.query(async ({ ctx }) => ({ emailVerified: (await ensureCustomerControls(ctx.user.id)).emailVerified })),
    stakeEarn: router({
      dashboard: protectedProcedure.query(async ({ ctx }) => { const result=await getStakeDashboard(ctx.user.id); for (const event of result.events.filter((item:any)=>["reward.posted","position.completed"].includes(item.eventType))) await recordTransactionConsoleEvent(ctx.user.id,ctx.req,{eventType:event.eventType === "reward.posted" ? "REWARD_POSTED" : "POSITION_SETTLED",status:"COMPLETED",title:event.eventType === "reward.posted" ? "Reward posting completed" : "Position settlement completed",message:`${event.eventType} was committed to the authoritative ledger.`,transactionCode:`stake-event:${event.id}`,amountMinor:event.amountMinor,asset:event.asset,metadata:{positionId:event.positionId}}); return result; }),
      allocate: protectedProcedure.input(z.object({ productId: z.number().int().positive(), amountMinor: z.number().int().positive(), idempotencyKey: z.string().min(8).max(160) })).mutation(async ({ ctx, input }) => { const result=await allocateStake(ctx.user.id,input); await recordTransactionConsoleEvent(ctx.user.id,ctx.req,{eventType:"DEBIT",status:"COMPLETED",title:"Wallet debit posted",message:`${result.asset} available balance was debited and locked for the Stake & Earn position.`,transactionCode:`debit:${result.positionCode}`,amountMinor:-result.principalMinor,asset:result.asset,metadata:{positionId:result.positionId}}); await recordTransactionConsoleEvent(ctx.user.id,ctx.req,{eventType:"INVESTMENT",status:"COMPLETED",title:"Stake investment confirmed",message:`${result.asset} principal was reserved through the wallet ledger and the position is active.`,transactionCode:`investment:${result.positionCode}`,amountMinor:result.principalMinor,asset:result.asset,metadata:{positionId:result.positionId}}); return result; }),
      cancel: protectedProcedure.input(z.object({ positionId: z.number().int().positive(), idempotencyKey: z.string().min(8).max(160) })).mutation(async ({ ctx, input }) => { const result=await cancelStake(ctx.user.id, input.positionId, input.idempotencyKey); await recordTransactionConsoleEvent(ctx.user.id,ctx.req,{eventType:"CREDIT",status:"COMPLETED",title:"Wallet credit posted",message:`Position ${input.positionId} was cancelled and principal was released back to the available wallet balance.`,transactionCode:`credit:stake:${input.positionId}`,asset:"USD",metadata:{positionId:input.positionId}}); return result; }),
      project: protectedProcedure.input(z.object({ amountMinor: z.number().int().positive(), annualRateBps: z.number().int().min(0).max(100000), durationDays: z.number().int().positive(), compounding: z.boolean().optional() })).query(({ input }) => projectStake(input)),
    }),
    treasuryBonds: router({
      market: protectedProcedure.query(({ ctx }) => getTreasuryBondDashboard(ctx.user.id)),
      fundingQuote: protectedProcedure.input(z.object({
        amountMinor: z.number().int().min(0).max(100_000_000),
        fundingSource: z.string().trim().min(2).max(24).optional(),
      })).query(({ ctx, input }) => quoteTreasuryBondPurchase(ctx.user.id, input)),
      purchase: protectedProcedure.input(z.object({
        instrumentId: z.string().min(2).max(80),
        amountMinor: z.number().int().positive().max(100_000_000),
        fundingSource: z.string().trim().min(2).max(24).optional(),
        idempotencyKey: z.string().min(8).max(160),
      })).mutation(async ({ ctx, input }) => {
        const result = await purchaseTreasuryBond(ctx.user.id, input);
        await recordTransactionConsoleEvent(ctx.user.id, ctx.req, {
          eventType: "INVESTMENT",
          status: "COMPLETED",
          title: "Treasury bond purchased",
          message: `${result.instrumentName} was purchased and ${result.principalMinor} minor units of ${result.currency} principal were reserved through the wallet ledger (funding source: ${result.fundingSource}).`,
          transactionCode: `treasury-bond:${result.positionCode}`,
          amountMinor: result.principalMinor,
          asset: result.currency,
          metadata: { positionCode: result.positionCode, instrumentId: result.instrumentId, fundingSource: result.fundingSource },
        });
        return result;
      }),
      project: protectedProcedure.input(z.object({
        amountMinor: z.number().int().positive().max(100_000_000),
        ratePct: z.number().min(0).max(100),
        years: z.number().positive().max(60),
      })).query(({ input }) => ({
        projectedProfitMinor: projectTreasuryBondProfit(input.amountMinor, input.ratePct, input.years),
        projectedEndingMinor: input.amountMinor + projectTreasuryBondProfit(input.amountMinor, input.ratePct, input.years),
      })),
    }),
    cooperateDept: router({
      market: protectedProcedure.query(({ ctx }) => getCooperateDeptDashboard(ctx.user.id)),
      fundingQuote: protectedProcedure.input(z.object({
        amountMinor: z.number().int().min(0).max(100_000_000),
        fundingSource: z.string().trim().min(2).max(24).optional(),
      })).query(({ ctx, input }) => quoteCooperateDeptPurchase(ctx.user.id, input)),
      purchase: protectedProcedure.input(z.object({
        companyId: z.string().min(2).max(80),
        amountMinor: z.number().int().positive().max(100_000_000),
        ownershipBasis: z.enum(["SHARES", "FULL_OWNERSHIP", "ASSET_PURCHASE"]),
        fundingSource: z.string().trim().min(2).max(24).optional(),
        idempotencyKey: z.string().min(8).max(160),
      })).mutation(async ({ ctx, input }) => {
        const result = await purchaseCooperateDeptCompany(ctx.user.id, input);
        await recordTransactionConsoleEvent(ctx.user.id, ctx.req, {
          eventType: "INVESTMENT",
          status: "COMPLETED",
          title: "Cooperate Dept purchase recorded",
          message: `${result.companyName} received a ${result.ownershipBasis} purchase of ${result.amountMinor} minor units of ${result.currency}, funded from ${result.fundingSource === "COMBINED" ? "combined wallets" : result.fundingSource} through the wallet ledger.`,
          transactionCode: `cooperate-dept:${result.positionCode}`,
          amountMinor: result.amountMinor,
          asset: result.currency,
          metadata: { positionCode: result.positionCode, companyId: result.companyId, fundingSource: result.fundingSource },
        });
        return result;
      }),
    }),
    litigationFunds: router({
      market: protectedProcedure.query(({ ctx }) => getLitigationFundsDashboard(ctx.user.id)),
      fundingQuote: protectedProcedure.input(z.object({
        amountMinor: z.number().int().min(0).max(100_000_000),
        fundingSource: z.string().trim().min(2).max(24).optional(),
      })).query(({ ctx, input }) => quoteLitigationFundPurchase(ctx.user.id, input)),
      purchase: protectedProcedure.input(z.object({
        instrumentType: z.enum(["CASE", "BUNDLE"]),
        instrumentId: z.string().min(2).max(80),
        amountMinor: z.number().int().positive().max(100_000_000),
        fundingSource: z.string().trim().min(2).max(24).optional(),
        idempotencyKey: z.string().min(8).max(160),
      })).mutation(async ({ ctx, input }) => {
        const result = await purchaseLitigationFund(ctx.user.id, input);
        await recordTransactionConsoleEvent(ctx.user.id, ctx.req, {
          eventType: "INVESTMENT",
          status: "COMPLETED",
          title: "Litigation Funds commitment recorded",
          message: `${result.instrumentName} received a ${result.instrumentType === "CASE" ? "case-share" : "bundle"} commitment of ${result.amountMinor} minor units of ${result.currency}, funded from ${result.fundingSource === "COMBINED" ? "combined wallets" : result.fundingSource} through the wallet ledger.`,
          transactionCode: `litigation-funds:${result.positionCode}`,
          amountMinor: result.amountMinor,
          asset: result.currency,
          metadata: { positionCode: result.positionCode, instrumentId: result.instrumentId, instrumentType: result.instrumentType, fundingSource: result.fundingSource },
        });
        return result;
      }),
    }),
    ipRoyalties: router({
      market: protectedProcedure.query(({ ctx }) => getIpRoyaltiesDashboard(ctx.user.id)),
      fundingQuote: protectedProcedure.input(z.object({
        amountMinor: z.number().int().min(0).max(100_000_000),
        fundingSource: z.string().trim().min(2).max(24).optional(),
      })).query(({ ctx, input }) => quoteIpRoyaltyPurchase(ctx.user.id, input)),
      purchase: protectedProcedure.input(z.object({
        instrumentType: z.enum(["RIGHT", "PORTFOLIO"]),
        instrumentId: z.string().min(2).max(80),
        amountMinor: z.number().int().positive().max(100_000_000),
        fundingSource: z.string().trim().min(2).max(24).optional(),
        idempotencyKey: z.string().min(8).max(160),
      })).mutation(async ({ ctx, input }) => {
        const result = await purchaseIpRoyalty(ctx.user.id, input);
        await recordTransactionConsoleEvent(ctx.user.id, ctx.req, {
          eventType: "INVESTMENT",
          status: "COMPLETED",
          title: "IP Royalties commitment recorded",
          message: `${result.instrumentName} received a ${result.instrumentType === "RIGHT" ? "right-share" : "portfolio"} commitment of ${result.amountMinor} minor units of ${result.currency}, funded from ${result.fundingSource === "COMBINED" ? "combined wallets" : result.fundingSource} through the wallet ledger.`,
          transactionCode: `ip-royalties:${result.positionCode}`,
          amountMinor: result.amountMinor,
          asset: result.currency,
          metadata: { positionCode: result.positionCode, instrumentId: result.instrumentId, instrumentType: result.instrumentType, fundingSource: result.fundingSource },
        });
        return result;
      }),
    }),
    musicRoyalties: router({
      market: protectedProcedure.query(({ ctx }) => getMusicRoyaltiesDashboard(ctx.user.id)),
      fundingQuote: protectedProcedure.input(z.object({
        amountMinor: z.number().int().min(0).max(100_000_000),
        fundingSource: z.string().trim().min(2).max(24).optional(),
      })).query(({ ctx, input }) => quoteMusicPurchase(ctx.user.id, input)),
      purchase: protectedProcedure.input(z.object({
        instrumentId: z.string().min(2).max(80),
        amountMinor: z.number().int().positive().max(100_000_000),
        fundingSource: z.string().trim().min(2).max(24).optional(),
        idempotencyKey: z.string().min(8).max(160),
      })).mutation(async ({ ctx, input }) => {
        const result = await purchaseMusicOpportunity(ctx.user.id, input);
        await recordTransactionConsoleEvent(ctx.user.id, ctx.req, {
          eventType: "INVESTMENT",
          status: "COMPLETED",
          title: "Music Royalties investment recorded",
          message: `${result.instrumentName} received a music opportunity commitment of ${result.amountMinor} minor units of ${result.currency}, funded from ${result.fundingSource === "COMBINED" ? "combined wallets" : result.fundingSource} through the wallet ledger.`,
          transactionCode: `music-royalties:${result.positionCode}`,
          amountMinor: result.amountMinor,
          asset: result.currency,
          metadata: { positionCode: result.positionCode, instrumentId: result.instrumentId, musicType: result.musicType, fundingSource: result.fundingSource },
        });
        return result;
      }),
    }),
    agroInvestment: router({
      market: protectedProcedure.query(({ ctx }) => getAgroInvestmentDashboard(ctx.user.id)),
      fundingQuote: protectedProcedure.input(z.object({
        amountMinor: z.number().int().min(0).max(100_000_000),
        fundingSource: z.string().trim().min(2).max(24).optional(),
      })).query(({ ctx, input }) => quoteAgroPurchase(ctx.user.id, input)),
      purchase: protectedProcedure.input(z.object({
        instrumentId: z.string().min(2).max(80),
        amountMinor: z.number().int().positive().max(100_000_000),
        fundingSource: z.string().trim().min(2).max(24).optional(),
        idempotencyKey: z.string().min(8).max(160),
      })).mutation(async ({ ctx, input }) => {
        const result = await purchaseAgroOpportunity(ctx.user.id, input);
        await recordTransactionConsoleEvent(ctx.user.id, ctx.req, {
          eventType: "INVESTMENT",
          status: "COMPLETED",
          title: "Agro Investment recorded",
          message: `${result.instrumentName} received an agriculture opportunity commitment of ${result.amountMinor} minor units of ${result.currency}, funded from ${result.fundingSource === "COMBINED" ? "combined wallets" : result.fundingSource} through the wallet ledger.`,
          transactionCode: `agro-investments:${result.positionCode}`,
          amountMinor: result.amountMinor,
          asset: result.currency,
          metadata: { positionCode: result.positionCode, instrumentId: result.instrumentId, agroType: result.agroType, fundingSource: result.fundingSource },
        });
        return result;
      }),
    }),
    carbonCredit: router({
      market: protectedProcedure.query(({ ctx }) => getCarbonInvestmentDashboard(ctx.user.id)),
      fundingQuote: protectedProcedure.input(z.object({
        amountMinor: z.number().int().min(0).max(100_000_000),
        fundingSource: z.string().trim().min(2).max(24).optional(),
      })).query(({ ctx, input }) => quoteCarbonPurchase(ctx.user.id, input)),
      purchase: protectedProcedure.input(z.object({
        instrumentId: z.string().min(2).max(80),
        amountMinor: z.number().int().positive().max(100_000_000),
        fundingSource: z.string().trim().min(2).max(24).optional(),
        idempotencyKey: z.string().min(8).max(160),
      })).mutation(async ({ ctx, input }) => {
        const result = await purchaseCarbonOpportunity(ctx.user.id, input);
        await recordTransactionConsoleEvent(ctx.user.id, ctx.req, {
          eventType: "INVESTMENT",
          status: "COMPLETED",
          title: "Carbon Credit recorded",
          message: `${result.instrumentName} received a carbon-credit commitment of ${result.amountMinor} minor units of ${result.currency}, funded from ${result.fundingSource === "COMBINED" ? "combined wallets" : result.fundingSource} through the wallet ledger.`,
          transactionCode: `carbon-credits:${result.positionCode}`,
          amountMinor: result.amountMinor,
          asset: result.currency,
          metadata: { positionCode: result.positionCode, instrumentId: result.instrumentId, creditType: result.creditType, fundingSource: result.fundingSource },
        });
        return result;
      }),
    }),
    greenEnergy: router({
      market: protectedProcedure.query(({ ctx }) => getGreenEnergyInvestmentDashboard(ctx.user.id)),
      fundingQuote: protectedProcedure.input(z.object({
        amountMinor: z.number().int().min(0).max(100_000_000),
        fundingSource: z.string().trim().min(2).max(24).optional(),
      })).query(({ ctx, input }) => quoteGreenEnergyPurchase(ctx.user.id, input)),
      purchase: protectedProcedure.input(z.object({
        instrumentId: z.string().min(2).max(80),
        amountMinor: z.number().int().positive().max(100_000_000),
        fundingSource: z.string().trim().min(2).max(24).optional(),
        idempotencyKey: z.string().min(8).max(160),
      })).mutation(async ({ ctx, input }) => {
        const result = await purchaseGreenEnergyOpportunity(ctx.user.id, input);
        await recordTransactionConsoleEvent(ctx.user.id, ctx.req, {
          eventType: "INVESTMENT",
          status: "COMPLETED",
          title: "Green Energy recorded",
          message: `${result.instrumentName} received a green-energy commitment of ${result.amountMinor} minor units of ${result.currency}, funded from ${result.fundingSource === "COMBINED" ? "combined wallets" : result.fundingSource} through the wallet ledger.`,
          transactionCode: `green-energy:${result.positionCode}`,
          amountMinor: result.amountMinor,
          asset: result.currency,
          metadata: { positionCode: result.positionCode, instrumentId: result.instrumentId, energyType: result.energyType, fundingSource: result.fundingSource },
        });
        return result;
      }),
    }),
    lending: router({
      desk: protectedProcedure.query(({ ctx }) => getLendingDesk(ctx.user.id)),
      loan: protectedProcedure.input(z.object({ loanId: z.string().trim().min(1).max(80) })).query(({ ctx, input }) => getLendingLoanView(ctx.user.id, input.loanId)),
      fundingQuote: protectedProcedure.input(z.object({
        loanId: z.string().trim().min(1).max(80),
        amountMinor: z.number().int().min(0).max(100_000_000),
        fundingSource: z.string().trim().min(2).max(24).optional(),
      })).query(({ ctx, input }) => quoteLendingFunding(ctx.user.id, input)),
      fund: protectedProcedure.input(z.object({
        loanId: z.string().trim().min(1).max(80),
        amountMinor: z.number().int().positive().max(100_000_000),
        fundingSource: z.string().trim().min(2).max(24).optional(),
        idempotencyKey: z.string().min(8).max(160),
      })).mutation(async ({ ctx, input }) => {
        const result = await fundLendingLoan(ctx.user.id, input);
        await recordTransactionConsoleEvent(ctx.user.id, ctx.req, {
          eventType: "INVESTMENT",
          status: "COMPLETED",
          title: "Lending position opened",
          message: `${result.loanTitle} received a lending commitment of ${result.amountMinor} minor units of ${result.currency}, funded from ${result.fundingSource === "COMBINED" ? "combined wallets" : result.fundingSource} through the wallet ledger.`,
          transactionCode: `lending:${result.positionCode}`,
          amountMinor: result.amountMinor,
          asset: result.currency,
          metadata: { positionCode: result.positionCode, loanId: result.loanId, expectedInterestBps: result.expectedInterestBps, fundingSource: result.fundingSource },
        });
        return result;
      }),
      placeBid: protectedProcedure.input(z.object({
        loanId: z.string().trim().min(1).max(80),
        bidInterestBps: z.number().int().positive().max(100_000),
        amountMinor: z.number().int().positive().max(100_000_000),
        tenureMonths: z.number().int().positive().max(600),
        idempotencyKey: z.string().min(8).max(160),
      })).mutation(async ({ ctx, input }) => {
        const result = await placeLendingBid(ctx.user.id, input);
        await recordTransactionConsoleEvent(ctx.user.id, ctx.req, {
          eventType: "BID",
          status: "PENDING",
          title: "Lending bid placed",
          message: `Your bid of ${result.bid.bidInterestBps} bps over ${result.bid.tenureMonths} months${result.isLeading ? " now leads the auction" : " was recorded"} with ${result.bidCount} live bid${result.bidCount === 1 ? "" : "s"}.`,
          amountMinor: result.bid.amountMinor,
          asset: "USD",
          metadata: { bidId: result.bid.id, loanId: input.loanId, isLeading: result.isLeading, topBidBps: result.topBidBps },
        });
        return result;
      }),
      raiseBid: protectedProcedure.input(z.object({
        bidId: z.string().trim().min(1).max(80),
        bidInterestBps: z.number().int().positive().max(100_000),
        idempotencyKey: z.string().min(8).max(160),
      })).mutation(({ ctx, input }) => raiseLendingBid(ctx.user.id, input)),
      withdrawBid: protectedProcedure.input(z.object({ bidId: z.string().trim().min(1).max(80) })).mutation(({ ctx, input }) => withdrawLendingBid(ctx.user.id, input.bidId)),
    }),
    mining: router({
      dashboard: protectedProcedure.query(({ ctx }) => mining.getCustomerMiningDashboard(ctx.user.id)),
      packages: protectedProcedure.query(({ ctx }) => mining.listCustomerMiningPackages(ctx.user.id)),
      boostStatus: protectedProcedure.query(({ ctx }) => mining.getCustomerMiningBoostStatus(ctx.user.id)),
      purchasePackage: protectedProcedure.input(z.object({ packageVersionId: z.number().int().positive(), idempotencyKey: z.string().min(8).max(160), paymentAsset: z.string().min(2).max(12).optional() })).mutation(({ ctx, input }) => mining.purchaseCustomerMiningPackage(ctx.user.id, input)),
      quotePurchase: protectedProcedure.input(z.object({ packageVersionId: z.number().int().positive(), paymentAsset: z.string().min(2).max(12).optional() })).mutation(({ ctx, input }) => mining.createCustomerMiningPurchaseQuote(ctx.user.id, input)),
      confirmPurchase: protectedProcedure.input(z.object({ quoteId: z.number().int().positive(), idempotencyKey: z.string().min(8).max(160), acceptedTerms: z.boolean() })).mutation(({ ctx, input }) => mining.confirmCustomerMiningPurchase(ctx.user.id, input)),
      activateBoost: protectedProcedure.input(z.object({ idempotencyKey: z.string().min(8).max(160) })).mutation(({ ctx, input }) => mining.activateCustomerMiningBoost(ctx.user.id, input)),
      updateConversionPreference: protectedProcedure.input(z.object({ enabled: z.boolean(), targetDenomination: z.string().min(2).max(12), minimumThreshold: z.string().min(1).max(64) })).mutation(({ ctx, input }) => mining.updateCustomerMiningConversionPreference(ctx.user.id, input)),
      quoteSwap: protectedProcedure.input(z.object({ tokenAmount: z.string().min(1).max(64), targetAsset: z.string().min(2).max(12) })).mutation(({ ctx, input }) => mining.createCustomerMiningSwapQuote(ctx.user.id, input)),
      confirmSwap: protectedProcedure.input(z.object({ quoteId: z.number().int().positive(), idempotencyKey: z.string().min(8).max(160) })).mutation(({ ctx, input }) => mining.confirmCustomerMiningSwap(ctx.user.id, input)),
      transactions: protectedProcedure.query(({ ctx }) => mining.listCustomerMiningTransactions(ctx.user.id)),
    }),
  }),

  adminOperations: router({
    workerHealth: adminProcedure.query(() => getWorkerHealthSummary()),
    deviceOversightSummary: adminProcedure.query(() => getDeviceOversightSummary()),
    blockedDevices: adminProcedure.query(() => listBlockedDevicesForAdmin()),
    devices: adminProcedure.input(z.object({ limit: z.number().int().min(1).max(500).optional() }).optional()).query(({ input }) => listDevicesForAdmin(input?.limit)),
    restoreDevice: adminProcedure.input(z.object({ id: z.number().int().positive(), note: z.string().trim().max(500).optional() })).mutation(({ ctx, input }) => adminRestoreDevice(ctx.user.id, input.id, input.note)),
    systemDiagnostics: adminProcedure.query(() => getSystemDiagnosticsReport()),
    requeueDeadQualificationJob: adminProcedure.input(z.object({
      jobId: z.number().int().positive(),
      reason: z.string().trim().min(8).max(500),
    })).mutation(({ ctx, input }) => requeueDeadQualificationJob({
      jobId: input.jobId,
      adminId: ctx.user.id,
      reason: input.reason,
    })),
    scheduledJobs: router({
      list: adminProcedure.input(z.object({ page: z.number().int().positive().optional(), pageSize: z.number().int().min(1).max(100).optional() }).optional()).query(({ ctx, input }) => {
        const token = parseCookieHeader(ctx.req.headers.cookie ?? "")[COOKIE_NAME] ?? "";
        return listHeartbeatJobs(token, input);
      }),
      create: adminProcedure.input(z.object({
        name: z.string().trim().min(1).max(160),
        cron: z.string().trim().min(1).max(120),
        path: z.string().trim().min(1).max(512),
        method: z.enum(["POST", "PUT"]).optional(),
        payload: z.unknown().optional(),
        description: z.string().max(1000).optional(),
      })).mutation(({ ctx, input }) => {
        const token = parseCookieHeader(ctx.req.headers.cookie ?? "")[COOKIE_NAME] ?? "";
        return createHeartbeatJob(input, token);
      }),
      update: adminProcedure.input(z.object({
        taskUid: z.string().trim().min(1).max(64),
        patch: z.object({
          cron: z.string().trim().min(1).max(120).optional(),
          path: z.string().trim().min(1).max(512).optional(),
          method: z.enum(["POST", "PUT"]).optional(),
          payload: z.unknown().optional(),
          description: z.string().max(1000).optional(),
          enable: z.boolean().optional(),
        }).refine((value) => Object.keys(value).length > 0, "At least one field to update is required"),
      })).mutation(({ ctx, input }) => {
        const token = parseCookieHeader(ctx.req.headers.cookie ?? "")[COOKIE_NAME] ?? "";
        return updateHeartbeatJob(input.taskUid, input.patch, token);
      }),
      delete: adminProcedure.input(z.object({ taskUid: z.string().trim().min(1).max(64) })).mutation(({ ctx, input }) => {
        const token = parseCookieHeader(ctx.req.headers.cookie ?? "")[COOKIE_NAME] ?? "";
        return deleteHeartbeatJob(input.taskUid, token).then(() => ({ success: true }));
      }),
    }),

    globalTradeControls: adminProcedure.query(() => getTradeGlobalControls()),
    deliveryRetryPolicy: adminProcedure.query(() => getDeliveryRetryPolicy()),
    updateDeliveryRetryPolicy: adminProcedure.input(z.object({
      expectedVersion: z.number().int().min(1),
      policy: z.enum(["none", "temporary"]),
      maxAttempts: z.number().int().min(1).max(20),
      intervalsSeconds: z.array(z.number().int().min(5).max(3600)).max(19),
      effectiveAt: z.string().datetime(),
      reason: z.string().trim().min(5).max(500),
    }).strict().superRefine((value, ctx) => {
      const valid = value.policy === "none"
        ? value.maxAttempts === 1 && value.intervalsSeconds.length === 0
        : value.maxAttempts >= 2 && value.intervalsSeconds.length === value.maxAttempts - 1;
      if (!valid) ctx.addIssue({ code: "custom", message: "Policy none requires one initial attempt and no intervals; temporary retry policy requires 2–20 attempts and exactly one 5–3,600 second interval per retry." });
    })).mutation(async ({ ctx, input }) => {
      try { return await updateDeliveryRetryPolicy(input, ctx.user.id); }
      catch (error) {
        if (error instanceof DeliveryRetryPolicyVersionConflictError) throw new TRPCError({ code: "CONFLICT", message: error.message });
        throw error;
      }
    }),
    updateGlobalTradeControl: adminProcedure.input(z.object({
      key: z.enum(["tierPolicyMasterEnabled","informationalPopupDeliveryEnabled","companyRotationEnabled","randomizedTimingEnabled","burstDeliveryEnabled","requirePreviousSettlement","automaticFinancialExecutionEnabled"]),
      enabled: z.boolean(),
      reason: z.string().trim().min(5).max(500),
      expectedPolicyVersion: z.number().int().positive(),
    }).strict()).mutation(async ({ ctx, input }) => {
      try { return await setTradeGlobalControl(input, ctx.user.id); }
      catch (error) {
        if (error instanceof TradeGlobalControlVersionConflictError) throw new TRPCError({ code: "CONFLICT", message: error.message });
        throw error;
      }
    }),
    tradeAllocationControls: adminProcedure.query(() => getTradeAllocationControls()),
    updateTradeAllocationControls: adminProcedure.input(z.object({
      allocationsPaused: z.boolean(),
      reason: z.string().trim().min(8).max(500),
    }).strict()).mutation(({ ctx, input }) => setTradeAllocationControls(ctx.user.id, input)),
    walletFundingPriority: adminProcedure.query(() => getWalletFundingPriority()),
    updateWalletFundingPriority: adminProcedure.input(z.object({
      order: z.array(z.string().trim().min(2).max(12)).max(50),
      reason: z.string().trim().min(5).max(500),
      expectedPolicyVersion: z.number().int().min(0),
    }).strict()).mutation(async ({ ctx, input }) => {
      try { return await setWalletFundingPriority(ctx.user.id, input); }
      catch (error) {
        if (error instanceof WalletFundingPriorityVersionConflictError) throw new TRPCError({ code: "CONFLICT", message: error.message });
        throw error;
      }
    }),
    tradingPackages: adminProcedure.query(() => listAdminTradingPackages()),
    createTradingPackage: adminProcedure.input(z.object({
      name: z.string().trim().min(1).max(80),
      reason: z.string().trim().min(5).max(500),
      minimumQualifyingBalanceUsdMinor: z.number().int().positive().max(9007199254740991),
      durationMonths: z.number().int().min(1).max(1200),
      opportunitiesPerDay: z.number().int().min(1).max(10000),
      maxPopupsPerDay: z.number().int().min(0).max(10000),
      maxActiveInvestments: z.number().int().min(0).max(10000),
      startsAt: z.string().datetime().nullable(),
      expiresAt: z.string().datetime().nullable(),
      enabled: z.boolean(),
    }).refine(input => !input.startsAt || !input.expiresAt || Date.parse(input.expiresAt) > Date.parse(input.startsAt), {
      message: "Package expiry must be later than its start time",
      path: ["expiresAt"],
    })).mutation(({ ctx, input }) => createAdminTradingPackage(ctx.user.id, {
      ...input, startsAt:input.startsAt?new Date(input.startsAt):null, expiresAt:input.expiresAt?new Date(input.expiresAt):null,
    })),
    updateTradingPackage: adminProcedure.input(z.object({
      id: z.number().int().positive(),
      expectedTermsVersion: z.number().int().positive().max(2_147_483_647),
      reason: z.string().trim().min(5).max(500),
      name: z.string().trim().min(1).max(80),
      minimumQualifyingBalanceUsdMinor: z.number().int().positive().max(9007199254740991),
      durationMonths: z.number().int().min(1).max(1200),
      opportunitiesPerDay: z.number().int().min(1).max(10000),
      maxPopupsPerDay: z.number().int().min(0).max(10000),
      maxActiveInvestments: z.number().int().min(0).max(10000),
      startsAt: z.string().datetime().nullable(),
      expiresAt: z.string().datetime().nullable(),
      enabled: z.boolean(),
    }).refine(input => !input.startsAt || !input.expiresAt || Date.parse(input.expiresAt) > Date.parse(input.startsAt), {
      message: "Package expiry must be later than its start time",
      path: ["expiresAt"],
    })).mutation(async ({ ctx, input }) => {
      try {
        return await updateAdminTradingPackage(ctx.user.id, {
          ...input, startsAt:input.startsAt?new Date(input.startsAt):null, expiresAt:input.expiresAt?new Date(input.expiresAt):null,
        });
      } catch (error) {
        if (error instanceof TradingPackageTermsVersionConflictError) throw new TRPCError({ code: "CONFLICT", message: error.message });
        throw error;
      }
    }),
    communicationSettings: adminProcedure.query(() => getAdminCommunicationSettings()),
    updateCommunicationSettings: adminProcedure.input(communicationSettingsInput).mutation(async ({ ctx, input }) => {
      const errors = validateCommunicationSettingsInput(input);
      if (errors.length) throw new TRPCError({ code: "BAD_REQUEST", message: errors.join(" ") });
      return saveAdminCommunicationSettings(ctx.user.id, input);
    }),

    privacyPolicyState: adminProcedure.query(() => privacyService.getAdminPrivacyPolicyState()),
    savePrivacyPolicyDraft: adminProcedure.input(z.object({
      draftId: z.number().int().positive().optional(),
      title: z.string().trim().min(5).max(200),
      summary: z.string().trim().min(20).max(700),
      controllerName: z.string().trim().min(3).max(200),
      controllerAddress: z.string().max(500),
      privacyContact: z.string().trim().min(5).max(320),
      applicableJurisdiction: z.string().max(180),
      htmlContent: z.string(),
      sections: z.array(z.object({
        id: z.string(),
        title: z.string(),
        body: z.string(),
      })).max(16),
    })).mutation(({ ctx, input }) => privacyService.savePrivacyPolicyDraft(ctx.user.id, input)),
    publishPrivacyPolicy: adminProcedure.input(z.object({ draftId: z.number().int().positive(), reviewAcknowledged: z.literal(true) }))
      .mutation(({ ctx, input }) => privacyService.publishPrivacyPolicy(ctx.user.id, input.draftId, input.reviewAcknowledged)),
    privacyRequests: adminProcedure.input(z.object({
      status: z.enum(["submitted", "identity_check", "in_review", "awaiting_customer", "completed", "declined", "cancelled"]).optional(),
    }).optional()).query(({ input }) => privacyService.listAdminPrivacyRequests(input?.status)),
    privacyRequestDetail: adminProcedure.input(z.object({ requestId: z.number().int().positive() }))
      .query(({ input }) => privacyService.getAdminPrivacyRequestDetail(input.requestId)),
    updatePrivacyRequest: adminProcedure.input(z.object({
      requestId: z.number().int().positive(),
      status: z.enum(["submitted", "identity_check", "in_review", "awaiting_customer", "completed", "declined", "cancelled"]),
      customerMessage: z.string().max(1500).optional(),
      internalNote: z.string().max(3000).optional(),
    })).mutation(async ({ ctx, input }) => {
      const result = await privacyService.updatePrivacyRequest(ctx.user.id, input);
      if (result.customerMessage) {
        try {
          await createNotification(result.userId, "Privacy request update",
            result.requestReference + ": " + result.customerMessage, {
              eventKey: "privacy-request-update:" + result.requestReference + ":" + Date.now(),
              category: "account",
              priority: "normal",
              href: "/customer",
            });
        } catch (error) {
          console.error("[Privacy] Customer update notice failed after request persistence:", error instanceof Error ? error.name : "UnknownError");
        }
      }
      return result;
    }),
    payoutRequests: adminProcedure.input(z.object({ cursor: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/).optional(), pageSize: z.number().int().min(1).max(100).optional() }).strict().optional()).query(({ input }) => listAdminPayoutRequests(input ?? {})),
    resolvePayoutRequest: adminProcedure.input(z.object({
      requestId: z.number().int().positive(),
      action: z.enum(["completed", "declined"]),
      externalReference: z.string().trim().max(160).optional(),
      note: z.string().trim().min(3).max(1000),
    })).mutation(({ ctx, input }) => resolveCustomerPayoutRequest(ctx.user.id, input)),
    withdrawalPins: adminProcedure.query(() => listCustomerWithdrawalPins()),
    clearWithdrawalPin: adminProcedure.input(z.object({ userId: z.number().int().positive() })).mutation(({ input }) => clearCustomerWithdrawalPin(input.userId)),
    notifications: adminProcedure.query(({ctx})=>listNotifications(ctx.user.id)),
    markNotificationsRead: adminProcedure.input(z.object({id:z.number().int().positive().optional()}).optional()).mutation(({ctx,input})=>markCustomerNotificationsRead(ctx.user.id,input?.id)),
    notificationCategoryVisibility: adminProcedure.query(() => getNotificationCategoryVisibility()),
    updateNotificationCategoryVisibility: adminProcedure.input(z.object({account:z.boolean(),transaction:z.boolean(),deposit:z.boolean(),withdrawal:z.boolean(),ledger_credit:z.boolean(),ledger_debit:z.boolean(),trading:z.boolean(),trading_reward:z.boolean(),mining:z.boolean(),mining_reward:z.boolean(),support:z.boolean(),announcement:z.boolean(),promotion:z.boolean(),platform_update:z.boolean(),security:z.boolean()})).mutation(({ctx,input})=>setNotificationCategoryVisibility(input,ctx.user.id)),
    publishAnnouncement: adminProcedure.input(z.object({title:z.string().trim().min(3).max(200),body:z.string().trim().min(1).max(10000),eventKey:z.string().trim().min(8).max(120),category:z.enum(ADMIN_BROADCAST_CATEGORIES),priority:z.enum(["low","normal","high","urgent"]).default("normal"),href:z.string().max(512).optional(),targetUserId:z.number().int().positive().nullable().optional(),scheduledAt:z.string().datetime().optional(),expiresAt:z.string().datetime().optional()})).mutation(({ctx,input})=>broadcastCustomerNotification(ctx.user.id,input)),
    announcementHistory: adminProcedure.query(() => listAdminNotificationCampaigns()),
    retryAnnouncement: adminProcedure.input(z.object({campaignId:z.number().int().positive()})).mutation(({ctx,input})=>retryNotificationCampaign(ctx.user.id,input.campaignId)),
    withdrawAnnouncement: adminProcedure.input(z.object({campaignId:z.number().int().positive()})).mutation(({ctx,input})=>withdrawNotificationCampaign(ctx.user.id,input.campaignId)),
    miningDashboard: adminProcedure.query(() => miningAdmin.getMiningAdminDashboard()),
    miningPackages: adminProcedure.query(() => miningAdmin.getMiningAdminPackages()),
    miningEconomics: adminProcedure.query(() => miningAdmin.getMiningAdminEconomics()),
    saveMiningEconomics: adminProcedure.input(z.object({ packagePurchasesEnabled:z.boolean(),boostsEnabled:z.boolean(),tokenName:z.string().trim().min(2).max(64),tokenSymbol:z.string().trim().min(2).max(16),tokenIconUrl:z.string().trim().max(1000).optional().default(""),tokenRateSource:z.enum(["fixed","live"]).optional().default("fixed"),tokenExternalSymbol:z.string().trim().max(64).optional().default(""),tokenRateProvider:z.string().trim().max(64).optional().default(""),defaultContractDurationMonths:z.number().int().min(1).max(120),calculationModel:z.enum(["package_daily","hashrate_daily"]),ckiPerThsPerDay:z.string().min(1).max(64),effectiveAt:z.string().min(1).max(64).optional(),difficultyBaselineThs:z.string().min(1).max(64),tokenUnitsPerUsd:z.string().min(1).max(64),rewardTokensPerThsHour:z.string().min(1).max(64),swapFeeBps:z.number().int().min(0).max(10000),purchaseFeeBps:z.number().int().min(0).max(10000),minSwapTokens:z.string().min(1).max(64),maxSwapTokens:z.string().min(1).max(64),defaultAutoConversionThreshold:z.string().min(1).max(64),boostCycleSeconds:z.number().int().min(60).max(31536000),boostDurationSeconds:z.number().int().min(10).max(31536000),boostRewardCkiPerDay:z.string().min(1).max(64),boostActivationBonusCki:z.string().min(1).max(64),quoteTtlSeconds:z.number().int().min(10).max(600),fiatMaxAgeSeconds:z.number().int().min(60).max(604800),cryptoMaxAgeSeconds:z.number().int().min(30).max(3600),maxRateDeviationBps:z.number().int().min(0).max(10000),dailyRewardCapTokens:z.string().min(1).max(64),dualApprovalThresholdUsd:z.string().min(1).max(64),globalHashPowerThs:z.string().min(1).max(64),miningSpeedMultiplier:z.string().min(1).max(64),reason:z.string().trim().min(10).max(2000) })).mutation(({ ctx,input }) => miningAdmin.saveMiningEconomics(ctx.user.id,input)),
    saveMiningPackageDraft: adminProcedure.input(z.object({ packageId:z.number().int().positive().optional(),versionId:z.number().int().positive().optional(),code:z.string().min(2).max(48),name:z.string().min(2).max(120),displayOrder:z.number().int().min(1).max(10000),durationMonths:z.number().int().min(1).max(120),expectedDailyRewardCki:z.string().max(64).nullable().optional(),priceAmount:z.string().min(1).max(64),priceAsset:z.string().min(2).max(12),baseThs:z.string().min(1).max(64),boostBonusThs:z.string().min(1).max(64),boostDurationSeconds:z.number().int().min(10).max(31536000).nullable().optional(),maxPerCustomer:z.number().int().min(0).max(100000),stackingPolicy:z.enum(["stack","replace"]),themeKey:z.enum(MINING_PACKAGE_THEME_KEYS).optional(),termsText:z.string().max(20000).optional(),simulationAcknowledgementRequired:z.boolean().optional(),reason:z.string().max(2000).optional() })).mutation(({ctx,input})=>miningAdmin.saveMiningPackageDraft(ctx.user.id,input)),
    publishMiningPackage: adminProcedure.input(z.object({packageId:z.number().int().positive(),versionId:z.number().int().positive(),reason:z.string().max(2000).optional()})).mutation(({ctx,input})=>miningAdmin.publishMiningPackage(ctx.user.id,input)),
    setMiningPackageStatus: adminProcedure.input(z.object({packageId:z.number().int().positive(),status:z.enum(["published","paused","retired"]),reason:z.string().max(2000).optional()})).mutation(({ctx,input})=>miningAdmin.setMiningPackageStatus(ctx.user.id,input)),
    cloneMiningPackage: adminProcedure.input(z.object({packageId:z.number().int().positive(),code:z.string().min(2).max(48),name:z.string().min(2).max(120),displayOrder:z.number().int().min(1).max(10000),reason:z.string().max(2000).optional()})).mutation(({ctx,input})=>miningAdmin.cloneMiningPackage(ctx.user.id,input)),
    setCustomerMiningEntitlementState: adminProcedure.input(z.object({purchaseId:z.number().int().positive(),action:z.enum(["pause","resume","stop","extend"]),extendSeconds:z.number().int().min(60).max(315360000).optional(),reason:z.string().trim().min(10).max(2000),idempotencyKey:z.string().min(8).max(160)})).mutation(({ctx,input})=>miningAdmin.setCustomerMiningEntitlementState(ctx.user.id,input)),
    miningPriceFeeds: adminProcedure.query(()=>miningAdmin.getMiningAdminPriceFeeds()),
    refreshMiningPriceFeeds: adminProcedure.mutation(()=>miningAdmin.refreshMiningPriceFeeds()),
    miningCustomers: adminProcedure.input(z.object({query:z.string().max(120).optional(),limit:z.number().int().min(1).max(100).optional()}).optional()).query(({input})=>miningAdmin.listMiningAdminCustomers(input||{})),
    miningCustomerDetail: adminProcedure.input(z.object({userId:z.number().int().positive()})).query(({input})=>miningAdmin.getMiningAdminCustomerDetail(input.userId)),
    grantSandboxMiningPackage: adminProcedure.input(z.object({userId:z.number().int().positive(),packageVersionId:z.number().int().positive(),reason:z.string().trim().min(10).max(2000),idempotencyKey:z.string().min(8).max(160)})).mutation(({ctx,input})=>miningAdmin.grantSandboxMiningPackage(ctx.user.id,input)),
    createMiningAdjustment: adminProcedure.input(z.object({userId:z.number().int().positive(),assetCode:z.string().min(2).max(12),amount:z.string().min(1).max(64),direction:z.enum(["credit","debit"]),reason:z.string().trim().min(10).max(2000),idempotencyKey:z.string().min(8).max(160)})).mutation(({ctx,input})=>miningAdmin.createMiningAdjustment(ctx.user.id,input)),
    miningAdjustmentQueue: adminProcedure.query(()=>miningAdmin.listMiningAdjustmentQueue()),
    resolveMiningAdjustment: adminProcedure.input(z.object({requestId:z.number().int().positive(),approve:z.boolean(),reason:z.string().trim().min(10).max(2000)})).mutation(({ctx,input})=>miningAdmin.resolveMiningAdjustment(ctx.user.id,input)),
    reverseMiningTransaction: adminProcedure.input(z.object({transactionId:z.number().int().positive(),reason:z.string().trim().min(10).max(2000)})).mutation(({ctx,input})=>miningAdmin.reverseMiningTransaction(ctx.user.id,input)),
    reconcileMiningLedger: adminProcedure.input(z.object({repair:z.boolean().optional(),reason:z.string().max(2000).optional()}).optional()).mutation(({ctx,input})=>miningAdmin.reconcileMiningLedger(ctx.user.id,input||{})),
    runBulkMiningCkiOperation: adminProcedure.input(z.object({direction:z.enum(["credit","debit"]),amount:z.string().min(1).max(64),reason:z.string().trim().min(10).max(2000),idempotencyKey:z.string().min(8).max(160),userIds:z.array(z.number().int().positive()).max(20000).optional(),query:z.string().max(120).optional()})).mutation(({ctx,input})=>miningAdmin.runBulkMiningCkiOperation(ctx.user.id,input)),
    miningBulkOperations: adminProcedure.input(z.object({limit:z.number().int().min(1).max(100).optional()}).optional()).query(({input})=>miningAdmin.listMiningBulkOperations(input||{})),
    kycDashboard: adminProcedure.query(() => adminDashboard()),
    kycCustomers: adminProcedure.input(z.object({ page: z.number().int().positive().optional(), pageSize: z.number().int().min(10).max(100).optional(), search: z.string().max(100).optional(), status: z.enum(["NOT_STARTED", "IN_PROGRESS", "VERIFIED", "REVIEW_REQUIRED", "RETRY_AVAILABLE", "REJECTED"]).optional() }).optional()).query(({ input }) => adminCustomerDirectory(input || {})),
    kycQueue: adminProcedure.query(() => adminQueue()),
    kycSettings: adminProcedure.query(async () => getAdminKycSettings(await isEmailDeliveryConfigured() || await isEmailAdminConfigured())),
    updateKycSettings: adminProcedure.input(z.object({ emailExpiryMinutes: z.number().int().min(5).max(60), phoneExpiryMinutes: z.number().int().min(1).max(30), rawRetentionDays: z.number().int().min(1).max(30), extractedRetentionDays: z.number().int().min(30).max(3650), resultRetentionDays: z.number().int().min(365).max(3650), faceMatchPassThreshold: z.number().min(0.7).max(0.99), faceMatchReviewThreshold: z.number().min(0.5).max(0.98), reviewSlaHours: z.number().int().min(1).max(168) })).mutation(({ ctx, input }) => updateAdminKycSettings(ctx.user.id, input)),
    kycDecision: adminProcedure.input(z.object({ profileId: z.number().int().positive(), stage: z.enum(["EMAIL", "PHONE", "ADDRESS", "IDENTITY_DOCUMENT", "FACE_LIVENESS"]), decision: z.enum(["APPROVE", "REJECT"]), reason: z.string().trim().min(5).max(2000) })).mutation(({ ctx, input }) => adminDecision(ctx.user.id, input.profileId, input.stage, input.decision, input.reason)),
    kycOverride: adminProcedure.input(z.object({ profileId: z.number().int().positive(), stage: z.enum(["EMAIL", "PHONE", "ADDRESS", "IDENTITY_DOCUMENT", "FACE_LIVENESS"]), reason: z.string().min(5).max(2000) })).mutation(({ ctx, input }) => adminOverride(ctx.user.id, input.profileId, input.stage, input.reason)),
    kycAuditEvents: adminProcedure.query(() => adminAuditEvents()),
    kycVerifyAudit: adminProcedure.query(() => verifyAuditChain()),
    emailAdminConfig: adminProcedure.query(async () => ({ email: { smtp: await publicEmailConfig(), smtpReady: await isEmailAdminConfigured(), dailyCloseHourUtc: Number(await getAppSetting("email.dailyCloseHourUtc", "23")), dailyCloseMinuteUtc: Number(await getAppSetting("email.dailyCloseMinuteUtc", "59")) } })),
    emailRecipients: adminProcedure.query(() => listEmailRecipients()),
    testEmail: adminProcedure.input(z.object({ to: z.string().email() })).mutation(({ input }) => testEmailConnection(input.to)),
    runDailyReports: adminProcedure.input(z.object({ force: z.boolean().optional() }).optional()).mutation(({ input }) => runDailyEmailReports(Boolean(input?.force))),
    saveEmailConfig: adminProcedure.input(z.object({ provider: z.enum(["local", "local-smtp", "sendgrid", "aws-ses", "other"]).optional(), region: z.string().max(64).optional(), clearPassword: z.boolean().optional(), mode: z.enum(["external", "direct"]), host: z.string().max(255), port: z.number().int().min(1).max(65535), secure: z.boolean(), authType: z.enum(["login", "plain", "none"]), user: z.string().max(255), password: z.string().max(2000).optional(), fromName: z.string().min(1).max(120), fromAddress: z.string().email(), replyTo: z.string().email().or(z.literal("")), dailyCloseHourUtc: z.number().int().min(0).max(23), dailyCloseMinuteUtc: z.number().int().min(0).max(59) })).mutation(async ({ ctx, input }) => { const { dailyCloseHourUtc, dailyCloseMinuteUtc, clearPassword, ...emailConfig } = input; const saved = await saveEmailConfig({ ...emailConfig, clearPassword }, ctx.user.id); await setAppSetting("email.dailyCloseHourUtc", String(dailyCloseHourUtc), ctx.user.id); await setAppSetting("email.dailyCloseMinuteUtc", String(dailyCloseMinuteUtc), ctx.user.id); return saved; }),
    composeEmail: adminProcedure.input(z.object({ recipients: z.array(z.string().email()).min(1).max(500), subject: z.string().trim().min(3).max(200), htmlBody: z.string().min(1).max(200000), textBody: z.string().max(200000).optional(), attachments: z.array(z.object({ filename: z.string().min(1).max(255), content: z.string().max(35000000), contentType: z.string().max(160).optional() })).max(10).optional() })).mutation(({ ctx, input }) => sendAdminComposedEmail(ctx.user.id, input)),
    emailStatus: adminProcedure.query(async () => ({ smtpConfigured: await isEmailDeliveryConfigured(), dailyDigestSchedule: getDailyDigestSchedule() })),
    sendTestEmail: adminProcedure.input(z.object({ userId: z.number().int().positive().optional() }).optional()).mutation(({ ctx, input }) => sendEmailTest(input?.userId || ctx.user.id)),
    sendCustomerEmail: adminProcedure.input(z.object({ userId: z.number().int().positive(), subject: z.string().trim().min(3).max(160), body: z.string().trim().min(1).max(8000) })).mutation(({ ctx, input }) => enqueueAdminMessage(input.userId, input.subject, input.body, `admin:${ctx.user.id}:${Date.now()}:${input.userId}`)),
    customers: adminProcedure.query(() => listAdminCustomers()),
    resetOpportunityUsage: adminProcedure.input(z.discriminatedUnion("scope", [
      z.object({ scope: z.literal("customer"), customerId: z.number().int().positive(), reason: z.string().trim().min(8).max(500), operationId: z.string().uuid() }).strict(),
      z.object({ scope: z.literal("all"), confirmAllCustomers: z.literal(true), reason: z.string().trim().min(8).max(500), operationId: z.string().uuid() }).strict(),
    ])).mutation(({ ctx, input }) => resetTradeOpportunityUsage({
      scope: input.scope,
      customerId: input.scope === "customer" ? input.customerId : undefined,
      reason: input.reason,
      operationId: input.operationId,
    }, ctx.user.id)),
    clearTradePreview: adminProcedure.input(tradeRecordClearPreviewSchema).query(({ input }) => previewTradeRecordClear(input)),
    clearTrade: adminProcedure.input(tradeRecordClearInputSchema).mutation(({ ctx, input }) => clearTradeRecords(input, ctx.user.id)),
    audit: adminProcedure.query(() => listAdminAuditEvents()),
    tradeAuditHistory: adminProcedure.input(z.object({
      actorUserId: z.number().int().positive().max(2_147_483_647).optional(),
      fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      key: z.string().trim().min(1).max(160).optional(),
      entityType: z.string().trim().min(1).max(80).optional(),
      entityId: z.string().trim().min(1).max(128).optional(),
      package: z.string().trim().min(1).max(100).optional(),
      scope: z.enum(["global", "package", "record"]).optional(),
      cursor: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/).optional(),
      pageSize: z.number().int().min(1).max(100).default(50),
    }).strict()
      .refine(input => [input.fromDate, input.toDate].every(value => {
        if (!value) return true;
        const date = new Date(`${value}T00:00:00.000Z`);
        return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
      }), { message: "Dates must be valid UTC calendar dates." })
      .refine(input => !input.fromDate || !input.toDate || input.fromDate <= input.toDate, { message: "Start date must not follow end date." })
    ).query(({ input }) => listAdminTradeAuditHistory(input)),
    ledgerActivity: adminProcedure.input(z.object({
      userId: z.number().int().positive(),
      utcDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
        const date = new Date(`${value}T00:00:00.000Z`);
        return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
      }, { message: "UTC day must be a valid YYYY-MM-DD calendar date." }),
      cursor: z.string().min(1).max(256).optional(),
      }).strict()).query(({ input }) => listAdminRecentLedgerActivity(input)),
    tradingHistory: adminProcedure.input(z.object({
      beforeTradeId: z.number().int().positive().max(2_147_483_647).optional(),
      userId: z.number().int().positive().max(2_147_483_647).optional(),
      status: z.enum(["pending", "confirmed", "settled", "cancelled"]).optional(),
      settlementStatus: z.enum(["pending", "confirmed_awaiting_credit", "completed"]).optional(),
      fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      scanLimit: z.number().int().min(25).max(250).default(100),
    }).strict()
      .refine(input => [input.fromDate, input.toDate].every(value => {
        if (!value) return true;
        const date = new Date(`${value}T00:00:00.000Z`);
        return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
      }), { message: "Dates must be valid UTC calendar dates." })
      .refine(input => !input.fromDate || !input.toDate || input.fromDate <= input.toDate, { message: "Start date must not follow end date." })
    ).query(({ input }) => listAdminTradingHistory(input)),
    packageFeePolicies: adminProcedure.query(() => getPackageFeePolicies()),
    packageFeeHistory: adminProcedure.input(z.object({ packageId: z.number().int().positive().max(2_147_483_647) }).strict())
      .query(({ input }) => getPackageFeeHistory(input.packageId)),
    updatePackageFeePolicy: adminProcedure.input(z.object({
      packageId: z.number().int().positive().max(2_147_483_647),
      expectedVersion: z.number().int().min(0).max(2_147_483_647),
      feeRateBps: z.number().int().min(0).max(10000),
      roundingMode: z.enum(["half_up","down","up","half_even"]),
      effectiveAt: z.string().datetime({ offset: false }),
      reason: z.string().trim().min(5).max(500),
    }).strict()).mutation(({ ctx, input }) => updatePackageFeePolicy(input, ctx.user.id)),
    tradeFeePolicy: adminProcedure.query(() => getTradeFeePolicy()),
    pendingSettlements: adminProcedure.query(() => listPendingSettlements()),
    settlementEvidence: adminProcedure.input(z.object({ tradeId: z.number().int().positive() }).strict()).query(({ input }) => listSettlementEvidence(input.tradeId)),
    submitSettlementEvidence: adminProcedure.input(z.object({
      tradeId: z.number().int().positive(), evidenceReference: z.string().trim().min(3).max(160),
      evidenceType: z.enum(["document","statement","screenshot","transaction_receipt","other"]),
      originalFilename: z.string().trim().max(255).optional(), mimeType: z.string().trim().max(160).optional(),
      sizeBytes: z.number().int().positive().max(25_000_000).optional(), sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
      storageKey: z.string().trim().max(512).optional(), notes: z.string().trim().max(2000).optional(),
    }).strict()).mutation(({ ctx, input }) => submitSettlementEvidence(ctx.user.id, input)),
    reviewSettlementEvidence: adminProcedure.input(z.object({ evidenceId: z.number().int().positive(), decision: z.enum(["approve","reject"]), notes: z.string().trim().min(5).max(2000) }).strict()).mutation(({ ctx, input }) => reviewSettlementEvidence(ctx.user.id, input)),
    settlementIntegrityIssues: adminProcedure.input(z.object({
      limit: z.number().int().min(1).max(1000).optional(),
      beforeTradeId: z.number().int().positive().optional(),
    }).optional()).query(({ input }) => listTradeSettlementIntegrityIssues(input)),
    walletLedgerReconciliation: adminProcedure.input(z.object({
      limit: z.number().int().min(1).max(1000).optional(),
      afterUserId: z.number().int().positive().optional(),
      afterCurrency: z.string().trim().min(2).max(12).optional(),
      beforeTradeId: z.number().int().positive().optional(),
    }).refine((input) => (input.afterUserId === undefined) === (input.afterCurrency === undefined), {
      message: "Wallet reconciliation cursor requires both customer ID and currency",
    }).optional()).query(({ input }) => listWalletLedgerReconciliation(input)),
    confirmManualSettlement: adminProcedure.input(z.object({
      tradeId: z.number().int().positive(),
      grossProfitMinor: z.number().int().safe(),
      settlementReference: z.string().trim().min(3).max(160),
      evidenceId: z.number().int().positive(),
      notes: z.string().trim().max(2000).optional(),
    }).strict()).mutation(async ({ ctx, input }) => {
      // Confirmation records the evidence-backed result; wallet-credit notices are
      // intentionally not sent until the delayed posting worker commits the ledger.
      return await manuallySettleTrade(input.tradeId,ctx.user.id,input);
    }),
    customerBalances: adminProcedure.input(z.object({ userId: z.number().int().positive() })).query(({ input }) => listBalances(input.userId)),
    currencies: adminProcedure.query(() => listCurrencies()),
    upsertCurrency: adminProcedure.input(z.object({ code: z.string().min(2).max(32), name: z.string().min(2).max(120), symbol: z.string().min(1).max(16), scale: z.number().int().min(0).max(18), assetType: z.enum(["fiat","crypto","token"]), usdRate: z.string().min(1).max(64), rateProvider: z.string().min(1).max(120), externalCode: z.string().max(80).optional(), enabled: z.boolean().optional() })).mutation(({ input }) => upsertCurrency(input)),
    treasuryInstruments: adminProcedure.query(() => listAdminTreasuryBondInstruments()),
    createTreasuryInstrument: adminProcedure.input(createTreasuryInstrumentSchema).mutation(({ ctx, input }) => createAdminTreasuryBondInstrument(ctx.user!.id, input)),
    updateTreasuryInstrument: adminProcedure.input(updateTreasuryInstrumentSchema).mutation(({ ctx, input }) => {
      const { instrumentId, ...fields } = input;
      return updateAdminTreasuryBondInstrument(ctx.user!.id, instrumentId, fields);
    }),
    setTreasuryInstrumentEnabled: adminProcedure.input(z.object({ instrumentId: z.string().trim().min(2).max(80), enabled: z.boolean() })).mutation(({ ctx, input }) => setAdminTreasuryBondInstrumentEnabled(ctx.user!.id, input.instrumentId, input.enabled)),
    deleteTreasuryInstrument: adminProcedure.input(z.object({ instrumentId: z.string().trim().min(2).max(80) })).mutation(({ ctx, input }) => deleteAdminTreasuryBondInstrument(ctx.user!.id, input.instrumentId)),
    cooperateDeptCompanies: adminProcedure.query(() => listAdminCooperateDeptCompanies()),
    createCooperateDeptCompany: adminProcedure.input(createCooperateDeptCompanySchema).mutation(({ ctx, input }) => createAdminCooperateDeptCompany(ctx.user!.id, input)),
    updateCooperateDeptCompany: adminProcedure.input(updateCooperateDeptCompanySchema).mutation(({ ctx, input }) => {
      const { companyId, ...fields } = input;
      return updateAdminCooperateDeptCompany(ctx.user!.id, companyId, fields);
    }),
    setCooperateDeptCompanyEnabled: adminProcedure.input(z.object({ companyId: z.string().trim().min(2).max(80), enabled: z.boolean() })).mutation(({ ctx, input }) => setAdminCooperateDeptCompanyEnabled(ctx.user!.id, input.companyId, input.enabled)),
    deleteCooperateDeptCompany: adminProcedure.input(z.object({ companyId: z.string().trim().min(2).max(80) })).mutation(({ ctx, input }) => deleteAdminCooperateDeptCompany(ctx.user!.id, input.companyId)),
    litigationDossiers: adminProcedure.query(() => listAdminLitigationDossiers()),
    createLitigationDossier: adminProcedure.input(createLitigationDossierSchema).mutation(({ ctx, input }) => createAdminLitigationDossier(ctx.user!.id, input)),
    updateLitigationDossier: adminProcedure.input(updateLitigationDossierSchema).mutation(({ ctx, input }) => {
      const { dossierId, ...fields } = input;
      return updateAdminLitigationDossier(ctx.user!.id, dossierId, fields);
    }),
    setLitigationDossierEnabled: adminProcedure.input(z.object({ dossierId: z.string().trim().min(2).max(80), enabled: z.boolean() })).mutation(({ ctx, input }) => setAdminLitigationDossierEnabled(ctx.user!.id, input.dossierId, input.enabled)),
    setLitigationDossierStatus: adminProcedure.input(z.object({
      dossierId: z.string().trim().min(2).max(80),
      status: z.enum(["FUNDING", "ESCROW", "ACTIVE", "RESOLVED", "WITHDRAWN"]),
      reason: z.string().trim().max(500).optional(),
    })).mutation(({ ctx, input }) => setAdminLitigationDossierStatus(ctx.user!.id, input.dossierId, input.status, input.reason)),
    reachLitigationMilestone: adminProcedure.input(z.object({
      dossierId: z.string().trim().min(2).max(80),
      stage: z.enum(["FILED", "DISCOVERY", "MEDIATION", "TRIAL", "JUDGMENT", "ENFORCEMENT", "DISTRIBUTION"]),
      reason: z.string().trim().max(500).optional(),
    })).mutation(({ ctx, input }) => reachAdminLitigationMilestone(ctx.user!.id, input.dossierId, input.stage, input.reason)),
    recordLitigationOutcome: adminProcedure.input(z.object({
      dossierId: z.string().trim().min(2).max(80),
      outcome: z.enum(["SETTLE", "WIN", "LOSE"]),
      reason: z.string().trim().max(500).optional(),
    })).mutation(({ ctx, input }) => recordLitigationOutcome(ctx.user!.id, input.dossierId, input.outcome)),
    deleteLitigationDossier: adminProcedure.input(z.object({ dossierId: z.string().trim().min(2).max(80) })).mutation(({ ctx, input }) => deleteAdminLitigationDossier(ctx.user!.id, input.dossierId)),
    litigationOpenCases: adminProcedure.query(() => listLitigationOpenCases()),
    settleLitigationCase: adminProcedure.input(z.object({
      instrumentId: z.string().trim().min(2).max(80),
      outcome: z.enum(["SETTLE", "WIN", "LOSE"]),
      funderMultipleBps: z.number().int().min(0).max(100_000),
      reason: z.string().trim().max(500).optional(),
    })).mutation(({ ctx, input }) => settleLitigationCase(ctx.user!.id, input)),
    litigationBundles: adminProcedure.query(() => listAdminLitigationBundles()),
    createLitigationBundle: adminProcedure.input(createLitigationBundleSchema).mutation(({ ctx, input }) => createAdminLitigationBundle(ctx.user!.id, input)),
    updateLitigationBundle: adminProcedure.input(updateLitigationBundleSchema).mutation(({ ctx, input }) => {
      const { bundleId, ...fields } = input;
      return updateAdminLitigationBundle(ctx.user!.id, bundleId, fields);
    }),
    setLitigationBundleEnabled: adminProcedure.input(z.object({ bundleId: z.string().trim().min(2).max(80), enabled: z.boolean() })).mutation(({ ctx, input }) => setAdminLitigationBundleEnabled(ctx.user!.id, input.bundleId, input.enabled)),
    deleteLitigationBundle: adminProcedure.input(z.object({ bundleId: z.string().trim().min(2).max(80) })).mutation(({ ctx, input }) => deleteAdminLitigationBundle(ctx.user!.id, input.bundleId)),
    ipRoyaltyDossiers: adminProcedure.query(() => listAdminIpRoyaltyDossiers()),
    createIpRoyaltyDossier: adminProcedure.input(createIpRoyaltyDossierSchema).mutation(({ ctx, input }) => createAdminIpRoyaltyDossier(ctx.user!.id, input)),
    updateIpRoyaltyDossier: adminProcedure.input(updateIpRoyaltyDossierSchema).mutation(({ ctx, input }) => {
      const { dossierId, ...fields } = input;
      return updateAdminIpRoyaltyDossier(ctx.user!.id, dossierId, fields);
    }),
    setIpRoyaltyDossierEnabled: adminProcedure.input(z.object({ dossierId: z.string().trim().min(2).max(80), enabled: z.boolean() })).mutation(({ ctx, input }) => setAdminIpRoyaltyDossierEnabled(ctx.user!.id, input.dossierId, input.enabled)),
    setIpRoyaltyDossierStatus: adminProcedure.input(z.object({
      dossierId: z.string().trim().min(2).max(80),
      status: z.enum(["FUNDING", "ACTIVE", "DISTRIBUTING", "COMPLETED", "WITHDRAWN"]),
      reason: z.string().trim().max(500).optional(),
    })).mutation(({ ctx, input }) => setAdminIpRoyaltyDossierStatus(ctx.user!.id, input.dossierId, input.status, input.reason)),
    deleteIpRoyaltyDossier: adminProcedure.input(z.object({ dossierId: z.string().trim().min(2).max(80) })).mutation(({ ctx, input }) => deleteAdminIpRoyaltyDossier(ctx.user!.id, input.dossierId)),
    ipRoyaltyPortfolios: adminProcedure.query(() => listAdminIpRoyaltyPortfolios()),
    createIpRoyaltyPortfolio: adminProcedure.input(createIpRoyaltyPortfolioSchema).mutation(({ ctx, input }) => createAdminIpRoyaltyPortfolio(ctx.user!.id, input)),
    updateIpRoyaltyPortfolio: adminProcedure.input(updateIpRoyaltyPortfolioSchema).mutation(({ ctx, input }) => {
      const { portfolioId, ...fields } = input;
      return updateAdminIpRoyaltyPortfolio(ctx.user!.id, portfolioId, fields);
    }),
    setIpRoyaltyPortfolioEnabled: adminProcedure.input(z.object({ portfolioId: z.string().trim().min(2).max(80), enabled: z.boolean() })).mutation(({ ctx, input }) => setAdminIpRoyaltyPortfolioEnabled(ctx.user!.id, input.portfolioId, input.enabled)),
    deleteIpRoyaltyPortfolio: adminProcedure.input(z.object({ portfolioId: z.string().trim().min(2).max(80) })).mutation(({ ctx, input }) => deleteAdminIpRoyaltyPortfolio(ctx.user!.id, input.portfolioId)),
    ipRoyaltyOpenInstruments: adminProcedure.query(() => listIpRoyaltyOpenInstruments()),
    recordIpRoyaltyDistribution: adminProcedure.input(z.object({
      instrumentType: z.enum(["RIGHT", "PORTFOLIO"]),
      instrumentId: z.string().trim().min(2).max(80),
      amountMinor: z.number().int().positive().max(100_000_000_000),
      note: z.string().trim().max(400).optional(),
      idempotencyKey: z.string().min(8).max(160),
    })).mutation(({ ctx, input }) => recordIpRoyaltyDistribution(ctx.user!.id, input)),
    settleIpRoyaltyInstrument: adminProcedure.input(z.object({
      instrumentType: z.enum(["RIGHT", "PORTFOLIO"]),
      instrumentId: z.string().trim().min(2).max(80),
      outcome: z.enum(["BUYOUT", "RUNOFF_COMPLETE", "WRITE_OFF"]),
      funderMultipleBps: z.number().int().min(0).max(100_000),
      reason: z.string().trim().max(500).optional(),
    })).mutation(({ ctx, input }) => settleIpRoyaltyInstrument(ctx.user!.id, input)),
    musicDossiers: adminProcedure.query(() => listAdminMusicDossiers()),
    createMusicDossier: adminProcedure.input(createMusicDossierSchema).mutation(({ ctx, input }) => createAdminMusicDossier(ctx.user!.id, input)),
    updateMusicDossier: adminProcedure.input(updateMusicDossierSchema).mutation(({ ctx, input }) => {
      const { dossierId, ...fields } = input;
      return updateAdminMusicDossier(ctx.user!.id, dossierId, fields);
    }),
    setMusicDossierEnabled: adminProcedure.input(z.object({ dossierId: z.string().trim().min(2).max(80), enabled: z.boolean() })).mutation(({ ctx, input }) => setAdminMusicDossierEnabled(ctx.user!.id, input.dossierId, input.enabled)),
    setMusicDossierStatus: adminProcedure.input(z.object({
      dossierId: z.string().trim().min(2).max(80),
      status: z.enum(["FUNDING", "ESCROW", "IN_PRODUCTION", "ACTIVE", "PAYING", "COMPLETED", "WITHDRAWN"]),
      reason: z.string().trim().max(500).optional(),
    })).mutation(({ ctx, input }) => setAdminMusicDossierStatus(ctx.user!.id, input.dossierId, input.status, input.reason)),
    reachMusicMilestone: adminProcedure.input(z.object({
      dossierId: z.string().trim().min(2).max(80),
      stage: z.enum(["ANNOUNCED", "FUNDING", "IN_PRODUCTION", "RELEASED", "TOURING", "PAYING", "CLOSED"]),
      reason: z.string().trim().max(500).optional(),
    })).mutation(({ ctx, input }) => reachAdminMusicMilestone(ctx.user!.id, input.dossierId, input.stage, input.reason)),
    deleteMusicDossier: adminProcedure.input(z.object({ dossierId: z.string().trim().min(2).max(80) })).mutation(({ ctx, input }) => deleteAdminMusicDossier(ctx.user!.id, input.dossierId)),
    musicOpenInstruments: adminProcedure.query(() => listMusicOpenInstruments()),
    recordMusicDistribution: adminProcedure.input(z.object({
      instrumentId: z.string().trim().min(2).max(80),
      amountMinor: z.number().int().positive().max(100_000_000_000),
      note: z.string().trim().max(400).optional(),
      idempotencyKey: z.string().min(8).max(160),
    })).mutation(({ ctx, input }) => recordMusicDistribution(ctx.user!.id, input)),
    settleMusicInstrument: adminProcedure.input(z.object({
      instrumentId: z.string().trim().min(2).max(80),
      outcome: z.enum(["HIT", "RECOUP", "WRITE_OFF"]),
      funderMultipleBps: z.number().int().min(0).max(1_000_000),
      reason: z.string().trim().max(500).optional(),
    })).mutation(({ ctx, input }) => settleMusicInstrument(ctx.user!.id, input)),
    agroDossiers: adminProcedure.query(() => listAdminAgroDossiers()),
    createAgroDossier: adminProcedure.input(createAgroDossierSchema).mutation(({ ctx, input }) => createAdminAgroDossier(ctx.user!.id, input)),
    updateAgroDossier: adminProcedure.input(updateAgroDossierSchema).mutation(({ ctx, input }) => {
      const { dossierId, ...fields } = input;
      return updateAdminAgroDossier(ctx.user!.id, dossierId, fields);
    }),
    setAgroDossierEnabled: adminProcedure.input(z.object({ dossierId: z.string().trim().min(2).max(80), enabled: z.boolean() })).mutation(({ ctx, input }) => setAdminAgroDossierEnabled(ctx.user!.id, input.dossierId, input.enabled)),
    setAgroDossierStatus: adminProcedure.input(z.object({
      dossierId: z.string().trim().min(2).max(80),
      status: z.enum(["FUNDING", "ESCROW", "IN_PRODUCTION", "ACTIVE", "PAYING", "COMPLETED", "WITHDRAWN"]),
      reason: z.string().trim().max(500).optional(),
    })).mutation(({ ctx, input }) => setAdminAgroDossierStatus(ctx.user!.id, input.dossierId, input.status, input.reason)),
    reachAgroMilestone: adminProcedure.input(z.object({
      dossierId: z.string().trim().min(2).max(80),
      stage: z.enum(["PLANNED", "FUNDING", "IN_PRODUCTION", "HARVESTING", "OFF_TAKE", "PAYING", "CLOSED"]),
      reason: z.string().trim().max(500).optional(),
    })).mutation(({ ctx, input }) => reachAdminAgroMilestone(ctx.user!.id, input.dossierId, input.stage, input.reason)),
    deleteAgroDossier: adminProcedure.input(z.object({ dossierId: z.string().trim().min(2).max(80) })).mutation(({ ctx, input }) => deleteAdminAgroDossier(ctx.user!.id, input.dossierId)),
    agroOpenInstruments: adminProcedure.query(() => listAgroOpenInstruments()),
    recordAgroDistribution: adminProcedure.input(z.object({
      instrumentId: z.string().trim().min(2).max(80),
      amountMinor: z.number().int().positive().max(100_000_000_000),
      note: z.string().trim().max(400).optional(),
      idempotencyKey: z.string().min(8).max(160),
    })).mutation(({ ctx, input }) => recordAgroDistribution(ctx.user!.id, input)),
    settleAgroInstrument: adminProcedure.input(z.object({
      instrumentId: z.string().trim().min(2).max(80),
      outcome: z.enum(["STRONG_SEASON", "ON_PLAN", "WRITE_OFF"]),
      funderMultipleBps: z.number().int().min(0).max(1_000_000),
      reason: z.string().trim().max(500).optional(),
    })).mutation(({ ctx, input }) => settleAgroInstrument(ctx.user!.id, input)),
    // Auto-assigned desk economics: list every stored profile, patch one from the
    // admin portal, or re-roll an AUTO profile. An ADMIN row is never re-derived.
    deskEconomics: adminProcedure.input(z.object({ desk: deskKeySchema.optional() }).optional()).query(({ input }) => listDeskEconomics(input?.desk)),
    deskEconomicsBatch: adminProcedure.input(z.object({ desk: deskKeySchema, instrumentIds: z.array(z.string().trim().min(1).max(160)).max(500) })).query(async ({ input }) => [...(await getDeskEconomicsMap(input.desk, input.instrumentIds)).values()]),
    setDeskEconomics: adminProcedure.input(z.object({ desk: deskKeySchema, instrumentId: z.string().trim().min(1).max(160), ...deskEconomicsOverrideSchema })).mutation(({ ctx, input }) => {
      const { desk, instrumentId, ...patch } = input;
      return setDeskEconomicsOverride(desk, instrumentId, patch, ctx.user!.id);
    }),
    // Bulk edit many opportunities on one desk at once: the same override fields,
    // plus one USD amount applied per row and whole-month shifts for the close and
    // payout dates. Used by the admin Desk Economics console.
    bulkSetDeskEconomics: adminProcedure.input(z.object({
      desk: deskKeySchema,
      instrumentIds: z.array(z.string().trim().min(1).max(160)).min(1).max(500),
      ...deskEconomicsOverrideSchema,
      amountUsdMinor: z.number().int().min(1).max(1_000_000_000).optional(),
      extendCloseMonths: z.number().int().min(0).max(60).optional(),
      extendMaturityMonths: z.number().int().min(0).max(60).optional(),
      adjustProfitBps: z.number().int().min(-2_000).max(2_000).optional(),
      variancePct: z.number().min(0).max(50).optional(),
      seed: z.string().trim().min(1).max(40).optional(),
    })).mutation(({ ctx, input }) => {
      const { desk, instrumentIds, amountUsdMinor, extendCloseMonths, extendMaturityMonths, adjustProfitBps, variancePct, seed, ...patch } = input;
      return setDeskEconomicsBulkOverride(
        desk,
        instrumentIds,
        patch,
        { amountUsdMinor, extendCloseMonths, extendMaturityMonths, adjustProfitBps, variancePct, seed },
        ctx.user!.id,
      );
    }),
    // Re-roll the automatic profile for many opportunities at once: fresh, varied,
    // still-realistic numbers. Administrator overrides are kept unless explicitly included.
    reassignDeskEconomicsBulk: adminProcedure.input(z.object({
      desk: deskKeySchema,
      instrumentIds: z.array(z.string().trim().min(1).max(160)).min(1).max(500),
      includeAdmin: z.boolean().optional(),
      salt: z.string().trim().min(1).max(40).optional(),
    })).mutation(({ input }) => reassignDeskEconomicsBulk(input.desk, input.instrumentIds, { includeAdmin: input.includeAdmin, salt: input.salt })),
    reassignDeskEconomics: adminProcedure.input(z.object({ desk: deskKeySchema, instrumentId: z.string().trim().min(1).max(160), salt: z.string().trim().min(1).max(40).optional() })).mutation(({ ctx, input }) => reassignDeskEconomics(input.desk, input.instrumentId, input.salt || `admin-${ctx.user!.id}-${Date.now()}`)),
    // "Load live from source": pull every offer the desk currently serves into the
    // economics store (assigning and persisting the missing ones), then return the
    // desk's full stored set for the console.
    syncDeskEconomics: adminProcedure.input(z.object({ desk: deskKeySchema })).mutation(({ input }) => syncDeskEconomicsFromSource(input.desk)),
    carbonDossiers: adminProcedure.query(() => listAdminCarbonDossiers()),
    createCarbonDossier: adminProcedure.input(createCarbonDossierSchema).mutation(({ ctx, input }) => createAdminCarbonDossier(ctx.user!.id, input)),
    updateCarbonDossier: adminProcedure.input(updateCarbonDossierSchema).mutation(({ ctx, input }) => {
      const { dossierId, ...fields } = input;
      return updateAdminCarbonDossier(ctx.user!.id, dossierId, fields);
    }),
    setCarbonDossierEnabled: adminProcedure.input(z.object({ dossierId: z.string().trim().min(2).max(80), enabled: z.boolean() })).mutation(({ ctx, input }) => setAdminCarbonDossierEnabled(ctx.user!.id, input.dossierId, input.enabled)),
    setCarbonDossierStatus: adminProcedure.input(z.object({
      dossierId: z.string().trim().min(2).max(80),
      status: z.enum(["FUNDING", "ESCROW", "DEVELOPMENT", "ACTIVE", "ISSUING", "COMPLETED", "WITHDRAWN"]),
      reason: z.string().trim().max(500).optional(),
    })).mutation(({ ctx, input }) => setAdminCarbonDossierStatus(ctx.user!.id, input.dossierId, input.status, input.reason)),
    reachCarbonMilestone: adminProcedure.input(z.object({
      dossierId: z.string().trim().min(2).max(80),
      stage: z.enum(["PLANNED", "FUNDING", "DEVELOPMENT", "VALIDATION", "ISSUANCE", "RETIRING", "CLOSED"]),
      reason: z.string().trim().max(500).optional(),
    })).mutation(({ ctx, input }) => reachAdminCarbonMilestone(ctx.user!.id, input.dossierId, input.stage, input.reason)),
    deleteCarbonDossier: adminProcedure.input(z.object({ dossierId: z.string().trim().min(2).max(80) })).mutation(({ ctx, input }) => deleteAdminCarbonDossier(ctx.user!.id, input.dossierId)),
    carbonOpenInstruments: adminProcedure.query(() => listCarbonOpenInstruments()),
    recordCarbonDistribution: adminProcedure.input(z.object({
      instrumentId: z.string().trim().min(2).max(80),
      amountMinor: z.number().int().positive().max(100_000_000_000),
      note: z.string().trim().max(400).optional(),
      idempotencyKey: z.string().min(8).max(160),
    })).mutation(({ ctx, input }) => recordCarbonDistribution(ctx.user!.id, input)),
    settleCarbonInstrument: adminProcedure.input(z.object({
      instrumentId: z.string().trim().min(2).max(80),
      outcome: z.enum(["HIGH_ISSUANCE", "ON_PLAN", "WRITE_OFF"]),
      funderMultipleBps: z.number().int().min(0).max(1_000_000),
      reason: z.string().trim().max(500).optional(),
    })).mutation(({ ctx, input }) => settleCarbonInstrument(ctx.user!.id, input)),
    greenEnergyDossiers: adminProcedure.query(() => listAdminGreenEnergyDossiers()),
    createGreenEnergyDossier: adminProcedure.input(createGreenEnergyDossierSchema).mutation(({ ctx, input }) => createAdminGreenEnergyDossier(ctx.user!.id, input)),
    updateGreenEnergyDossier: adminProcedure.input(updateGreenEnergyDossierSchema).mutation(({ ctx, input }) => {
      const { dossierId, ...fields } = input;
      return updateAdminGreenEnergyDossier(ctx.user!.id, dossierId, fields);
    }),
    setGreenEnergyDossierEnabled: adminProcedure.input(z.object({ dossierId: z.string().trim().min(2).max(80), enabled: z.boolean() })).mutation(({ ctx, input }) => setAdminGreenEnergyDossierEnabled(ctx.user!.id, input.dossierId, input.enabled)),
    setGreenEnergyDossierStatus: adminProcedure.input(z.object({
      dossierId: z.string().trim().min(2).max(80),
      status: z.enum(["FUNDING", "ESCROW", "DEVELOPMENT", "ACTIVE", "OPERATING", "COMPLETED", "WITHDRAWN"]),
      reason: z.string().trim().max(500).optional(),
    })).mutation(({ ctx, input }) => setAdminGreenEnergyDossierStatus(ctx.user!.id, input.dossierId, input.status, input.reason)),
    reachGreenEnergyMilestone: adminProcedure.input(z.object({
      dossierId: z.string().trim().min(2).max(80),
      stage: z.enum(["PLANNED", "FUNDING", "DEVELOPMENT", "CONSTRUCTION", "COMMISSIONING", "OPERATING", "CLOSED"]),
      reason: z.string().trim().max(500).optional(),
    })).mutation(({ ctx, input }) => reachAdminGreenEnergyMilestone(ctx.user!.id, input.dossierId, input.stage, input.reason)),
    deleteGreenEnergyDossier: adminProcedure.input(z.object({ dossierId: z.string().trim().min(2).max(80) })).mutation(({ ctx, input }) => deleteAdminGreenEnergyDossier(ctx.user!.id, input.dossierId)),
    greenEnergyOpenInstruments: adminProcedure.query(() => listGreenEnergyOpenInstruments()),
    recordGreenEnergyDistribution: adminProcedure.input(z.object({
      instrumentId: z.string().trim().min(2).max(80),
      amountMinor: z.number().int().positive().max(100_000_000_000),
      note: z.string().trim().max(400).optional(),
      idempotencyKey: z.string().min(8).max(160),
    })).mutation(({ ctx, input }) => recordGreenEnergyDistribution(ctx.user!.id, input)),
    settleGreenEnergyInstrument: adminProcedure.input(z.object({
      instrumentId: z.string().trim().min(2).max(80),
      outcome: z.enum(["OUTPERFORM", "ON_PLAN", "WRITE_OFF"]),
      funderMultipleBps: z.number().int().min(0).max(1_000_000),
      reason: z.string().trim().max(500).optional(),
    })).mutation(({ ctx, input }) => settleGreenEnergyInstrument(ctx.user!.id, input)),
    // Lending desk administrator console. The administrator publishes each loan,
    // controls the auction window (which is the server's authoritative countdown),
    // sets the post-win disbursement conditions, records lender reserves, and then
    // disburses and settles. All money movement stays in the internal ledger.
    lendingLoans: adminProcedure.query(() => listAdminLendingLoans()),
    createLendingLoan: adminProcedure.input(createLendingLoanSchema).mutation(({ ctx, input }) => createAdminLendingLoan(ctx.user!.id, input)),
    updateLendingLoan: adminProcedure.input(updateLendingLoanSchema).mutation(({ ctx, input }) => {
      const { loanId, ...fields } = input;
      return updateAdminLendingLoan(ctx.user!.id, loanId, fields);
    }),
    setLendingLoanEnabled: adminProcedure.input(z.object({ loanId: z.string().trim().min(1).max(80), enabled: z.boolean() })).mutation(({ ctx, input }) => setAdminLendingLoanEnabled(ctx.user!.id, input.loanId, input.enabled)),
    setLendingLoanStage: adminProcedure.input(z.object({ loanId: z.string().trim().min(1).max(80), stage: lendingEnum(LENDING_STAGES), reason: z.string().trim().max(500).optional() })).mutation(({ ctx, input }) => setAdminLendingLoanStage(ctx.user!.id, input.loanId, input.stage, input.reason)),
    // Opens/closes bidding, or re-schedules it: the auction countdown and when the
    // next auction starts are entirely administrator controlled.
    setLendingLoanSchedule: adminProcedure.input(z.object({
      loanId: z.string().trim().min(1).max(80),
      auctionOpensAt: z.string().trim().max(40).nullable().optional(),
      auctionClosesAt: z.string().trim().max(40).nullable().optional(),
      stage: lendingEnum(LENDING_STAGES).nullable().optional(),
      reason: z.string().trim().max(500).optional(),
    })).mutation(({ ctx, input }) => setAdminLendingLoanSchedule(ctx.user!.id, input.loanId, input)),
    setLendingConditions: adminProcedure.input(z.object({
      loanId: z.string().trim().min(1).max(80),
      conditions: z.array(lendingDisbursementConditionSchema).min(1).max(15),
      reason: z.string().trim().max(500).optional(),
    })).mutation(({ ctx, input }) => setAdminLendingConditions(ctx.user!.id, input.loanId, input.conditions, input.reason)),
    meetLendingCondition: adminProcedure.input(z.object({
      loanId: z.string().trim().min(1).max(80),
      type: lendingEnum(LENDING_CONDITION_TYPES),
      status: lendingEnum(LENDING_CONDITION_STATUSES).optional(),
      reason: z.string().trim().max(500).optional(),
    })).mutation(({ ctx, input }) => meetAdminLendingCondition(ctx.user!.id, input.loanId, input.type, input.status, input.reason)),
    deleteLendingLoan: adminProcedure.input(z.object({ loanId: z.string().trim().min(1).max(80) })).mutation(({ ctx, input }) => deleteAdminLendingLoan(ctx.user!.id, input.loanId)),
    lenderReserves: adminProcedure.query(() => listAdminLenderReserves()),
    createLenderReserve: adminProcedure.input(createLenderReserveSchema).mutation(({ ctx, input }) => createAdminLenderReserve(ctx.user!.id, input)),
    updateLenderReserve: adminProcedure.input(updateLenderReserveSchema).mutation(({ ctx, input }) => {
      const { reserveId, ...fields } = input;
      return updateAdminLenderReserve(ctx.user!.id, reserveId, fields);
    }),
    setLenderReserveEnabled: adminProcedure.input(z.object({ reserveId: z.string().trim().min(1).max(80), enabled: z.boolean() })).mutation(({ ctx, input }) => setAdminLenderReserveEnabled(ctx.user!.id, input.reserveId, input.enabled)),
    deleteLenderReserve: adminProcedure.input(z.object({ reserveId: z.string().trim().min(1).max(80) })).mutation(({ ctx, input }) => deleteAdminLenderReserve(ctx.user!.id, input.reserveId)),
    // Publish the six example auctions and four lender reserves on demand. Idempotent:
    // an example already on the desk is skipped, so it is safe to run repeatedly.
    seedLendingExamples: adminProcedure.mutation(({ ctx }) => seedExampleLendingDesk(ctx.user!.id)),
    lendingLoansForSettlement: adminProcedure.query(() => listLendingLoansForSettlement()),
    lendingLoanBids: adminProcedure.input(z.object({ loanId: z.string().trim().min(1).max(80) })).query(({ input }) => listLendingLoanBids(input.loanId)),
    disburseLendingLoan: adminProcedure.input(z.object({
      loanId: z.string().trim().min(1).max(80),
      reason: z.string().trim().max(500).optional(),
      idempotencyKey: z.string().min(8).max(160),
    })).mutation(({ ctx, input }) => disburseLendingLoan(ctx.user!.id, input)),
    settleLendingLoan: adminProcedure.input(z.object({
      loanId: z.string().trim().min(1).max(80),
      outcome: lendingEnum(LENDING_OUTCOMES),
      reason: z.string().trim().max(500).optional(),
      idempotencyKey: z.string().min(8).max(160),
    })).mutation(({ ctx, input }) => settleLendingLoan(ctx.user!.id, input)),
    createCustomer: adminProcedure.input(z.object({ name: z.string().min(2).max(160), email: z.string().email(), password: z.string().min(10).max(200) })).mutation(({ input }) => createAdminCustomer(input)),
    updateCustomer: adminProcedure.input(z.object({ id: z.number().int().positive(), name: z.string().min(2).max(160), email: z.string().email() })).mutation(({ input }) => updateAdminCustomer(input)),
    deleteCustomer: adminProcedure.input(z.object({ userId: z.number().int().positive() })).mutation(async ({ input }) => {
      try {
        return await deleteAdminCustomer(input.userId);
      } catch (error) {
        if (error instanceof AccountClosureDecisionError) throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
        throw error;
      }
    }),
    updateCustomerControls: adminProcedure.input(z.object({ userId: z.number().int().positive(), accountStatus: z.enum(["active","suspended","restricted"]).optional(), withdrawalsEnabled: z.boolean().optional(), kycRequired: z.boolean().optional(), twoFactorRequired: z.boolean().optional(), emailVerified: z.boolean().optional(), riskTier: z.string().min(1).max(24).optional(), adminNote: z.string().max(2000).optional(), companyCountryRestrictions: z.array(z.string().trim().min(1).max(100)).max(100).optional() })).mutation(({ ctx, input }) => updateCustomerControls(ctx.user.id, input)),
    adjustCustomerBalance: adminProcedure.input(z.object({
      userId: z.number().int().positive(),
      currency: z.string().min(2).max(32),
      amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      mode: z.enum(["credit","debit"]),
      creditClassification: z.enum(["qualifying_deposit","non_qualifying_credit"]).optional(),
      debitClassification: z.enum(["ordinary_debit","qualifying_deposit_reversal"]).optional(),
      reversalLedgerId: z.number().int().positive().optional(),
      reason: z.string().trim().min(3).max(500),
      idempotencyKey: z.string().trim().regex(/^[A-Za-z0-9._:-]{8,160}$/),
    }).strict()
      .refine(input => input.mode !== "credit" || Boolean(input.creditClassification), {
        message: "Choose whether this manual credit is a qualifying deposit or a non-qualifying credit.",
        path: ["creditClassification"],
      })
      .refine(input => input.mode !== "debit" || Boolean(input.debitClassification), {
        message: "Choose whether this debit is ordinary or reverses a qualifying deposit.",
        path: ["debitClassification"],
      })
      .refine(input => input.mode !== "debit" || input.debitClassification !== "qualifying_deposit_reversal" || Boolean(input.reversalLedgerId), {
        message: "Select the original qualifying deposit ledger ID to reverse.",
        path: ["reversalLedgerId"],
      })).mutation(async ({ ctx, input }) => {
      const result=await adjustCustomerBalance(ctx.user.id, input);
      if(!result.idempotentReplay) await recordTransactionConsoleEvent(ctx.user.id,ctx.req,{
        eventType:`ADMIN_${input.mode.toUpperCase()}`,status:"COMPLETED",
        title:`Wallet ${input.mode} transaction completed`,
        message:`${input.currency} wallet adjustment was committed to the ledger for account ${input.userId}.`,
        amountMinor:input.amountMinor,asset:input.currency,
        metadata:{targetUserId:input.userId,reason:input.reason,creditClassification:input.creditClassification,debitClassification:input.debitClassification,reversalLedgerId:input.reversalLedgerId,qualifyingDepositReversalOfId:result.qualifyingDepositReversalOfId,ledgerId:result.ledgerId,entryType:result.entryType,rateUsd:result.rateUsd,amountUsd:result.amountUsd,rateUpdatedAt:result.rateUpdatedAt,qualifyingDepositRateProvider:result.qualifyingDepositRateProvider},
      });
      return result;
    }),
    settings: adminProcedure.query(async () => ({ sounds: await (async () => { const raw = await getAppSetting("sound.settings"); try { return JSON.parse(raw || "{}"); } catch { return {}; } })(), ticket: await getTicketUploadPolicy(), email: { provider: await getAppSetting("email.provider"), fromName: await getAppSetting("email.fromName"), fromAddress: await getAppSetting("email.fromAddress"), replyTo: await getAppSetting("email.replyTo", "") }, opportunity: { countdownSeconds: Number(await getAppSetting("opportunity.countdownSeconds")), signupCreditMinor: Number(await getAppSetting("signup.autoCreditMinor")), signupCreditCurrency: await getAppSetting("signup.autoCreditCurrency") }, policy: await (async()=>{ try{const stored=JSON.parse((await getAppSetting("policy.defaults"))||"{}")||{};return {...stored,withdrawals:true};}catch{return {withdrawals:true}} })(), branding: await (async()=>{ try{return JSON.parse((await getAppSetting("branding.settings"))||"{}")}catch{return {}} })(), appearance: await normalizeAppearanceSettings(await getAppSetting("appearance.settings")), trade: await getTradeSettlementPolicy() })),
    updateSettings: adminProcedure.input(z.object({ ticket: z.object({ maxAttachmentMb: z.number().int().min(1).max(100), allowedMimeTypes: z.array(z.string().min(1).max(120)).min(1).max(50) }).optional(), email: z.object({ provider: z.enum(["smtp", "sendgrid", "disabled"]), fromName: z.string().min(1).max(120), fromAddress: z.string().email(), replyTo: z.string().email().or(z.literal("")) }).optional(), opportunity: z.object({ countdownSeconds: z.number().int().min(10).max(86400), signupCreditMinor: z.number().int().min(0).max(100000000), signupCreditCurrency: z.enum(["USD","EUR","GBP","BTC","ETH"]) }).optional(), sounds: z.object({ default: z.string().min(1).max(80), opportunity: z.string().min(1).max(80), deposit: z.string().min(1).max(80), credit: z.string().min(1).max(80), debit: z.string().min(1).max(80), withdrawal: z.string().min(1).max(80), trading: z.string().min(1).max(80), mining: z.string().min(1).max(80), support: z.string().min(1).max(80), announcement: z.string().min(1).max(80), failure: z.string().min(1).max(80), enabled: z.boolean(), loopOpportunity: z.boolean(), volume: z.number().int().min(0).max(100).default(80) }).optional(), policy: z.object({ kyc: z.boolean(), withdrawals: z.boolean(), twofa: z.boolean(), facial: z.boolean() }).optional(), branding: z.record(z.string(), z.string()).optional(), appearance: z.object({ defaultTheme: z.enum(["original","midnight-premium","clean-light","emerald-finance","aurora-modern","gold-luxe"]), enabledThemes: z.array(z.enum(["original","midnight-premium","clean-light","emerald-finance","aurora-modern","gold-luxe"])).min(1).max(6), customerCanSelect: z.boolean() }).optional(), trade: z.object({ settlementDelaySeconds: z.number().int().min(0).max(604800), creditDelaySeconds: z.number().int().min(0).max(604800), cooldownSeconds: z.number().int().min(0).max(604800), nextPopupFormulaDelaySeconds: z.number().int().min(0).max(604800), popupCooldownSeconds: z.number().int().min(0).max(604800), popupDisplaySeconds: z.number().int().min(1).max(3600), popupPreAlertSeconds: z.number().int().min(0).max(3600), popupJitterSeconds: z.number().int().min(0).max(604800), popupMaxPerHour: z.number().int().min(1).max(10000), marketRefreshIntervalMinutes: z.number().int().min(1).max(10080), blockUntilSettled: z.boolean(), reason: z.string().trim().min(5).max(500), expectedPolicyVersion: z.number().int().min(1) }).optional() }).refine((sections) => !sections.trade || Object.entries(sections).every(([key, value]) => key === "trade" || value === undefined), { message: "Trade timing settings must be saved on their own." })).mutation(async ({ ctx, input }) => { if (input.appearance && !input.appearance.enabledThemes.includes(input.appearance.defaultTheme)) throw new TRPCError({ code: "BAD_REQUEST", message: "The default theme must be enabled." }); if (input.ticket) { await setAppSetting("ticket.maxAttachmentMb", String(input.ticket.maxAttachmentMb), ctx.user.id); await setAppSetting("ticket.allowedMimeTypes", input.ticket.allowedMimeTypes.join(","), ctx.user.id); } if (input.email) { await setAppSetting("email.provider", input.email.provider, ctx.user.id); await setAppSetting("email.fromName", input.email.fromName, ctx.user.id); await setAppSetting("email.fromAddress", input.email.fromAddress, ctx.user.id); await setAppSetting("email.replyTo", input.email.replyTo, ctx.user.id); } if (input.sounds) { await setAppSetting("sound.settings", JSON.stringify(input.sounds), ctx.user.id); } if (input.policy) await setAppSetting("policy.defaults", JSON.stringify({ ...input.policy, withdrawals: true }), ctx.user.id); if (input.branding) await setAppSetting("branding.settings", JSON.stringify(input.branding), ctx.user.id); if (input.appearance) { await setAppSetting("appearance.settings", JSON.stringify(input.appearance), ctx.user.id); } if (input.trade) { try { await setTradeSettlementPolicy({delaySeconds:input.trade.settlementDelaySeconds,creditDelaySeconds:input.trade.creditDelaySeconds,cooldownSeconds:input.trade.cooldownSeconds,nextPopupFormulaDelaySeconds:input.trade.nextPopupFormulaDelaySeconds,popupCooldownSeconds:input.trade.popupCooldownSeconds,popupDisplaySeconds:input.trade.popupDisplaySeconds,popupPreAlertSeconds:input.trade.popupPreAlertSeconds,popupJitterSeconds:input.trade.popupJitterSeconds,popupMaxPerHour:input.trade.popupMaxPerHour,marketRefreshIntervalMinutes:input.trade.marketRefreshIntervalMinutes,blockUntilSettled:input.trade.blockUntilSettled}, ctx.user.id, input.trade.reason, input.trade.expectedPolicyVersion); } catch (error) { if (error instanceof TradeTimingPolicyVersionConflictError) throw new TRPCError({ code: "CONFLICT", message: error.message }); throw error; } } if (input.opportunity) { await setAppSetting("opportunity.countdownSeconds", String(input.opportunity.countdownSeconds), ctx.user.id); await setAppSetting("signup.autoCreditMinor", String(input.opportunity.signupCreditMinor), ctx.user.id); await setAppSetting("signup.autoCreditCurrency", input.opportunity.signupCreditCurrency, ctx.user.id); } return { success: true }; }),
    offers: adminProcedure.query(() => listOpenOffers()),
    opportunityGenerationTemplates: adminProcedure.query(() => listOpportunityGenerationTemplates()),
    opportunityGenerationMonitor: adminProcedure.query(() => getOpportunityGenerationMonitor()),
    opportunityGenerationControl: adminProcedure.query(() => getOpportunityGenerationControl()),
    saveOpportunityGenerationTemplate: adminProcedure.input(z.object({
      id: z.number().int().positive().safe().optional(), expectedVersion: z.number().int().positive().optional(),
      action: z.enum(["draft","approve","disable","archive"]), reason: z.string().trim().min(5).max(500),
      template: z.object({
        templateName: z.string().trim().min(1).max(120), companyReferenceId: z.string().regex(/^logo-brand-\d{4}$/),
        symbol: z.string().trim().min(1).max(40), venueFrom: z.string().trim().min(1).max(80), venueTo: z.string().trim().min(1).max(80),
        currency: z.enum(["USD","EUR","GBP","BTC","ETH"]), minimumMinor: z.number().int().positive().safe(),
        sourceReference: z.string().trim().min(1).max(160), reviewNotes: z.string().trim().min(1).max(2000),
      }).strict(),
    }).strict().refine(value=>value.id===undefined||value.expectedVersion!==undefined,{message:"Editing an existing template requires its expected version."}))
      .mutation(({ctx,input})=>saveOpportunityGenerationTemplate(ctx.user.id,input)),
    updateOpportunityGenerationControl: adminProcedure.input(z.object({
      enabled:z.boolean(), reason:z.string().trim().min(5).max(500), expectedVersion:z.number().int().min(0),
    }).strict()).mutation(async ({ctx,input})=>{
      try{return await setOpportunityGenerationControl(input,ctx.user.id);}
      catch(error){if(error instanceof OpportunityGenerationControlVersionConflictError)throw new TRPCError({code:"CONFLICT",message:error.message});throw error;}
    }),
    packagePolicies: adminProcedure.query(() => listPersistedOpportunityPackagePolicies()),
    overviewPackagePolicies: adminProcedure.query(() => listPersistedOpportunityPackagePolicies()),
    popupLifecycleSummary: adminProcedure.query(() => getOpportunityLifecycleSummary()),
    opportunityDeliveryRecords: adminProcedure.input(z.object({
      filters: opportunityDeliveryFiltersSchema,
      page: z.number().int().min(1).max(10_000),
      pageSize: z.number().int().min(1).max(100),
    }).strict()).query(({ input }) => listOpportunityDeliveryRecords({ ...input, includeHistory: true })),
    opportunityDeliveryDetails: adminProcedure.input(z.object({ customerId: z.number().int().positive().max(2_147_483_647), offerId: z.number().int().positive().max(2_147_483_647) }).strict())
      .query(({ input }) => getOpportunityDeliveryDetails(input.customerId, input.offerId)),
    opportunityDeliveryCustomerSearch: adminProcedure.input(z.object({ query: z.string().trim().min(2).max(100) }).strict())
      .query(({ input }) => searchOpportunityDeliveryCustomers(input.query)),
    opportunityDeliveryCustomer: adminProcedure.input(z.object({ customerId: z.number().int().positive().max(2_147_483_647) }).strict())
      .query(({ input }) => getOpportunityDeliveryCustomer(input.customerId)),
    opportunityDeliveryQueueDiagnostics: adminProcedure.query(() => getOpportunityDeliveryQueueDiagnostics()),
    exportOpportunityDeliveryRecords: adminProcedure.input(z.object({
      filters: opportunityDeliveryFiltersSchema,
      maxRows: z.number().int().min(1).max(10_000).default(10_000),
    }).strict()).query(({ input }) => exportOpportunityDeliveryRecords(input.filters, input.maxRows)),
    runPopupRetention: adminProcedure.mutation(() => runOpportunityRetention()),
    visitorAnalytics: adminProcedure.input(z.object({
      days: z.number().int().min(1).max(180).optional(),
      countryLimit: z.number().int().min(1).max(50).optional(),
    }).strict().optional()).query(({ input }) => getVisitorAnalyticsReport(input?.days ?? 30, input?.countryLimit ?? 12)),
    updatePackagePolicies: adminProcedure.input(z.object({
      reason: z.string().trim().min(5).max(500),
      policies: z.array(z.object({
        packageName: z.string().trim().min(1).max(80),
        // All policy fields are patchable; omitted fields are merged from the
        // locked current row so stale browser snapshots cannot overwrite them.
        maxPopupsPerDay: z.number().int().min(1).max(1000).optional(),
        maxVisibleOffers: z.number().int().min(1).max(10000).optional(),
        minimumTradeUnits: z.number().int().min(1).max(2147483647).optional(),
        maximumTradeUnits: z.number().int().min(1).max(2147483647).optional(),
        minHourlyTarget: z.number().int().min(0).max(100).optional(),
        normalHourlyTarget: z.number().int().min(0).max(100).optional(),
        marketInfluenceBps: z.number().int().min(0).max(10000).optional(),
        maxBurstSize: z.number().int().min(0).max(100).optional(),
        dailyPopupTarget: z.number().int().min(0).max(10000).optional(),
        schedulingPeriod: z.enum(["rolling_24h","calendar_day"]).optional(),
        minIntervalSeconds: z.number().int().min(0).max(604800).optional(),
        maxIntervalSeconds: z.number().int().min(0).max(604800).optional(),
        completionDisplaySeconds: z.number().int().min(1).max(3600).optional(),
        postCompletionIntervalSeconds: z.number().int().min(0).max(604800).optional(),
        maxPendingDeliveries: z.number().int().min(0).max(1000).optional(),
        maxTradeAttemptsPerDay: z.number().int().min(0).max(10000).optional(),
        tradeRetryDelaySeconds: z.number().int().min(5).max(3600).optional(),
        maxSuccessfulTradesPerDay: z.number().int().min(0).max(10000).optional(),
        maxConcurrentActiveTrades: z.number().int().min(1).max(1000).optional(),
        minSettlementDelaySeconds: z.number().int().min(0).max(604800).optional(),
        maxSettlementDelaySeconds: z.number().int().min(0).max(604800).optional(),
        minimumRewardBps: z.number().int().min(0).max(10000).optional(),
        maxDailyRewardMinor: z.number().int().min(0).max(2147483647).optional(),
        maxRewardPerTradeMinor: z.number().int().min(0).max(2147483647).optional(),
        badgeLabel: z.string().trim().max(40).nullable().optional(),
        badgeStyle: z.enum(["neutral","blue","purple","gold","green"]).optional(),
        minimumPayoutRateBps: z.number().int().min(0).max(5000).nullable().optional(),
        maximumPayoutRateBps: z.number().int().min(0).max(5000).nullable().optional(),
        minimumTradeDurationSeconds: z.number().int().min(10).max(86400).nullable().optional(),
        maximumTradeDurationSeconds: z.number().int().min(10).max(86400).nullable().optional(),
        companyRotationCountryNames: z.string().trim().max(2000).optional(),
        companyRotationRepeatPolicy: z.enum(["avoid_until_exhausted","allow_repeats"]).optional(),
        closePolicy: z.enum(["after_completion","after_final_display"]).optional(),
      }).strict()).min(1).max(1000),
    })).mutation(({ ctx, input }) => updateOpportunityPackagePolicies(ctx.user.id, input.policies, input.reason)),
    createOffer: adminProcedure.input(z.unknown()).mutation(() => { throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Manual opportunity publication is retired. Customer-specific opportunities are generated automatically from the approved company catalogue; saved company templates are optional display-term enrichment." }); }),
    bulkCreateOffers: adminProcedure.input(z.unknown()).mutation(() => { throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Manual opportunity CSV import is retired. Customer offers are generated from the approved company catalogue and saved qualifying-package policy; a company template is not required." }); }),
    closeOffer: adminProcedure.input(z.object({ offerId: z.number().int().positive().safe(), reason: z.string().trim().min(1).max(2000) })).mutation(({ ctx, input }) => closeOpportunityOffer(ctx.user.id, input)),
    tickets: adminProcedure.query(() => listAllTickets()),
    supportAssignees: adminProcedure.query(() => listSupportAssignees()),
    assignTicket: adminProcedure.input(z.object({ ticketId: z.number().int().positive(), assignedAdminId: z.number().int().positive().nullable() })).mutation(({ ctx, input }) => assignSupportTicket(ctx.user.id, input.ticketId, input.assignedAdminId)),
    ticketMessages: adminProcedure.input(z.object({ ticketId: z.number().int().positive() })).query(({ input }) => listTicketMessages(input.ticketId)),
    ticketAttachments: adminProcedure.input(z.object({ ticketId: z.number().int().positive() })).query(async ({ input }) => { if (!(await getSupportTicketById(input.ticketId))) throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found" }); return listTicketAttachments(input.ticketId); }),
    decideAccountClosure: adminProcedure.input(z.object({
      ticketId: z.number().int().positive(),
      decision: z.enum(["approve", "reject"]),
      reason: z.string().trim().min(10, "Enter a review reason of at least 10 characters.").max(2000),
    })).mutation(async ({ ctx, input }) => {
      try {
        const result = await applyAccountClosureDecision(ctx.user.id, input);
        if (result.decision === "reject") {
          try {
            await createNotification(result.customerId, "Account closure request reviewed", `${result.ticketNumber}: The administration team declined this closure request. Please open the ticket to read the review note.`, {
              eventKey: `account-closure-decision:${result.ticketId}:rejected`, category: "support", priority: "high",
            });
          } catch (error) {
            console.error("[AccountClosure] Rejection notice failed after decision:", error instanceof Error ? error.name : "UnknownError");
          }
        }
        return result;
      } catch (error) {
        if (error instanceof AccountClosureDecisionError) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
        }
        throw error;
      }
    }),
    replyTicket: adminProcedure.input(z.object({ ticketId: z.number().int().positive(), body: z.string().trim().min(1).max(20000), status: z.enum(["answered", "resolved", "closed"]) })).mutation(async ({ ctx, input }) => { const ticket=await getSupportTicketById(input.ticketId); if(!ticket) throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found" }); if(ticket.subject === ACCOUNT_CLOSURE_TICKET_SUBJECT) throw new TRPCError({code:"BAD_REQUEST",message:"Use the explicit account-closure decision controls for this request."}); await addTicketMessage(ctx.user.id,input.ticketId,input.body,input.status); return { success:true }; }),
    reopenTicket: adminProcedure.input(z.object({ ticketId: z.number().int().positive() })).mutation(async ({ ctx, input }) => { const ticket=await getSupportTicketById(input.ticketId); if(ticket?.subject === ACCOUNT_CLOSURE_TICKET_SUBJECT) throw new TRPCError({code:"BAD_REQUEST",message:"Account-closure requests cannot be reopened from generic support controls."}); return reopenSupportTicket(ctx.user.id,input.ticketId); }),
    apiAccess: router({
      overview: adminProcedure.query(() => getAdminApiOverview()),
      customerOptions: adminProcedure.input(z.object({ query: z.string().trim().max(160).optional() }).optional()).query(({ input }) => listAdminApiCustomerOptions(input ?? {})),
      keys: adminProcedure.input(z.object({
        query: z.string().trim().max(160).optional(),
        status: z.enum(["active", "revoked"]).optional(),
        userId: z.number().int().positive().optional(),
        page: z.number().int().min(1).max(10_000).optional(),
        pageSize: z.number().int().min(1).max(100).optional(),
      }).optional()).query(({ input }) => listAdminApiKeys(input ?? {})),
      createKey: adminProcedure.input(z.object({
        userId: z.number().int().positive(),
        name: z.string().trim().min(2).max(64),
        scopes: z.array(z.string().trim().min(1)).min(1),
        environment: z.enum(["live", "test"]).optional(),
        ipAllowlist: z.array(z.string().trim().min(1)).max(50).optional(),
        rateLimitPerMinute: z.number().int().min(1).max(100_000).optional(),
        reason: z.string().trim().min(5).max(500),
      })).mutation(({ ctx, input }) => runApiAccessAction(() => createAdminApiKey(ctx.user.id, input))),
      updateKey: adminProcedure.input(z.object({
        keyId: z.number().int().positive(),
        name: z.string().trim().min(2).max(64).optional(),
        scopes: z.array(z.string().trim().min(1)).min(1).optional(),
        ipAllowlist: z.array(z.string().trim().min(1)).max(50).optional(),
        rateLimitPerMinute: z.number().int().min(1).max(100_000).nullable().optional(),
        status: z.enum(["active", "revoked"]).optional(),
        reason: z.string().trim().min(5).max(500),
      })).mutation(({ ctx, input }) => runApiAccessAction(() => updateAdminApiKey(ctx.user.id, input))),
      revokeKey: adminProcedure.input(z.object({
        keyId: z.number().int().positive(),
        reason: z.string().trim().min(5).max(500),
      })).mutation(({ ctx, input }) => runApiAccessAction(() => revokeAdminApiKey(ctx.user.id, input.keyId, input.reason))),
      requests: adminProcedure.input(z.object({
        apiKeyId: z.number().int().positive().optional(),
        userId: z.number().int().positive().optional(),
        page: z.number().int().min(1).max(10_000).optional(),
        pageSize: z.number().int().min(1).max(100).optional(),
      }).optional()).query(({ input }) => listAdminApiRequests(input ?? {})),
      deliveries: adminProcedure.input(z.object({
        page: z.number().int().min(1).max(10_000).optional(),
        pageSize: z.number().int().min(1).max(100).optional(),
      }).optional()).query(({ input }) => listAdminApiWebhookDeliveries(input ?? {})),
      settings: adminProcedure.input(z.object({ userId: z.number().int().positive() })).query(({ input }) => getCustomerApiSettings(input.userId)),
      updateSettings: adminProcedure.input(z.object({
        userId: z.number().int().positive(),
        apiEnabled: z.boolean().optional(),
        defaultRateLimitPerMinute: z.number().int().min(1).max(100_000).nullable().optional(),
        allowedScopes: z.array(z.string().trim().min(1)).min(1).nullable().optional(),
        reason: z.string().trim().min(5).max(500),
      })).mutation(({ ctx, input }) => runApiAccessAction(() => updateCustomerApiSettings(ctx.user.id, input.userId, input))),
    }),
  }),

  // TODO: add feature routers here, e.g.
  // todo: router({
  //   list: protectedProcedure.query(({ ctx }) =>
  //     db.getUserTodos(ctx.user.id)
  //   ),
  // }),
});

export type AppRouter = typeof appRouter;
