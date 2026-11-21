import type { ReactNode } from "react";
import { useI18n } from "../../i18n/I18nContext";
import { describeError, type ErrorView } from "./describeError";

type NoticeState = "loading" | "empty" | "partial" | "unavailable" | "error";

const ICONS: Record<NoticeState, string> = { loading: "⟳", empty: "∅", partial: "◑", unavailable: "⚠", error: "⚠" };

/** Same visual vocabulary as StateNotice, with caller-supplied text so live responses can be described exactly. */
export function DataNotice({
  state,
  title,
  children,
  live,
}: {
  state: NoticeState;
  title: string;
  children?: ReactNode;
  /** Errors are announced (`alert`); other state changes use a polite status. */
  live?: "alert" | "status";
}) {
  return (
    <section className="state-notice" data-state={state} role={live} aria-label={title}>
      <span className="state-notice__icon" aria-hidden="true">
        {ICONS[state]}
      </span>
      <div>
        <h3 className="state-notice__title">{title}</h3>
        {children}
      </div>
    </section>
  );
}

export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useI18n();
  const view: ErrorView = describeError(error);
  if (view.kind === "aborted") return null;
  const state: NoticeState = view.kind === "unavailable" ? "unavailable" : "error";
  const title =
    view.kind === "unavailable"
      ? t("p1.error.unavailable.title")
      : view.kind === "problem"
        ? t("p1.error.problem.title")
        : t("p1.error.unexpected.title");
  return (
    <DataNotice state={state} title={title} live="alert">
      {view.kind === "unavailable" ? <p>{t("p1.error.unavailable.body")}</p> : null}
      {view.kind === "unexpected" ? <p>{t("p1.error.unexpected.body")}</p> : null}
      {view.kind === "problem" ? (
        <p>
          {view.title}
          {view.detail ? `: ${view.detail}` : ""}
        </p>
      ) : null}
      {"status" in view && view.status !== undefined ? (
        <p>
          {t("p1.error.status")}: {view.status}
        </p>
      ) : null}
      {"correlationId" in view && view.correlationId ? (
        <p>
          {t("p1.error.correlation")}: <code>{view.correlationId}</code>
        </p>
      ) : null}
      {onRetry ? (
        <button type="button" onClick={onRetry}>
          {t("p1.error.retry")}
        </button>
      ) : null}
    </DataNotice>
  );
}
