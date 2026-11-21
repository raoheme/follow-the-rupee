import type { TagTone } from "../../components/Card";

/**
 * Glyph and tone per server-supplied state. Meaning is carried by the translated label and the glyph; the tone is only an
 * accent. A completion claim and a verification are deliberately different vocabularies and never share a glyph.
 */
export interface TagStyle {
  readonly icon: string;
  readonly tone: TagTone;
}

export const VERIFICATION_STYLE: Record<string, TagStyle> = {
  AWAITING_AUTHORITY_CLAIM: { icon: "○", tone: "neutral" },
  WINDOW_OPEN: { icon: "◔", tone: "pending" },
  CITIZEN_CONFIRMED: { icon: "✔", tone: "verified" },
  CITIZEN_PARTLY_FIXED: { icon: "◐", tone: "pending" },
  CITIZEN_DISPUTED: { icon: "✖", tone: "disputed" },
  WINDOW_EXPIRED_NO_VERDICT: { icon: "⌛", tone: "pending" },
  INDEPENDENT_REVIEW_PENDING: { icon: "⚑", tone: "pending" },
  INDEPENDENTLY_VERIFIED: { icon: "✔", tone: "verified" },
};

export const DLP_STYLE: Record<string, TagStyle> = {
  NOT_STARTED: { icon: "○", tone: "neutral" },
  ACTIVE: { icon: "◉", tone: "active" },
  EXPIRED: { icon: "◌", tone: "neutral" },
};

export const JURISDICTION_STYLE: Record<string, TagStyle> = {
  UNKNOWN: { icon: "?", tone: "neutral" },
  SPATIALLY_INFERRED_PROVISIONAL: { icon: "◔", tone: "pending" },
  CONFIRMED_BMC_WARD: { icon: "✔", tone: "verified" },
  EXTERNAL_AGENCY_ASSIGNED: { icon: "↗", tone: "active" },
  CONFLICT_DISPUTED: { icon: "✖", tone: "disputed" },
  HANDOFF_LOGGED: { icon: "⇄", tone: "active" },
};

export const EVIDENCE_VERIFICATION_STYLE: Record<string, TagStyle> = {
  NOT_VERIFIED: { icon: "○", tone: "pending" },
  CORROBORATED: { icon: "◑", tone: "active" },
  INDEPENDENTLY_VERIFIED: { icon: "✔", tone: "verified" },
};

export const TRACE_STYLE: Record<string, TagStyle> = {
  LINKED_TO_STREET: { icon: "✔", tone: "verified" },
  // an evidence gap in the record, not a finding about anyone: amber and dashed, never red
  GAP_BEFORE_STREET_GEOMETRY: { icon: "⚠", tone: "pending" },
};

/** `ISSUE_SUBMITTED_UNVERIFIED` -> `Issue submitted unverified`. Deterministic, for event types the API supplies verbatim. */
export function humanize(code: string): string {
  const words = code.toLowerCase().split("_").filter(Boolean).join(" ");
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : code;
}

/** The exact claim-safe wording is shown only while the server's derived status is ACTIVE. */
export function showsPotentialDlpWording(status: string | undefined): boolean {
  return status === "ACTIVE";
}

/** Order the audit preview by sequence; the API already sorts, this keeps the page correct if it ever does not. */
export function bySequence<T extends { sequence: number }>(events: readonly T[]): T[] {
  return [...events].sort((a, b) => a.sequence - b.sequence);
}

/** The chain steps in order, with whether each is proven, the missing next link, or simply not available in the record. */
export const CHAIN_ORDER = ["BUDGET", "TENDER", "CONTRACT", "WORK_ORDER", "ASSET_GEOMETRY"] as const;
export type ChainStep = (typeof CHAIN_ORDER)[number];
export type StepState = "proven" | "missing" | "notAvailable";

export function missingToStep(missing: string | null): ChainStep | null {
  switch (missing) {
    case "TENDER":
      return "TENDER";
    case "CONTRACT":
      return "CONTRACT";
    case "WORK_ORDER":
      return "WORK_ORDER";
    case "STREET_LEVEL_GEOMETRY":
      return "ASSET_GEOMETRY";
    default:
      return null;
  }
}

export function stepState(step: ChainStep, present: boolean, missingNext: string | null): StepState {
  if (present) return "proven";
  return missingToStep(missingNext) === step ? "missing" : "notAvailable";
}
