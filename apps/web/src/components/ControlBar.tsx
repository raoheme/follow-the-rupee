import { useState } from "react";
import { useI18n } from "../i18n/I18nContext";
import { LANGUAGES } from "../i18n/resources";
import { usePersona } from "../state/PersonaContext";
import { DEMO_PERSONAS, personaLabelKey } from "../state/personas";

/**
 * Persona lens and language selectors. The persona <option value> is the exact X-Demo-Persona wire value; only the
 * visible label is translated. The persona is a presentation lens, explicitly not authentication or authorization; that
 * explanation lives in an accessible helper disclosure (and is the select's accessible description) instead of sitting in
 * the header. Below 960px the two selectors sit behind one disclosure button so the page title is reached sooner.
 */
export function ControlBar() {
  const { t, language, setLanguage } = useI18n();
  const { persona, setPersona } = usePersona();
  const [open, setOpen] = useState(false);
  return (
    <div className="control-bar">
      <button
        type="button"
        className="control-bar__toggle"
        aria-expanded={open}
        aria-controls="header-controls"
        onClick={() => setOpen((o) => !o)}
      >
        {t("header.options")}
      </button>
      <div id="header-controls" className="control-bar__panel" data-open={open}>
        <div className="control">
          <label htmlFor="persona-select">{t("persona.label")}</label>
          <select
            id="persona-select"
            value={persona}
            aria-describedby="persona-disclaimer"
            onChange={(e) => setPersona(e.target.value)}
          >
            {DEMO_PERSONAS.map((p) => (
              <option key={p} value={p}>
                {t(personaLabelKey(p))}
              </option>
            ))}
          </select>
          <details className="helper">
            <summary>{t("persona.help")}</summary>
            <p id="persona-disclaimer" className="control__note">
              {t("persona.disclaimer")}
            </p>
          </details>
        </div>
        <div className="control">
          <label htmlFor="language-select">{t("locale.label")}</label>
          <select id="language-select" value={language} onChange={(e) => setLanguage(e.target.value)}>
            {LANGUAGES.map((l) => (
              <option key={l} value={l} lang={l}>
                {t(`locale.${l}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
