import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { newOperationalId } from "../../api/ids";
import { Card, Tag } from "../../components/Card";
import { StatusBadge } from "../../components/StatusBadge";
import { useI18n } from "../../i18n/I18nContext";
import { readIdParam } from "../../lib/synId";
import { usePersona } from "../../state/PersonaContext";
import { DataNotice, ErrorNotice } from "../map-list/DataNotice";
import { formatUtc } from "../map-list/Inspector";
import { NO_FILTERS } from "../map-list/filters";
import type { IssueSummary } from "../map-list/model";
import { useIssuesQuery } from "../map-list/queries";
import { kundaliPath } from "../dossier/links";
import { LoadingNotice, QueryFailure } from "../dossier/states";
import { CAPTION_MAX, isEligibleCaption, keywordsFrom, tidy } from "./form";
import { newFixtureRef, sha256Hex } from "./evidence";
import { useReportFlow } from "./flow";
import {
  DUPLICATE_CHOICES,
  FACTOR_KEYS,
  type CreatedIssue,
  type DuplicateCandidate,
  type DuplicateCandidates,
  type DuplicateChoice,
} from "./model";
import { personaMaySubmit } from "./model";
import { BAND_PRESENTATION, CHOICE_KEY, FACTOR_LABEL_KEY, fill, receiptPath, statusCaveatKey } from "./present";
import { useAddEvidence, useDuplicateCheck, useRecoveredRecord } from "./queries";
import { SafetyNotices, StepIndicator } from "./shared";

interface Subject {
  readonly issue: CreatedIssue;
  readonly keywords: readonly string[];
  readonly recovered: boolean;
}

/**
 * PAGE-05: Duplicate Decision. Everything shown about a candidate comes from the `checkDuplicates` response (identifier,
 * score, band, the five factor points, the recurrence flag) plus the public issue list for display text. The browser never
 * recomputes or re-ranks a score. The three contract choices are always offered; none merges or rejects anything.
 */
export function DuplicatePage() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const idParam = readIdParam(params, "issueId");
  const issueId = idParam.kind === "valid" ? idParam.id : null;
  const flow = useReportFlow();
  const { persona } = usePersona();
  const allowed = personaMaySubmit(persona);
  const local = flow.submitted && flow.submitted.issue.id === issueId ? flow.submitted : null;
  const recovery = useRecoveredRecord(issueId !== null && local === null ? issueId : null);

  const subject: Subject | null = useMemo(() => {
    if (local) return { issue: local.issue, keywords: local.keywords, recovered: false };
    if (recovery.data) {
      const i = recovery.data.data.issue;
      return { issue: i, keywords: keywordsFrom(i.title, i.publicDescription), recovered: true };
    }
    return null;
  }, [local, recovery.data]);

  // One Idempotency-Key per mounted page: Retry replays the same request instead of creating a second audit event.
  const checkKey = useRef(newOperationalId());
  // The check is a command, so it only runs for a persona the committed workflow allows (a simulated rule). After a reload the
  // persona lens resets to Public, so the page asks for Citizen instead of sending a request that would be refused.
  const check = useDuplicateCheck(
    subject && allowed
      ? {
          issueId: subject.issue.id,
          recordVersion: subject.issue.recordVersion,
          payload: {
            category: subject.issue.category,
            geometry: subject.issue.geometry,
            descriptionKeywords: subject.keywords,
          },
        }
      : null,
    checkKey.current,
  );

  return (
    <article aria-labelledby="page-heading" className="duplicate">
      <h1 id="page-heading" tabIndex={-1}>
        {t("page.PAGE-05.name")}
      </h1>
      <StepIndicator current="review" />
      {idParam.kind === "absent" ? (
        <NoSubject />
      ) : idParam.kind === "malformed" ? (
        <>
          <DataNotice state="error" title={t("p5.dup.badId.title")} live="status">
            <p>{t("p5.dup.badId.body")}</p>
          </DataNotice>
          <p>
            <Link className="button-link" to="/page-04">
              {t("p5.new.report")}
            </Link>
          </p>
        </>
      ) : subject === null ? (
        recovery.isError ? (
          <QueryFailure error={recovery.error} onRetry={() => void recovery.refetch()} />
        ) : (
          <LoadingNotice />
        )
      ) : (
        <>
          <p className="hint">{t("p5.dup.intro")}</p>
          <Card id="method-heading" title={t("p5.dup.method.title")} className="card--compact">
            <p>{t("p5.dup.method.body")}</p>
            <p className="hint">{t("p5.dup.noRejection")}</p>
          </Card>
          <YourReport subject={subject} />
          {subject.recovered ? (
            <p className="callout" role="status">
              {t("p5.dup.recovered")}
            </p>
          ) : null}
          {!allowed ? (
            <p className="callout" role="status" data-testid="persona-blocked">
              {fill(t("p5.dup.persona.blocked"), { persona: t(`persona.option.${persona}`) })}
            </p>
          ) : check.isPending ? (
            <LoadingNotice />
          ) : check.isError ? (
            <DataNotice state="error" title={t("p5.dup.check.failed")} live="alert">
              <ErrorNotice error={check.error} onRetry={() => void check.refetch()} />
            </DataNotice>
          ) : (
            <Review subject={subject} result={check.data.data} />
          )}
        </>
      )}
    </article>
  );
}

function NoSubject() {
  const { t } = useI18n();
  return (
    <>
      <DataNotice state="empty" title={t("p5.dup.noSubject.title")} live="status">
        <p>{t("p5.dup.noSubject.body")}</p>
      </DataNotice>
      <p>
        <Link className="button-link button-link--primary" to="/page-04">
          {t("p5.new.report")}
        </Link>
      </p>
    </>
  );
}

function YourReport({ subject }: { subject: Subject }) {
  const { t } = useI18n();
  const i = subject.issue;
  return (
    <Card id="your-report-heading" title={t("p5.dup.yourReport")} className="card--compact">
      <p>
        <strong>{i.title}</strong>
      </p>
      <p className="hint">
        <code>{i.id}</code> · {t(`p1.category.${i.category}`)} · {formatUtc(i.reportedAt)}
      </p>
      <p>
        <StatusBadge status={i.status} />
      </p>
    </Card>
  );
}

function Review({ subject, result }: { subject: Subject; result: DuplicateCandidates }) {
  const { t } = useI18n();
  const issues = useIssuesQuery(NO_FILTERS);
  const byId = useMemo(() => {
    const m = new Map<string, IssueSummary>();
    for (const i of issues.data?.data.items ?? []) m.set(i.id, i);
    return m;
  }, [issues.data]);
  const [selected, setSelected] = useState<{ choice: DuplicateChoice; targetId: string } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) panelRef.current?.focus();
  }, [selected]);

  const choose = (choice: DuplicateChoice, targetId: string) => setSelected({ choice, targetId });
  const hasCandidates = result.candidates.length > 0;

  return (
    <>
      <p className="hint">
        {t("p5.dup.policy")}: <code>{result.policyLabel}</code>
      </p>
      {hasCandidates ? (
        <section aria-labelledby="candidates-heading">
          <h2 id="candidates-heading">{t("p5.dup.candidates")}</h2>
          <ul className="candidates" aria-label={t("p5.dup.candidates")}>
            {result.candidates.map((c) => (
              <CandidateCard
                key={c.issueId}
                candidate={c}
                summary={byId.get(c.issueId)}
                detailsLoading={issues.isPending}
                result={result}
                selected={selected}
                onChoose={choose}
              />
            ))}
          </ul>
        </section>
      ) : (
        <DataNotice state="empty" title={t("p5.dup.empty.title")} live="status">
          <p>{t("p5.dup.empty.body")}</p>
        </DataNotice>
      )}

      <Card id="decision-heading" title={t("p5.dup.decide")} className="card--compact">
        <p className="hint">{t("p5.dup.decide.body")}</p>
        <ul className="choice-help">
          {result.choices.map((c) => (
            <li key={c}>
              <strong>{t(CHOICE_KEY[c])}</strong>: {t(`${CHOICE_KEY[c]}.help`)}
            </li>
          ))}
        </ul>
        <p>
          <button
            type="button"
            onClick={() => choose("CREATE_SEPARATE_ISSUE", subject.issue.id)}
            aria-pressed={selected?.choice === "CREATE_SEPARATE_ISSUE"}
            data-choice="CREATE_SEPARATE_ISSUE"
          >
            {t(CHOICE_KEY.CREATE_SEPARATE_ISSUE)}
          </button>
        </p>
        <p className="hint">{t("p5.dup.skip.body")}</p>
        <p>
          <Link className="button-link" to={receiptPath({ issueId: subject.issue.id })}>
            {t("p5.dup.skip")}
          </Link>
        </p>
      </Card>

      {selected ? (
        <div ref={panelRef} tabIndex={-1} className="decision-panel">
          <EvidenceStep
            key={`${selected.choice}|${selected.targetId}`}
            subject={subject}
            choice={selected.choice}
            targetId={selected.targetId}
            targetVersion={
              selected.targetId === subject.issue.id ? subject.issue.recordVersion : byId.get(selected.targetId)?.recordVersion
            }
            onCancel={() => setSelected(null)}
          />
        </div>
      ) : null}
    </>
  );
}

function CandidateCard({
  candidate: c,
  summary,
  detailsLoading,
  result,
  selected,
  onChoose,
}: {
  candidate: DuplicateCandidate;
  summary: IssueSummary | undefined;
  detailsLoading: boolean;
  result: DuplicateCandidates;
  selected: { choice: DuplicateChoice; targetId: string } | null;
  onChoose: (choice: DuplicateChoice, targetId: string) => void;
}) {
  const { t } = useI18n();
  const band = BAND_PRESENTATION[c.band];
  const caveat = summary ? statusCaveatKey(summary.status) : null;
  const headingId = `cand-${c.issueId}`;
  const targetable = summary?.recordVersion !== undefined;
  const offered = DUPLICATE_CHOICES.filter((x) => x !== "CREATE_SEPARATE_ISSUE" && result.choices.includes(x));
  return (
    <li className="candidate" aria-labelledby={headingId} data-band={c.band}>
      <h3 id={headingId} className="candidate__title">
        <code>{c.issueId}</code>
      </h3>
      <p className="candidate__band">
        <Tag tone={band.tone} icon={band.icon} label={t(band.key)} />{" "}
        <span className="candidate__score" data-testid="candidate-score">
          {t("p5.dup.score")}: {fill(t("p5.dup.scoreOf"), { score: c.score })}
        </span>
      </p>
      {summary ? (
        <>
          <p>
            <strong>{summary.title}</strong>
          </p>
          <p className="hint">
            {t(`p1.category.${summary.category}`)} · {summary.streetName}
          </p>
          <p>
            <StatusBadge status={summary.status} />
          </p>
          {caveat ? <p className="hint">{t(caveat)}</p> : null}
        </>
      ) : (
        <p className="hint">{detailsLoading ? t("state.loading.title") : t("p5.dup.details.unavailable")}</p>
      )}
      {c.possibleRecurrence ? <p className="callout">{t("p5.dup.recurrence")}</p> : null}
      <details className="disclosure" open>
        <summary>{t("p5.dup.why")}</summary>
        <div className="disclosure__body">
          <table className="factors">
            <thead>
              <tr>
                <th scope="col">{t("p5.dup.why")}</th>
                <th scope="col">{t("p5.dup.points")}</th>
              </tr>
            </thead>
            <tbody>
              {FACTOR_KEYS.map((k) => (
                <tr key={k}>
                  <th scope="row">{t(FACTOR_LABEL_KEY[k])}</th>
                  <td data-factor={k}>
                    {c.breakdown[k] > 0 ? "● " : "○ "}
                    {c.breakdown[k]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <div className="candidate__actions">
        {offered.map((choice) => (
          <button
            key={choice}
            type="button"
            disabled={!targetable}
            aria-pressed={selected?.choice === choice && selected.targetId === c.issueId}
            onClick={() => onChoose(choice, c.issueId)}
            data-choice={choice}
          >
            {t(CHOICE_KEY[choice])}
          </button>
        ))}
        <Link className="button-link" to={kundaliPath(c.issueId)}>
          {t("p5.dup.open")}
        </Link>
      </div>
      {!targetable ? <p className="hint">{t("p5.dup.notReady")}</p> : null}
    </li>
  );
}

/**
 * The evidence step: one short synthetic note, sent as fixture-reference metadata with the chosen `duplicateChoice`. The
 * fixture reference and its hash are created once per attempt, so a retry is an exact replay on the server.
 */
function EvidenceStep({
  subject,
  choice,
  targetId,
  targetVersion,
  onCancel,
}: {
  subject: Subject;
  choice: DuplicateChoice;
  targetId: string;
  targetVersion: number | undefined;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const flow = useReportFlow();
  const [caption, setCaption] = useState("");
  const [problem, setProblem] = useState<"required" | "tooLong" | "control" | null>(null);
  const [prepError, setPrepError] = useState(false);
  const attempt = useRef<{ fingerprint: string; key: string; mediaRef: string; sha256: string } | null>(null);
  const mutation = useAddEvidence();

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (mutation.isPending || targetVersion === undefined) return;
    const c = isEligibleCaption(caption);
    if (c !== "ok") {
      setProblem(c);
      return;
    }
    setProblem(null);
    setPrepError(false);
    const text = tidy(caption);
    const fingerprint = `${choice}|${targetId}|${text}`;
    if (!attempt.current || attempt.current.fingerprint !== fingerprint) {
      try {
        const mediaRef = newFixtureRef();
        attempt.current = { fingerprint, key: newOperationalId(), mediaRef, sha256: await sha256Hex(mediaRef) };
      } catch {
        setPrepError(true);
        return;
      }
    }
    const a = attempt.current;
    mutation.mutate(
      {
        issueId: targetId,
        recordVersion: targetVersion,
        key: a.key,
        payload: {
          stage: "BEFORE",
          caption: text,
          sourceType: "CITIZEN_FIXTURE",
          capturedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
          mediaRef: a.mediaRef,
          sha256: a.sha256,
          duplicateChoice: choice,
        },
      },
      {
        onSuccess: (res) => {
          flow.setDecision({ choice, targetIssueId: targetId, evidence: res.data, correlationId: res.correlationId });
          navigate(receiptPath({ issueId: subject.issue.id, targetId, evidenceId: res.data.id }));
        },
      },
    );
  };

  return (
    <Card id="evidence-heading" title={`${t("p5.dup.evidence.title")} — ${t(CHOICE_KEY[choice])}`}>
      <SafetyNotices compact />
      <p className="hint">
        {t("p5.dup.evidence.target")}: <code>{targetId}</code>
      </p>
      <form onSubmit={(e) => void onSubmit(e)} noValidate>
        <div className="field" data-invalid={problem ? "true" : undefined}>
          <label htmlFor="evidence-caption" className="field__label">
            {t("p5.dup.evidence.caption")}
          </label>
          <p id="evidence-caption-hint" className="hint field__hint">
            {fill(t("p5.dup.evidence.captionHint"), { max: CAPTION_MAX })}
          </p>
          <textarea
            id="evidence-caption"
            rows={3}
            autoComplete="off"
            value={caption}
            onChange={(e) => {
              setCaption(e.target.value);
              if (problem) setProblem(null);
            }}
            aria-invalid={problem ? true : undefined}
            aria-describedby={`evidence-caption-hint${problem ? " evidence-caption-error" : ""}`}
            required
          />
          {problem ? (
            <p id="evidence-caption-error" className="field-error" role="alert">
              <span aria-hidden="true">⚠ </span>
              {t(`p5.report.error.${problem}`)}
            </p>
          ) : null}
        </div>
        <p className="hint">{t("p5.dup.evidence.fixture")}</p>
        {prepError ? (
          <p className="field-error" role="alert">
            {t("p5.dup.evidence.capture")}
          </p>
        ) : null}
        {mutation.isError ? (
          <div className="form-failed">
            <h3 className="form-summary__title">{t("p5.dup.evidence.failed")}</h3>
            <ErrorNotice error={mutation.error} onRetry={() => mutation.reset()} />
            <p className="hint">{t("p5.report.failed.retryHint")}</p>
          </div>
        ) : null}
        <div className="form-actions">
          <button type="submit" className="button-primary" disabled={mutation.isPending || targetVersion === undefined}>
            {t(mutation.isPending ? "p5.dup.evidence.submitting" : "p5.dup.evidence.submit")}
          </button>
          <button type="button" onClick={onCancel} disabled={mutation.isPending}>
            {t("p5.dup.evidence.cancel")}
          </button>
        </div>
      </form>
    </Card>
  );
}
