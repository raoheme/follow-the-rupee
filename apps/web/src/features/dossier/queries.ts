import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "../../api/ApiClientContext";
import type { ApiClient } from "../../api/client";
import { parseResult, type Parsed } from "../map-list/model";
import {
  budgetTraceResultSchema,
  kundaliResultSchema,
  workOrderDetailResultSchema,
  type BudgetTrace,
  type Kundali,
  type WorkOrderDetail,
} from "./model";

/** Detail reads are keyed by the validated identifier only: selecting the same record again is served without a duplicate request. */
export const dossierKeys = {
  kundali: (id: string) => ["kundali", id] as const,
  work: (id: string) => ["work-order", id] as const,
  trace: (id: string) => ["budget-trace", id] as const,
};

export async function fetchKundali(client: ApiClient, id: string, signal?: AbortSignal): Promise<Parsed<Kundali>> {
  const r = parseResult(kundaliResultSchema, await client.get<unknown>(`/v1/kundalis/${id}`, { signal }));
  return { data: r.data, correlationId: r.correlationId };
}

export async function fetchWorkOrder(client: ApiClient, id: string, signal?: AbortSignal): Promise<Parsed<WorkOrderDetail>> {
  const r = parseResult(workOrderDetailResultSchema, await client.get<unknown>(`/v1/works/${id}`, { signal }));
  return { data: r.data, correlationId: r.correlationId };
}

export async function fetchBudgetTrace(client: ApiClient, id: string, signal?: AbortSignal): Promise<Parsed<BudgetTrace>> {
  const r = parseResult(budgetTraceResultSchema, await client.get<unknown>(`/v1/budget-traces/${id}`, { signal }));
  return { data: r.data, correlationId: r.correlationId };
}

/** `id === null` disables the query: nothing is requested for an absent or malformed identifier. */
export function useKundaliQuery(id: string | null) {
  const client = useApiClient();
  return useQuery({
    queryKey: dossierKeys.kundali(id ?? ""),
    queryFn: ({ signal }) => fetchKundali(client, id!, signal),
    enabled: id !== null,
  });
}

export function useWorkOrderQuery(id: string | null) {
  const client = useApiClient();
  return useQuery({
    queryKey: dossierKeys.work(id ?? ""),
    queryFn: ({ signal }) => fetchWorkOrder(client, id!, signal),
    enabled: id !== null,
  });
}

export function useBudgetTraceQuery(id: string | null) {
  const client = useApiClient();
  return useQuery({
    queryKey: dossierKeys.trace(id ?? ""),
    queryFn: ({ signal }) => fetchBudgetTrace(client, id!, signal),
    enabled: id !== null,
  });
}
