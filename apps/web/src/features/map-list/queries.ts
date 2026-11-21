import { QueryClient, useQuery } from "@tanstack/react-query";
import { useApiClient } from "../../api/ApiClientContext";
import type { ApiClient } from "../../api/client";
import { issuesQuery, mapQuery, type WorkspaceFilters } from "./filters";
import {
  issueListResultSchema,
  mapFeatureCollectionResultSchema,
  parseResult,
  type IssueSummary,
  type MapFeature,
  type Parsed,
} from "./model";

/** Live reads only: nothing is cached across reloads, retried silently or seeded with fabricated data. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 0, gcTime: 5 * 60_000 } },
  });
}

export const queryKeys = {
  issues: (f: WorkspaceFilters) => ["issues", issuesQuery(f)] as const,
  map: (f: WorkspaceFilters) => ["map-features", mapQuery(f)] as const,
};

export interface IssueListData {
  readonly items: readonly IssueSummary[];
  readonly total: number;
}

export async function fetchIssues(
  client: ApiClient,
  f: WorkspaceFilters,
  signal?: AbortSignal,
): Promise<Parsed<IssueListData>> {
  const body = await client.get<unknown>("/v1/issues", { query: issuesQuery(f), signal });
  const r = parseResult(issueListResultSchema, body);
  return { data: r.data, correlationId: r.correlationId };
}

export async function fetchMapFeatures(
  client: ApiClient,
  f: WorkspaceFilters,
  signal?: AbortSignal,
): Promise<Parsed<readonly MapFeature[]>> {
  const body = await client.get<unknown>("/v1/map/features", { query: mapQuery(f), signal });
  const r = parseResult(mapFeatureCollectionResultSchema, body);
  return { data: r.data.features, correlationId: r.correlationId };
}

export function useIssuesQuery(f: WorkspaceFilters) {
  const client = useApiClient();
  return useQuery({ queryKey: queryKeys.issues(f), queryFn: ({ signal }) => fetchIssues(client, f, signal) });
}

export function useMapFeaturesQuery(f: WorkspaceFilters) {
  const client = useApiClient();
  return useQuery({ queryKey: queryKeys.map(f), queryFn: ({ signal }) => fetchMapFeatures(client, f, signal) });
}
