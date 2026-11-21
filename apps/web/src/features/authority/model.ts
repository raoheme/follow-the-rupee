import { z } from "zod";
import { ISSUE_STATUSES } from "../../components/status";
import { DLP_STATUSES, JURISDICTION_STATUSES, WORK_STATUSES } from "../dossier/model";

/**
 * Response models for the four P6 operations (`getAuthorityDashboard`, `listDlpExceptions`, `resolveJurisdiction`,
 * `linkWork`) and the part of `getKundali` the authority pages need. Only fields a P6 page shows are declared; missing or
 * mistyped ones fail the parse, so a drifting server is reported honestly instead of rendered half-wrong. The DLP status is
 * always the server's derived value for the request's one evaluation instant (never recomputed in the browser).
 */
const synId = z.string().regex(/^SYN-DEMO-[A-Z0-9][A-Z0-9-]*$/);
const paise = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const envelope = <S extends z.ZodTypeAny>(data: S) => z.object({ data, correlationId: z.string().min(1) });

export const dashboardSchema = z.object({
  asOf: z.string(),
  openIssueCount: z.number().int().min(0),
  awaitingVerificationIssueIds: z.array(synId),
  uncertainJurisdictionIssueIds: z.array(synId),
  dlpExceptionIssueIds: z.array(synId),
  traceabilityGapBudgetIds: z.array(synId),
});
export type Dashboard = z.infer<typeof dashboardSchema>;
export const dashboardResultSchema = envelope(dashboardSchema);

export const dlpExceptionItemSchema = z.object({
  issueId: synId,
  candidateWorkOrderId: synId,
  dlpStatus: z.object({
    status: z.enum(DLP_STATUSES),
    dlpStartsOn: z.string(),
    dlpEndsAt: z.string(),
    evaluatedAt: z.string(),
    explanation: z.string(),
  }),
  warrantyPathNote: z.string(),
  potentialSpendLabel: z.literal("SYNTHETIC_POTENTIAL_NOT_REALIZED_SAVINGS"),
  syntheticFreshRepairEstimatePaise: paise,
});
export type DlpExceptionItem = z.infer<typeof dlpExceptionItemSchema>;
export const dlpExceptionListResultSchema = envelope(z.object({ items: z.array(dlpExceptionItemSchema) }));

export const jurisdictionSchema = z.object({
  id: synId,
  recordVersion: z.number().int().min(1),
  updatedAt: z.string(),
  issueId: synId,
  status: z.enum(JURISDICTION_STATUSES),
  spatialMatchMethod: z.enum(["ST_COVERS", "ST_INTERSECTS", "NONE"]),
  distanceToBoundaryMeters: z.number().nullable(),
  candidateWardId: synId.nullable(),
  externalAgencyLabel: z.string().nullable(),
  confirmationBasis: z.string().nullable(),
  sourceConflictNote: z.string().nullable(),
  legalOwnershipAsserted: z.literal(false),
  confidenceNote: z.string(),
  establishedAt: z.string(),
});
export type JurisdictionRecord = z.infer<typeof jurisdictionSchema>;
export const jurisdictionResultSchema = envelope(jurisdictionSchema);

/** The `linkWork` answer is the updated issue; only the fields the page confirms are declared. */
export const linkedIssueResultSchema = envelope(
  z.object({
    id: synId,
    recordVersion: z.number().int().min(1),
    status: z.enum(ISSUE_STATUSES),
    workOrderId: synId.nullable(),
    assetId: synId.nullable(),
  }),
);
export type LinkedIssue = z.infer<typeof linkedIssueResultSchema>["data"];

/** The slice of the Kundali PAGE-09 needs: the issue with its `recordVersion`, the jurisdiction record and the linked work. */
export const authorityKundaliSchema = z.object({
  issue: z.object({
    id: synId,
    recordVersion: z.number().int().min(1),
    title: z.string(),
    category: z.string(),
    status: z.enum(ISSUE_STATUSES),
    publicStatusExplanation: z.string(),
    reportedAt: z.string(),
    streetName: z.string(),
    nearbyLandmark: z.string(),
    assetId: synId.nullable(),
    workOrderId: synId.nullable(),
    wardCandidateId: synId.nullable(),
    responsiblePostTitle: z.string(),
    escalationPostTitle: z.string(),
  }),
  ward: z.object({ id: synId, code: z.string(), displayName: z.string() }).nullable(),
  asset: z.object({ id: synId, displayName: z.string(), streetName: z.string() }).nullable(),
  responsibleDepartment: z.object({ id: synId, displayName: z.string() }),
  jurisdiction: jurisdictionSchema,
  workOrder: z
    .object({ id: synId, displayTitle: z.string(), status: z.enum(WORK_STATUSES), dlpEndsAt: z.string() })
    .nullable(),
  dlpStatus: z
    .object({
      status: z.enum(DLP_STATUSES),
      evaluatedAt: z.string(),
      dlpEndsAt: z.string(),
      warrantyPathNote: z.string(),
    })
    .nullable(),
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
export type AuthorityKundali = z.infer<typeof authorityKundaliSchema>;
export const authorityKundaliResultSchema = envelope(authorityKundaliSchema);
