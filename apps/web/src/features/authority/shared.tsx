import { useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Tag } from "../../components/Card";
import { StatusBadge } from "../../components/StatusBadge";
import { useI18n } from "../../i18n/I18nContext";
import { usePersona } from "../../state/PersonaContext";
import { kundaliPath } from "../dossier/links";
import { NO_FILTERS } from "../map-list/filters";
import type { IssueSummary } from "../map-list/model";
import { useIssuesQuery } from "../map-list/queries";
import { fill } from "../report/present";
import { DLP_STYLE } from "../dossier/present";
import { JURISDICTION_STYLE } from "./present";

/** Shown instead of authority content for every persona except Authority. No authority request is made for them. */
export function PersonaGate() {
  const { t } = useI18n();
  const { persona } = usePersona();
  return (
    <p className="callout" role="status" data-testid="persona-gate">
      {fill(t("p6.persona.blocked"), { persona: t(`persona.option.${persona}`) })}
    </p>
  );
}

/** The jurisdiction state as text plus a distinct glyph; the tone only adds a border style, never the meaning. */
export function JurisdictionTag({ status }: { status: string }) {
  const { t } = useI18n();
  const s = JURISDICTION_STYLE[status] ?? { icon: "•", tone: "neutral" as const };
  return <Tag tone={s.tone} icon={s.icon} label={t(`p4.jurisdiction.${status}`)} />;
}

/** The derived DLP state as text plus a distinct glyph. It is the server's value for the request instant, never stored. */
export function DlpTag({ status }: { status: string }) {
  const { t } = useI18n();
  const s = DLP_STYLE[status] ?? { icon: "•", tone: "neutral" as const };
  return <Tag tone={s.tone} icon={s.icon} label={t(`p4.dlp.status.${status}`)} />;
}

/**
 * The public issue list, used only to turn identifiers into display titles. It is one request for the whole page (the same
 * list PAGE-01 reads), never one request per row.
 */
export function useIssueIndex() {
  const q = useIssuesQuery(NO_FILTERS);
  const index = useMemo(() => {
    const m = new Map<string, IssueSummary>();
    for (const i of q.data?.data.items ?? []) m.set(i.id, i);
    return m;
  }, [q.data]);
  return { query: q, index };
}

export interface RowAction {
  readonly to: string;
  readonly label: string;
}

/** One queue row: title, state, identifier and a single next action. Compact on desktop, a labelled card on mobile. */
export function QueueRow({
  id,
  issue,
  actions,
  children,
}: {
  id: string;
  issue: IssueSummary | undefined;
  actions: readonly RowAction[];
  children?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <li className="queue-row">
      <div className="queue-row__main">
        <p className="queue-row__title">{issue ? issue.title : t("p6.row.titleUnavailable")}</p>
        <p className="queue-row__meta">
          {issue ? <StatusBadge status={issue.status} /> : null} <code>{id}</code>
        </p>
        {children}
      </div>
      <div className="queue-row__actions">
        {actions.map((a) => (
          <Link key={a.to + a.label} className="button-link" to={a.to}>
            {a.label}
          </Link>
        ))}
        {issue ? (
          <Link className="button-link" to={kundaliPath(id)}>
            {t("p6.row.kundali")}
          </Link>
        ) : null}
      </div>
    </li>
  );
}

export function describedBy(id: string, hasHint: boolean, hasError: boolean): string | undefined {
  const parts = [hasHint ? `${id}-hint` : null, hasError ? `${id}-error` : null].filter(Boolean);
  return parts.length ? parts.join(" ") : undefined;
}

export function Field({
  id,
  label,
  hint,
  error,
  counter,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
  counter?: string;
  children: ReactNode;
}) {
  return (
    <div className="field" data-invalid={error ? "true" : undefined}>
      <label htmlFor={id} className="field__label">
        {label}
      </label>
      {hint ? (
        <p id={`${id}-hint`} className="hint field__hint">
          {hint}
        </p>
      ) : null}
      {children}
      {counter ? <p className="hint field__counter">{counter}</p> : null}
      {error ? (
        <p id={`${id}-error`} className="field-error">
          <span aria-hidden="true">⚠ </span>
          {error}
        </p>
      ) : null}
    </div>
  );
}
