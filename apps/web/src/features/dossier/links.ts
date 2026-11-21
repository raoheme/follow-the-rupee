import { isSynId } from "../../lib/synId";

/** Deep-link builders. Only identifiers that pass local validation can enter a URL; anything else yields the bare page path. */
export function kundaliPath(issueId: string): string {
  if (!isSynId(issueId)) return "/page-02";
  const q = new URLSearchParams({ id: issueId });
  return `/page-02?${q.toString()}`;
}

export function tracePath(ids: { budgetId?: string | null; workOrderId?: string | null }): string {
  const q = new URLSearchParams();
  if (ids.budgetId && isSynId(ids.budgetId)) q.set("budgetId", ids.budgetId);
  if (ids.workOrderId && isSynId(ids.workOrderId)) q.set("workOrderId", ids.workOrderId);
  const s = q.toString();
  return s ? `/page-03?${s}` : "/page-03";
}

/**
 * The two committed demonstration traces PAGE-03 offers. They are a bounded demonstration set, not the municipal budget
 * universe. `tests` pin these identifiers against `data/demo/*.json`, so a seed change cannot leave a stale example.
 */
export const TRACE_EXAMPLES = [
  { key: "complete", budgetId: "SYN-DEMO-BUD-001", workOrderId: "SYN-DEMO-WO-001" },
  { key: "gap", budgetId: "SYN-DEMO-BUD-002", workOrderId: null },
] as const;
