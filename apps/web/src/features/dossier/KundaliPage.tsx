import { Link, useSearchParams } from "react-router-dom";
import { Card, Disclosure, Fact, Facts, Tag } from "../../components/Card";
import { EvidenceIllustration } from "../../components/evidence/EvidenceIllustration";
import { StatusBadge } from "../../components/StatusBadge";
import { useI18n, type Translate } from "../../i18n/I18nContext";
import { formatInr } from "../../lib/currency";
import { readIdParam } from "../../lib/synId";
import { formatUtc } from "../map-list/Inspector";
import { NO_FILTERS } from "../map-list/filters";
import { useIssuesQuery } from "../map-list/queries";
import type { EvidenceRecord, Kundali } from "./model";
import { kundaliPath, tracePath } from "./links";
import {
  bySequence,
  DLP_STYLE,
  EVIDENCE_VERIFICATION_STYLE,
  humanize,
  JURISDICTION_STYLE,
  showsPotentialDlpWording,
  TRACE_STYLE,
  VERIFICATION_STYLE,
} from "./present";
import { useKundaliQuery } from "./queries";
import { LoadingNotice, MalformedNotice, QueryFailure } from "./states";

/** Audit entries shown before the rest sit behind a disclosure. The page makes no per-event request. */
export const AUDIT_PREVIEW_COUNT = 5;

/**
 * PAGE-02: the Civic Issue Kundali. One live request (`GET /v1/kundalis/{id}`) carries every section, so there are no
 * hidden per-section or per-event calls. The identifier comes from `?id=`, is validated locally before any request, and is
 * never echoed back into the page.
 */
export function KundaliPage() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const idParam = readIdParam(params, "id");
  const id = idParam.kind === "valid" ? idParam.id : null;
  const q = useKundaliQuery(id);

  return (
    <article aria-labelledby="page-heading" className="dossier">
      <h1 id="page-heading" tabIndex={-1}>
        {t("page.PAGE-02.name")}
      </h1>
      {idParam.kind === "absent" ? <KundaliSelector /> : null}
      {idParam.kind === "malformed" ? (
        <>
          <MalformedNotice which="issue" />
          <KundaliSelector />
        </>
      ) : null}
      {id !== null ? (
        q.isPending ? (
          <LoadingNotice />
        ) : q.isError ? (
          <>
            <QueryFailure error={q.error} onRetry={() => void q.refetch()} />
            <p>
              <Link className="button-link" to="/page-02">
                {t("p4.selector.choose")}
              </Link>
            </p>
          </>
        ) : (
          <KundaliContent k={q.data.data} />
        )
      ) : null}
    </article>
  );
}

/** Bounded live selector for a direct visit: the issue list the API already serves (no new endpoint, no enumeration). */
function KundaliSelector() {
  const { t } = useI18n();
  const q = useIssuesQuery(NO_FILTERS);
  return (
    <Card id="selector-heading" title={t("p4.selector.title")}>
      <p className="hint">{t("p4.selector.body")}</p>
      {q.isPending ? (
        <LoadingNotice />
      ) : q.isError ? (
        <QueryFailure error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <ul className="selector-list">
          {q.data.data.items.map((i) => (
            <li key={i.id}>
              <Link className="selector-link" to={kundaliPath(i.id)}>
                <span className="selector-link__title">{i.title}</span>
                <span className="selector-link__meta">
                  <StatusBadge status={i.status} /> <code>{i.id}</code>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function KundaliContent({ k }: { k: Kundali }) {
  const { t } = useI18n();
  const i = k.issue;
  return (
    <>
      <header className="dossier__summary">
        <div className="dossier__summary-main">
          <p className="dossier__id">
            <code>{i.id}</code>
          </p>
          <h2 className="dossier__title">{i.title}</h2>
          <p className="dossier__status">
            <StatusBadge status={i.status} />
          </p>
          <p>{i.publicStatusExplanation}</p>
          <p className="dossier__where">
            {k.asset?.corridorName ? `${k.asset.corridorName} · ` : ""}
            {i.streetName} · {i.nearbyLandmark}
          </p>
        </div>
        <nav className="dossier__actions" aria-label={t("p4.actions.label")}>
          <Link className="button-link button-link--primary" to={tracePath({ budgetId: k.budgetTrace?.budget.id, workOrderId: k.workOrder?.id })}>
            {t("p4.actions.trace")}
          </Link>
          <Link className="button-link" to="/page-01">
            {t("p4.actions.map")}
          </Link>
        </nav>
      </header>

      <div className="dossier-grid">
        <div className="dossier-main">
          <ClaimAndVerification k={k} />
          <EvidenceSection evidence={k.evidence} claimedAfterId={k.completionClaim?.claimedAfterEvidenceId ?? null} />
          <LinkedWork k={k} />
        </div>
        <div className="dossier-aside">
          <Responsibility k={k} />
          <AuditPreview events={k.auditEvents} />
          <CorrectionsSection k={k} />
        </div>
      </div>
    </>
  );
}

function ClaimAndVerification({ k }: { k: Kundali }) {
  const { t } = useI18n();
  const claim = k.completionClaim;
  const v = k.verification;
  return (
    <Card id="claim-heading" title={t("p4.claim.title")}>
      {claim ? (
        <>
          <p>
            <Tag tone="pending" icon="⚑" label={t("p4.claim.badge")} />
          </p>
          <Facts>
            <Fact label={t("p4.claim.by")}>{claim.claimedByPostTitle}</Fact>
            <Fact label={t("p4.claim.at")}>{formatUtc(claim.claimedAt)}</Fact>
            <Fact label={t("p4.claim.atr")}>{claim.atrSummary}</Fact>
          </Facts>
          <Disclosure summary={t("p4.claim.details")}>
            <p>{claim.claimNote}</p>
          </Disclosure>
        </>
      ) : (
        <p>{t("p4.claim.none")}</p>
      )}
      <h3 className="card__subtitle">{t("p4.verification.title")}</h3>
      {v ? (
        <>
          <p>
            <Tag
              tone={(VERIFICATION_STYLE[v.state] ?? { tone: "neutral" as const }).tone}
              icon={(VERIFICATION_STYLE[v.state] ?? { icon: "•" }).icon}
              label={t(`p4.verification.state.${v.state}`)}
            />
          </p>
          <Facts>
            <Fact label={t("p4.verification.window")}>
              {formatUtc(v.windowOpensAt)} – {formatUtc(v.windowEndsAt)}
            </Fact>
            <Fact label={t("p4.verification.verdict")}>
              {v.citizenVerdict ? t(`p4.verification.verdict.${v.citizenVerdict}`) : t("p4.verification.noVerdict")}
            </Fact>
          </Facts>
          {/* the single place the "silence is not verification" rule is stated, in the API's own words */}
          <p className="callout">{v.silenceNote}</p>
        </>
      ) : (
        <p>{t("p4.verification.none")}</p>
      )}
    </Card>
  );
}

const STAGE_ORDER = { BEFORE: 0, CLAIMED_AFTER: 1, DISPUTED_OR_RECURRING: 2 } as const;

function EvidenceSection({ evidence, claimedAfterId }: { evidence: readonly EvidenceRecord[]; claimedAfterId: string | null }) {
  const { t } = useI18n();
  const ordered = [...evidence].sort((a, b) => STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage] || a.capturedAt.localeCompare(b.capturedAt));
  return (
    <Card id="evidence-heading" title={t("p4.evidence.title")}>
      {ordered.length === 0 ? (
        <p>{t("p4.evidence.none")}</p>
      ) : (
        <ul className="evidence-list">
          {ordered.map((e) => (
            <li key={e.id}>
              <figure className="evidence">
                <EvidenceIllustration stage={e.stage} />
                <figcaption>
                  <p className="evidence__stage">
                    <strong>{t(`p4.evidence.stage.${e.stage}`)}</strong>{" "}
                    {e.stage === "CLAIMED_AFTER" || e.id === claimedAfterId ? <Tag tone="pending" icon="⚑" label={t("p4.evidence.claimNotVerified")} /> : null}
                  </p>
                  <p>{e.caption}</p>
                  <Facts>
                    <Fact label={t("p4.evidence.captured")}>{formatUtc(e.capturedAt)}</Fact>
                    <Fact label={t("p4.evidence.source")}>{t(`p4.evidence.source.${e.sourceType}`)}</Fact>
                    <Fact label={t("p4.evidence.state")}>
                      <Tag
                        tone={(EVIDENCE_VERIFICATION_STYLE[e.verificationState] ?? { tone: "neutral" as const }).tone}
                        icon={(EVIDENCE_VERIFICATION_STYLE[e.verificationState] ?? { icon: "•" }).icon}
                        label={t(`p4.evidence.verification.${e.verificationState}`)}
                      />
                    </Fact>
                    <Fact label={t("p4.evidence.location")}>{t(`p4.evidence.location.${e.locationConfidence}`)}</Fact>
                  </Facts>
                  <Disclosure summary={t("p4.evidence.caveat")}>
                    <p>{e.caveat}</p>
                    <p className="hint">
                      {t("p4.evidence.hash")}: <code className="hash">{e.sha256}</code>
                    </p>
                  </Disclosure>
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function dlpTag(t: Translate, status: string) {
  const s = DLP_STYLE[status] ?? { icon: "•", tone: "neutral" as const };
  return <Tag tone={s.tone} icon={s.icon} label={t(`p4.dlp.status.${status}`)} />;
}

function LinkedWork({ k }: { k: Kundali }) {
  const { t } = useI18n();
  const w = k.workOrder;
  const d = k.dlpStatus;
  const trace = k.budgetTrace;
  return (
    <Card id="work-heading" title={t("p4.work.title")}>
      {!w ? (
        <p>{t("p4.work.none")}</p>
      ) : (
        <>
          <p className="card__lead">
            <strong>{w.displayTitle}</strong> <code>{w.id}</code>
          </p>
          <Facts>
            <Fact label={t("p4.work.value")}>{formatInr(w.valuePaise)}</Fact>
            <Fact label={t("p4.work.status")}>{t(`p4.work.status.${w.status}`)}</Fact>
            {d ? <Fact label={t("p4.dlp.label")}>{dlpTag(t, d.status)}</Fact> : null}
            {d ? <Fact label={t("p4.dlp.until")}>{formatUtc(d.dlpEndsAt)}</Fact> : null}
            {d ? <Fact label={t("p4.dlp.evaluated")}>{formatUtc(d.evaluatedAt)}</Fact> : null}
            {trace ? (
              <Fact label={t("p4.trace.status")}>
                <Tag
                  tone={(TRACE_STYLE[trace.traceabilityStatus] ?? { tone: "neutral" as const }).tone}
                  icon={(TRACE_STYLE[trace.traceabilityStatus] ?? { icon: "•" }).icon}
                  label={t(`p4.trace.status.${trace.traceabilityStatus}`)}
                />
              </Fact>
            ) : null}
            {trace ? <Fact label={t("p4.trace.budget")}>{formatInr(trace.budget.amountPaise)}</Fact> : null}
          </Facts>
          {d ? (
            <Disclosure summary={t("p4.dlp.details")}>
              {showsPotentialDlpWording(d.status) ? <p className="callout">{t("p4.dlp.claimSafe")}</p> : null}
              <p>{d.explanation}</p>
              <p>{d.warrantyPathNote}</p>
              {d.syntheticFreshRepairEstimatePaise !== null ? (
                <p>
                  {t("p4.dlp.estimate")}: {formatInr(d.syntheticFreshRepairEstimatePaise)}
                  {d.potentialSpendLabel ? ` (${t("p4.dlp.potentialLabel")})` : ""}
                </p>
              ) : null}
            </Disclosure>
          ) : null}
          <p>
            <Link className="button-link button-link--primary" to={tracePath({ budgetId: trace?.budget.id, workOrderId: w.id })}>
              {t("p4.actions.trace")}
            </Link>
          </p>
        </>
      )}
    </Card>
  );
}

function Responsibility({ k }: { k: Kundali }) {
  const { t } = useI18n();
  const j = k.jurisdiction;
  const js = JURISDICTION_STYLE[j.status] ?? { icon: "•", tone: "neutral" as const };
  return (
    <Card id="resp-heading" title={t("p4.resp.title")}>
      <Facts>
        <Fact label={t("p4.resp.post")}>{k.issue.responsiblePostTitle}</Fact>
        <Fact label={t("p4.resp.escalation")}>{k.issue.escalationPostTitle}</Fact>
        <Fact label={t("p4.resp.department")}>
          {k.responsibleDepartment.displayName} <span className="hint">({t(`p4.resp.kind.${k.responsibleDepartment.kind}`)})</span>
        </Fact>
        <Fact label={t("p4.resp.ward")}>
          {k.ward ? `${k.ward.displayName} (${k.ward.code})` : t("p1.inspector.wardNone")}{" "}
          <span className="hint">{t("p4.resp.wardCandidate")}</span>
        </Fact>
        <Fact label={t("p4.resp.jurisdiction")}>
          <Tag tone={js.tone} icon={js.icon} label={t(`p4.jurisdiction.${j.status}`)} />
        </Fact>
      </Facts>
      <p>{j.confidenceNote}</p>
      {j.sourceConflictNote ? <p className="callout">{j.sourceConflictNote}</p> : null}
      <Disclosure summary={t("p4.resp.details")}>
        <p>{k.responsibleDepartment.scopeSummary}</p>
        {j.confirmationBasis ? <p>{j.confirmationBasis}</p> : null}
        {j.externalAgencyLabel ? <p>{j.externalAgencyLabel}</p> : null}
        <p>{t("p4.resp.noLegal")}</p>
      </Disclosure>
    </Card>
  );
}

function AuditPreview({ events }: { events: Kundali["auditEvents"] }) {
  const { t } = useI18n();
  const ordered = bySequence(events);
  const shown = ordered.slice(0, AUDIT_PREVIEW_COUNT);
  const rest = ordered.slice(AUDIT_PREVIEW_COUNT);
  const row = (e: (typeof ordered)[number]) => (
    <li key={e.id} className="timeline__item">
      <span className="timeline__seq" aria-hidden="true">
        {e.sequence}
      </span>
      <div>
        <p className="timeline__type">
          <strong>{humanize(e.eventType)}</strong>
        </p>
        <p className="timeline__meta">
          {formatUtc(e.occurredAt)} · {t(`p4.actor.${e.actorRole}`)}
        </p>
        <p>{e.summary}</p>
      </div>
    </li>
  );
  return (
    <Card id="audit-heading" title={t("p4.audit.title")}>
      {ordered.length === 0 ? (
        <p>{t("p4.audit.none")}</p>
      ) : (
        <>
          <ol className="timeline">{shown.map(row)}</ol>
          {rest.length > 0 ? (
            <Disclosure summary={`${t("p4.audit.more")} (${rest.length})`}>
              <ol className="timeline" start={AUDIT_PREVIEW_COUNT + 1}>
                {rest.map(row)}
              </ol>
            </Disclosure>
          ) : null}
          <p className="hint">{t("p4.audit.note")}</p>
        </>
      )}
    </Card>
  );
}

function CorrectionsSection({ k }: { k: Kundali }) {
  const { t } = useI18n();
  if (k.corrections.length === 0) return null;
  return (
    <Card id="corrections-heading" title={t("p4.corrections.title")}>
      <ul className="plain-list">
        {k.corrections.map((c) => (
          <li key={c.id}>
            <p>
              <code>{c.id}</code> · {humanize(c.status)}
            </p>
            <p className="hint">
              {c.fieldPath} · {formatUtc(c.submittedAt)}
            </p>
            <p>{c.reason}</p>
          </li>
        ))}
      </ul>
      <p className="hint">{t("p4.corrections.note")}</p>
    </Card>
  );
}
