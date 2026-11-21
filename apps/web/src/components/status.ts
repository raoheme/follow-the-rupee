/**
 * Issue lifecycle statuses (openapi.yaml IssueStatus enum). The tone is only a presentation aid: every badge also
 * carries a distinct icon and the full status text, so state never depends on colour. "disputed" (red) marks a
 * disputed or reopened record only; it never expresses blame or anyone's performance.
 */
export const ISSUE_STATUSES = [
  "DRAFT_LOCAL",
  "SUBMITTED_UNVERIFIED",
  "TRIAGED_ASSIGNED",
  "IN_PROGRESS",
  "CLOSURE_CLAIMED_PENDING_VERIFICATION",
  "VERIFIED_COMPLETE",
  "DISPUTED_REOPENED",
] as const;

export type IssueStatus = (typeof ISSUE_STATUSES)[number];
export type StatusTone = "neutral" | "pending" | "active" | "verified" | "disputed";

export const STATUS_PRESENTATION: Readonly<Record<IssueStatus, { icon: string; tone: StatusTone }>> = {
  DRAFT_LOCAL: { icon: "○", tone: "neutral" },
  SUBMITTED_UNVERIFIED: { icon: "◔", tone: "pending" },
  TRIAGED_ASSIGNED: { icon: "◑", tone: "active" },
  IN_PROGRESS: { icon: "▶", tone: "active" },
  // A claim is not verification: shown as pending, never with the verified icon or tone.
  CLOSURE_CLAIMED_PENDING_VERIFICATION: { icon: "⚑", tone: "pending" },
  VERIFIED_COMPLETE: { icon: "✔", tone: "verified" },
  DISPUTED_REOPENED: { icon: "✖", tone: "disputed" },
};

export const statusLabelKey = (s: IssueStatus): string => `status.${s}`;
