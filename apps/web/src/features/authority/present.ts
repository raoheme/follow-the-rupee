import { isSynId } from "../../lib/synId";
import { JURISDICTION_STYLE } from "../dossier/present";

export { JURISDICTION_STYLE };

/**
 * The simulated workflow persona that may use the authority pages. This is a presentation hint: the server enforces the rule
 * with 401 (missing or unrecognised persona) and 403 (any other persona). It is never authentication.
 */
export function personaIsAuthority(persona: string): boolean {
  return persona === "authority";
}

export type JurisdictionStatusCode =
  | "UNKNOWN"
  | "SPATIALLY_INFERRED_PROVISIONAL"
  | "CONFIRMED_BMC_WARD"
  | "EXTERNAL_AGENCY_ASSIGNED"
  | "CONFLICT_DISPUTED"
  | "HANDOFF_LOGGED";

/** The three targets the contract's `ResolveJurisdictionPayload.targetStatus` allows. */
export const COMMANDABLE_TARGETS = ["CONFIRMED_BMC_WARD", "EXTERNAL_AGENCY_ASSIGNED", "HANDOFF_LOGGED"] as const;
export type CommandableTarget = (typeof COMMANDABLE_TARGETS)[number];

/**
 * Which commandable targets the committed JURISDICTION machine allows from each state (config/jurisdiction-state-machine.json,
 * pinned by a drift test). It decides only which choices the form offers; the server re-checks every transition and rejects an
 * illegal one with 409. UNKNOWN -> provisional and the move into CONFLICT_DISPUTED are not commandable through this contract.
 */
export const LEGAL_TARGETS: Readonly<Record<JurisdictionStatusCode, readonly CommandableTarget[]>> = {
  UNKNOWN: [],
  SPATIALLY_INFERRED_PROVISIONAL: ["CONFIRMED_BMC_WARD", "EXTERNAL_AGENCY_ASSIGNED"],
  CONFLICT_DISPUTED: ["CONFIRMED_BMC_WARD", "EXTERNAL_AGENCY_ASSIGNED"],
  EXTERNAL_AGENCY_ASSIGNED: ["HANDOFF_LOGGED"],
  CONFIRMED_BMC_WARD: [],
  HANDOFF_LOGGED: [],
};

export const RATIONALE_MAX = 400;
export const AGENCY_LABEL_MAX = 160;

export interface ResolveValues {
  readonly target: CommandableTarget | "";
  readonly agencyLabel: string;
  readonly rationale: string;
}
export const EMPTY_RESOLVE: ResolveValues = { target: "", agencyLabel: "", rationale: "" };

export type ResolveField = "target" | "agencyLabel" | "rationale";
export type ResolveErrors = Partial<Record<ResolveField, string>>;

export interface ResolvePayload {
  targetStatus: CommandableTarget;
  externalAgencyLabel: string | null;
  rationale: string;
}

const hasControl = (s: string) => /[\u0000-\u001f\u007f-\u009f]/.test(s);
const len = (s: string) => [...s].length;

/** Local validation mirrors the contract limits; the server validates again and is the authority (including audit-text length). */
export function validateResolve(
  v: ResolveValues,
  status: JurisdictionStatusCode,
): { ok: true; payload: ResolvePayload } | { ok: false; errors: ResolveErrors } {
  const errors: ResolveErrors = {};
  const target = v.target;
  if (target === "" || !LEGAL_TARGETS[status].includes(target)) errors.target = "target";
  const label = v.agencyLabel.trim();
  if (target === "EXTERNAL_AGENCY_ASSIGNED") {
    if (len(label) === 0) errors.agencyLabel = "labelRequired";
  }
  if (label.length > 0 && (len(label) > AGENCY_LABEL_MAX || hasControl(label))) errors.agencyLabel = "labelInvalid";
  if (target === "CONFIRMED_BMC_WARD" && label.length > 0) errors.agencyLabel = "labelNotAllowed";
  const rationale = v.rationale.trim();
  if (len(rationale) === 0) errors.rationale = "rationaleRequired";
  else if (len(rationale) > RATIONALE_MAX || hasControl(rationale)) errors.rationale = "rationaleInvalid";
  if (Object.keys(errors).length > 0 || target === "") return { ok: false, errors };
  return {
    ok: true,
    payload: {
      targetStatus: target,
      externalAgencyLabel: target === "CONFIRMED_BMC_WARD" || label === "" ? null : label,
      rationale,
    },
  };
}

export interface LinkValues {
  readonly workOrderId: string;
  readonly rationale: string;
}
export type LinkField = "workOrderId" | "rationale";
export type LinkErrors = Partial<Record<LinkField, string>>;
export interface LinkPayload {
  workOrderId: string;
  rationale: string;
}

export function validateLink(v: LinkValues): { ok: true; payload: LinkPayload } | { ok: false; errors: LinkErrors } {
  const errors: LinkErrors = {};
  const id = v.workOrderId.trim();
  if (!isSynId(id)) errors.workOrderId = "workOrderId";
  const rationale = v.rationale.trim();
  if (len(rationale) === 0) errors.rationale = "rationaleRequired";
  else if (len(rationale) > RATIONALE_MAX || hasControl(rationale)) errors.rationale = "rationaleInvalid";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, payload: { workOrderId: id, rationale } };
}

/** Stable text for an attempt, so a retry of the same input reuses one Idempotency-Key and a changed input gets a new one. */
export function fingerprint(parts: readonly unknown[]): string {
  return JSON.stringify(parts);
}

// ------------------------------------------------------------------------------------------------------------ deep links

export function jurisdictionWorkPath(issueId: string, workOrderId?: string | null): string {
  if (!isSynId(issueId)) return "/page-09";
  const q = new URLSearchParams({ issueId });
  if (workOrderId && isSynId(workOrderId)) q.set("workOrderId", workOrderId);
  return `/page-09?${q.toString()}`;
}

/** `ISSUE_WORK_LINKED` -> `Issue work linked`: event types are shown verbatim from the API, only de-underscored. */
export function eventLabel(code: string): string {
  const words = code.toLowerCase().split("_").filter(Boolean).join(" ");
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : code;
}

/** `Z`-suffixed API timestamps as `2026-10-05 04:15 UTC`. */
export function utc(iso: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  return m && /Z$|\+00:00$/.test(iso) ? `${m[1]} ${m[2]} UTC` : iso;
}

/** The exact claim-safe DLP wording is shown only while the server's derived status is ACTIVE for the request instant. */
export function showsPotentialDlp(status: string | undefined): boolean {
  return status === "ACTIVE";
}
