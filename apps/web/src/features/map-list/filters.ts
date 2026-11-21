import { ISSUE_STATUSES, type IssueStatus } from "../../components/status";
import { FULL_BBOX, ISSUE_CATEGORIES, type IssueCategory } from "./model";

/**
 * The filters shared by `GET /v1/map/features` and `GET /v1/issues` (openapi.yaml parameters Ward, Category, Status,
 * DlpOnly). One object feeds both requests, so the map and the list can never be asked different questions.
 * `bbox` is declared on the map operation only; PAGE-01 always sends the full Greater Mumbai box so the map answer is the
 * complete eligible set the list also returns.
 */
export interface WorkspaceFilters {
  /** Ward code such as `K/W` (not a ward record id or a display name). */
  readonly ward: string | "";
  readonly category: IssueCategory | "";
  readonly status: IssueStatus | "";
  readonly dlpOnly: boolean;
}

export const NO_FILTERS: WorkspaceFilters = { ward: "", category: "", status: "", dlpOnly: false };

/**
 * Ward codes of the frozen demonstration scope (DECISIONS.md: K/West primary, G/North and M/East comparison labels).
 * There is no ward-list operation in the contract, so these three codes are the only options offered.
 */
export const WARD_OPTIONS = [
  { code: "K/W", labelKey: "p1.ward.KW" },
  { code: "G/N", labelKey: "p1.ward.GN" },
  { code: "M/E", labelKey: "p1.ward.ME" },
] as const;

export const CATEGORY_OPTIONS = ISSUE_CATEGORIES;
export const STATUS_OPTIONS = ISSUE_STATUSES;

export function hasActiveFilters(f: WorkspaceFilters): boolean {
  return f.ward !== "" || f.category !== "" || f.status !== "" || f.dlpOnly;
}

/** How many filters are applied (a ward, a category, a status and the DLP switch each count once). */
export function activeFilterCount(f: WorkspaceFilters): number {
  return (f.ward !== "" ? 1 : 0) + (f.category !== "" ? 1 : 0) + (f.status !== "" ? 1 : 0) + (f.dlpOnly ? 1 : 0);
}

type Query = Record<string, string>;

/** Query for `GET /v1/issues`. `dlpOnly=false` is the same as omitting it, so only `true` is ever sent. */
export function issuesQuery(f: WorkspaceFilters): Query {
  const q: Query = {};
  if (f.ward) q.ward = f.ward;
  if (f.category) q.category = f.category;
  if (f.status) q.status = f.status;
  if (f.dlpOnly) q.dlpOnly = "true";
  return q;
}

/** Query for `GET /v1/map/features`: the identical filters plus the required bbox. */
export function mapQuery(f: WorkspaceFilters): Query {
  return { bbox: FULL_BBOX, ...issuesQuery(f) };
}
