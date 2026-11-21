import { describe, expect, it } from "vitest";
import contextSource from "./PersonaContext.tsx?raw";
import { DEFAULT_PERSONA, DEMO_PERSONAS, coercePersona, isDemoPersona, personaLabelKey } from "./personas";
import { en } from "../i18n/resources";

describe("persona enum handling", () => {
  it("accepts exactly the six contract values", () => {
    expect([...DEMO_PERSONAS]).toEqual(["public", "citizen", "authority", "moderator", "independent_reviewer", "demo_admin"]);
    for (const p of DEMO_PERSONAS) expect(isDemoPersona(p)).toBe(true);
  });

  it.each(["system", "Public", "admin", "", " citizen", null, undefined, 3, {}])("rejects %j and falls back safely", (v) => {
    expect(isDemoPersona(v)).toBe(false);
    expect(coercePersona(v)).toBe(DEFAULT_PERSONA);
  });

  it("keeps translated labels separate from wire values", () => {
    for (const p of DEMO_PERSONAS) {
      expect(en[personaLabelKey(p)]).toBeDefined();
      expect(en[personaLabelKey(p)]).not.toBe(p);
    }
  });

  it("does not persist the persona anywhere in the browser (presentation lens only)", () => {
    expect(contextSource).not.toMatch(/localStorage|sessionStorage|document\.cookie|indexedDB/);
  });
});
