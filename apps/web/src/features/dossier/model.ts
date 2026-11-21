import { z } from "zod";
import { ISSUE_STATUSES } from "../../components/status";
import { geometrySchema, ISSUE_CATEGORIES } from "../map-list/model";

/**
 * Response models for the three P4 read operations (`getKundali`, `getWorkOrder`, `getBudgetTrace`). Only fields a P4 page
 * actually shows are declared; unknown members are ignored and missing or mistyped ones fail the parse, so a drifting
 * server is reported honestly instead of rendered half-wrong. Money is integer paise only; DLP status is the server's
 * derived value (never recomputed in the browser).
 */
const synId = z.string().regex(/^SYN-DEMO-[A-Z0-9][A-Z0-9-]*$/);
const paise = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const tier = z.enum(["SYNTHETIC_DEMO", "COMMUNITY_REFERENCE", "OFFICIAL_SOURCE_PENDING"]);
const nullableId = synId.nullable();

export const DLP_STATUSES = ["NOT_STARTED", "ACTIVE", "EXPIRED"] as const;
export const TRACEABILITY = ["LINKED_TO_STREET", "GAP_BEFORE_STREET_GEOMETRY"] as const;
export const CHAIN_LINKS = ["BUDGET", "TENDER", "CONTRACT", "WORK_ORDER", "ASSET_GEOMETRY"] as const;
export const MISSING_LINKS = ["TENDER", "CONTRACT", "WORK_ORDER", "STREET_LEVEL_GEOMETRY"] as const;
export const EVIDENCE_STAGES = ["BEFORE", "CLAIMED_AFTER", "DISPUTED_OR_RECURRING"] as const;
export const JURISDICTION_STATUSES = [
  "UNKNOWN",
  "SPATIALLY_INFERRED_PROVISIONAL",
  "CONFIRMED_BMC_WARD",
  "EXTERNAL_AGENCY_ASSIGNED",
  "CONFLICT_DISPUTED",
  "HANDOFF_LOGGED",
] as const;
export const VERIFICATION_STATES = [
  "AWAITING_AUTHORITY_CLAIM",
  "WINDOW_OPEN",
  "CITIZEN_CONFIRMED",
  "CITIZEN_PARTLY_FIXED",
  "CITIZEN_DISPUTED",
  "WINDOW_EXPIRED_NO_VERDICT",
  "INDEPENDENT_REVIEW_PENDING",
  "INDEPENDENTLY_VERIFIED",
] as const;
export const WORK_STATUSES = [
  "BUDGETED_PROPOSED",
  "TENDER_PUBLISHED",
  "RETENDER_REQUIRED",
  "CONTRACT_AWARDED",
  "WORK_ORDER_ISSUED",
  "IN_EXECUTION",
  "SUSPENDED",
  "COMPLETION_CERTIFIED_IN_DLP",
  "DEFECT_NOTIFIED",
  "DLP_EXPIRED_ARCHIVED",
] as const;
export const TENDER_STATUSES = ["TENDER_PUBLISHED", "CONTRACT_AWARDED", "RETENDER_REQUIRED"] as const;
export const CONTRACT_STATUSES = ["AWARDED", "COMPLETED_IN_DLP"] as const;
export const EVIDENCE_SOURCES = ["CITIZEN_FIXTURE", "AUTHORITY_FIXTURE", "INDEPENDENT_FIXTURE"] as const;
export const EVIDENCE_VERIFICATION = ["NOT_VERIFIED", "CORROBORATED", "INDEPENDENTLY_VERIFIED"] as const;
export const LOCATION_CONFIDENCE = ["LOCATION_CONSISTENT", "LOCATION_UNVERIFIED", "LOCATION_INCONSISTENT"] as const;
export const ASSET_TYPES = ["ROAD_SEGMENT", "DRAIN_SEGMENT", "SCHOOL", "DISPENSARY"] as const;

const asset = z.object({
  id: synId,
  assetType: z.enum(ASSET_TYPES),
  displayName: z.string(),
  streetName: z.string(),
  corridorName: z.string().nullable(),
  nearbyLandmark: z.string(),
  geometry: geometrySchema,
});

const workOrder = z.object({
  id: synId,
  sourceTier: tier,
  displayTitle: z.string(),
  publicDescription: z.string(),
  contractId: synId,
  assetId: synId,
  valuePaise: paise,
  startedOn: z.string(),
  completionCertifiedOn: z.string().nullable(),
  dlpEndsAt: z.string(),
  status: z.enum(WORK_STATUSES),
});

const dlpStatus = z.object({
  id: synId,
  workOrderId: synId,
  status: z.enum(DLP_STATUSES),
  dlpStartsOn: z.string(),
  dlpEndsAt: z.string(),
  evaluatedAt: z.string(),
  explanation: z.string(),
  warrantyPathNote: z.string(),
  syntheticFreshRepairEstimatePaise: paise.nullable(),
  potentialSpendLabel: z.literal("SYNTHETIC_POTENTIAL_NOT_REALIZED_SAVINGS").nullable(),
});

const tender = z.object({
  id: synId,
  tenderReference: z.string(),
  title: z.string(),
  status: z.enum(TENDER_STATUSES),
  publishedOn: z.string(),
  estimatedValuePaise: paise,
  scopeSummary: z.string(),
  locationDescription: z.string(),
  streetGeometryAvailable: z.boolean(),
});

const contract = z.object({
  id: synId,
  displayTitle: z.string(),
  contractStatus: z.enum(CONTRACT_STATUSES),
  awardedOn: z.string(),
  valuePaise: paise,
  budgetId: synId,
  tenderId: synId,
});

const contractor = z.object({ id: synId, displayName: z.string(), syntheticNote: z.string() });

const budget = z.object({
  id: synId,
  displayTitle: z.string(),
  budgetBookName: z.string(),
  budgetHead: z.string(),
  amountPaise: paise,
  financialYear: z.string(),
});

export const budgetTraceSchema = z.object({
  budget,
  tender: tender.nullable(),
  contract: contract.nullable(),
  contractor: contractor.nullable(),
  workOrder: workOrder.nullable(),
  asset: asset.nullable(),
  traceabilityStatus: z.enum(TRACEABILITY),
  lastProvenLink: z.enum(CHAIN_LINKS),
  missingNextLink: z.enum(MISSING_LINKS).nullable(),
  explanation: z.string(),
});
export type BudgetTrace = z.infer<typeof budgetTraceSchema>;
export type DlpView = z.infer<typeof dlpStatus>;
export type WorkOrderRecord = z.infer<typeof workOrder>;

export const workOrderDetailSchema = z.object({
  workOrder,
  contract,
  contractor,
  asset,
  dlpStatus: dlpStatus.nullable(),
  linkedIssueIds: z.array(synId),
});
export type WorkOrderDetail = z.infer<typeof workOrderDetailSchema>;

const evidence = z.object({
  id: synId,
  stage: z.enum(EVIDENCE_STAGES),
  caption: z.string(),
  confidence: z.enum(["CITIZEN_SUBMITTED", "AUTHORITY_SUBMITTED", "INDEPENDENTLY_VERIFIED"]),
  sourceType: z.enum(EVIDENCE_SOURCES),
  capturedAt: z.string(),
  locationConfidence: z.enum(LOCATION_CONFIDENCE),
  distanceToAssetMeters: z.number().nullable(),
  sha256: z.string(),
  hashBasis: z.literal("FIXTURE_REFERENCE_STRING"),
  verificationState: z.enum(EVIDENCE_VERIFICATION),
  processingState: z.string(),
  caveat: z.string(),
});
export type EvidenceRecord = z.infer<typeof evidence>;

export const kundaliSchema = z.object({
  syntheticBanner: z.string(),
  canonicalDemoPath: z.string(),
  issue: z.object({
    id: synId,
    title: z.string(),
    publicDescription: z.string(),
    category: z.enum(ISSUE_CATEGORIES),
    status: z.enum(ISSUE_STATUSES),
    publicStatusExplanation: z.string(),
    reportedAt: z.string(),
    streetName: z.string(),
    nearbyLandmark: z.string(),
    assetId: nullableId,
    workOrderId: nullableId,
    wardCandidateId: nullableId,
    responsiblePostTitle: z.string(),
    escalationPostTitle: z.string(),
    parentRecurrenceId: nullableId.optional(),
  }),
  ward: z.object({ id: synId, code: z.string(), displayName: z.string(), localityLabel: z.string() }).nullable(),
  asset: asset.nullable(),
  responsibleDepartment: z.object({
    id: synId,
    kind: z.enum(["CENTRAL_DEPARTMENT", "WARD_OFFICE"]),
    displayName: z.string(),
    scopeSummary: z.string(),
  }),
  jurisdiction: z.object({
    id: synId,
    status: z.enum(JURISDICTION_STATUSES),
    externalAgencyLabel: z.string().nullable(),
    confirmationBasis: z.string().nullable(),
    sourceConflictNote: z.string().nullable(),
    legalOwnershipAsserted: z.literal(false),
    confidenceNote: z.string(),
  }),
  workOrder: workOrder.nullable(),
  dlpStatus: dlpStatus.nullable(),
  budgetTrace: budgetTraceSchema.nullable(),
  evidence: z.array(evidence),
  completionClaim: z
    .object({
      id: synId,
      claimedAt: z.string(),
      claimedByPostTitle: z.string(),
      atrSummary: z.string(),
      claimedAfterEvidenceId: synId,
      verificationWindowEndsAt: z.string(),
      claimNote: z.string(),
    })
    .nullable(),
  verification: z
    .object({
      id: synId,
      state: z.enum(VERIFICATION_STATES),
      windowOpensAt: z.string(),
      windowEndsAt: z.string(),
      citizenVerdict: z.enum(["FIXED", "PARTLY_FIXED", "STILL_UNRESOLVED"]).nullable(),
      verdictAt: z.string().nullable(),
      silenceNote: z.string(),
    })
    .nullable(),
  corrections: z.array(
    z.object({
      id: synId,
      fieldPath: z.string(),
      status: z.string(),
      reason: z.string(),
      submittedAt: z.string(),
      adjudicationNote: z.string().nullable(),
      priorValuePreserved: z.literal(true),
    }),
  ),
  auditEvents: z.array(
    z.object({
      id: synId,
      sequence: z.number().int().min(1),
      eventType: z.string(),
      actorRole: z.string(),
      occurredAt: z.string(),
      summary: z.string(),
    }),
  ),
});
export type Kundali = z.infer<typeof kundaliSchema>;

const envelope = <S extends z.ZodTypeAny>(data: S) => z.object({ data, correlationId: z.string().min(1) });
export const kundaliResultSchema = envelope(kundaliSchema);
export const workOrderDetailResultSchema = envelope(workOrderDetailSchema);
export const budgetTraceResultSchema = envelope(budgetTraceSchema);
