import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { ErrorBoundary } from "../../components/ErrorBoundary";
import { useI18n } from "../../i18n/I18nContext";
import { LANGUAGES } from "../../i18n/resources";
import { useOverview } from "./api";
import { LENSES, STRIP_TEXT, TABS, tabLabel } from "./copy";
import { EvidenceProvider } from "./EvidenceDrawer";

const LANG_NAME: Record<string, string> = { en: "EN", hi: "हिंदी", mr: "मराठी" };

function Disclosure() {
  const q = useOverview();
  const d = q.data?.meta?.model_contribution_disclosure;
  return (
    <details className="m-disclosure">
      <summary>Methodology &amp; AI Disclosure</summary>
      <div className="m-disclosure__body">
        <p>{q.data?.meta?.disclosure ?? "Synthetic challenge dataset. Not official BMC data."}</p>
        {d ? <p data-testid="model-disclosure">{d.text}</p> : <p className="m-sub">Loading disclosure…</p>}
        <p className="m-sub">Review flags are prompts for checking records, not findings of wrongdoing. Amounts are in Indian rupees. Categories overlap and are not an estimate of confirmed loss.</p>
      </div>
    </details>
  );
}

export function MonsoonShell() {
  const { language, setLanguage } = useI18n();
  const { pathname } = useLocation();
  const [lens, setLens] = useState<string>(LENSES[0].key);
  useEffect(() => {
    document.title = "Mumbai Civic Lens · Follow the Rupee";
  }, []);
  useEffect(() => {
    document.getElementById("page-heading")?.focus({ preventScroll: true });
  }, [pathname]);
  const hint = LENSES.find((l) => l.key === lens)?.hint;
  return (
    <div className="m-app">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <div className="m-strip" data-testid="disclosure-strip">
        {STRIP_TEXT}
      </div>
      <header className="m-header">
        <div className="m-header__brand">
          <b>Mumbai Civic Lens</b> <span className="m-sub">Follow the Rupee: Mumbai monsoon roads</span>
        </div>
        <div className="m-header__controls">
          <label className="m-field m-field--inline">
            <span>View as</span>
            <select value={lens} onChange={(e) => setLens(e.target.value)} aria-describedby="lens-hint">
              {LENSES.map((l) => (
                <option key={l.key} value={l.key}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <label className="m-field m-field--inline">
            <span>Language</span>
            <select value={language} onChange={(e) => setLanguage(e.target.value)}>
              {LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {LANG_NAME[l] ?? l}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Disclosure />
      </header>
      <nav className="m-tabs" aria-label="Main">
        {TABS.map((t) => (
          <NavLink key={t.key} to={t.path} end className="m-tab">
            {tabLabel(t, language)}
          </NavLink>
        ))}
      </nav>
      <p id="lens-hint" className="m-lens-hint">
        {hint}
      </p>
      <EvidenceProvider>
        <main id="main" tabIndex={-1} className="m-main">
          <ErrorBoundary resetKey={pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </EvidenceProvider>
    </div>
  );
}
