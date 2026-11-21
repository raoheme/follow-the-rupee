import { Link } from "react-router-dom";
import { useI18n } from "../i18n/I18nContext";
import { HOME_PATH } from "../routes";

export function NotFound() {
  const { t } = useI18n();
  return (
    <article aria-labelledby="page-heading">
      <h1 id="page-heading" tabIndex={-1}>
        {t("notfound.title")}
      </h1>
      <p>{t("notfound.body")}</p>
      <p>
        <Link to={HOME_PATH} className="button-link">
          {t("notfound.home")}
        </Link>
      </p>
    </article>
  );
}
