import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import assetsSeed from "../../../../../data/demo/assets.json";
import budgetsSeed from "../../../../../data/demo/budgets.json";
import claimsSeed from "../../../../../data/demo/completion-claims.json";
import contractorsSeed from "../../../../../data/demo/contractors.json";
import contractsSeed from "../../../../../data/demo/contracts.json";
import departmentsSeed from "../../../../../data/demo/departments.json";
import dlpSeed from "../../../../../data/demo/dlp-status.json";
import evidenceSeed from "../../../../../data/demo/evidence.json";
import eventsSeed from "../../../../../data/demo/lifecycle-events.json";
import issuesSeed from "../../../../../data/demo/issues.json";
import jurisdictionsSeed from "../../../../../data/demo/jurisdictions.json";
import tendersSeed from "../../../../../data/demo/tenders.json";
import verificationsSeed from "../../../../../data/demo/verifications.json";
import wardsSeed from "../../../../../data/demo/wards.json";
import workSeed from "../../../../../data/demo/work-orders.json";
import { ApiClient } from "../../api/client";
import { ApiClientProvider } from "../../api/ApiClientContext";
import { EvidenceIllustration } from "../../components/evidence/EvidenceIllustration";
import { I18nProvider } from "../../i18n/I18nContext";
import { en } from "../../i18n/resources";
import { isSynId, readIdParam } from "../../lib/synId";
import { PersonaProvider } from "../../state/PersonaContext";
import { createQueryClient } from "../map-list/queries";
import { KundaliPage } from "./KundaliPage";
import { TracePage } from "./TracePage";
import { kundaliPath, TRACE_EXAMPLES, tracePath } from "./links";
import {
  budgetTraceResultSchema,
  kundaliResultSchema,
  workOrderDetailResultSchema,
  CHAIN_LINKS,
  DLP_STATUSES,
  EVIDENCE_STAGES,
  JURISDICTION_STATUSES,
  MISSING_LINKS,
  VERIFICATION_STATES,
  WORK_STATUSES,
} from "./model";
import { bySequence, humanize, missingToStep, showsPotentialDlpWording, stepState } from "./present";
import { dossierKeys } from "./queries";

type Rec = Record<string, unknown>;
const rows = (x: unknown) => x as Rec[];
const byId = (list: unknown, id: string): Rec => rows(list).find((r) => r.id === id)!;

// ---- Contract-shaped fixtures assembled from the committed seed files. These feed UNIT rendering only; they are never live proof.
function dlpView(status: string): Rec {
  const d = rows(dlpSeed)[0]!;
  return { ...d, dlpEndsAt: byId(workSeed, "SYN-DEMO-WO-001").dlpEndsAt, evaluatedAt: "2026-11-20T00:00:00Z", status };
}

function traceFor(budgetId: string): Rec {
  const budget = byId(budgetsSeed, budgetId);
  const tender = rows(tendersSeed).find((t) => t.budgetId === budgetId) ?? null;
  const contract = rows(contractsSeed).find((c) => c.budgetId === budgetId) ?? null;
  const contractor = contract ? byId(contractorsSeed, contract.vendorId as string) : null;
  const work = contract ? (rows(workSeed).find((w) => w.contractId === contract.id) ?? null) : null;
  const asset = work ? byId(assetsSeed, work.assetId as string) : null;
  return {
    budget,
    tender,
    contract,
    contractor,
    workOrder: work,
    asset,
    traceabilityStatus: budget.traceabilityStatus,
    lastProvenLink: budget.lastProvenLink,
    missingNextLink: budget.missingNextLink,
    explanation: budget.traceabilityExplanation,
  };
}

function kundaliFor(issueId: string, dlpStatus = "ACTIVE"): Rec {
  const issue = byId(issuesSeed, issueId);
  const work = issue.workOrderId ? byId(workSeed, issue.workOrderId as string) : null;
  const contract = work ? byId(contractsSeed, work.contractId as string) : null;
  return {
    syntheticBanner: "DEMONSTRATION - SYNTHETIC DATA - NOT AN OFFICIAL BMC PORTAL",
    canonicalDemoPath: `/demo/kundali/${issueId}`,
    issue,
    ward: issue.wardCandidateId ? byId(wardsSeed, issue.wardCandidateId as string) : null,
    asset: issue.assetId ? byId(assetsSeed, issue.assetId as string) : null,
    responsibleDepartment: byId(departmentsSeed, issue.responsibleDepartmentId as string),
    jurisdiction: rows(jurisdictionsSeed).find((j) => j.issueId === issueId),
    workOrder: work,
    dlpStatus: work ? dlpView(dlpStatus) : null,
    budgetTrace: contract ? traceFor(contract.budgetId as string) : null,
    evidence: rows(evidenceSeed).filter((e) => e.issueId === issueId),
    completionClaim: rows(claimsSeed).find((c) => c.issueId === issueId) ?? null,
    verification: rows(verificationsSeed).find((v) => v.issueId === issueId) ?? null,
    corrections: [],
    auditEvents: rows(eventsSeed).filter((e) => e.entityId === issueId),
  };
}

function render(path: string, el: "kundali" | "trace", setup: (qc: QueryClient) => void = () => undefined, fetchSpy?: () => void): string {
  const qc = createQueryClient();
  qc.setDefaultOptions({ queries: { retry: false, retryOnMount: false, refetchOnWindowFocus: false } });
  setup(qc);
  const client = new ApiClient({
    baseUrl: "http://127.0.0.1:1",
    fetch: (async () => {
      fetchSpy?.();
      throw new Error("no network in unit rendering");
    }) as unknown as typeof fetch,
  });
  return renderToStaticMarkup(
    <I18nProvider>
      <PersonaProvider>
        <ApiClientProvider client={client}>
          <QueryClientProvider client={qc}>
            <MemoryRouter initialEntries={[path]}>{el === "kundali" ? <KundaliPage /> : <TracePage />}</MemoryRouter>
          </QueryClientProvider>
        </ApiClientProvider>
      </PersonaProvider>
    </I18nProvider>,
  );
}

const prime = (qc: QueryClient, key: readonly unknown[], data: unknown) => qc.setQueryData(key, { data, correlationId: "cid-test" });

describe("identifier validation (local, before any request)", () => {
  it("accepts only SYN-DEMO identifiers within the length bound", () => {
    for (const ok of ["SYN-DEMO-KND-001", "SYN-DEMO-BUD-002", "SYN-DEMO-A"]) expect(isSynId(ok)).toBe(true);
    for (const bad of ["", "syn-demo-knd-001", "SYN-DEMO-", "SYN-DEMO--X", "SYN-DEMO-a", "../etc/passwd", "SYN-DEMO-KND-001/../x", "SYN-DEMO-X Y", "SYN-DEMO-X?y=1", `SYN-DEMO-${"A".repeat(200)}`, "<script>"])
      expect(isSynId(bad), bad).toBe(false);
    expect(isSynId(undefined)).toBe(false);
  });

  it("classifies a query parameter as absent, valid or malformed (repeats and empties are malformed)", () => {
    const p = (q: string) => new URLSearchParams(q);
    expect(readIdParam(p(""), "id")).toEqual({ kind: "absent" });
    expect(readIdParam(p("id=SYN-DEMO-KND-001"), "id")).toEqual({ kind: "valid", id: "SYN-DEMO-KND-001" });
    expect(readIdParam(p("id="), "id").kind).toBe("malformed");
    expect(readIdParam(p("id=SYN-DEMO-KND-001&id=SYN-DEMO-KND-002"), "id").kind).toBe("malformed");
    expect(readIdParam(p("id=%3Cscript%3E"), "id").kind).toBe("malformed");
  });

  it("builds deep links only from valid identifiers", () => {
    expect(kundaliPath("SYN-DEMO-KND-001")).toBe("/page-02?id=SYN-DEMO-KND-001");
    expect(kundaliPath("../x")).toBe("/page-02");
    expect(tracePath({ budgetId: "SYN-DEMO-BUD-001", workOrderId: "SYN-DEMO-WO-001" })).toBe("/page-03?budgetId=SYN-DEMO-BUD-001&workOrderId=SYN-DEMO-WO-001");
    expect(tracePath({ budgetId: "bad", workOrderId: "SYN-DEMO-WO-001" })).toBe("/page-03?workOrderId=SYN-DEMO-WO-001");
    expect(tracePath({})).toBe("/page-03");
  });

  it("pins the demonstration trace examples to the committed seed", () => {
    for (const ex of TRACE_EXAMPLES) {
      expect(byId(budgetsSeed, ex.budgetId)).toBeDefined();
      if (ex.workOrderId) {
        const wo = byId(workSeed, ex.workOrderId);
        expect(byId(contractsSeed, wo.contractId as string).budgetId).toBe(ex.budgetId);
      }
    }
    expect(TRACE_EXAMPLES.map((e) => e.budgetId)).toEqual(["SYN-DEMO-BUD-001", "SYN-DEMO-BUD-002"]);
    expect(byId(budgetsSeed, "SYN-DEMO-BUD-002").traceabilityStatus).toBe("GAP_BEFORE_STREET_GEOMETRY");
  });
});

describe("response models accept the committed record shapes", () => {
  it("parses every seeded issue's Kundali-shaped body", () => {
    for (const i of rows(issuesSeed)) {
      const r = kundaliResultSchema.safeParse({ data: kundaliFor(i.id as string), correlationId: "c" });
      expect(r.success, `${String(i.id)}: ${r.success ? "" : r.error.message.slice(0, 300)}`).toBe(true);
    }
  });

  it("parses both budget traces and the work order detail", () => {
    for (const b of rows(budgetsSeed)) expect(budgetTraceResultSchema.safeParse({ data: traceFor(b.id as string), correlationId: "c" }).success).toBe(true);
    const work = byId(workSeed, "SYN-DEMO-WO-001");
    const contract = byId(contractsSeed, work.contractId as string);
    const detail = {
      workOrder: work,
      contract,
      contractor: byId(contractorsSeed, contract.vendorId as string),
      asset: byId(assetsSeed, work.assetId as string),
      dlpStatus: dlpView("ACTIVE"),
      linkedIssueIds: ["SYN-DEMO-KND-001"],
    };
    expect(workOrderDetailResultSchema.safeParse({ data: detail, correlationId: "c" }).success).toBe(true);
  });

  it("rejects fractional money, a wrong shape and a swapped coordinate order", () => {
    const k = kundaliFor("SYN-DEMO-KND-001");
    const frac = structuredClone(k) as { workOrder: { valuePaise: number } };
    frac.workOrder.valuePaise = 1.5;
    expect(kundaliResultSchema.safeParse({ data: frac, correlationId: "c" }).success).toBe(false);
    expect(kundaliResultSchema.safeParse({ data: { issue: {} }, correlationId: "c" }).success).toBe(false);
    const swapped = structuredClone(k) as { asset: { geometry: { coordinates: number[][] } } };
    swapped.asset.geometry.coordinates = [[19.1, 72.8], [19.2, 72.9]];
    expect(kundaliResultSchema.safeParse({ data: swapped, correlationId: "c" }).success).toBe(false);
  });
});

describe("PAGE-02 deep links and states", () => {
  it("shows a bounded live selector (loading) when opened without an id, and makes no detail request", () => {
    let calls = 0;
    const html = render("/page-02", "kundali", undefined, () => (calls += 1));
    expect(html).toContain(en["p4.selector.title"]);
    expect(html).toContain('data-state="loading"');
    expect(html).not.toMatch(/SYN-DEMO-KND/);
    expect(calls).toBe(0); // server rendering never fetches; the selector is the only query and it is the P3 list
  });

  it("shows a malformed-identifier state without echoing the value, and never queries the API", () => {
    for (const bad of ["id=%3Cscript%3Ealert(1)%3C%2Fscript%3E", "id=..%2F..%2Fsecret", "id=", "id=SYN-DEMO-KND-001&id=SYN-DEMO-KND-002", "id=syn-demo-knd-001"]) {
      let calls = 0;
      const html = render(`/page-02?${bad}`, "kundali", undefined, () => (calls += 1));
      expect(html, bad).toContain(en["p4.malformed.title"]);
      expect(html).not.toContain("script");
      expect(html).not.toContain("secret");
      expect(html).not.toContain("syn-demo-knd-001");
      expect(calls).toBe(0);
      expect(html).not.toContain('class="dossier__summary"');
    }
  });

  it("shows loading for a valid id until the real API has answered", () => {
    const html = render("/page-02?id=SYN-DEMO-KND-001", "kundali");
    expect(html).toContain('data-state="loading"');
    expect(html).not.toContain("dossier__summary");
  });
});

describe("PAGE-02 Kundali content (contract-shaped fixture, unit rendering only)", () => {
  const page = (id: string, dlp = "ACTIVE") =>
    render(`/page-02?id=${id}`, "kundali", (qc) => prime(qc, dossierKeys.kundali(id), kundaliFor(id, dlp)));

  it("renders the Journey 1 dossier with claim and verification kept distinct", () => {
    const html = page("SYN-DEMO-KND-001");
    expect(html).toContain("Pothole-like surface break near a joint, Paliram Road");
    expect(html).toContain(en["p4.claim.badge"]); // completion claimed, not verified
    expect(html).toContain(en["p4.verification.state.WINDOW_OPEN"]);
    expect(html).not.toContain("Verified complete");
    expect(html).toContain(en["status.CLOSURE_CLAIMED_PENDING_VERIFICATION"]);
    // the rule that silence is not verification is stated once, in the API's own words
    expect((html.match(/is not verification/g) ?? []).length).toBe(1);
    expect(html).toContain("Assistant Engineer (Roads)");
    expect(html).toContain(en["p4.jurisdiction.CONFIRMED_BMC_WARD"]);
    expect(html).toContain("/page-03?budgetId=SYN-DEMO-BUD-001&amp;workOrderId=SYN-DEMO-WO-001");
  });

  it("formats money from integer paise and shows the exact claim-safe DLP wording only while ACTIVE", () => {
    const active = page("SYN-DEMO-KND-001", "ACTIVE");
    expect(active).toContain("₹18 lakh"); // 180000000 paise work order value
    expect(active).toContain(en["p4.dlp.claimSafe"]);
    expect(en["p4.dlp.claimSafe"]).toBe(
      "Potential active DLP. The linked synthetic contract may require contractor rectification, subject to confirmation of scope, dates, defect classification and contractual terms. This is not a finding of liability or a claim of zero municipal cost.",
    );
    expect(showsPotentialDlpWording("ACTIVE")).toBe(true);
    for (const s of ["NOT_STARTED", "EXPIRED"]) {
      const html = page("SYN-DEMO-KND-001", s);
      expect(html).not.toContain("Potential active DLP");
      expect(html).toContain(en[`p4.dlp.status.${s}`]);
      expect(showsPotentialDlpWording(s)).toBe(false);
    }
    // the fresh-repair estimate is labelled as a synthetic potential, never as realized savings
    expect(active).toContain("₹12,000");
    expect(active).toContain("synthetic potential, not realized savings");
    expect(active.replace(en["p4.dlp.claimSafe"]!, "")).not.toMatch(/zero (municipal )?cost/i);
  });

  it("selects the illustration from the committed evidence stage and renders its facts from the API", () => {
    const html = page("SYN-DEMO-KND-001");
    expect(html).toContain('data-stage="BEFORE"');
    expect(html).toContain('data-stage="CLAIMED_AFTER"');
    expect(html).not.toContain('data-stage="DISPUTED_OR_RECURRING"');
    expect(html).toContain(en["p4.evidence.claimNotVerified"]);
    expect(html).toContain("2026-"); // timestamps come from the response, not the drawing
    expect(html).toContain(en["p4.evidence.hash"]);
    expect(html).not.toMatch(/authentic(?!ity)/i);
    const recurring = page("SYN-DEMO-KND-004");
    expect(recurring).toContain('data-stage="DISPUTED_OR_RECURRING"');
  });

  it("shows an ordered audit preview from the response with the remainder behind a disclosure and no immutability claim", () => {
    const html = page("SYN-DEMO-KND-001");
    const shown = (html.match(/class="timeline__item"/g) ?? []).length;
    expect(shown).toBe(9); // 5 visible + 4 inside the disclosure, all from the one response
    expect(html).toContain(`${en["p4.audit.more"]} (4)`);
    const timeline = html.slice(html.indexOf('class="timeline"'));
    expect(timeline.indexOf("Issue submitted unverified")).toBeLessThan(timeline.indexOf("Verification window open"));
    expect(html).not.toMatch(/immutable|tamper[- ]proof|cannot be altered/i);
    expect(bySequence([{ sequence: 3 }, { sequence: 1 }, { sequence: 2 }]).map((e) => e.sequence)).toEqual([1, 2, 3]);
  });

  it("states honestly when there is no work order, no claim or no evidence, and invents nothing", () => {
    const html = page("SYN-DEMO-KND-002");
    expect(html).toContain(en["p4.work.none"]);
    expect(html).toContain(en["p4.claim.none"]);
    expect(html).toContain(en["p4.verification.none"]);
    expect(html).toContain(en["p4.evidence.none"]);
    expect(html).not.toContain("₹");
    expect(html).not.toContain(en["p4.dlp.claimSafe"]);
    expect(html).toContain(en["p4.jurisdiction.SPATIALLY_INFERRED_PROVISIONAL"]);
  });

  it("never claims a legal owner and shows a disputed jurisdiction with its source-conflict note", () => {
    const html = page("SYN-DEMO-KND-003");
    expect(html).toContain(en["p4.jurisdiction.CONFLICT_DISPUTED"]);
    expect(html).toContain(en["p4.resp.noLegal"]);
    expect(html).not.toMatch(/legal owner is|belongs to/i);
  });

  it("leaves no untranslated raw key on any seeded dossier", () => {
    for (const i of rows(issuesSeed)) expect(page(i.id as string)).not.toMatch(/\bp[14]\.[a-zA-Z]+\.[A-Za-z]/);
  });
});

describe("PAGE-03 traces (contract-shaped fixture, unit rendering only)", () => {
  const trace = (budgetId: string) =>
    render(`/page-03?budgetId=${budgetId}`, "trace", (qc) => prime(qc, dossierKeys.trace(budgetId), traceFor(budgetId)));

  it("offers exactly the two committed demonstration traces and a locally validated manual id", () => {
    const html = render("/page-03", "trace");
    expect(html).toContain(en["p4.trace.example.complete"]);
    expect(html).toContain(en["p4.trace.example.gap"]);
    expect(html).toContain(en["p4.trace.selector.scope"]);
    expect(html).toContain('autoComplete="off"');
    expect(html).toContain('data-testid="trace-prompt"');
    expect((html.match(/class="selector-link"/g) ?? []).length).toBe(2);
  });

  it("renders the complete chain with every link proven and amounts derived from paise", () => {
    const html = trace("SYN-DEMO-BUD-001");
    expect(html).toContain(en["p4.trace.status.LINKED_TO_STREET"]);
    expect((html.match(/data-state="proven"/g) ?? []).length).toBe(5);
    expect(html).toContain("₹25 lakh");
    expect(html).toContain("₹18 lakh");
    expect(html).toContain(en["p4.trace.loadWork"]); // work detail is an explicit link, not a hidden request
    expect(html).not.toMatch(/data-state="(missing|notAvailable)"/);
  });

  it("renders the traceability gap with the last proven link, the missing next link and no invented geometry", () => {
    const html = trace("SYN-DEMO-BUD-002");
    expect(html).toContain(en["p4.trace.status.GAP_BEFORE_STREET_GEOMETRY"]);
    expect(html).toContain("TRACEABILITY GAP");
    expect(html).toContain("not an allegation");
    expect(html).toContain(en["p4.chain.link.TENDER"]);
    expect(html).toContain(en["p4.chain.missing.STREET_LEVEL_GEOMETRY"]);
    expect((html.match(/data-state="proven"/g) ?? []).length).toBe(2); // budget and tender only
    expect(html).toContain('data-state="missing"');
    expect(html).not.toMatch(/coordinates|<svg|leaflet|lat(itude)?/i);
    expect(html).not.toMatch(/misconduct|fraud|corrupt|blame|diverted/i);
    expect(html).toContain("₹12 lakh");
  });

  it("shows a malformed-identifier state for either parameter and requests nothing", () => {
    let calls = 0;
    const a = render("/page-03?budgetId=nope", "trace", undefined, () => (calls += 1));
    const b = render("/page-03?workOrderId=%00", "trace", undefined, () => (calls += 1));
    expect(a).toContain(en["p4.malformed.body.budget"]);
    expect(b).toContain(en["p4.malformed.body.work"]);
    expect(calls).toBe(0);
    expect(a).not.toContain("nope");
  });

  it("derives the budget from the work order's own contract when only a work order is given, and flags a mismatch", () => {
    const work = byId(workSeed, "SYN-DEMO-WO-001");
    const contract = byId(contractsSeed, work.contractId as string);
    const detail = {
      workOrder: work,
      contract,
      contractor: byId(contractorsSeed, contract.vendorId as string),
      asset: byId(assetsSeed, work.assetId as string),
      dlpStatus: dlpView("ACTIVE"),
      linkedIssueIds: ["SYN-DEMO-KND-001"],
    };
    const only = render("/page-03?workOrderId=SYN-DEMO-WO-001", "trace", (qc) => {
      prime(qc, dossierKeys.work("SYN-DEMO-WO-001"), detail);
      prime(qc, dossierKeys.trace("SYN-DEMO-BUD-001"), traceFor("SYN-DEMO-BUD-001"));
    });
    expect(only).toContain(en["p4.trace.status.LINKED_TO_STREET"]);
    expect(only).toContain(en["p4.work.detail"]);
    expect(only).toContain("/page-02?id=SYN-DEMO-KND-001");
    expect(only).toContain(en["p4.dlp.claimSafe"]);
    expect(only).not.toContain(en["p4.trace.mismatch.title"]);
    const mismatched = render("/page-03?budgetId=SYN-DEMO-BUD-002&workOrderId=SYN-DEMO-WO-001", "trace", (qc) => {
      prime(qc, dossierKeys.work("SYN-DEMO-WO-001"), detail);
      prime(qc, dossierKeys.trace("SYN-DEMO-BUD-002"), traceFor("SYN-DEMO-BUD-002"));
    });
    expect(mismatched).toContain(en["p4.trace.mismatch.title"]);
  });
});

describe("chain and presentation rules", () => {
  it("maps the API's missing link to a chain step and classifies each step", () => {
    expect(missingToStep("STREET_LEVEL_GEOMETRY")).toBe("ASSET_GEOMETRY");
    expect(missingToStep("CONTRACT")).toBe("CONTRACT");
    expect(missingToStep(null)).toBeNull();
    expect(stepState("BUDGET", true, null)).toBe("proven");
    expect(stepState("ASSET_GEOMETRY", false, "STREET_LEVEL_GEOMETRY")).toBe("missing");
    expect(stepState("CONTRACT", false, "STREET_LEVEL_GEOMETRY")).toBe("notAvailable");
  });

  it("humanizes event types deterministically", () => {
    expect(humanize("ISSUE_SUBMITTED_UNVERIFIED")).toBe("Issue submitted unverified");
    expect(humanize("")).toBe("");
  });
});

describe("synthetic evidence illustrations", () => {
  const svg = (stage: (typeof EVIDENCE_STAGES)[number]) =>
    renderToStaticMarkup(
      <I18nProvider>
        <EvidenceIllustration stage={stage} />
      </I18nProvider>,
    );

  it("renders three distinct, labelled, self-contained drawings with no external resource", () => {
    const out = EVIDENCE_STAGES.map(svg);
    expect(new Set(out).size).toBe(3);
    for (const html of out) {
      expect(html).toContain(en["p4.illustration.label"]);
      expect(html).toContain('role="img"');
      expect(html).not.toMatch(/https?:|xlink:href|<image|<foreignObject|<script|url\(/i);
      expect(html).not.toMatch(/plate|house|person|face/i);
    }
  });
});

describe("P4 i18n completeness", () => {
  const enumKeys: string[] = [
    ...VERIFICATION_STATES.map((s) => `p4.verification.state.${s}`),
    ...DLP_STATUSES.map((s) => `p4.dlp.status.${s}`),
    ...JURISDICTION_STATUSES.map((s) => `p4.jurisdiction.${s}`),
    ...EVIDENCE_STAGES.map((s) => `p4.evidence.stage.${s}`),
    ...WORK_STATUSES.map((s) => `p4.work.status.${s}`),
    ...CHAIN_LINKS.flatMap((s) => [`p4.chain.link.${s}`, `p4.chain.step.${s}`]),
    ...MISSING_LINKS.map((s) => `p4.chain.missing.${s}`),
    ...["proven", "missing", "notAvailable"].map((s) => `p4.chain.state.${s}`),
    ...["LINKED_TO_STREET", "GAP_BEFORE_STREET_GEOMETRY"].map((s) => `p4.trace.status.${s}`),
    ...["CITIZEN_FIXTURE", "AUTHORITY_FIXTURE", "INDEPENDENT_FIXTURE"].map((s) => `p4.evidence.source.${s}`),
    ...["NOT_VERIFIED", "CORROBORATED", "INDEPENDENTLY_VERIFIED"].map((s) => `p4.evidence.verification.${s}`),
    ...["LOCATION_CONSISTENT", "LOCATION_UNVERIFIED", "LOCATION_INCONSISTENT"].map((s) => `p4.evidence.location.${s}`),
    ...["FIXED", "PARTLY_FIXED", "STILL_UNRESOLVED"].map((s) => `p4.verification.verdict.${s}`),
    ...["public", "citizen", "authority", "moderator", "independent_reviewer", "demo_admin", "system"].map((s) => `p4.actor.${s}`),
    ...["TENDER_PUBLISHED", "CONTRACT_AWARDED", "RETENDER_REQUIRED"].map((s) => `p4.tender.status.${s}`),
    ...["CENTRAL_DEPARTMENT", "WARD_OFFICE"].map((s) => `p4.resp.kind.${s}`),
    ...TRACE_EXAMPLES.map((e) => `p4.trace.example.${e.key}`),
  ];

  const sources = import.meta.glob("../../**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

  it("defines every statically referenced and every enum-derived key in English", () => {
    const keys = new Set<string>(enumKeys);
    for (const [file, text] of Object.entries(sources)) {
      if (/\.test\.tsx?$/.test(file)) continue;
      for (const m of text.matchAll(/\bt\(\s*"((?:p4|p1|about|header|persona|banner)\.[A-Za-z0-9_.-]+)"\s*\)/g)) keys.add(m[1]!);
    }
    const missing = [...keys].filter((k) => !(k in en));
    expect(missing).toEqual([]);
  });

  it("keeps the exact claim-safe DLP sentence and the single global banner line in English", () => {
    expect(en["banner.text"]).toBe("Mumbai Civic Lens • Demonstration environment • Not an official BMC service");
    expect(en["p4.dlp.claimSafe"]!.startsWith("Potential active DLP.")).toBe(true);
  });
});
