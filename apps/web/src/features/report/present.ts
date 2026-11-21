import type { DuplicateBand, DuplicateChoice, FactorKey } from "./model";

/**
 * Presentation only. Bands and choices carry a glyph AND words so no state depends on colour. Nothing here computes a
 * score; the API's `score`, `band` and `breakdown` are shown verbatim.
 */
export const BAND_PRESENTATION: Readonly<Record<DuplicateBand, { icon: string; tone: "verified" | "pending" | "neutral"; key: string }>> = {
  LIKELY_SAME: { icon: "≈", tone: "pending", key: "p5.band.LIKELY_SAME" },
  POSSIBLE_MATCH: { icon: "~", tone: "neutral", key: "p5.band.POSSIBLE_MATCH" },
  PROBABLY_DISTINCT: { icon: "≠", tone: "neutral", key: "p5.band.PROBABLY_DISTINCT" },
};

export const FACTOR_LABEL_KEY: Readonly<Record<FactorKey, string>> = {
  sameAssetOrSegment: "p5.factor.sameAssetOrSegment",
  sameCategory: "p5.factor.sameCategory",
  withinConfiguredRadius: "p5.factor.withinConfiguredRadius",
  withinConfiguredWindow: "p5.factor.withinConfiguredWindow",
  keywordOverlap: "p5.factor.keywordOverlap",
};

export const CHOICE_KEY: Readonly<Record<DuplicateChoice, string>> = {
  ENDORSE_EXISTING: "p5.choice.ENDORSE_EXISTING",
  ADD_EVIDENCE_TO_EXISTING: "p5.choice.ADD_EVIDENCE_TO_EXISTING",
  CREATE_SEPARATE_ISSUE: "p5.choice.CREATE_SEPARATE_ISSUE",
};

/** Audit event type that records each choice on the chosen issue (used only to describe a recovered receipt). */
export const CHOICE_EVENT_TYPE: Readonly<Record<string, DuplicateChoice>> = {
  DUPLICATE_ENDORSED_EXISTING: "ENDORSE_EXISTING",
  DUPLICATE_EVIDENCE_ADDED_TO_EXISTING: "ADD_EVIDENCE_TO_EXISTING",
  DUPLICATE_DECISION_CREATE_SEPARATE: "CREATE_SEPARATE_ISSUE",
};

/** A claim-aware caveat for a candidate's status: a claimed closure is never described as a verified one. */
export function statusCaveatKey(status: string): string | null {
  switch (status) {
    case "CLOSURE_CLAIMED_PENDING_VERIFICATION":
      return "p5.caveat.claimed";
    case "VERIFIED_COMPLETE":
      return "p5.caveat.verified";
    case "DISPUTED_REOPENED":
      return "p5.caveat.disputed";
    case "SUBMITTED_UNVERIFIED":
      return "p5.caveat.unverified";
    default:
      return null;
  }
}

export function reportPath(): string {
  return "/page-04";
}

export function duplicatePath(issueId: string): string {
  return `/page-05?${new URLSearchParams({ issueId }).toString()}`;
}

export function receiptPath(ids: { issueId: string; targetId?: string; evidenceId?: string }): string {
  const q = new URLSearchParams({ issueId: ids.issueId });
  if (ids.targetId) q.set("targetId", ids.targetId);
  if (ids.evidenceId) q.set("evidenceId", ids.evidenceId);
  return `/page-06?${q.toString()}`;
}

/** Minimal `{name}` substitution for translated strings (the translator takes a key only). */
export function fill(text: string, values: Readonly<Record<string, string | number>>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
}
