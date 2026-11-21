import { useMutation, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { useApiClient } from "../../api/ApiClientContext";
import type { ApiClient } from "../../api/client";
import { parseResult, type Geometry, type Parsed } from "../map-list/model";
import type { SubmitIssuePayload } from "./form";
import {
  duplicateCandidatesResultSchema,
  evidenceResultSchema,
  submitIssueResultSchema,
  createdIssueSchema,
  type CreatedIssue,
  type DuplicateCandidates,
  type DuplicateChoice,
  type EvidenceRecord,
} from "./model";

/**
 * The three P5 command calls. Each sends `{ recordVersion, payload }` with a correlation id and an Idempotency-Key. The key is
 * supplied by the caller and reused for a retry of the same request, so a retry after a network failure is an exact replay on
 * the server (the same committed record comes back) rather than a second mutation.
 */
export async function submitIssue(
  client: ApiClient,
  payload: SubmitIssuePayload,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<Parsed<CreatedIssue>> {
  const body = await client.command<unknown, SubmitIssuePayload>("/v1/issues", {
    recordVersion: 1,
    payload,
    idempotencyKey,
    signal,
  });
  const r = parseResult(submitIssueResultSchema, body);
  return { data: r.data, correlationId: r.correlationId };
}

export interface CheckPayload {
  category: string;
  geometry: Geometry;
  descriptionKeywords: readonly string[];
}

export async function checkDuplicates(
  client: ApiClient,
  issueId: string,
  recordVersion: number,
  payload: CheckPayload,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<Parsed<DuplicateCandidates>> {
  const body = await client.command<unknown, CheckPayload>(`/v1/issues/${issueId}/duplicate-candidates`, {
    recordVersion,
    payload,
    idempotencyKey,
    signal,
  });
  const r = parseResult(duplicateCandidatesResultSchema, body);
  return { data: r.data, correlationId: r.correlationId };
}

export interface EvidencePayload {
  stage: "BEFORE" | "DISPUTED_OR_RECURRING";
  caption: string;
  sourceType: "CITIZEN_FIXTURE";
  capturedAt: string;
  mediaRef: string;
  sha256: string;
  duplicateChoice: DuplicateChoice | null;
}

export async function addEvidence(
  client: ApiClient,
  issueId: string,
  recordVersion: number,
  payload: EvidencePayload,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<Parsed<EvidenceRecord>> {
  const body = await client.command<unknown, EvidencePayload>(`/v1/issues/${issueId}/evidence`, {
    recordVersion,
    payload,
    idempotencyKey,
    signal,
  });
  const r = parseResult(evidenceResultSchema, body);
  return { data: r.data, correlationId: r.correlationId };
}

export function useSubmitIssue() {
  const client = useApiClient();
  return useMutation({
    mutationFn: (v: { payload: SubmitIssuePayload; key: string }) => submitIssue(client, v.payload, v.key),
  });
}

export function useAddEvidence() {
  const client = useApiClient();
  return useMutation({
    mutationFn: (v: { issueId: string; recordVersion: number; payload: EvidencePayload; key: string }) =>
      addEvidence(client, v.issueId, v.recordVersion, v.payload, v.key),
  });
}

/**
 * Duplicate check as a query so PAGE-05 shows loading, error and retry states. The call is an idempotent POST: the
 * Idempotency-Key is created once per subject and held by the caller, so Retry replays the same request. `staleTime` is
 * infinite so returning to PAGE-05 with back/forward uses the cached answer instead of appending another audit event.
 */
export function useDuplicateCheck(
  subject: { issueId: string; recordVersion: number; payload: CheckPayload } | null,
  idempotencyKey: string,
) {
  const client = useApiClient();
  return useQuery({
    queryKey: ["duplicate-check", subject?.issueId ?? "", subject ? JSON.stringify(subject.payload) : ""],
    queryFn: ({ signal }) =>
      checkDuplicates(client, subject!.issueId, subject!.recordVersion, subject!.payload, idempotencyKey, signal),
    enabled: subject !== null,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 10 * 60_000,
    retry: false,
    // A failed check is retried only by the user pressing Retry, never silently on remount.
    retryOnMount: false,
  });
}

// ----------------------------------------------------------------------------------------------- honest refresh recovery

/**
 * The committed contract has no operation that re-reads a duplicate result or a recorded decision, so after a refresh the
 * pages re-read what the server does hold: the Kundali (`getKundali`) carries the issue, its evidence list and a bounded
 * audit preview. This schema keeps just the fields recovery needs, with the geometry and `recordVersion` PAGE-05 must resend.
 */
const synId = z.string().regex(/^SYN-DEMO-[A-Z0-9][A-Z0-9-]*$/);
const recoverySchema = z.object({
  data: z.object({
    issue: createdIssueSchema,
    evidence: z.array(z.object({ id: synId, stage: z.string(), caption: z.string(), processingState: z.string(), verificationState: z.string() })),
    auditEvents: z.array(z.object({ id: synId, sequence: z.number().int(), eventType: z.string(), summary: z.string(), occurredAt: z.string() })),
  }),
  correlationId: z.string().min(1),
});
export type RecoveredRecord = z.infer<typeof recoverySchema>["data"];

export async function fetchRecovered(client: ApiClient, id: string, signal?: AbortSignal): Promise<Parsed<RecoveredRecord>> {
  const r = parseResult(recoverySchema, await client.get<unknown>(`/v1/kundalis/${id}`, { signal }));
  return { data: r.data, correlationId: r.correlationId };
}

export function useRecoveredRecord(id: string | null) {
  const client = useApiClient();
  return useQuery({
    queryKey: ["p5-recovery", id ?? ""],
    queryFn: ({ signal }) => fetchRecovered(client, id!, signal),
    enabled: id !== null,
  });
}
