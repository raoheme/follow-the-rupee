import { useI18n } from "../i18n/I18nContext";
import type { PageRoute } from "../routes";
import { StateNotice } from "./StateNotice";

/** Honest placeholder for a page whose implementation belongs to a later phase. Shows no operational data. */
export function PagePlaceholder({ page }: { page: PageRoute }) {
  const { t } = useI18n();
  return (
    <article aria-labelledby="page-heading">
      <h1 id="page-heading" tabIndex={-1}>
        {t(page.nameKey)}
      </h1>
      <StateNotice kind="notImplemented" />
      <dl className="facts">
        <div>
          <dt>{t("placeholder.pageId")}</dt>
          <dd>{page.pageId}</dd>
        </div>
        <div>
          <dt>{t("placeholder.owner")}</dt>
          <dd>{page.owningPhases.join(" / ")}</dd>
        </div>
      </dl>
      {page.pageId === "PAGE-12" ? <p>{t("placeholder.p12")}</p> : null}
    </article>
  );
}
