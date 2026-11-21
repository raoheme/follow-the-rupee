/**
 * Simulated demonstration persona: a presentation lens only. It is not identity, authentication or authorization.
 *
 * Wire values are the exact strings sent in the X-Demo-Persona header. openapi.yaml declares the header as an apiKey
 * scheme without an enum; the contract enum that carries these roles is LifecycleEvent.actorRole, whose values are
 * these six plus the server-only "system" (persona-enum.test.ts compares against the frozen schema). Translated labels
 * live in the i18n bundles and are looked up by key; the wire value is never translated.
 */
export const DEMO_PERSONAS = [
  "public",
  "citizen",
  "authority",
  "moderator",
  "independent_reviewer",
  "demo_admin",
] as const;

export type DemoPersona = (typeof DEMO_PERSONAS)[number];

export const DEFAULT_PERSONA: DemoPersona = "public";

/** Exact contract wording; shown beside the selector in English and used as the reference text for translations. */
export const PERSONA_DISCLAIMER_EN = "Simulated demonstration persona, not authentication or authorization.";

export function isDemoPersona(value: unknown): value is DemoPersona {
  return typeof value === "string" && (DEMO_PERSONAS as readonly string[]).includes(value);
}

/** Validate an untrusted value against the fixed enum; anything else falls back to the safe default. */
export function coercePersona(value: unknown): DemoPersona {
  return isDemoPersona(value) ? value : DEFAULT_PERSONA;
}

export function personaLabelKey(persona: DemoPersona): string {
  return `persona.option.${persona}`;
}
