import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { CreatedIssue, DuplicateChoice, EvidenceRecord } from "./model";

/**
 * In-memory hand-off between PAGE-04, PAGE-05 and PAGE-06. It holds only what the API itself returned (the created issue and the
 * recorded decision) plus the keywords the browser sent. It is never written to browser storage, a
 * cookie or the URL: a refresh starts from an honest recovery state (identifiers in the URL, records re-read from the server).
 */
export interface SubmittedState {
  readonly issue: CreatedIssue;
  readonly correlationId: string;
  readonly keywords: readonly string[];
}

export interface DecisionState {
  readonly choice: DuplicateChoice;
  readonly targetIssueId: string;
  readonly evidence: EvidenceRecord;
  readonly correlationId: string;
}

export interface ReportFlow {
  readonly submitted: SubmittedState | null;
  readonly decision: DecisionState | null;
  setSubmitted: (s: SubmittedState) => void;
  setDecision: (d: DecisionState) => void;
  reset: () => void;
}

const Ctx = createContext<ReportFlow | null>(null);

export function ReportFlowProvider({ children, initial }: { children: ReactNode; initial?: Partial<Pick<ReportFlow, "submitted" | "decision">> }) {
  const [submitted, setSubmittedState] = useState<SubmittedState | null>(initial?.submitted ?? null);
  const [decision, setDecisionState] = useState<DecisionState | null>(initial?.decision ?? null);

  // A new submission invalidates any earlier decision.
  const setSubmitted = useCallback((s: SubmittedState) => {
    setSubmittedState(s);
    setDecisionState(null);
  }, []);
  const setDecision = useCallback((d: DecisionState) => setDecisionState(d), []);
  const reset = useCallback(() => {
    setSubmittedState(null);
    setDecisionState(null);
  }, []);

  const value = useMemo<ReportFlow>(
    () => ({ submitted, decision, setSubmitted, setDecision, reset }),
    [submitted, decision, setSubmitted, setDecision, reset],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useReportFlow(): ReportFlow {
  const v = useContext(Ctx);
  if (!v) throw new Error("useReportFlow must be used inside ReportFlowProvider");
  return v;
}
