import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { kundaliPath, tracePath } from "../dossier/links";
import { StatusBadge } from "../../components/StatusBadge";
import { isIssueStatus } from "./map/presentation";
import { useI18n } from "../../i18n/I18nContext";
import type { IssueSummary, MapFeature } from "./model";

/** `2026-10-05T04:15:00Z` -> `2026-10-05 04:15 UTC`. Timestamps are shown in UTC exactly as the API sends them. */
export function formatUtc(iso: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  return m && /Z$|\+00:00$/.test(iso) ? `${m[1]} ${m[2]} UTC` : iso;
}

/** What the inspector may show about the selection: only fields the two P3 responses already carry. */
export type Selection =
  | { readonly type: "issue"; readonly issue: IssueSummary; readonly dlpActive: boolean | null }
  | { readonly type: "feature"; readonly feature: MapFeature }
  | null;

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * Summary of the selected record. No hidden detail request is made: richer detail belongs to the Kundali page (PAGE-02,
 * phase P4), which is linked but not implemented here. The ward is only a candidate; a jurisdiction is never confirmed
 * here, and a closure claim is shown as pending verification (via the status badge and the API's own explanation).
 */
export function Inspector({ selection }: { selection: Selection }) {
  const { t } = useI18n();
  if (!selection) return <p>{t("p1.inspector.none")}</p>;

  if (selection.type === "issue") {
    const i = selection.issue;
    return (
      <div>
        <h3 className="inspector__title">{i.title}</h3>
        <p className="inspector__status">
          <StatusBadge status={i.status} />
        </p>
        <p className="inspector__explanation">{i.publicStatusExplanation}</p>
        <p className="inspector__action">
          <Link className="button-link button-link--primary" to={kundaliPath(i.id)}>
            {t("p1.inspector.open")}
          </Link>
          <span className="hint">{t("p1.inspector.openHint")}</span>
        </p>
        <dl className="facts facts--compact">
          <Fact label={t("p1.inspector.id")}>
            <code>{i.id}</code>
          </Fact>
          <Fact label={t("p1.inspector.category")}>{t(`p1.category.${i.category}`)}</Fact>
          <Fact label={t("p1.inspector.street")}>{i.streetName}</Fact>
          <Fact label={t("p1.inspector.landmark")}>{i.nearbyLandmark}</Fact>
          <Fact label={t("p1.inspector.reported")}>{formatUtc(i.reportedAt)}</Fact>
          <Fact label={t("p1.inspector.ward")}>{i.wardCandidateId ? <code>{i.wardCandidateId}</code> : t("p1.inspector.wardNone")}</Fact>
          <Fact label={t("p1.inspector.asset")}>{i.assetId ? <code>{i.assetId}</code> : t("p1.inspector.wardNone")}</Fact>
          <Fact label={t("p1.inspector.work")}>{i.workOrderId ? <code>{i.workOrderId}</code> : t("p1.inspector.workNone")}</Fact>
          {selection.dlpActive !== null ? (
            <Fact label={t("p1.inspector.dlp")}>
              {selection.dlpActive ? t("p1.inspector.dlpActive") : t("p1.inspector.dlpNone")}
            </Fact>
          ) : null}
        </dl>
        <p className="inspector__note">{t("p1.inspector.summaryOnly")}</p>
      </div>
    );
  }

  const f = selection.feature.properties;
  return (
    <div>
      <h3 className="inspector__title">{f.title}</h3>
      <dl className="facts facts--compact">
        <Fact label={t("p1.inspector.kind")}>{t(`p1.kind.${f.kind}`)}</Fact>
        <Fact label={t("p1.inspector.id")}>
          <code>{f.recordId}</code>
        </Fact>
        {f.status ? (
          <Fact label={t("p1.inspector.status")}>
            {isIssueStatus(f.status) ? <StatusBadge status={f.status} /> : <code>{f.status}</code>}
          </Fact>
        ) : null}
        <Fact label={t("p1.inspector.ward")}>{f.wardId ? <code>{f.wardId}</code> : t("p1.inspector.wardNone")}</Fact>
        <Fact label={t("p1.inspector.dlp")}>{f.dlpActive ? t("p1.inspector.dlpActive") : t("p1.inspector.dlpNone")}</Fact>
      </dl>
      <p className="inspector__note">{t("p1.inspector.summaryOnly")}</p>
      {f.kind === "PUBLIC_WORK" ? (
        <Link className="button-link button-link--primary" to={tracePath({ workOrderId: f.recordId })}>
          {t("p4.actions.trace")}
        </Link>
      ) : null}
    </div>
  );
}
