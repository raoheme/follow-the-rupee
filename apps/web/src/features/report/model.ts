import { z } from "zod";
import { ISSUE_STATUSES } from "../../components/status";
import { geometrySchema, ISSUE_CATEGORIES } from "../map-list/model";

/**
 * Response models for the three P5 operations (`submitIssue`, `checkDuplicates`, `addEvidence`). Only the fields PAGE-04,
 * PAGE-05 and PAGE-06 show are declared; unknown members are ignored and missing or mistyped ones fail the parse, so a
 * drifting server is reported honestly instead of rendered half-wrong.
 *
 * Nothing here scores, ranks or re-derives a duplicate result: the score, band and factor points are exactly what the API
 * returned, and the browser holds no copy of the policy weights, radii, windows or thresholds.
 */
const synId = z.string().regex(/^SYN-DEMO-[A-Z0-9][A-Z0-9-]*$/);

export const DUPLICATE_CHOICES = ["ENDORSE_EXISTING", "ADD_EVIDENCE_TO_EXISTING", "CREATE_SEPARATE_ISSUE"] as const;
export type DuplicateChoice = (typeof DUPLICATE_CHOICES)[number];

export const DUPLICATE_BANDS = ["LIKELY_SAME", "POSSIBLE_MATCH", "PROBABLY_DISTINCT"] as const;
export type DuplicateBand = (typeof DUPLICATE_BANDS)[number];

/** The five factor keys of the contract's `DuplicateScoreBreakdown`, in the order they are explained. */
export const FACTOR_KEYS = [
  "sameAssetOrSegment",
  "sameCategory",
  "withinConfiguredRadius",
  "withinConfiguredWindow",
  "keywordOverlap",
] as const;
export type FactorKey = (typeof FACTOR_KEYS)[number];

export const createdIssueSchema = z.object({
  id: synId,
  recordNature: z.literal("SYNTHETIC_DEMONSTRATION"),
  recordVersion: z.number().int().min(1),
  title: z.string(),
  publicDescription: z.string(),
  category: z.enum(ISSUE_CATEGORIES),
  status: z.enum(ISSUE_STATUSES),
  publicStatusExplanation: z.string(),
  reportedAt: z.string(),
  streetName: z.string(),
  nearbyLandmark: z.string(),
  geometry: geometrySchema,
  assetId: synId.nullable(),
  wardCandidateId: synId.nullable(),
  responsiblePostTitle: z.string(),
  escalationPostTitle: z.string(),
});
export type CreatedIssue = z.infer<typeof createdIssueSchema>;

export const submitIssueResultSchema = z.object({ data: createdIssueSchema, correlationId: z.string().min(1) });

const points = z.number().int().min(0).max(100);

export const duplicateCandidateSchema = z.object({
  issueId: synId,
  score: z.number().int().min(0).max(100),
  band: z.enum(DUPLICATE_BANDS),
  breakdown: z.object({
    sameAssetOrSegment: points,
    sameCategory: points,
    withinConfiguredRadius: points,
    withinConfiguredWindow: points,
    keywordOverlap: points,
  }),
  possibleRecurrence: z.boolean(),
});
export type DuplicateCandidate = z.infer<typeof duplicateCandidateSchema>;

export const duplicateCandidatesSchema = z.object({
  policyLabel: z.literal("DEMONSTRATION_HEURISTIC_V1"),
  choices: z.array(z.enum(DUPLICATE_CHOICES)).min(3),
  silentRejection: z.literal(false),
  candidates: z.array(duplicateCandidateSchema),
});
export type DuplicateCandidates = z.infer<typeof duplicateCandidatesSchema>;

export const duplicateCandidatesResultSchema = z.object({
  data: duplicateCandidatesSchema,
  correlationId: z.string().min(1),
});

export const evidenceRecordSchema = z.object({
  id: synId,
  recordVersion: z.number().int().min(1),
  issueId: synId,
  stage: z.enum(["BEFORE", "CLAIMED_AFTER", "DISPUTED_OR_RECURRING"]),
  caption: z.string(),
  confidence: z.enum(["CITIZEN_SUBMITTED", "AUTHORITY_SUBMITTED", "INDEPENDENTLY_VERIFIED"]),
  capturedAt: z.string(),
  locationConfidence: z.enum(["LOCATION_CONSISTENT", "LOCATION_UNVERIFIED", "LOCATION_INCONSISTENT"]),
  mediaStatus: z.literal("SYNTHETIC_FIXTURE_REFERENCE_ONLY"),
  mediaRef: z.string(),
  hashBasis: z.literal("FIXTURE_REFERENCE_STRING"),
  verificationState: z.enum(["NOT_VERIFIED", "CORROBORATED", "INDEPENDENTLY_VERIFIED"]),
  processingState: z.enum([
    "UPLOADED_QUARANTINE",
    "PROCESSING",
    "READY_FOR_REVIEW",
    "PROCESSING_FAILED",
    "MANUAL_REVIEW",
    "PUBLISHED_PUBLIC",
    "REJECTED",
  ]),
  caveat: z.string(),
});
export type EvidenceRecord = z.infer<typeof evidenceRecordSchema>;

export const evidenceResultSchema = z.object({ data: evidenceRecordSchema, correlationId: z.string().min(1) });

/** Persona values the committed ISSUE machine allows to submit (a presentation hint; the server enforces the rule). */
export const SUBMITTING_PERSONAS = ["citizen", "authority"] as const;
export function personaMaySubmit(persona: string): boolean {
  return (SUBMITTING_PERSONAS as readonly string[]).includes(persona);
}
