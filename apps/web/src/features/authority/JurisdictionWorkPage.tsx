import { useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ApiProblemError } from "../../api/errors";
import { newOperationalId } from "../../api/ids";
import { Card, Disclosure, Fact, Facts, Tag } from "../../components/Card";
import { StatusBadge } from "../../components/StatusBadge";
import { useI18n } from "../../i18n/I18nContext";
import { readIdParam } from "../../lib/synId";
import { usePersona } from "../../state/PersonaContext";
import { kundaliPath, tracePath } from "../dossier/links";
import { LoadingNotice, MalformedNotice, QueryFailure } from "../dossier/states";
import { DataNotice, ErrorNotice } from "../map-list/DataNotice";
import { fill } from "../report/present";
import type { AuthorityKundali, DlpExceptionItem } from "./model";
import {
  AGENCY_LABEL_MAX,
  EMPTY_RESOLVE,
  LEGAL_TARGETS,
  RATIONALE_MAX,
  eventLabel,
  fingerprint,
  jurisdictionWorkPath,
  personaIsAuthority,
  showsPotentialDlp,
  utc,
  validateLink,
  validateResolve,
  type CommandableTarget,
  type JurisdictionStatusCode,
  type LinkErrors,
  type LinkValues,
  type ResolveErrors,
  type ResolveValues,
} from "./present";
import { useAuthorityKundaliQuery, useDashboardQuery, useDlpExceptionsQuery, useLinkWork, useResolveJurisdiction } from "./queries";
import { DlpTag, Field, JurisdictionTag, PersonaGate, QueueRow, describedBy, useIssueIndex } from "./shared";

/** Audit entries shown before the rest sit behind a disclosure. The page makes no per-event request. */
export const AUDIT_PREVIEW = 5;

/**
 * PAGE-09: Jurisdiction / Work Link (AUTH-003 jurisdiction resolution and AUTH-005 work linkage). The identifier comes from
 * `?issueId=`, is validated locally before any request and is never echoed back. One public read (`getKundali`) carries the
 * issue, its jurisdiction record, the linked work and the audit tail, so there is no hidden per-section request. The two
 * commands are available only to the simulated Authority persona; every other persona sees the record read-only.
 */
export function JurisdictionWorkPage() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const idParam = readIdParam(params, "issueId");
  const workParam = readIdParam(params, "workOrderId");
  const issueId = idParam.kind === "valid" ? idParam.id : null;
  const q = useAuthorityKundaliQuery(issueId);
  return (
    <article aria-labelledby="page-heading" className="juris">
      <h1 id="page-heading" tabIndex={-1}>
        {t("page.PAGE-09.name")}
      </h1>
      <p className="hint">{t("p6.juris.intro")}</p>
      {idParam.kind === "absent" ? <IssueSelector /> : null}
      {idParam.kind === "malformed" ? (
        <>
          <MalformedNotice which="issue" />
          <IssueSelector />
        </>
      ) : null}
      {issueId !== null ? (
        q.isPending ? (
          <LoadingNotice />
        ) : q.isError ? (
          <>
            <QueryFailure error={q.error} onRetry={() => void q.refetch()} />
            <p>
              <Link className="button-link" to="/page-09">
                {t("p6.juris.choose")}
              </Link>
            </p>
          </>
        ) : (
          <RecordContent
            k={q.data.data}
            candidateFromLink={workParam.kind === "valid" ? workParam.id : null}
            onReload={() => void q.refetch()}
          />
        )
      ) : null}
    </article>
  );
}

/** Bounded selector for a direct visit: the two authority queues the dashboard already serves, with titles from the issue list. */
function IssueSelector() {
  const { t } = useI18n();
  const { persona } = usePersona();
  const allowed = personaIsAuthority(persona);
  const dash = useDashboardQuery(allowed);
  const { index } = useIssueIndex();
  const ids = allowed && dash.data ? unique([...dash.data.data.uncertainJurisdictionIssueIds, ...dash.data.data.dlpExceptionIssueIds]) : [];
  return (
    <Card id="selector-heading" title={t("p6.selector.title")}>
      <p className="hint">{t("p6.selector.body")}</p>
      {!allowed ? (
        <>
          <PersonaGate />
          <p>
            <Link className="button-link" to="/page-01">
              {t("p5.open.map")}
            </Link>
          </p>
        </>
      ) : dash.isPending ? (
        <LoadingNotice />
      ) : dash.isError ? (
        <QueryFailure error={dash.error} onRetry={() => void dash.refetch()} />
      ) : ids.length === 0 ? (
        <DataNotice state="empty" title={t("p6.selector.empty")} live="status" />
      ) : (
        <ul className="queue">
          {ids.map((id) => (
            <QueueRow key={id} id={id} issue={index.get(id)} actions={[{ to: jurisdictionWorkPath(id), label: t("p6.selector.open") }]} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort();
}

function RecordContent({ k, candidateFromLink, onReload }: { k: AuthorityKundali; candidateFromLink: string | null; onReload: () => void }) {
  const { t } = useI18n();
  const { persona } = usePersona();
  const allowed = personaIsAuthority(persona);
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
          <p className="dossier__where">
            {i.streetName} · {i.nearbyLandmark}
          </p>
          <Facts>
            <Fact label={t("p6.post.department")}>{k.responsibleDepartment.displayName}</Fact>
            <Fact label={t("p6.post.workflow")}>{i.responsiblePostTitle}</Fact>
            <Fact label={t("p6.post.escalation")}>{i.escalationPostTitle}</Fact>
          </Facts>
        </div>
        <nav className="dossier__actions" aria-label={t("p4.actions.label")}>
          <Link className="button-link button-link--primary" to={kundaliPath(i.id)}>
            {t("p5.open.kundali")}
          </Link>
          <Link className="button-link" to="/page-08">
            {t("p6.juris.backToCommand")}
          </Link>
        </nav>
      </header>
      {!allowed ? <PersonaGate /> : null}
      <div className="dossier-grid">
        <div className="dossier-main">
          <JurisdictionCard k={k} />
          {allowed ? <ResolveForm k={k} onReload={onReload} /> : null}
          <WorkLinkCard k={k} allowed={allowed} candidateFromLink={candidateFromLink} onReload={onReload} />
        </div>
        <div className="dossier-aside">
          <AuditCard k={k} />
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------- jurisdiction

function JurisdictionCard({ k }: { k: AuthorityKundali }) {
  const { t } = useI18n();
  const j = k.jurisdiction;
  return (
    <Card id="jurisdiction-heading" title={t("p6.jurisdiction.title")}>
      <p>
        <JurisdictionTag status={j.status} />
      </p>
      <p>{t(`p6.jurisdiction.explain.${j.status}`)}</p>
      {j.status === "SPATIALLY_INFERRED_PROVISIONAL" || j.status === "CONFLICT_DISPUTED" || j.status === "UNKNOWN" ? (
        <p className="callout">{t("p6.jurisdiction.provisionalNote")}</p>
      ) : null}
      <Facts>
        <Fact label={t("p6.jurisdiction.ward")}>{k.ward ? `${k.ward.displayName} (${k.ward.code})` : t("p6.jurisdiction.noWard")}</Fact>
        <Fact label={t("p6.jurisdiction.method")}>
          {t(`p6.jurisdiction.method.${j.spatialMatchMethod}`)}
          {j.distanceToBoundaryMeters !== null ? ` · ${fill(t("p6.jurisdiction.distance"), { metres: j.distanceToBoundaryMeters })}` : ""}
        </Fact>
        {j.externalAgencyLabel ? <Fact label={t("p6.jurisdiction.agency")}>{j.externalAgencyLabel}</Fact> : null}
        {j.confirmationBasis ? <Fact label={t("p6.jurisdiction.basis")}>{j.confirmationBasis}</Fact> : null}
        <Fact label={t("p6.jurisdiction.legal")}>{t("p6.jurisdiction.legalNo")}</Fact>
        <Fact label={t("p6.jurisdiction.version")}>{j.recordVersion}</Fact>
      </Facts>
      {j.sourceConflictNote ? (
        <Disclosure summary={t("p6.jurisdiction.conflict")}>
          <p>{j.sourceConflictNote}</p>
          {j.status !== "CONFLICT_DISPUTED" ? <p className="hint">{t("p6.jurisdiction.conflictHistorical")}</p> : null}
        </Disclosure>
      ) : null}
      <Disclosure summary={t("p6.jurisdiction.caveats")}>
        <p>{j.confidenceNote}</p>
        <ul className="plain-list">
          <li>{t("p6.caveat.jurisdiction")}</li>
          <li>{t("p6.caveat.osm")}</li>
          <li>{t("p6.caveat.geographies")}</li>
        </ul>
      </Disclosure>
    </Card>
  );
}

function ResolveForm({ k, onReload }: { k: AuthorityKundali; onReload: () => void }) {
  const { t } = useI18n();
  const j = k.jurisdiction;
  const status = j.status as JurisdictionStatusCode;
  const targets = LEGAL_TARGETS[status];
  const [values, setValues] = useState<ResolveValues>(EMPTY_RESOLVE);
  const [errors, setErrors] = useState<ResolveErrors>({});
  const [showErrors, setShowErrors] = useState(false);
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const mutation = useResolveJurisdiction();

  const set = (patch: Partial<ResolveValues>) => {
    const next = { ...values, ...patch };
    setValues(next);
    if (showErrors) {
      const r = validateResolve(next, status);
      setErrors(r.ok ? {} : r.errors);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (mutation.isPending) return;
    const r = validateResolve(values, status);
    if (!r.ok) {
      setErrors(r.errors);
      setShowErrors(true);
      queueMicrotask(() => summaryRef.current?.focus());
      return;
    }
    setErrors({});
    const fp = fingerprint([k.issue.id, j.recordVersion, r.payload]);
    if (!attempt.current || attempt.current.fingerprint !== fp) attempt.current = { fingerprint: fp, key: newOperationalId() };
    mutation.mutate(
      { issueId: k.issue.id, recordVersion: j.recordVersion, payload: r.payload, key: attempt.current.key },
      {
        onSuccess: () => {
          setValues(EMPTY_RESOLVE);
          setShowErrors(false);
          attempt.current = null;
        },
      },
    );
  };

  const errList = (["target", "agencyLabel", "rationale"] as const).filter((f) => errors[f]);
  const errText = (f: keyof ResolveErrors) => (errors[f] ? t(`p6.resolve.error.${errors[f]}`) : null);
  const stale = mutation.error instanceof ApiProblemError && mutation.error.status === 409;

  return (
    <Card id="resolve-heading" title={t("p6.resolve.title")}>
      <p className="hint">{t("p6.resolve.intro")}</p>
      {mutation.isSuccess ? (
        <div className="callout" role="status" data-testid="resolve-success">
          <p>
            <strong>{t("p6.resolve.done")}</strong> {fill(t("p6.resolve.doneBody"), { state: t(`p4.jurisdiction.${mutation.data.data.status}`), version: mutation.data.data.recordVersion })}
          </p>
          <p className="hint">
            {t("p1.error.correlation")}: <code>{mutation.data.correlationId}</code>
          </p>
        </div>
      ) : null}
      {targets.length === 0 ? (
        <p data-testid="resolve-final">{t(`p6.resolve.final.${status}`)}</p>
      ) : (
        <form onSubmit={onSubmit} noValidate aria-describedby="resolve-disclaimer">
          {showErrors && errList.length > 0 ? (
            <div ref={summaryRef} tabIndex={-1} role="alert" className="form-summary" data-testid="resolve-summary">
              <h3 className="form-summary__title">{t("p6.form.summary")}</h3>
              <ul>
                {errList.map((f) => (
                  <li key={f}>
                    <a href={`#resolve-${f}`}>{errText(f)}</a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <fieldset className="choice-set" aria-describedby={errors.target ? "resolve-target-error" : undefined}>
            <legend>{t("p6.resolve.target")}</legend>
            {targets.map((target) => (
              <label key={target} className="choice">
                <input
                  type="radio"
                  name="resolve-target"
                  id={`resolve-target-${target}`}
                  value={target}
                  checked={values.target === target}
                  onChange={() => set({ target: target as CommandableTarget })}
                  aria-labelledby={`resolve-target-${target}-name`}
                  aria-describedby={`resolve-target-${target}-hint`}
                />
                <span>
                  <strong id={`resolve-target-${target}-name`}>{t(`p6.resolve.target.${target}`)}</strong>
                  <span id={`resolve-target-${target}-hint`} className="hint choice__hint">
                    {t(`p6.resolve.target.${target}.hint`)}
                  </span>
                </span>
              </label>
            ))}
            {errors.target ? (
              <p id="resolve-target-error" className="field-error">
                <span aria-hidden="true">⚠ </span>
                {errText("target")}
              </p>
            ) : null}
          </fieldset>
          {values.target === "EXTERNAL_AGENCY_ASSIGNED" || (values.target === "HANDOFF_LOGGED" && j.externalAgencyLabel) ? (
            <Field
              id="resolve-agencyLabel"
              label={t(values.target === "HANDOFF_LOGGED" ? "p6.resolve.agency.handoff" : "p6.resolve.agency")}
              hint={fill(t("p6.resolve.agency.hint"), { max: AGENCY_LABEL_MAX })}
              error={errText("agencyLabel")}
            >
              <input
                id="resolve-agencyLabel"
                type="text"
                autoComplete="off"
                value={values.agencyLabel}
                placeholder={values.target === "HANDOFF_LOGGED" ? (j.externalAgencyLabel ?? "") : ""}
                onChange={(e) => set({ agencyLabel: e.target.value })}
                aria-invalid={errors.agencyLabel ? true : undefined}
                aria-describedby={describedBy("resolve-agencyLabel", true, !!errors.agencyLabel)}
              />
            </Field>
          ) : null}
          <Field
            id="resolve-rationale"
            label={t("p6.resolve.rationale")}
            hint={t("p6.resolve.rationale.hint")}
            error={errText("rationale")}
            counter={fill(t("p6.resolve.counter"), { used: [...values.rationale.trim()].length, max: RATIONALE_MAX })}
          >
            <textarea
              id="resolve-rationale"
              rows={3}
              autoComplete="off"
              value={values.rationale}
              onChange={(e) => set({ rationale: e.target.value })}
              aria-invalid={errors.rationale ? true : undefined}
              aria-describedby={describedBy("resolve-rationale", true, !!errors.rationale)}
            />
          </Field>
          <p id="resolve-disclaimer" className="hint">
            {t("p6.resolve.disclaimer")}
          </p>
          {mutation.isError ? (
            <div className="form-failed">
              <ErrorNotice error={mutation.error} />
              {stale ? (
                <div className="callout" role="status">
                  <p>{t("p6.stale.body")}</p>
                  <button
                    type="button"
                    onClick={() => {
                      mutation.reset();
                      onReload();
                    }}
                  >
                    {t("p6.stale.reload")}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="form-actions">
            <button type="submit" className="button-primary" disabled={mutation.isPending}>
              {mutation.isPending ? t("p6.form.working") : t("p6.resolve.submit")}
            </button>
          </div>
        </form>
      )}
    </Card>
  );
}

// --------------------------------------------------------------------------------------------------------- work linkage

function WorkLinkCard({
  k,
  allowed,
  candidateFromLink,
  onReload,
}: {
  k: AuthorityKundali;
  allowed: boolean;
  candidateFromLink: string | null;
  onReload: () => void;
}) {
  const { t } = useI18n();
  const i = k.issue;
  const dlp = useDlpExceptionsQuery(allowed && i.workOrderId === null);
  const candidate: DlpExceptionItem | undefined = dlp.data?.data.find((x) => x.issueId === i.id);
  // The form unmounts once the refreshed record shows the link, so its confirmation is kept here.
  const [done, setDone] = useState<{ work: string; version: number; correlationId: string } | null>(null);
  return (
    <Card id="link-heading" title={t("p6.link.title")}>
      <p className="hint">{t("p6.link.intro")}</p>
      {done ? (
        <div className="callout" role="status" data-testid="link-success">
          <p>
            <strong>{t("p6.link.done")}</strong> {fill(t("p6.link.doneBody"), { work: done.work, version: done.version })}
          </p>
          <p className="hint">
            {t("p1.error.correlation")}: <code>{done.correlationId}</code>
          </p>
        </div>
      ) : null}
      {i.workOrderId ? (
        <LinkedWork k={k} />
      ) : i.assetId === null ? (
        <DataNotice state="empty" title={t("p6.link.noAsset.title")} live="status">
          <p>{t("p6.link.noAsset.body")}</p>
        </DataNotice>
      ) : (
        <>
          <p>
            {fill(t("p6.link.unlinked"), { asset: k.asset ? k.asset.displayName : i.assetId })} <code>{i.assetId}</code>
          </p>
          {!allowed ? (
            <PersonaGate />
          ) : (
            <>
              {dlp.isPending ? <LoadingNotice /> : null}
              {dlp.isError ? <ErrorNotice error={dlp.error} onRetry={() => void dlp.refetch()} /> : null}
              {candidate ? <Candidate item={candidate} /> : dlp.isSuccess ? <p className="hint">{t("p6.link.noCandidate")}</p> : null}
              <LinkForm
                k={k}
                candidate={candidate?.candidateWorkOrderId ?? null}
                initial={candidateFromLink}
                onReload={onReload}
                onLinked={(r) => setDone({ work: r.data.workOrderId ?? "", version: r.data.recordVersion, correlationId: r.correlationId })}
              />
            </>
          )}
        </>
      )}
    </Card>
  );
}

function LinkedWork({ k }: { k: AuthorityKundali }) {
  const { t } = useI18n();
  const w = k.workOrder;
  const dlp = k.dlpStatus;
  return (
    <div data-testid="linked-work">
      <p>
        <Tag tone="active" icon="🔗" label={t("p6.link.linkedBadge")} />
      </p>
      {w ? (
        <Facts>
          <Fact label={t("p6.link.work")}>
            {w.displayTitle} <code>{w.id}</code>
          </Fact>
          <Fact label={t("p6.link.workStatus")}>{t(`p6.work.status.${w.status}`)}</Fact>
          <Fact label={t("p6.link.dlpEnds")}>{utc(w.dlpEndsAt)}</Fact>
        </Facts>
      ) : null}
      {dlp ? (
        <>
          <p>
            <DlpTag status={dlp.status} />
          </p>
          <p className="hint">
            {t("p6.dlp.evaluated")}: {utc(dlp.evaluatedAt)}
          </p>
          {showsPotentialDlp(dlp.status) ? <p className="callout">{t("p6.dlp.claimSafe")}</p> : null}
          <p>{dlp.warrantyPathNote}</p>
        </>
      ) : null}
      <p className="hint">{t("p6.link.neverReplaced")}</p>
      {w ? (
        <p>
          <Link className="button-link" to={tracePath({ workOrderId: w.id })}>
            {t("p6.link.openTrace")}
          </Link>
        </p>
      ) : null}
    </div>
  );
}

function Candidate({ item }: { item: DlpExceptionItem }) {
  const { t } = useI18n();
  return (
    <div className="callout" data-testid="dlp-candidate">
      <p>
        <DlpTag status={item.dlpStatus.status} /> <code>{item.candidateWorkOrderId}</code>
      </p>
      <p>{t("p6.dlp.claimSafe")}</p>
      <p className="hint">{t("p6.link.candidateNote")}</p>
    </div>
  );
}

function LinkForm({
  k,
  candidate,
  initial,
  onReload,
  onLinked,
}: {
  k: AuthorityKundali;
  candidate: string | null;
  initial: string | null;
  onReload: () => void;
  onLinked: (r: { data: { workOrderId: string | null; recordVersion: number }; correlationId: string }) => void;
}) {
  const { t } = useI18n();
  const [values, setValues] = useState<LinkValues>({ workOrderId: initial ?? "", rationale: "" });
  const [errors, setErrors] = useState<LinkErrors>({});
  const [showErrors, setShowErrors] = useState(false);
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const mutation = useLinkWork();

  const set = (patch: Partial<LinkValues>) => {
    const next = { ...values, ...patch };
    setValues(next);
    if (showErrors) {
      const r = validateLink(next);
      setErrors(r.ok ? {} : r.errors);
    }
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (mutation.isPending) return;
    const r = validateLink(values);
    if (!r.ok) {
      setErrors(r.errors);
      setShowErrors(true);
      queueMicrotask(() => summaryRef.current?.focus());
      return;
    }
    setErrors({});
    const fp = fingerprint([k.issue.id, k.issue.recordVersion, r.payload]);
    if (!attempt.current || attempt.current.fingerprint !== fp) attempt.current = { fingerprint: fp, key: newOperationalId() };
    mutation.mutate(
      { issueId: k.issue.id, recordVersion: k.issue.recordVersion, payload: r.payload, key: attempt.current.key },
      { onSuccess: (res) => onLinked(res) },
    );
  };
  const errList = (["workOrderId", "rationale"] as const).filter((f) => errors[f]);
  const errText = (f: keyof LinkErrors) => (errors[f] ? t(`p6.link.error.${errors[f]}`) : null);
  const stale = mutation.error instanceof ApiProblemError && mutation.error.status === 409;

  return (
    <form onSubmit={onSubmit} noValidate aria-describedby="link-disclaimer">
      {showErrors && errList.length > 0 ? (
        <div ref={summaryRef} tabIndex={-1} role="alert" className="form-summary" data-testid="link-summary">
          <h3 className="form-summary__title">{t("p6.form.summary")}</h3>
          <ul>
            {errList.map((f) => (
              <li key={f}>
                <a href={`#link-${f}`}>{errText(f)}</a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <Field
        id="link-workOrderId"
        label={t("p6.link.field.work")}
        hint={t("p6.link.field.work.hint")}
        error={errText("workOrderId")}
      >
        <input
          id="link-workOrderId"
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={values.workOrderId}
          onChange={(e) => set({ workOrderId: e.target.value })}
          aria-invalid={errors.workOrderId ? true : undefined}
          aria-describedby={describedBy("link-workOrderId", true, !!errors.workOrderId)}
        />
      </Field>
      {candidate && values.workOrderId !== candidate ? (
        <p>
          <button type="button" onClick={() => set({ workOrderId: candidate })}>
            {fill(t("p6.link.useCandidate"), { id: candidate })}
          </button>
        </p>
      ) : null}
      <Field
        id="link-rationale"
        label={t("p6.resolve.rationale")}
        hint={t("p6.resolve.rationale.hint")}
        error={errText("rationale")}
        counter={fill(t("p6.resolve.counter"), { used: [...values.rationale.trim()].length, max: RATIONALE_MAX })}
      >
        <textarea
          id="link-rationale"
          rows={3}
          autoComplete="off"
          value={values.rationale}
          onChange={(e) => set({ rationale: e.target.value })}
          aria-invalid={errors.rationale ? true : undefined}
          aria-describedby={describedBy("link-rationale", true, !!errors.rationale)}
        />
      </Field>
      <p id="link-disclaimer" className="hint">
        {t("p6.link.disclaimer")}
      </p>
      {mutation.isError ? (
        <div className="form-failed">
          <ErrorNotice error={mutation.error} />
          {stale ? (
            <div className="callout" role="status">
              <p>{t("p6.stale.body")}</p>
              <button
                type="button"
                onClick={() => {
                  mutation.reset();
                  onReload();
                }}
              >
                {t("p6.stale.reload")}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="form-actions">
        <button type="submit" className="button-primary" disabled={mutation.isPending}>
          {mutation.isPending ? t("p6.form.working") : t("p6.link.submit")}
        </button>
      </div>
    </form>
  );
}

// --------------------------------------------------------------------------------------------------------------- audit

function AuditCard({ k }: { k: AuthorityKundali }) {
  const { t } = useI18n();
  const all = [...k.auditEvents].sort((a, b) => a.sequence - b.sequence);
  const recent = all.slice(-AUDIT_PREVIEW).reverse();
  const older = all.slice(0, Math.max(0, all.length - AUDIT_PREVIEW)).reverse();
  const row = (e: (typeof all)[number]) => (
    <li key={e.id} className="audit-row">
      <p className="audit-row__head">
        <span className="audit-row__seq">#{e.sequence}</span> <strong>{eventLabel(e.eventType)}</strong>
      </p>
      <p className="audit-row__meta">
        {utc(e.occurredAt)} · {t(`p6.role.${e.actorRole}`)}
      </p>
      <p>{e.summary}</p>
    </li>
  );
  return (
    <Card id="audit-heading" title={t("p6.audit.title")}>
      <p className="hint">{t("p6.audit.note")}</p>
      {all.length === 0 ? <p>{t("p6.audit.none")}</p> : <ol className="audit-list">{recent.map(row)}</ol>}
      {older.length > 0 ? (
        <Disclosure summary={fill(t("p6.audit.older"), { count: older.length })}>
          <ol className="audit-list">{older.map(row)}</ol>
        </Disclosure>
      ) : null}
    </Card>
  );
}
