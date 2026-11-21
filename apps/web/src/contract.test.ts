import { describe, expect, it } from "vitest";
import pagesJson from "../../../wireframes/pages.json";
import lifecycleSchema from "../../../schemas/lifecycle-event.schema.json";
import openapi from "../../../openapi/openapi.yaml?raw";
import moneyRs from "../../../crates/domain/src/money.rs?raw";
import { HEADER_CORRELATION_ID, HEADER_IDEMPOTENCY_KEY, HEADER_IF_MATCH, HEADER_PERSONA } from "./api/client";
import { formatInr } from "./lib/currency";
import { en } from "./i18n/resources";
import { DEMO_PERSONAS, PERSONA_DISCLAIMER_EN } from "./state/personas";
import { HOME_PATH, PAGE_IDS, PAGE_ROUTES } from "./routes";
import { ISSUE_STATUSES } from "./components/status";

/**
 * Drift guards against the frozen P1 artifacts. They read the contract files directly (read-only), so a change to
 * wireframes/pages.json, the persona roles, the OpenAPI headers/statuses or the Rust money rules fails here.
 */
describe("route inventory vs wireframes/pages.json", () => {
  const pages = pagesJson.pages;

  it("has exactly PAGE-01..PAGE-12 in order, matching the wireframe file", () => {
    expect(pages.map((p) => p.pageId)).toEqual([...PAGE_IDS]);
    expect(PAGE_ROUTES.map((r) => r.pageId)).toEqual(pages.map((p) => p.pageId));
    expect(pagesJson.implementationPageCount).toBe(12);
  });

  it("uses the wireframe page names as the English names", () => {
    for (const p of pages) {
      const route = PAGE_ROUTES.find((r) => r.pageId === p.pageId)!;
      expect(route.englishName).toBe(p.name);
      expect(en[route.nameKey]).toBe(p.name);
    }
  });

  it("derives paths from page ids (not titles), unique and rooted", () => {
    const paths = PAGE_ROUTES.map((r) => r.path);
    expect(new Set(paths).size).toBe(12);
    for (const r of PAGE_ROUTES) expect(r.path).toBe(`/${r.pageId.toLowerCase()}`);
    expect(HOME_PATH).toBe("/page-01");
  });
});

describe("persona enum vs frozen contract", () => {
  it("matches LifecycleEvent.actorRole without the server-only 'system' role", () => {
    const roles = (lifecycleSchema.properties.actorRole.enum as string[]).filter((r) => r !== "system");
    expect([...DEMO_PERSONAS]).toEqual(roles);
  });

  it("reuses the exact contract wording for the persona disclaimer", () => {
    expect(openapi).toContain(`description: ${PERSONA_DISCLAIMER_EN}`);
    expect(en["persona.disclaimer"]).toBe(PERSONA_DISCLAIMER_EN);
  });

  it("keeps the header name identical to the contract", () => {
    expect(openapi).toMatch(/name: X-Demo-Persona\b/);
    expect(HEADER_PERSONA).toBe("X-Demo-Persona");
  });
});

describe("API header names vs openapi.yaml", () => {
  it.each([HEADER_CORRELATION_ID, HEADER_IDEMPOTENCY_KEY, HEADER_IF_MATCH])("declares %s", (name) => {
    expect(openapi).toMatch(new RegExp(`name: ${name}\\n`));
  });

  it("keeps If-Match scoped to resolveJurisdiction only", () => {
    expect(openapi.match(/parameters\/IfMatch/g)).toHaveLength(1);
  });

  it("covers every contract IssueStatus", () => {
    const block = openapi.split("Status:\n")[1] ?? "";
    for (const s of ISSUE_STATUSES) expect(openapi).toContain(`- ${s}`);
    expect(block.length).toBeGreaterThan(0);
  });

  it("requires Problem fields the client validates", () => {
    const problem = openapi.slice(openapi.indexOf("    Problem:\n"));
    for (const f of ["- type", "- title", "- status", "- correlationId"]) expect(problem.slice(0, 400)).toContain(f);
  });
});

describe("currency formatter parity with crates/domain/src/money.rs", () => {
  it("reproduces every Rust assert_eq!(f(N), \"text\") vector", () => {
    const vectors = [...moneyRs.matchAll(/assert_eq!\(f\(([\d_]+)\), "([^"]+)"\)/g)].map((m) => ({
      paise: Number(m[1]!.replaceAll("_", "")),
      text: m[2]!,
    }));
    expect(vectors.length).toBeGreaterThanOrEqual(15);
    for (const v of vectors) expect(formatInr(v.paise), `${v.paise}`).toBe(v.text);
  });
});
