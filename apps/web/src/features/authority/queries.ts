import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useApiClient } from "../../api/ApiClientContext";
import type { ApiClient } from "../../api/client";
import { parseResult, type Parsed } from "../map-list/model";
import {
  authorityKundaliResultSchema,
  dashboardResultSchema,
  dlpExceptionListResultSchema,
  jurisdictionResultSchema,
  linkedIssueResultSchema,
  type AuthorityKundali,
  type Dashboard,
  type DlpExceptionItem,
  type JurisdictionRecord,
  type LinkedIssue,
} from "./model";
import type { LinkPayload, ResolvePayload } from "./present";

/**
 * Authority reads and the two P6 commands. Reads are keyed under `["authority", ...]` and run only when the simulated persona
 * is Authority, so another persona never produces a request that the server would answer 403. Commands send
 * `{ recordVersion, payload }` with a correlation id and an Idempotency-Key supplied by the caller: a retry of the same input
 * reuses the key (an exact replay on the server) and a changed input gets a new one.
 */
export const authorityKeys = {
  dashboard: ["authority", "dashboard"] as const,
  dlp: ["authority", "dlp-exceptions"] as const,
  kundali: (id: string) => ["kundali", id, "authority"] as const,
};

export async function fetchDashboard(client: ApiClient, signal?: AbortSignal): Promise<Parsed<Dashboard>> {
  const r = parseResult(dashboardResultSchema, await client.get<unknown>("/v1/authority/dashboard", { signal }));
  return { data: r.data, correlationId: r.correlationId };
}

export async function fetchDlpExceptions(
  client: ApiClient,
  signal?: AbortSignal,
): Promise<Parsed<readonly DlpExceptionItem[]>> {
  const r = parseResult(dlpExceptionListResultSchema, await client.get<unknown>("/v1/authority/dlp-exceptions", { signal }));
  return { data: r.data.items, correlationId: r.correlationId };
}

export async function fetchAuthorityKundali(
  client: ApiClient,
  id: string,
  signal?: AbortSignal,
): Promise<Parsed<AuthorityKundali>> {
  const r = parseResult(authorityKundaliResultSchema, await client.get<unknown>(`/v1/kundalis/${id}`, { signal }));
  return { data: r.data, correlationId: r.correlationId };
}

export function useDashboardQuery(enabled: boolean) {
  const client = useApiClient();
  return useQuery({
    queryKey: authorityKeys.dashboard,
    queryFn: ({ signal }) => fetchDashboard(client, signal),
    enabled,
  });
}

export function useDlpExceptionsQuery(enabled: boolean) {
  const client = useApiClient();
  return useQuery({
    queryKey: authorityKeys.dlp,
    queryFn: ({ signal }) => fetchDlpExceptions(client, signal),
    enabled,
  });
}

/** A public read (the Kundali) available to every persona; `id === null` disables it. */
export function useAuthorityKundaliQuery(id: string | null) {
  const client = useApiClient();
  return useQuery({
    queryKey: authorityKeys.kundali(id ?? ""),
    queryFn: ({ signal }) => fetchAuthorityKundali(client, id!, signal),
    enabled: id !== null,
  });
}

export async function resolveJurisdiction(
  client: ApiClient,
  issueId: string,
  recordVersion: number,
  payload: ResolvePayload,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<Parsed<JurisdictionRecord>> {
  const body = await client.command<unknown, ResolvePayload>(`/v1/authority/issues/${issueId}/jurisdiction`, {
    recordVersion,
    payload,
    ifMatch: true,
    idempotencyKey,
    signal,
  });
  const r = parseResult(jurisdictionResultSchema, body);
  return { data: r.data, correlationId: r.correlationId };
}

export async function linkWork(
  client: ApiClient,
  issueId: string,
  recordVersion: number,
  payload: LinkPayload,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<Parsed<LinkedIssue>> {
  const body = await client.command<unknown, LinkPayload>(`/v1/authority/issues/${issueId}/work-link`, {
    recordVersion,
    payload,
    idempotencyKey,
    signal,
  });
  const r = parseResult(linkedIssueResultSchema, body);
  return { data: r.data, correlationId: r.correlationId };
}

/** Everything a state change can make stale: the dossier, both lists, the map and the authority queues. */
export function invalidateAfterCommand(qc: QueryClient): Promise<unknown> {
  return Promise.all([
    qc.invalidateQueries({ queryKey: ["kundali"] }),
    qc.invalidateQueries({ queryKey: ["issues"] }),
    qc.invalidateQueries({ queryKey: ["map-features"] }),
    qc.invalidateQueries({ queryKey: ["authority"] }),
  ]);
}

export function useResolveJurisdiction() {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { issueId: string; recordVersion: number; payload: ResolvePayload; key: string }) =>
      resolveJurisdiction(client, v.issueId, v.recordVersion, v.payload, v.key),
    onSuccess: () => invalidateAfterCommand(qc),
  });
}

export function useLinkWork() {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { issueId: string; recordVersion: number; payload: LinkPayload; key: string }) =>
      linkWork(client, v.issueId, v.recordVersion, v.payload, v.key),
    onSuccess: () => invalidateAfterCommand(qc),
  });
}
