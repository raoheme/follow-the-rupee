import { useEffect, useRef } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useI18n } from "../i18n/I18nContext";
import { routeForPath } from "../routes";
import { ControlBar } from "./ControlBar";
import { DisclosureBanner } from "./DisclosureBanner";
import { ErrorBoundary } from "./ErrorBoundary";
import { NavMenu } from "./NavMenu";

/**
 * Responsive application shell shared by every route: skip link, persistent disclosure banner, header with the
 * persona and language controls, navigation, a single <main> landmark and a footer. On client-side navigation the
 * document title is updated and focus moves to the page heading, so keyboard and screen-reader users are not left on
 * the previous page's link (the static banner is not re-announced).
 */
export function AppShell() {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const first = useRef(true);
  const route = routeForPath(pathname);
  const pageName = route ? t(route.nameKey) : t("notfound.title");

  useEffect(() => {
    document.title = `${pageName} · ${t("app.title")}`;
  }, [pageName, t]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    document.getElementById("page-heading")?.focus();
  }, [pathname]);

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        {t("skip.toMain")}
      </a>
      <DisclosureBanner />
      <header className="app-header">
        <div className="brand">
          <p className="brand__name">{t("app.title")}</p>
          <p className="brand__tagline">{t("app.tagline")}</p>
        </div>
        <ControlBar />
      </header>
      <div className="shell-body">
        <NavMenu />
        <main id="main" tabIndex={-1}>
          <ErrorBoundary resetKey={pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
      <footer className="app-footer">
        <p>{t("footer.text")}</p>
      </footer>
    </div>
  );
}
