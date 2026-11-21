import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createI18n } from "./index";
import { DEFAULT_LANGUAGE, isLanguage, type Language } from "./resources";

export type Translate = (key: string) => string;

interface I18nValue {
  language: Language;
  /** Ignores values outside the supported language list. */
  setLanguage: (next: unknown) => void;
  t: Translate;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ initialLanguage = DEFAULT_LANGUAGE, children }: { initialLanguage?: Language; children: ReactNode }) {
  const [instance] = useState(() => createI18n(initialLanguage));
  const [language, setLanguageState] = useState<Language>(initialLanguage);

  const setLanguage = useCallback(
    (next: unknown) => {
      if (!isLanguage(next)) return;
      void instance.changeLanguage(next);
      setLanguageState(next);
    },
    [instance],
  );

  // A fixed translator per language keeps rendering deterministic and independent of async language switching.
  const t = useMemo<Translate>(() => {
    const fixed = instance.getFixedT(language);
    return (key) => String(fixed(key));
  }, [instance, language]);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}
