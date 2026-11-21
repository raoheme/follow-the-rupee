import { Link, useSearchParams } from "react-router-dom";
import { Card, Fact, Facts, Tag } from "../../components/Card";
import { StatusBadge } from "../../components/StatusBadge";
import { useI18n } from "../../i18n/I18nContext";
import { readIdParam } from "../../lib/synId";
import { DataNotice } from "../map-list/DataNotice";
import { formatUtc } from "../map-list/Inspector";
import { kundaliPath } from "../dossier/links";
import { LoadingNotice, QueryFailure } from "../dossier/states";
import { useReportFlow } from "./flow";
import type { CreatedIssue, DuplicateChoice, EvidenceRecord } from "./model";
import { CHOICE_EVENT_TYPE } from "./present";
import { useRecoveredRecord, type RecoveredRecord } from "./queries";
import { StepIndicator } from "./shared";

interface Receipt {
  readonly issue: CreatedIssue;
  readonly submitCorrelationId: string | null;
  readonly decision: {
    readonly choice: DuplicateChoice;
    readonly targetIssueId: string;
    readonly evidence: Pick<EvidenceRecord, "id" | "stage" | "processingState" | "verificationState">;
    readonly correlationId: string | null;
  } | null;
  readonly recovered: boolean;
  /** True when a recovered receipt asked about a decision the server record does not identify. */
  readonly decisionUnknown: boolean;
}

/** The decision for an evidence id, read back from the target issue's recorded events (the contract has no evidence read). */
function recoverDecision(target: RecoveredRecord | undefined, evidenceId: string): Receipt["decision"] {
  if (!target) return null;
  const ev = target.evidence.find((e) => e.id === evidenceId);
  const event = target.auditEvents.find((a) => a.summary.includes(evidenceId) && a.eventType in CHOICE_EVENT_TYPE);
  if (!ev || !event) return null;
  return {
    choice: CHOICE_EVENT_TYPE[event.eventType]!,
    targetIssueId: target.issue.id,
    evidence: { id: ev.id, stage: ev.stage as EvidenceRecord["stage"], processingState: ev.processingState as EvidenceRecord["processingState"], verificationState: ev.verificationState as EvidenceRecord["verificationState"] },
    correlationId: null,
  };
}

/**
 * PAGE-06: Submission Receipt. Built from the committed mutation responses held in memory from this visit; after a refresh it
 * is rebuilt from the records the server holds and says so. It never claims verification, resolution, authority acceptance or
 * an official submission, and never fills in a field it does not have.
 */
export function ReceiptPage() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const issueParam = readIdParam(params, "issueId");
  const targetParam = readIdParam(params, "targetId");
  const evidenceParam = readIdParam(params, "evidenceId");
  const flow = useReportFlow();
  const issueId = issueParam.kind === "valid" ? issueParam.id : null;
  const targetId = targetParam.kind === "valid" ? targetParam.id : null;
  const evidenceId = evidenceParam.kind === "valid" ? evidenceParam.id : null;
  const malformed = [issueParam, targetParam, evidenceParam].some((p) => p.kind === "malformed");

  const local = flow.submitted && flow.submitted.issue.id === issueId ? flow.submitted : null;
  const localDecision =
    flow.decision && evidenceId && flow.decision.evidence.id === evidenceId && flow.decision.targetIssueId === targetId
      ? flow.decision
      : null;

  const recoverIssue = useRecoveredRecord(!malformed && issueId !== null && local === null ? issueId : null);
  const needTarget = !malformed && evidenceId !== null && targetId !== null && localDecision === null;
  const recoverTarget = useRecoveredRecord(needTarget ? targetId : null);

  let receipt: Receipt | null = null;
  if (local) {
    receipt = {
      issue: local.issue,
      submitCorrelationId: local.correlationId,
      decision: localDecision
        ? { choice: localDecision.choice, targetIssueId: localDecision.targetIssueId, evidence: localDecision.evidence, correlationId: localDecision.correlationId }
        : null,
      recovered: false,
      decisionUnknown: false,
    };
  } else if (recoverIssue.data) {
    receipt = {
      issue: recoverIssue.data.data.issue,
      submitCorrelationId: null,
      decision: evidenceId ? recoverDecision(recoverTarget.data?.data, evidenceId) : null,
      recovered: true,
      decisionUnknown: evidenceId !== null && recoverTarget.data !== undefined && recoverDecision(recoverTarget.data.data, evidenceId) === null,
    };
  }

  const pendingTarget = needTarget && recoverTarget.isPending && local === null;

  return (
    <article aria-labelledby="page-heading" className="receipt">
      <h1 id="page-heading" tabIndex={-1}>
        {t("page.PAGE-06.name")}
      </h1>
      <StepIndicator current="receipt" />
      {issueParam.kind === "absent" ? (
        <Missing />
      ) : malformed ? (
        <>
          <DataNotice state="error" title={t("p5.receipt.badId.title")} live="status">
            <p>{t("p5.receipt.badId.body")}</p>
          </DataNotice>
          <p>
            <Link className="button-link" to="/page-04">
              {t("p5.new.report")}
            </Link>
          </p>
        </>
      ) : receipt === null ? (
        recoverIssue.isError ? (
          <QueryFailure error={recoverIssue.error} onRetry={() => void recoverIssue.refetch()} />
        ) : (
          <LoadingNotice />
        )
      ) : pendingTarget ? (
        <LoadingNotice />
      ) : (
        <ReceiptBody r={receipt} />
      )}
    </article>
  );
}

function Missing() {
  const { t } = useI18n();
  return (
    <>
      <DataNotice state="empty" title={t("p5.receipt.missing.title")} live="status">
        <p>{t("p5.receipt.missing.body")}</p>
      </DataNotice>
      <p>
        <Link className="button-link button-link--primary" to="/page-04">
          {t("p5.new.report")}
        </Link>
      </p>
    </>
  );
}

function ReceiptBody({ r }: { r: Receipt }) {
  const { t } = useI18n();
  const i = r.issue;
  const d = r.decision;
  const decisionTag =
    d === null
      ? { tone: "neutral" as const, icon: "—", key: "p5.receipt.state.noDecision" }
      : d.choice === "CREATE_SEPARATE_ISSUE"
        ? { tone: "neutral" as const, icon: "≠", key: "p5.receipt.state.separate" }
        : { tone: "pending" as const, icon: "≈", key: "p5.receipt.state.linked" };
  const decisionText =
    d === null
      ? "p5.receipt.decision.none"
      : d.choice === "ENDORSE_EXISTING"
        ? "p5.receipt.decision.endorse"
        : d.choice === "ADD_EVIDENCE_TO_EXISTING"
          ? "p5.receipt.decision.add"
          : "p5.receipt.decision.separate";

  return (
    <>
      <p className="hint">{t("p5.receipt.intro")}</p>
      <p className="callout" data-testid="not-official">
        {t("p5.receipt.notOfficial")}
      </p>
      {r.recovered ? (
        <DataNotice state="partial" title={t("p5.receipt.recovered.title")} live="status">
          <p>{t("p5.receipt.recovered.body")}</p>
          {r.decisionUnknown ? <p>{t("p5.receipt.recovered.decisionUnknown")}</p> : null}
        </DataNotice>
      ) : null}

      <Card id="states-heading" title={t("p5.receipt.states.title")} className="card--compact">
        <ul className="receipt-states">
          <li>
            <Tag tone="active" icon="✔" label={t("p5.receipt.state.submitted")} /> <span>{t("p5.receipt.state.yes")}</span>
          </li>
          <li>
            <Tag tone="pending" icon="◔" label={t("p5.receipt.state.unverified")} /> <span>{t("p5.receipt.state.yes")}</span>
          </li>
          <li>
            <Tag tone={decisionTag.tone} icon={decisionTag.icon} label={t(decisionTag.key)} />
          </li>
          <li>
            <Tag tone="neutral" icon="○" label={t("p5.receipt.state.verified")} /> <span>{t("p5.receipt.state.notReached")}</span>
          </li>
        </ul>
      </Card>

      <Card id="report-heading" title={t("p5.receipt.report")} className="card--compact">
        <p>
          <strong>{i.title}</strong>
        </p>
        <Facts>
          <Fact label={t("p5.id.label")}>
            <code data-testid="receipt-id">{i.id}</code>
          </Fact>
          <Fact label={t("p5.status.label")}>
            <StatusBadge status={i.status} />
          </Fact>
          <Fact label={t("p5.receipt.submittedAt")}>{formatUtc(i.reportedAt)}</Fact>
          <Fact label={t("p5.receipt.nextState")}>{t("p5.receipt.nextState.body")}</Fact>
        </Facts>
        <p className="hint">{i.publicStatusExplanation}</p>
      </Card>

      <Card id="decision-heading" title={t("p5.receipt.decision")} className="card--compact">
        <p>{t(decisionText)}</p>
        {d ? (
          <Facts>
            <Fact label={t("p5.receipt.decision.target")}>
              <code>{d.targetIssueId}</code>
            </Fact>
          </Facts>
        ) : null}
      </Card>

      {d ? (
        <Card id="evidence-ack-heading" title={t("p5.receipt.evidence")} className="card--compact">
          <p>{t("p5.receipt.evidence.body")}</p>
          <Facts>
            <Fact label={t("p5.id.label")}>
              <code>{d.evidence.id}</code>
            </Fact>
            <Fact label={t("p5.receipt.evidence.state")}>
              {d.evidence.processingState} · {d.evidence.verificationState}
            </Fact>
          </Facts>
        </Card>
      ) : null}

      {r.submitCorrelationId || d?.correlationId ? (
        <Card id="corr-heading" title={t("p5.receipt.correlation")} className="card--compact">
          <Facts>
            {r.submitCorrelationId ? (
              <Fact label={t("p5.receipt.correlation.submit")}>
                <code>{r.submitCorrelationId}</code>
              </Fact>
            ) : null}
            {d?.correlationId ? (
              <Fact label={t("p5.receipt.correlation.decision")}>
                <code>{d.correlationId}</code>
              </Fact>
            ) : null}
          </Facts>
        </Card>
      ) : null}

      <p className="form-actions">
        <Link className="button-link button-link--primary" to={kundaliPath(i.id)}>
          {t("p5.open.kundali")}
        </Link>
        <Link className="button-link" to="/page-01">
          {t("p5.open.map")}
        </Link>
        <Link className="button-link" to="/page-04">
          {t("p5.new.report")}
        </Link>
      </p>
    </>
  );
}
