import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import { describe, expect, it, vi } from "vitest";
import machine from "../../../../../config/jurisdiction-state-machine.json";
import issuesSeed from "../../../../../data/demo/issues.json";
import jurisdictionsSeed from "../../../../../data/demo/jurisdictions.json";
import openapi from "../../../../../openapi/openapi.yaml?raw";
import authoritySrc from "./AuthorityPage.tsx?raw";
import dlpSrc from "./DlpPage.tsx?raw";
import jurisSrc from "./JurisdictionWorkPage.tsx?raw";
import queriesSrc from "./queries.ts?raw";
import { ApiClient } from "../../api/client";
import { ApiClientProvider } from "../../api/ApiClientContext";
import { ApiHttpError, ApiProblemError } from "../../api/errors";
import { App } from "../../App";
import { I18nProvider } from "../../i18n/I18nContext";
import { en } from "../../i18n/resources";
import { enP6 } from "../../i18n/resources.p6";
import { PersonaProvider } from "../../state/PersonaContext";
import { NO_FILTERS } from "../map-list/filters";
import { queryKeys } from "../map-list/queries";
import { AuthorityPage } from "./AuthorityPage";
import { DlpPage } from "./DlpPage";
import { JurisdictionWorkPage } from "./JurisdictionWorkPage";
import { dashboardResultSchema, dlpExceptionListResultSchema, jurisdictionResultSchema, linkedIssueResultSchema } from "./model";
import {
  COMMANDABLE_TARGETS,
  EMPTY_RESOLVE,
  LEGAL_TARGETS,
  fingerprint,
  jurisdictionWorkPath,
  personaIsAuthority,
  showsPotentialDlp,
  validateLink,
  validateResolve,
  type JurisdictionStatusCode,
} from "./present";
import { authorityKeys, linkWork, resolveJurisdiction } from "./queries";
import { Route, Routes } from "react-router-dom";

// ---------------------------------------------------------------------------------------------------------------- fixtures

const SEED_ISSUES = issuesSeed as unknown as Array<Record<string, unknown>>;
const SEED_JUR = jurisdictionsSeed as unknown as Array<Record<string, unknown>>;
const issue = (id: string) => SEED_ISSUES.find((i) => i.id === id)!;
const jur = (issueId: string) => SEED_JUR.find((j) => j.issueId === issueId)!;
const CID = "corr-p6-test-0001";

const DASH = {
  asOf: "2026-11-21T04:30:00Z",
  openIssueCount: 6,
  awaitingVerificationIssueIds: ["SYN-DEMO-KND-001"],
  uncertainJurisdictionIssueIds: ["SYN-DEMO-KND-002", "SYN-DEMO-KND-003", "SYN-DEMO-KND-004"],
  dlpExceptionIssueIds: ["SYN-DEMO-KND-002", "SYN-DEMO-KND-004"],
  traceabilityGapBudgetIds: ["SYN-DEMO-BUD-002"],
};

const DLP_ITEM = (issueId: string) => ({
  issueId,
  candidateWorkOrderId: "SYN-DEMO-WO-001",
  dlpStatus: {
    status: "ACTIVE",
    dlpStartsOn: "2026-04-01",
    dlpEndsAt: "2027-03-31T18:29:59Z",
    evaluatedAt: "2026-11-21T04:30:00Z",
    explanation: "The synthetic work order is inside its defect liability period.",
  },
  warrantyPathNote: "Check the contractual warranty path before proposing fresh expenditure. Financial responsibility is pending contractual verification.",
  potentialSpendLabel: "SYNTHETIC_POTENTIAL_NOT_REALIZED_SAVINGS",
  syntheticFreshRepairEstimatePaise: 1200000,
});

function kundaliFor(issueId: string, over: { workOrder?: boolean; status?: string } = {}) {
  const i = issue(issueId);
  const j = { ...jur(issueId) };
  if (over.status) {
    j.status = over.status;
    if (over.status === "CONFIRMED_BMC_WARD") j.confirmationBasis = "Confirmed in the demonstration.";
    if (over.status === "EXTERNAL_AGENCY_ASSIGNED" || over.status === "HANDOFF_LOGGED") j.externalAgencyLabel = "Synthetic metro-corridor agency placeholder";
  }
  const linked = over.workOrder === true;
  return {
    issue: { ...i, workOrderId: linked ? "SYN-DEMO-WO-001" : i.workOrderId },
    ward: { id: "SYN-DEMO-WARD-KW", code: "K/W", displayName: "K/West Ward" },
    asset: { id: i.assetId, displayName: "Paliram Road segment (synthetic)", streetName: "Paliram Road" },
    responsibleDepartment: { id: i.responsibleDepartmentId, displayName: "Roads Department" },
    jurisdiction: j,
    workOrder: linked
      ? { id: "SYN-DEMO-WO-001", displayTitle: "Synthetic resurfacing work", status: "COMPLETION_CERTIFIED_IN_DLP", dlpEndsAt: "2027-03-31T18:29:59Z" }
      : null,
    dlpStatus: linked
      ? { status: "ACTIVE", evaluatedAt: "2026-11-21T04:30:00Z", dlpEndsAt: "2027-03-31T18:29:59Z", warrantyPathNote: "Financial responsibility is pending contractual verification." }
      : null,
    auditEvents: [
      { id: "SYN-DEMO-EVT-KND-003-001", sequence: 1, eventType: "ISSUE_SUBMITTED_UNVERIFIED", actorRole: "citizen", occurredAt: "2026-11-12T03:40:00Z", summary: "Synthetic report submitted." },
      { id: "SYN-DEMO-EVT-KND-003-002", sequence: 2, eventType: "JURISDICTION_CONFLICT_DISPUTED", actorRole: "authority", occurredAt: "2026-11-13T03:40:00Z", summary: "Marked disputed." },
    ],
  };
}

function qc(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } } });
}

function seeded(opts: { dash?: unknown; dlp?: unknown; kundali?: [string, unknown]; issues?: boolean } = {}): QueryClient {
  const c = qc();
  if (opts.dash) c.setQueryData(authorityKeys.dashboard, { data: opts.dash, correlationId: CID });
  if (opts.dlp) c.setQueryData(authorityKeys.dlp, { data: opts.dlp, correlationId: CID });
  if (opts.kundali) c.setQueryData(authorityKeys.kundali(opts.kundali[0]), { data: opts.kundali[1], correlationId: CID });
  if (opts.issues !== false) c.setQueryData(queryKeys.issues(NO_FILTERS), { data: { items: SEED_ISSUES, total: SEED_ISSUES.length }, correlationId: CID });
  return c;
}

function renderAt(path: string, opts: { qc?: QueryClient; persona?: string; fetchImpl?: typeof fetch } = {}): string {
  const api = new ApiClient({ fetch: opts.fetchImpl ?? (vi.fn(async () => new Response("{}", { status: 500 })) as unknown as typeof fetch) });
  return renderToStaticMarkup(
    <I18nProvider>
      <PersonaProvider initial={opts.persona ?? "authority"}>
        <ApiClientProvider client={api}>
          <QueryClientProvider client={opts.qc ?? qc()}>
            <StaticRouter location={path}>
              <Routes>
                <Route path="/page-08" element={<AuthorityPage />} />
                <Route path="/page-09" element={<JurisdictionWorkPage />} />
                <Route path="/page-10" element={<DlpPage />} />
              </Routes>
            </StaticRouter>
          </QueryClientProvider>
        </ApiClientProvider>
      </PersonaProvider>
    </I18nProvider>,
  );
}

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

// ------------------------------------------------------------------------------------------------------- contract and drift

describe("authority client models and the committed contract", () => {
  it("declares exactly the four P6 operations and the fields the models rely on", () => {
    for (const op of ["getAuthorityDashboard", "resolveJurisdiction", "linkWork", "listDlpExceptions"]) {
      expect(openapi).toContain(`operationId: ${op}`);
    }
    const block = (name: string) => openapi.split(`\n    ${name}:\n`)[1]!.split(/\n    [A-Za-z]+:\n/)[0]!;
    for (const f of ["asOf", "openIssueCount", "awaitingVerificationIssueIds", "uncertainJurisdictionIssueIds", "dlpExceptionIssueIds", "traceabilityGapBudgetIds"]) {
      expect(block("AuthorityDashboard")).toContain(`- ${f}`);
    }
    for (const f of ["issueId", "candidateWorkOrderId", "dlpStatus", "warrantyPathNote", "potentialSpendLabel", "syntheticFreshRepairEstimatePaise"]) {
      expect(block("DlpExceptionItem")).toContain(`- ${f}`);
    }
    // the only operation that declares If-Match is resolveJurisdiction
    const jurisdictionPath = openapi.split("\n  /v1/authority/issues/{id}/jurisdiction:\n")[1]!.split("\n  /")[0]!;
    expect(jurisdictionPath).toContain("components/parameters/IfMatch");
    const linkPath = openapi.split("\n  /v1/authority/issues/{id}/work-link:\n")[1]!.split("\n  /")[0]!;
    expect(linkPath).not.toContain("IfMatch");
  });

  it("offers exactly the commandable targets the contract enumerates", () => {
    const enumBlock = openapi.split("    ResolveJurisdictionPayload:\n")[1]!.split("    ResolveJurisdictionCommand:")[0]!;
    for (const t of COMMANDABLE_TARGETS) expect(enumBlock).toContain(`- ${t}`);
    expect(COMMANDABLE_TARGETS.length).toBe(3);
  });

  it("mirrors the committed jurisdiction state machine for every commandable target (drift guard)", () => {
    const transitions = machine.transitions as Array<{ from: string; to: string; allowedRoles: string[] }>;
    for (const [from, targets] of Object.entries(LEGAL_TARGETS)) {
      const fromMachine = transitions
        .filter((t) => t.from === from && (COMMANDABLE_TARGETS as readonly string[]).includes(t.to))
        .map((t) => t.to)
        .sort();
      expect([...targets].sort(), from).toEqual(fromMachine);
    }
    // every machine transition is either offered above or is a non-commandable move (spatial inference, new dispute)
    for (const t of transitions) {
      const offered = (LEGAL_TARGETS[t.from as JurisdictionStatusCode] as readonly string[]).includes(t.to);
      const nonCommandable = !(COMMANDABLE_TARGETS as readonly string[]).includes(t.to);
      expect(offered || nonCommandable, `${t.from} -> ${t.to}`).toBe(true);
      expect(t.allowedRoles).toEqual(["authority"]);
    }
  });

  it("parses contract-shaped responses and rejects drifted ones", () => {
    expect(dashboardResultSchema.safeParse({ data: DASH, correlationId: CID }).success).toBe(true);
    expect(dashboardResultSchema.safeParse({ data: { ...DASH, openIssueCount: "6" }, correlationId: CID }).success).toBe(false);
    expect(dlpExceptionListResultSchema.safeParse({ data: { items: [DLP_ITEM("SYN-DEMO-KND-004")] }, correlationId: CID }).success).toBe(true);
    expect(dlpExceptionListResultSchema.safeParse({ data: { items: [{ ...DLP_ITEM("SYN-DEMO-KND-004"), potentialSpendLabel: "REALIZED_SAVINGS" }] }, correlationId: CID }).success).toBe(false);
    expect(jurisdictionResultSchema.safeParse({ data: { ...jur("SYN-DEMO-KND-003") }, correlationId: CID }).success).toBe(true);
    expect(jurisdictionResultSchema.safeParse({ data: { ...jur("SYN-DEMO-KND-003"), legalOwnershipAsserted: true }, correlationId: CID }).success).toBe(false);
    expect(linkedIssueResultSchema.safeParse({ data: { ...issue("SYN-DEMO-KND-004"), workOrderId: "SYN-DEMO-WO-001", recordVersion: 2 }, correlationId: CID }).success).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------------------------ validation

describe("local validation mirrors the contract limits", () => {
  const ok = { ...EMPTY_RESOLVE, rationale: "Ward record reviewed." };
  it("requires a step that the current state offers", () => {
    expect(validateResolve(ok, "CONFLICT_DISPUTED").ok).toBe(false);
    expect(validateResolve({ ...ok, target: "HANDOFF_LOGGED" }, "CONFLICT_DISPUTED").ok).toBe(false);
    expect(validateResolve({ ...ok, target: "CONFIRMED_BMC_WARD" }, "CONFLICT_DISPUTED").ok).toBe(true);
    expect(validateResolve({ ...ok, target: "CONFIRMED_BMC_WARD" }, "HANDOFF_LOGGED").ok).toBe(false);
  });
  it("applies the cross-field agency label rules", () => {
    const external = { ...ok, target: "EXTERNAL_AGENCY_ASSIGNED" as const };
    expect(validateResolve(external, "SPATIALLY_INFERRED_PROVISIONAL")).toMatchObject({ ok: false, errors: { agencyLabel: "labelRequired" } });
    const v = validateResolve({ ...external, agencyLabel: "  Synthetic agency  " }, "SPATIALLY_INFERRED_PROVISIONAL");
    expect(v.ok && v.payload).toEqual({ targetStatus: "EXTERNAL_AGENCY_ASSIGNED", externalAgencyLabel: "Synthetic agency", rationale: "Ward record reviewed." });
    expect(validateResolve({ ...ok, target: "CONFIRMED_BMC_WARD", agencyLabel: "x" }, "SPATIALLY_INFERRED_PROVISIONAL")).toMatchObject({ ok: false, errors: { agencyLabel: "labelNotAllowed" } });
    const h = validateResolve({ ...ok, target: "HANDOFF_LOGGED" }, "EXTERNAL_AGENCY_ASSIGNED");
    expect(h.ok && h.payload.externalAgencyLabel).toBeNull();
  });
  it("bounds the rationale and the label", () => {
    const t = { ...ok, target: "CONFIRMED_BMC_WARD" as const };
    expect(validateResolve({ ...t, rationale: "   " }, "CONFLICT_DISPUTED")).toMatchObject({ ok: false, errors: { rationale: "rationaleRequired" } });
    expect(validateResolve({ ...t, rationale: "x".repeat(401) }, "CONFLICT_DISPUTED")).toMatchObject({ ok: false, errors: { rationale: "rationaleInvalid" } });
    expect(validateResolve({ ...t, rationale: "line\nbreak" }, "CONFLICT_DISPUTED").ok).toBe(false);
    expect(validateResolve({ ...t, rationale: "x".repeat(400) }, "CONFLICT_DISPUTED").ok).toBe(true);
    expect(validateResolve({ ...ok, target: "EXTERNAL_AGENCY_ASSIGNED", agencyLabel: "a".repeat(161) }, "CONFLICT_DISPUTED")).toMatchObject({ ok: false, errors: { agencyLabel: "labelInvalid" } });
  });
  it("validates the link command locally", () => {
    expect(validateLink({ workOrderId: "wo-1", rationale: "r" })).toMatchObject({ ok: false, errors: { workOrderId: "workOrderId" } });
    expect(validateLink({ workOrderId: "SYN-DEMO-WO-001", rationale: "" })).toMatchObject({ ok: false, errors: { rationale: "rationaleRequired" } });
    const v = validateLink({ workOrderId: " SYN-DEMO-WO-001 ", rationale: " Same segment. " });
    expect(v.ok && v.payload).toEqual({ workOrderId: "SYN-DEMO-WO-001", rationale: "Same segment." });
  });
  it("derives a stable fingerprint so a retry reuses its key and a changed input does not", () => {
    expect(fingerprint(["a", 1, { x: 1 }])).toBe(fingerprint(["a", 1, { x: 1 }]));
    expect(fingerprint(["a", 1, { x: 1 }])).not.toBe(fingerprint(["a", 2, { x: 1 }]));
  });
  it("only a valid identifier reaches a deep link", () => {
    expect(jurisdictionWorkPath("SYN-DEMO-KND-004", "SYN-DEMO-WO-001")).toBe("/page-09?issueId=SYN-DEMO-KND-004&workOrderId=SYN-DEMO-WO-001");
    expect(jurisdictionWorkPath("bad id")).toBe("/page-09");
    expect(jurisdictionWorkPath("SYN-DEMO-KND-004", "x")).toBe("/page-09?issueId=SYN-DEMO-KND-004");
    expect(personaIsAuthority("authority")).toBe(true);
    for (const p of ["public", "citizen", "moderator", "independent_reviewer", "demo_admin"]) expect(personaIsAuthority(p)).toBe(false);
    expect(showsPotentialDlp("ACTIVE")).toBe(true);
    expect(showsPotentialDlp("EXPIRED")).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------------------------- commands

describe("the two authority commands", () => {
  function recorder(body: unknown, status = 200) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const f = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status, headers: { "content-type": status === 200 ? "application/json" : "application/problem+json" } });
    }) as unknown as typeof fetch;
    return { calls, client: new ApiClient({ baseUrl: "http://api.test", fetch: f, getPersona: () => "authority" }) };
  }

  it("resolveJurisdiction sends If-Match derived from recordVersion, an Idempotency-Key and the persona header", async () => {
    const { calls, client } = recorder({ data: { ...jur("SYN-DEMO-KND-003"), recordVersion: 2, status: "EXTERNAL_AGENCY_ASSIGNED" }, correlationId: CID });
    const payload = { targetStatus: "EXTERNAL_AGENCY_ASSIGNED" as const, externalAgencyLabel: "Agency", rationale: "Reviewed." };
    const r = await resolveJurisdiction(client, "SYN-DEMO-KND-003", 1, payload, "idem-key-0001");
    expect(r.data.status).toBe("EXTERNAL_AGENCY_ASSIGNED");
    const { url, init } = calls[0]!;
    expect(url).toBe("http://api.test/v1/authority/issues/SYN-DEMO-KND-003/jurisdiction");
    const h = init.headers as Record<string, string>;
    expect(init.method).toBe("POST");
    expect(h["If-Match"]).toBe('"1"');
    expect(h["Idempotency-Key"]).toBe("idem-key-0001");
    expect(h["X-Demo-Persona"]).toBe("authority");
    expect(h["X-Correlation-Id"]!.length).toBeGreaterThanOrEqual(8);
    expect(JSON.parse(String(init.body))).toEqual({ recordVersion: 1, payload });
  });

  it("linkWork sends no If-Match and carries the issue recordVersion in the body", async () => {
    const { calls, client } = recorder({ data: { ...issue("SYN-DEMO-KND-004"), recordVersion: 2, workOrderId: "SYN-DEMO-WO-001" }, correlationId: CID });
    const r = await linkWork(client, "SYN-DEMO-KND-004", 1, { workOrderId: "SYN-DEMO-WO-001", rationale: "Same segment." }, "idem-key-0002");
    expect(r.data.workOrderId).toBe("SYN-DEMO-WO-001");
    const h = calls[0]!.init.headers as Record<string, string>;
    expect(h["If-Match"]).toBeUndefined();
    expect(calls[0]!.url).toBe("http://api.test/v1/authority/issues/SYN-DEMO-KND-004/work-link");
    expect(JSON.parse(String(calls[0]!.init.body)).recordVersion).toBe(1);
  });

  it("surfaces a stale-version conflict as a typed problem and a drifted success body as an unexpected-shape error", async () => {
    const problem = { type: "about:blank", title: "Conflict", status: 409, detail: "recordVersion is stale", correlationId: CID };
    const { client } = recorder(problem, 409);
    const e = await linkWork(client, "SYN-DEMO-KND-004", 1, { workOrderId: "SYN-DEMO-WO-001", rationale: "r" }, "idem-key-0003").catch((x) => x);
    expect(e).toBeInstanceOf(ApiProblemError);
    expect((e as ApiProblemError).isStaleWrite).toBe(true);
    const bad = recorder({ data: { id: "SYN-DEMO-KND-004" }, correlationId: CID });
    const e2 = await linkWork(bad.client, "SYN-DEMO-KND-004", 1, { workOrderId: "SYN-DEMO-WO-001", rationale: "r" }, "idem-key-0004").catch((x) => x);
    expect(e2).toBeInstanceOf(ApiHttpError);
  });

  it("makes no request when constructed or rendered (mutations run only on submit)", () => {
    expect(queriesSrc).not.toMatch(/useEffect/);
  });
});

// ------------------------------------------------------------------------------------------------------------- PAGE-08

describe("PAGE-08 Authority Command", () => {
  it("separates decisions from information and shows live queue content with titles from one issue list", () => {
    const html = renderAt("/page-08", { qc: seeded({ dash: DASH }) });
    const t = text(html);
    expect(html).toContain('class="authority"');
    expect(t).toContain("Needs a decision");
    expect(t).toContain("For information");
    expect(t).toContain("As of 2026-11-21 04:30 UTC. Open issues: 6.");
    // four tiles with counts, a text label and a kind label, so state never depends on colour
    expect((html.match(/class="tile"/g) ?? []).length).toBe(4);
    expect(html).toContain('data-action="true"');
    expect(html).toContain('data-action="false"');
    expect(t).toContain("Jurisdiction not confirmed");
    expect(t).toContain("Potential active DLP exceptions");
    // rows carry the issue title from the public list and a keyboard link to PAGE-09
    expect(t).toContain(String(issue("SYN-DEMO-KND-004").title));
    expect(html).toContain('href="/page-09?issueId=SYN-DEMO-KND-004"');
    expect(html).toContain('href="/page-03?budgetId=SYN-DEMO-BUD-002"');
    // claim-safe wording and no accusation
    expect(t).toContain("Contractual applicability pending verification");
    expect(t).toContain("no fresh-spend decision has been made");
    expect(html).not.toMatch(/₹/);
  });

  it("says plainly when the dashboard is loading, and shows no record for another persona (and makes no request)", () => {
    const loading = renderAt("/page-08", { qc: qc() });
    expect(loading).toContain(en["state.loading.title"]!);
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
    for (const persona of ["public", "citizen", "moderator", "independent_reviewer", "demo_admin"]) {
      const html = renderAt("/page-08", { qc: seeded({ dash: DASH }), persona, fetchImpl: fetchSpy });
      expect(html).toContain('data-testid="persona-gate"');
      expect(html).not.toContain("SYN-DEMO-KND-004");
      expect(html).not.toContain('class="tile"');
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows an empty queue as empty, not as an error, and names missing titles as partial data", () => {
    const empty = renderAt("/page-08", { qc: seeded({ dash: { ...DASH, uncertainJurisdictionIssueIds: [], dlpExceptionIssueIds: [], awaitingVerificationIssueIds: [], traceabilityGapBudgetIds: [] } }) });
    expect(text(empty)).toContain("Nothing in this queue.");
    expect(empty).not.toContain('role="alert"');
    const partial = renderAt("/page-08", { qc: seeded({ dash: DASH, issues: false }) });
    expect(partial).toContain("Title unavailable");
  });

  it("uses institution and post vocabulary and never names a person", () => {
    for (const v of [authoritySrc, jurisSrc, dlpSrc]) expect(v).not.toMatch(/officer name|commissioner|\bMr\.|\bMs\./i);
    expect(en["p6.post.workflow"]).toBe("Workflow post");
    expect(en["p6.post.department"]).toBe("Assigned department");
  });
});

// ------------------------------------------------------------------------------------------------------------- PAGE-09

describe("PAGE-09 Jurisdiction/Work Link", () => {
  it("shows a disputed jurisdiction as text with a glyph, offers only the legal steps and keeps the caveats progressive", () => {
    const k = kundaliFor("SYN-DEMO-KND-003");
    const html = renderAt("/page-09?issueId=SYN-DEMO-KND-003", { qc: seeded({ kundali: ["SYN-DEMO-KND-003", k] }) });
    const t = text(html);
    expect(html).toContain('class="juris"');
    expect(t).toContain("Disputed (sources conflict)");
    expect(t).toContain("Jurisdiction disputed.");
    expect(t).toContain("Roads Department");
    expect(t).toContain("Workflow post");
    // legal steps from CONFLICT_DISPUTED: confirm a ward or assign an external agency, not a handoff
    expect(html).toContain('value="CONFIRMED_BMC_WARD"');
    expect(html).toContain('value="EXTERNAL_AGENCY_ASSIGNED"');
    expect(html).not.toContain('value="HANDOFF_LOGGED"');
    // radios are real inputs inside labels (keyboard operable), the textarea has a label, and 44px targets come from the shared CSS
    expect(html).toMatch(/<label class="choice"><input type="radio"/);
    expect(html).toMatch(/<label for="resolve-rationale"/);
    // caveats sit behind a native disclosure
    expect(html).toContain("<details");
    expect(t).toContain("never legal ownership");
    expect(t).toContain("Legal ownership asserted No");
    // work linkage is available for the unlinked, asset-bearing issue
    expect(html).toMatch(/<label for="link-workOrderId"/);
    // audit trail with institutional role names and event text
    expect(t).toContain("Jurisdiction conflict disputed");
    expect(t).toContain("Authority workflow post");
  });

  it("shows provisional spatial inference with the guardrail and no confirmation", () => {
    const k = kundaliFor("SYN-DEMO-KND-004");
    const t = text(renderAt("/page-09?issueId=SYN-DEMO-KND-004", { qc: seeded({ kundali: ["SYN-DEMO-KND-004", k] }) }));
    expect(t).toContain("Spatially inferred provisional jurisdiction.");
    expect(t).toContain("Map proximity and basemap lines are never treated as ownership.");
    expect(t).not.toContain("Confirmed ward");
  });

  it("offers the handoff only after an external agency is assigned and nothing after a final state", () => {
    const assigned = renderAt("/page-09?issueId=SYN-DEMO-KND-003", { qc: seeded({ kundali: ["SYN-DEMO-KND-003", kundaliFor("SYN-DEMO-KND-003", { status: "EXTERNAL_AGENCY_ASSIGNED" })] }) });
    expect(assigned).toContain('value="HANDOFF_LOGGED"');
    expect(assigned).not.toContain('value="CONFIRMED_BMC_WARD"');
    for (const status of ["CONFIRMED_BMC_WARD", "HANDOFF_LOGGED"]) {
      const html = renderAt("/page-09?issueId=SYN-DEMO-KND-003", { qc: seeded({ kundali: ["SYN-DEMO-KND-003", kundaliFor("SYN-DEMO-KND-003", { status })] }) });
      expect(html).toContain('data-testid="resolve-final"');
      expect(html).not.toContain('name="resolve-target"');
    }
  });

  it("shows the linked work with derived DLP wording only while ACTIVE, and never offers to replace a link", () => {
    const k = kundaliFor("SYN-DEMO-KND-004", { workOrder: true });
    const html = renderAt("/page-09?issueId=SYN-DEMO-KND-004", { qc: seeded({ kundali: ["SYN-DEMO-KND-004", k] }) });
    const t = text(html);
    expect(html).toContain('data-testid="linked-work"');
    expect(t).toContain("Potential active DLP.");
    expect(t).toContain("An existing link is never replaced");
    expect(html).not.toContain('id="link-workOrderId"');
    expect(html).toContain('href="/page-03?workOrderId=SYN-DEMO-WO-001"');
    const expired = { ...k, dlpStatus: { ...k.dlpStatus!, status: "EXPIRED" } };
    const t2 = text(renderAt("/page-09?issueId=SYN-DEMO-KND-004", { qc: seeded({ kundali: ["SYN-DEMO-KND-004", expired] }) }));
    expect(t2).not.toContain("Potential active DLP.");
  });

  it("shows the candidate from the DLP queue with a button that fills the field instead of linking", () => {
    const k = kundaliFor("SYN-DEMO-KND-004");
    const html = renderAt("/page-09?issueId=SYN-DEMO-KND-004", { qc: seeded({ kundali: ["SYN-DEMO-KND-004", k], dlp: [DLP_ITEM("SYN-DEMO-KND-004")] }) });
    expect(html).toContain('data-testid="dlp-candidate"');
    expect(html).toContain("Use candidate SYN-DEMO-WO-001");
    expect(text(html)).toContain("Selecting it does not link anything.");
  });

  it("prefills the work order from a valid deep link and ignores a malformed one", () => {
    const k = kundaliFor("SYN-DEMO-KND-004");
    const c = () => seeded({ kundali: ["SYN-DEMO-KND-004", k] });
    expect(renderAt("/page-09?issueId=SYN-DEMO-KND-004&workOrderId=SYN-DEMO-WO-001", { qc: c() })).toContain('value="SYN-DEMO-WO-001"');
    const bad = renderAt("/page-09?issueId=SYN-DEMO-KND-004&workOrderId=%3Cscript%3E", { qc: c() });
    expect(bad).not.toContain("script");
  });

  it("rejects a malformed identifier before any request and never echoes it", () => {
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
    const html = renderAt("/page-09?issueId=%3Cb%3Ebad%3C%2Fb%3E", { fetchImpl: fetchSpy });
    expect(html).not.toContain("&lt;b&gt;bad");
    expect(text(html)).toContain(en["p4.malformed.title"]!);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows the record read-only (no form, no authority request) for every other persona", () => {
    const k = kundaliFor("SYN-DEMO-KND-003");
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
    for (const persona of ["public", "citizen", "moderator"]) {
      const html = renderAt("/page-09?issueId=SYN-DEMO-KND-003", { qc: seeded({ kundali: ["SYN-DEMO-KND-003", k] }), persona, fetchImpl: fetchSpy });
      expect(html).toContain('data-testid="persona-gate"');
      expect(html).not.toContain('name="resolve-target"');
      expect(html).not.toContain('id="link-workOrderId"');
      expect(text(html)).toContain("Disputed (sources conflict)");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("without an identifier offers the queue (authority) or the gate (other persona), never an enumeration for a refused persona", () => {
    const authority = renderAt("/page-09", { qc: seeded({ dash: DASH }) });
    expect(authority).toContain('href="/page-09?issueId=SYN-DEMO-KND-002"');
    const other = renderAt("/page-09", { qc: seeded({ dash: DASH }), persona: "citizen" });
    expect(other).toContain('data-testid="persona-gate"');
    expect(other).not.toContain("SYN-DEMO-KND-002");
  });
});

// ------------------------------------------------------------------------------------------------------------- PAGE-10

describe("PAGE-10 Completion/DLP", () => {
  it("lists potential active DLP exceptions with the derived status, a synthetic estimate and claim-safe wording", () => {
    const items = [DLP_ITEM("SYN-DEMO-KND-002"), DLP_ITEM("SYN-DEMO-KND-004")];
    const html = renderAt("/page-10", { qc: seeded({ dlp: items }) });
    const t = text(html);
    expect(html).toContain('class="dlp"');
    expect((html.match(/data-testid="dlp-row"/g) ?? []).length).toBe(2);
    expect(t).toContain("Active (derived for this request)");
    expect(t).toContain("₹12,000");
    expect(t).toContain("synthetic potential, not realized savings");
    expect(t).toContain("Contractual applicability pending verification");
    expect(t).toContain("No fresh-spend decision made");
    expect(t).toContain("not a finding of liability");
    expect(html).toContain('href="/page-09?issueId=SYN-DEMO-KND-004&amp;workOrderId=SYN-DEMO-WO-001"');
    // the completion half is stated as a later phase, never faked
    expect(t).toContain("Completion claims and citizen verification belong to a later phase");
  });

  it("shows an empty exception list as empty and the gate for another persona", () => {
    const empty = renderAt("/page-10", { qc: seeded({ dlp: [] }) });
    expect(text(empty)).toContain("No exceptions at this time");
    const gated = renderAt("/page-10", { qc: seeded({ dlp: [DLP_ITEM("SYN-DEMO-KND-004")] }), persona: "public" });
    expect(gated).toContain('data-testid="persona-gate"');
    expect(gated).not.toContain("SYN-DEMO-KND-004");
  });

  it("mounts through the full route table without the placeholder", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <PersonaProvider initial="authority">
          <ApiClientProvider>
            <QueryClientProvider client={seeded({ dlp: [] })}>
              <StaticRouter location="/page-10">
                <App />
              </StaticRouter>
            </QueryClientProvider>
          </ApiClientProvider>
        </PersonaProvider>
      </I18nProvider>,
    );
    expect(html).toContain('class="dlp"');
    expect(html).not.toContain("Not implemented in this phase");
  });
});

// ------------------------------------------------------------------------------------------------------- claim safety (static)

describe("claim-safe wording in the P6 strings and sources", () => {
  const all = Object.values(enP6).join("\n");
  it("never claims liability, zero cost, realized savings, ownership or blame", () => {
    for (const banned of [/\bis liable\b/i, /\bguilty\b/i, /zero cost/i, /free repair/i, /\bsaved\b/i, /(?<!not )realized savings/i, /legal owner(ship)? (is|has been)/i, /\bcorrupt/i]) {
      expect(all).not.toMatch(banned);
    }
    // the only "zero" mention is the negative disclaimer
    expect(all.match(/zero/gi)?.length ?? 0).toBeLessThanOrEqual(1);
    for (const must of ["Potential active DLP", "Contractual applicability pending verification", "No fresh-spend decision made", "Spatially inferred provisional jurisdiction", "Jurisdiction disputed", "External-agency handoff recorded", "Assigned department", "Workflow post"]) {
      expect(all, must).toContain(must);
    }
  });
  it("does not claim official BMC adoption or production authentication", () => {
    for (const v of Object.values(enP6)) expect(v).not.toMatch(/official BMC (portal|service) of|BMC has adopted|signed in as|logged in as/i);
    expect(all).toContain("not authentication");
  });
  it("never stores or recomputes a competing DLP status in the browser", () => {
    for (const v of [authoritySrc, dlpSrc, jurisSrc, queriesSrc]) {
      expect(v).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
      expect(v).not.toMatch(/new Date\(|Date\.now\(/);
    }
  });
  it("adds no mapping dependency or basemap: no authoritative action depends on a map", () => {
    for (const v of [authoritySrc, dlpSrc, jurisSrc]) expect(v).not.toMatch(/leaflet|CivicMapAdapter|tileLayer|tileHealth/i);
  });
});
