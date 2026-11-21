import { Link } from "react-router-dom";
import { Card, Disclosure } from "../../components/Card";
import { useI18n } from "../../i18n/I18nContext";
import { usePersona } from "../../state/PersonaContext";
import { DataNotice } from "../map-list/DataNotice";
import { tracePath } from "../dossier/links";
import { LoadingNotice, QueryFailure } from "../dossier/states";
import { fill } from "../report/present";
import type { Dashboard } from "./model";
import { jurisdictionWorkPath, personaIsAuthority, utc } from "./present";
import { useDashboardQuery } from "./queries";
import { PersonaGate, QueueRow, useIssueIndex } from "./shared";

/**
 * PAGE-08: Authority Command. One authority read (`getAuthorityDashboard`) plus the public issue list used only to put titles
 * on identifiers, so the page makes two requests in total and none per row. Rows are split into what needs a decision
 * (jurisdiction, potential DLP exceptions) and what is informational (closure claims awaiting citizen verification and budget
 * trace gaps, whose next steps belong to other pages and later phases). Institution and post are shown, never a person.
 */
export function AuthorityPage() {
  const { t } = useI18n();
  const { persona } = usePersona();
  const allowed = personaIsAuthority(persona);
  const q = useDashboardQuery(allowed);
  const { query: issuesQ, index } = useIssueIndex();

  return (
    <article aria-labelledby="page-heading" className="authority">
      <h1 id="page-heading" tabIndex={-1}>
        {t("page.PAGE-08.name")}
      </h1>
      <p className="hint">{t("p6.authority.intro")}</p>
      {!allowed ? <PersonaGate /> : null}
      {allowed ? (
        q.isPending ? (
          <LoadingNotice />
        ) : q.isError ? (
          <QueryFailure error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <DashboardContent
            d={q.data.data}
            correlationId={q.data.correlationId}
            titlesPending={issuesQ.isPending}
            titlesFailed={issuesQ.isError}
            index={index}
            onRefresh={() => void q.refetch()}
            refreshing={q.isFetching}
          />
        )
      ) : null}
    </article>
  );
}

function DashboardContent({
  d,
  correlationId,
  titlesPending,
  titlesFailed,
  index,
  onRefresh,
  refreshing,
}: {
  d: Dashboard;
  correlationId: string;
  titlesPending: boolean;
  titlesFailed: boolean;
  index: ReturnType<typeof useIssueIndex>["index"];
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const { t } = useI18n();
  const missingTitles = !titlesPending && !titlesFailed ? allIds(d).filter((id) => !index.has(id)) : [];
  const tiles: ReadonlyArray<{ key: string; icon: string; count: number; anchor: string; action: boolean }> = [
    { key: "jurisdiction", icon: "◔", count: d.uncertainJurisdictionIssueIds.length, anchor: "queue-jurisdiction", action: true },
    { key: "dlp", icon: "◉", count: d.dlpExceptionIssueIds.length, anchor: "queue-dlp", action: true },
    { key: "verification", icon: "⚑", count: d.awaitingVerificationIssueIds.length, anchor: "queue-verification", action: false },
    { key: "gaps", icon: "⚠", count: d.traceabilityGapBudgetIds.length, anchor: "queue-gaps", action: false },
  ];
  return (
    <>
      <section className="authority__summary" aria-label={t("p6.authority.summary")}>
        <p className="authority__asof">
          {fill(t("p6.authority.asOf"), { time: utc(d.asOf), open: d.openIssueCount })}
          <button type="button" className="authority__refresh" onClick={onRefresh} disabled={refreshing}>
            {t("p6.authority.refresh")}
          </button>
        </p>
        <ul className="tiles">
          {tiles.map((x) => (
            <li key={x.key} className="tile" data-action={x.action ? "true" : "false"}>
              <a href={`#${x.anchor}`} className="tile__link">
                <span className="tile__icon" aria-hidden="true">
                  {x.icon}
                </span>
                <span className="tile__count">{x.count}</span>
                <span className="tile__label">{t(`p6.tile.${x.key}`)}</span>
                <span className="tile__kind">{t(x.action ? "p6.kind.action" : "p6.kind.info")}</span>
              </a>
            </li>
          ))}
        </ul>
        {titlesFailed ? (
          <DataNotice state="partial" title={t("p6.titles.failed.title")} live="status">
            <p>{t("p6.titles.failed.body")}</p>
          </DataNotice>
        ) : null}
        {missingTitles.length > 0 ? (
          <DataNotice state="partial" title={t("p6.titles.partial.title")} live="status">
            <p>{t("p6.titles.partial.body")}</p>
          </DataNotice>
        ) : null}
      </section>

      <h2 className="authority__group">{t("p6.group.action")}</h2>
      <div className="authority-grid">
        <Card id="queue-jurisdiction" title={t("p6.queue.jurisdiction.title")}>
          <p className="hint">{t("p6.queue.jurisdiction.body")}</p>
          {d.uncertainJurisdictionIssueIds.length === 0 ? (
            <p>{t("p6.queue.empty")}</p>
          ) : (
            <ul className="queue">
              {d.uncertainJurisdictionIssueIds.map((id) => (
                <QueueRow
                  key={id}
                  id={id}
                  issue={index.get(id)}
                  actions={[{ to: jurisdictionWorkPath(id), label: t("p6.queue.jurisdiction.action") }]}
                />
              ))}
            </ul>
          )}
        </Card>
        <Card id="queue-dlp" title={t("p6.queue.dlp.title")}>
          <p className="hint">{t("p6.queue.dlp.body")}</p>
          {d.dlpExceptionIssueIds.length === 0 ? (
            <p>{t("p6.queue.empty")}</p>
          ) : (
            <ul className="queue">
              {d.dlpExceptionIssueIds.map((id) => (
                <QueueRow
                  key={id}
                  id={id}
                  issue={index.get(id)}
                  actions={[
                    { to: jurisdictionWorkPath(id), label: t("p6.queue.dlp.action") },
                    { to: "/page-10", label: t("p6.queue.dlp.view") },
                  ]}
                />
              ))}
            </ul>
          )}
          <p className="callout">{t("p6.dlp.claimSafe")}</p>
        </Card>
      </div>

      <h2 className="authority__group">{t("p6.group.info")}</h2>
      <div className="authority-grid">
        <Card id="queue-verification" title={t("p6.queue.verification.title")}>
          <p className="hint">{t("p6.queue.verification.body")}</p>
          {d.awaitingVerificationIssueIds.length === 0 ? (
            <p>{t("p6.queue.empty")}</p>
          ) : (
            <ul className="queue">
              {d.awaitingVerificationIssueIds.map((id) => (
                <QueueRow key={id} id={id} issue={index.get(id)} actions={[]} />
              ))}
            </ul>
          )}
        </Card>
        <Card id="queue-gaps" title={t("p6.queue.gaps.title")}>
          <p className="hint">{t("p6.queue.gaps.body")}</p>
          {d.traceabilityGapBudgetIds.length === 0 ? (
            <p>{t("p6.queue.empty")}</p>
          ) : (
            <ul className="queue">
              {d.traceabilityGapBudgetIds.map((id) => (
                <li key={id} className="queue-row">
                  <div className="queue-row__main">
                    <p className="queue-row__title">
                      <code>{id}</code>
                    </p>
                    <p className="queue-row__meta">{t("p6.queue.gaps.note")}</p>
                  </div>
                  <div className="queue-row__actions">
                    <Link className="button-link" to={tracePath({ budgetId: id })}>
                      {t("p6.queue.gaps.action")}
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Disclosure summary={t("p6.authority.caveats")}>
        <ul className="plain-list">
          <li>{t("p6.caveat.persona")}</li>
          <li>{t("p6.caveat.jurisdiction")}</li>
          <li>{t("p6.caveat.dlp")}</li>
          <li>{t("p6.caveat.institution")}</li>
        </ul>
        <p className="hint">
          {t("p1.error.correlation")}: <code>{correlationId}</code>
        </p>
      </Disclosure>
    </>
  );
}

function allIds(d: Dashboard): string[] {
  return [
    ...d.uncertainJurisdictionIssueIds,
    ...d.dlpExceptionIssueIds,
    ...d.awaitingVerificationIssueIds,
  ];
}
