import i18next, { type i18n as I18nInstance } from "i18next";
import { DEFAULT_LANGUAGE, LANGUAGES, resources, type Language } from "./resources";

/**
 * Creates an isolated, synchronously initialised i18next instance. Flat keys (no key/namespace separators),
 * deterministic fallback to English, and empty strings treated as missing so a blank can never be rendered.
 */
export function createI18n(language: Language = DEFAULT_LANGUAGE): I18nInstance {
  const instance = i18next.createInstance();
  void instance.init({
    lng: language,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: [...LANGUAGES],
    resources,
    keySeparator: false,
    nsSeparator: false,
    returnEmptyString: false,
    interpolation: { escapeValue: false },
    initAsync: false,
  });
  return instance;
}

export { DEFAULT_LANGUAGE, LANGUAGES } from "./resources";
export type { Language } from "./resources";
