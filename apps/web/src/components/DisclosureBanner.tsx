import { useI18n } from "../i18n/I18nContext";

/**
 * The single persistent global disclosure. It is one compact line of text (two on a narrow phone) plus ONE lightweight
 * "About this demo" disclosure (native details/summary) that holds the longer caveats, so routine page text never has to
 * repeat them. Rendered by the shell outside <main>, so it is present on every route including not-found and error states.
 * It is a static named region, not a live region: it never changes and is not re-announced on client-side navigation.
 */
export function DisclosureBanner() {
  const { t } = useI18n();
  return (
    <section className="demo-banner" aria-label={t("banner.label")} data-testid="disclosure-banner">
      <p className="demo-banner__text">{t("banner.text")}</p>
      <details className="about-demo">
        <summary>{t("about.summary")}</summary>
        <div className="about-demo__body">
          <p>{t("banner.detail")}</p>
          <p>{t("about.synthetic")}</p>
          <p>{t("about.claims")}</p>
          <p>{t("about.persona")}</p>
          <p>{t("about.basemap")}</p>
        </div>
      </details>
    </section>
  );
}
