import { describe, expect, it } from "vitest";
import { createI18n } from "./index";
import { LANGUAGES, en, hi, mr, type Language } from "./resources";

const bundles: Record<Language, Readonly<Record<string, string>>> = { en, hi, mr };

describe("i18n shell bundles", () => {
  it("resolves every required shell key to non-empty text in every selected language", () => {
    for (const lang of LANGUAGES) {
      const t = createI18n(lang).getFixedT(lang);
      for (const key of Object.keys(en)) {
        const text = String(t(key));
        expect(text.trim(), `${lang}:${key}`).not.toBe("");
        expect(text, `${lang}:${key} must not fall through to the raw key`).not.toBe(key);
      }
    }
  });

  it("English is complete and has no blank values", () => {
    for (const [k, v] of Object.entries(en)) expect(v.trim(), k).not.toBe("");
  });

  it("hi and mr only define keys that exist in English (no orphan keys)", () => {
    for (const lang of ["hi", "mr"] as const) {
      for (const k of Object.keys(bundles[lang])) expect(en[k], `${lang}:${k}`).toBeDefined();
    }
  });

  it("falls back to English for keys the starter bundles intentionally omit", () => {
    for (const lang of ["hi", "mr"] as const) {
      const omitted = Object.keys(en).filter((k) => !(k in bundles[lang]));
      expect(omitted.length).toBeGreaterThan(0); // starter bundles are bounded, not full localization
      const t = createI18n(lang).getFixedT(lang);
      for (const k of omitted) expect(String(t(k))).toBe(en[k]);
    }
  });

  it("treats an empty translated string as missing and falls back to English", () => {
    const i = createI18n("hi");
    i.addResource("hi", "translation", "banner.label", "");
    expect(String(i.getFixedT("hi")("banner.label"))).toBe(en["banner.label"]);
  });

  it("actually translates the banner, nav and status vocabulary in hi and mr", () => {
    for (const lang of ["hi", "mr"] as const) {
      for (const k of ["banner.text", "nav.menu", "status.VERIFIED_COMPLETE", "persona.disclaimer"]) {
        expect(bundles[lang][k], `${lang}:${k}`).toBeDefined();
        expect(bundles[lang][k]).not.toBe(en[k]);
      }
    }
  });

  it("keeps SYN-DEMO-* identifiers stable across languages", () => {
    for (const lang of LANGUAGES) expect(bundles[lang]["banner.detail"] ?? en["banner.detail"]).toContain("SYN-DEMO-*");
  });

  it("keeps persona wire values and route paths out of the translated text", () => {
    for (const lang of LANGUAGES) {
      for (const v of Object.values(bundles[lang])) expect(v).not.toMatch(/\/page-\d\d/);
    }
  });

  it("falls back to English for an unsupported language instead of rendering blanks", () => {
    const i = createI18n("en");
    expect(String(i.getFixedT("fr")("app.title"))).toBe(en["app.title"]);
  });
});
