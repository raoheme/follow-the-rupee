import { Link } from "react-router-dom";
import { Card, Disclosure, Fact, Facts } from "../../components/Card";
import { StatusBadge } from "../../components/StatusBadge";
import type { IssueStatus } from "../../components/status";
import { useI18n } from "../../i18n/I18nContext";
import { formatInr } from "../../lib/currency";
import { usePersona } from "../../state/PersonaContext";
import { kundaliPath, tracePath } from "../dossier/links";
import { LoadingNotice, QueryFailure } from "../dossier/states";
import { DataNotice } from "../map-list/DataNotice";
import type { DlpExceptionItem } from "./model";
import { jurisdictionWorkPath, personaIsAuthority, utc } from "./present";
import { useDlpExceptionsQuery } from "./queries";
import { DlpTag, PersonaGate, useIssueIndex } from "./shared";

/**
 * PAGE-10: Completion / DLP (AUTH-009 DLP exception view). In P6 this page owns the DLP half only: unlinked open defects on an
 * asset whose certified work is inside its defect liability period at the one evaluation instant of the request. A match is a
 * temporal overlap that needs contractual verification; it is never presented as liability, an obligation on a contractor or a
 * cost outcome. The completion-claim half (AUTH-007) belongs to the later verification phase and is stated as such, not faked.
 */
export function DlpPage() {
  const { t } = useI18n();
  const { persona } = usePersona();
  const allowed = personaIsAuthority(persona);
  const q = useDlpExceptionsQuery(allowed);
  const { query: issuesQ, index } = useIssueIndex();
  return (
    <article aria-labelledby="page-heading" className="dlp">
      <h1 id="page-heading" tabIndex={-1}>
        {t("page.PAGE-10.name")}
      </h1>
      <p className="hint">{t("p6.dlp.intro")}</p>
      {!allowed ? <PersonaGate /> : null}
      {allowed ? (
        q.isPending ? (
          <LoadingNotice />
        ) : q.isError ? (
          <QueryFailure error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <>
            <p className="callout" data-testid="dlp-claim-safe">
              {t("p6.dlp.claimSafe")}
            </p>
            {issuesQ.isError ? (
              <DataNotice state="partial" title={t("p6.titles.failed.title")} live="status">
                <p>{t("p6.titles.failed.body")}</p>
              </DataNotice>
            ) : null}
            <Card id="dlp-exceptions-heading" title={t("p6.dlp.list.title")}>
              {q.data.data.length === 0 ? (
                <DataNotice state="empty" title={t("p6.dlp.empty.title")} live="status">
                  <p>{t("p6.dlp.empty.body")}</p>
                </DataNotice>
              ) : (
                <ul className="queue">
                  {q.data.data.map((item) => (
                    <ExceptionRow key={`${item.issueId}-${item.candidateWorkOrderId}`} item={item} title={index.get(item.issueId)?.title ?? null} status={index.get(item.issueId)?.status ?? null} />
                  ))}
                </ul>
              )}
              <p className="hint">
                {t("p1.error.correlation")}: <code>{q.data.correlationId}</code>
              </p>
            </Card>
          </>
        )
      ) : null}
      <Card id="completion-heading" title={t("p6.completion.title")}>
        <DataNotice state="empty" title={t("p6.completion.notice")} live="status">
          <p>{t("p6.completion.body")}</p>
        </DataNotice>
      </Card>
    </article>
  );
}

function ExceptionRow({ item, title, status }: { item: DlpExceptionItem; title: string | null; status: IssueStatus | null }) {
  const { t } = useI18n();
  return (
    <li className="queue-row queue-row--dlp" data-testid="dlp-row">
      <div className="queue-row__main">
        <p className="queue-row__title">{title ?? t("p6.row.titleUnavailable")}</p>
        <p className="queue-row__meta">
          {status ? <StatusBadge status={status} /> : null} <code>{item.issueId}</code>
        </p>
        <p>
          <DlpTag status={item.dlpStatus.status} /> {t("p6.dlp.candidate")} <code>{item.candidateWorkOrderId}</code>
        </p>
        <Facts>
          <Fact label={t("p6.dlp.evaluated")}>{utc(item.dlpStatus.evaluatedAt)}</Fact>
          <Fact label={t("p6.dlp.window")}>
            {item.dlpStatus.dlpStartsOn} – {utc(item.dlpStatus.dlpEndsAt)}
          </Fact>
          <Fact label={t("p6.dlp.estimate")}>
            {formatInr(item.syntheticFreshRepairEstimatePaise)} <span className="hint">({t("p6.dlp.potentialLabel")})</span>
          </Fact>
        </Facts>
        <Disclosure summary={t("p6.dlp.details")}>
          <p>{item.warrantyPathNote}</p>
          <p>{item.dlpStatus.explanation}</p>
          <p className="hint">{t("p6.dlp.noFreshSpend")}</p>
        </Disclosure>
      </div>
      <div className="queue-row__actions">
        <Link className="button-link button-link--primary" to={jurisdictionWorkPath(item.issueId, item.candidateWorkOrderId)}>
          {t("p6.dlp.review")}
        </Link>
        <Link className="button-link" to={kundaliPath(item.issueId)}>
          {t("p6.row.kundali")}
        </Link>
        <Link className="button-link" to={tracePath({ workOrderId: item.candidateWorkOrderId })}>
          {t("p6.link.openTrace")}
        </Link>
      </div>
    </li>
  );
}
