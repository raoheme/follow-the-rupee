import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { Route, Routes } from "react-router-dom";
import { StaticRouter } from "react-router-dom/server";
import { describe, expect, it, vi } from "vitest";
import policy from "../../../../../config/duplicate-policy.json";
import issuesSeed from "../../../../../data/demo/issues.json";
import openapi from "../../../../../openapi/openapi.yaml?raw";
import dedupSrc from "./DuplicatePage.tsx?raw";
import presentSrc from "./present.ts?raw";
import receiptSrc from "./ReceiptPage.tsx?raw";
import reportSrc from "./ReportPage.tsx?raw";
import { ApiClient } from "../../api/client";
import { ApiClientProvider } from "../../api/ApiClientContext";
import { ApiProblemError } from "../../api/errors";
import { I18nProvider } from "../../i18n/I18nContext";
import { en } from "../../i18n/resources";
import { PersonaProvider } from "../../state/PersonaContext";
import { NO_FILTERS } from "../map-list/filters";
import { queryKeys } from "../map-list/queries";
import { App } from "../../App";
import { AppShell } from "../../components/AppShell";
import { DuplicatePage } from "./DuplicatePage";
import { ReceiptPage } from "./ReceiptPage";
import { ReportPage } from "./ReportPage";
import { newFixtureRef, sha256Hex, FIXTURE_REF_PATTERN } from "./evidence";
import {
  DEMO_LOCATION,
  EMPTY_REPORT,
  KEYWORDS_SENT,
  keywordsFrom,
  payloadFingerprint,
  tidy,
  validateReport,
  type ReportValues,
} from "./form";
import { ReportFlowProvider } from "./flow";
import { DUPLICATE_CHOICES, FACTOR_KEYS, createdIssueSchema, duplicateCandidatesResultSchema, personaMaySubmit } from "./model";
import { addEvidence, checkDuplicates, submitIssue } from "./queries";

// ---------------------------------------------------------------------------------------------------------------- fixtures

const SEED = issuesSeed as unknown as Array<Record<string, unknown>>;
const seed = (id: string) => SEED.find((i) => i.id === id)!;

const GEOM = { type: "Point" as const, coordinates: [72.83158, 19.11974] as [number, number] };

const NEW_ISSUE = {
  id: "SYN-DEMO-KND-RA1B2C3D4",
  recordNature: "SYNTHETIC_DEMONSTRATION",
  recordVersion: 1,
  title: "Pothole near the junction approach",
  publicDescription: "Synthetic pothole report near the S.V. Road Junction approach on Paliram Road.",
  category: "POTHOLE",
  status: "SUBMITTED_UNVERIFIED",
  publicStatusExplanation: "Submitted and unverified.",
  reportedAt: "2026-11-21T04:30:00Z",
  streetName: "Paliram Road",
  nearbyLandmark: "near S.V. Road Junction approach (synthetic label)",
  geometry: GEOM,
  assetId: "SYN-DEMO-AST-ROAD-001",
  wardCandidateId: "SYN-DEMO-WARD-KW",
  responsiblePostTitle: "Assistant Engineer (Roads), K/West Ward",
  escalationPostTitle: "Executive Engineer (Roads)",
} as const;

const KEYWORDS = ["pothole", "junction"];

const candidate = (issueId: string, score: number, band: string, b: Partial<Record<string, number>> = {}) => ({
  issueId,
  score,
  band,
  breakdown: {
    sameAssetOrSegment: 40,
    sameCategory: 20,
    withinConfiguredRadius: 20,
    withinConfiguredWindow: 0,
    keywordOverlap: 6,
    ...b,
  },
  possibleRecurrence: false,
});

const RESULT = {
  policyLabel: "DEMONSTRATION_HEURISTIC_V1",
  choices: [...DUPLICATE_CHOICES],
  silentRejection: false,
  candidates: [
    candidate("SYN-DEMO-KND-001", 86, "LIKELY_SAME"),
    candidate("SYN-DEMO-KND-004", 73, "POSSIBLE_MATCH", { withinConfiguredRadius: 0, withinConfiguredWindow: 10, keywordOverlap: 3 }),
  ],
};

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
}

function renderApp(
  path: string,
  opts: { qc?: QueryClient; persona?: string; flow?: React.ComponentProps<typeof ReportFlowProvider>["initial"]; fetchImpl?: typeof fetch } = {},
): string {
  const qc = opts.qc ?? client();
  const api = new ApiClient({ fetch: opts.fetchImpl ?? (vi.fn(async () => new Response("{}", { status: 500 })) as unknown as typeof fetch) });
  return renderToStaticMarkup(
    <I18nProvider>
      <PersonaProvider initial={opts.persona ?? "citizen"}>
        <ApiClientProvider client={api}>
          <QueryClientProvider client={qc}>
            <StaticRouter location={path}>
              <SeededApp initial={opts.flow} />
            </StaticRouter>
          </QueryClientProvider>
        </ApiClientProvider>
      </PersonaProvider>
    </I18nProvider>,
  );
}

function SeededApp({ initial }: { initial: React.ComponentProps<typeof ReportFlowProvider>["initial"] }) {
  return (
    <ReportFlowProvider initial={initial}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/page-04" element={<ReportPage />} />
          <Route path="/page-05" element={<DuplicatePage />} />
          <Route path="/page-06" element={<ReceiptPage />} />
        </Route>
      </Routes>
    </ReportFlowProvider>
  );
}

const submitted = { issue: createdIssueSchema.parse(NEW_ISSUE), correlationId: "corr-submit-0001", keywords: KEYWORDS };

function seededClient(): QueryClient {
  const qc = client();
  const subject = NEW_ISSUE;
  qc.setQueryData(["duplicate-check", subject.id, JSON.stringify({ category: subject.category, geometry: subject.geometry, descriptionKeywords: KEYWORDS })], {
    data: duplicateCandidatesResultSchema.parse({ data: RESULT, correlationId: "corr-check-0001" }).data,
    correlationId: "corr-check-0001",
  });
  qc.setQueryData(queryKeys.issues(NO_FILTERS), {
    data: {
      items: SEED.map((i) => ({ ...i, recordVersion: 1 })),
      total: SEED.length,
    },
    correlationId: "corr-list-0001",
  });
  return qc;
}

const GOOD: ReportValues = {
  category: "POTHOLE",
  title: "Pothole near the junction approach",
  description: "Synthetic pothole report near the junction approach.",
  landmark: "",
  assetId: "SYN-DEMO-AST-ROAD-001",
  ...DEMO_LOCATION,
};

// ----------------------------------------------------------------------------------------------------- PAGE-04 validation

describe("PAGE-04 validation and payload", () => {
  it("builds the contract payload with GeoJSON [longitude, latitude] order and nulls for optional fields", () => {
    const r = validateReport({ ...GOOD, assetId: "" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.payload).sort()).toEqual(["assetId", "category", "geometry", "nearbyLandmark", "publicDescription", "title"]);
    expect(r.payload.geometry).toEqual({ type: "Point", coordinates: [72.83158, 19.11974] });
    expect(r.payload.nearbyLandmark).toBeNull();
    expect(r.payload.assetId).toBeNull();
  });

  it("reports every required field and nothing for a fully empty form beyond the required set", () => {
    const r = validateReport(EMPTY_REPORT);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.errors).sort()).toEqual(["category", "description", "latitude", "longitude", "title"]);
    expect(Object.values(r.errors).every((e) => e === "required")).toBe(true);
  });

  it("enforces the contract length bounds, control characters, number format and Greater Mumbai bounds", () => {
    const err = (v: Partial<ReportValues>) => {
      const r = validateReport({ ...GOOD, ...v });
      return r.ok ? {} : r.errors;
    };
    expect(err({ title: "t".repeat(161) }).title).toBe("tooLong");
    expect(err({ title: "t".repeat(160) }).title).toBeUndefined();
    expect(err({ description: "d".repeat(401) }).description).toBe("tooLong");
    expect(err({ landmark: "l".repeat(161) }).landmark).toBe("tooLong");
    expect(err({ title: "bell\u0007char" }).title).toBe("control");
    expect(err({ longitude: "abc" }).longitude).toBe("badNumber");
    expect(err({ longitude: "19.1197", latitude: "72.8315" })).toMatchObject({ longitude: "outOfRange", latitude: "outOfRange" });
    expect(err({ longitude: "72.77" }).longitude).toBeUndefined();
    expect(err({ longitude: "72.99" }).longitude).toBeUndefined();
    expect(err({ longitude: "72.7699" }).longitude).toBe("outOfRange");
    expect(err({ category: "ROADWORKS" }).category).toBe("badCategory");
    expect(err({ assetId: "asset-1" }).assetId).toBe("badAsset");
  });

  it("tidies line breaks and runs of whitespace to single spaces, and nothing else", () => {
    expect(tidy("  a\n\nb \t c  ")).toBe("a b c");
    const r = validateReport({ ...GOOD, title: "Surface\nbreak   here" });
    expect(r.ok && r.payload.title).toBe("Surface break here");
  });

  it("extracts a bounded, unique, lower-case keyword list from the citizen's own words", () => {
    expect(keywordsFrom("Pothole near Junction", "The pothole on Paliram Road")).toEqual(["pothole", "near", "junction", "the", "paliram", "road"]);
    expect(keywordsFrom("a an of", "to")).toEqual([]);
    const many = keywordsFrom(Array.from({ length: 40 }, (_, i) => `word${i}`).join(" "));
    expect(many).toHaveLength(KEYWORDS_SENT);
  });

  it("gives an unchanged submission one fingerprint and an edited one another, so a retry reuses its key and an edit does not", () => {
    const a = validateReport(GOOD);
    const b = validateReport({ ...GOOD, title: "A different title" });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(payloadFingerprint(a.payload)).toBe(payloadFingerprint(a.payload));
    expect(payloadFingerprint(a.payload)).not.toBe(payloadFingerprint(b.payload));
  });

  it("only the committed submitting personas may submit (a presentation hint; the server enforces it)", () => {
    expect(personaMaySubmit("citizen")).toBe(true);
    expect(personaMaySubmit("authority")).toBe(true);
    for (const p of ["public", "moderator", "independent_reviewer", "demo_admin"]) expect(personaMaySubmit(p)).toBe(false);
  });
});

describe("PAGE-04 rendering", () => {
  const html = renderApp("/page-04");

  it("is a native keyboard form: submit button, no script-only submit, labelled inputs", () => {
    expect(html).toContain("<form");
    expect(html).toContain('type="submit"');
    expect(html).not.toMatch(/onclick|role="button"/i);
    for (const id of ["report-category", "report-title", "report-description", "report-landmark", "report-asset", "report-longitude", "report-latitude"]) {
      expect(html).toContain(`for="${id}"`);
      expect(html).toContain(`id="${id}"`);
    }
  });

  it("shows the do-not-enter-real-personal-data instruction and the compact practice notice", () => {
    for (const t of ["names", "phone numbers", "email addresses", "home addresses", "government identifiers", "vehicle registration numbers", "faces"]) {
      expect(html).toContain(t);
    }
    expect(html).toContain('data-testid="pii-notice"');
    expect(html).toContain('data-testid="synthetic-notice"');
    expect(html).toContain("Not an official BMC service"); // the persistent banner stays present
  });

  it("introduces no personal-data input: no name, phone, email, address, identity or vehicle fields", () => {
    const names = [...html.matchAll(/<(?:input|select|textarea)[^>]*\bname="([^"]+)"/g)].map((m) => m[1]);
    expect(names.sort()).toEqual(["asset", "category", "description", "landmark", "latitude", "longitude", "title"].sort());
    for (const bad of ["phone", "email", "mobile", "aadhaar", "pan", "passport", "vehicle", "contact", "fullname"]) {
      expect(html.toLowerCase()).not.toMatch(new RegExp(`name="${bad}`));
      expect(html.toLowerCase()).not.toMatch(new RegExp(`type="(email|tel)"`));
    }
  });

  it("needs no map: no map container, tile URL or basemap dependency on the page", () => {
    expect(html).not.toMatch(/leaflet|tile\.openstreetmap|class="map/i);
    expect(reportSrc).not.toMatch(/CivicMapAdapter|leaflet/i);
  });

  it("blocks submission with an explanation when the simulated persona cannot submit, and allows it for a citizen", () => {
    expect(renderApp("/page-04", { persona: "public" })).toMatch(/cannot submit a report[^<]*Switch to Citizen/);
    expect(renderApp("/page-04", { persona: "public" })).toMatch(/<button type="submit"[^>]*disabled=""/);
    expect(renderApp("/page-04", { persona: "citizen" })).not.toMatch(/<button type="submit"[^>]*disabled=""/);
  });
});

// ----------------------------------------------------------------------------------------------------- PAGE-05 rendering

describe("PAGE-05 duplicate decision", () => {
  const url = `/page-05?issueId=${NEW_ISSUE.id}`;
  const html = renderApp(url, { qc: seededClient(), flow: { submitted } });

  it("renders every candidate with its identifier, score, band text and glyph, and the policy label", () => {
    expect(html).toContain("SYN-DEMO-KND-001");
    expect(html).toContain("SYN-DEMO-KND-004");
    expect(html).toContain("DEMONSTRATION_HEURISTIC_V1");
    expect(html).toContain("86 out of 100");
    expect(html).toContain("73 out of 100");
    expect(html).toContain(en["p5.band.LIKELY_SAME"]);
    expect(html).toContain(en["p5.band.POSSIBLE_MATCH"]);
    expect(html).toMatch(/aria-hidden="true">≈<\/span><span>Likely the same/);
  });

  it("explains each factor by name with the points the API returned", () => {
    for (const k of FACTOR_KEYS) {
      expect(html).toContain(en[`p5.factor.${k}`]!);
      expect(html).toContain(`data-factor="${k}"`);
    }
    expect(html).toMatch(/data-factor="withinConfiguredRadius">● 20</);
    expect(html).toMatch(/data-factor="withinConfiguredWindow">○ 0</);
    expect(html).toMatch(/data-factor="keywordOverlap">● 6</);
  });

  it("states what the score is and is not, and that nothing is merged or silently rejected", () => {
    expect(html).toContain("deterministic demonstration heuristic");
    expect(html).toMatch(/not a probability, not an AI confidence, not a fraud or risk rating and not a legal conclusion/);
    expect(html).toContain("No report is silently rejected or merged by this check.");
    expect(html.toLowerCase()).not.toMatch(/\bconfidence: |\bprobability: |fraud score|risk score/);
  });

  it("offers all three contract choices: endorse and add-evidence per candidate, and keep-separate once", () => {
    expect((html.match(/data-choice="ENDORSE_EXISTING"/g) ?? []).length).toBe(RESULT.candidates.length);
    expect((html.match(/data-choice="ADD_EVIDENCE_TO_EXISTING"/g) ?? []).length).toBe(RESULT.candidates.length);
    expect((html.match(/data-choice="CREATE_SEPARATE_ISSUE"/g) ?? []).length).toBe(1);
    for (const c of DUPLICATE_CHOICES) expect(html).toContain(en[`p5.choice.${c}`]!);
  });

  it("shows candidate display text and status caveats from the public issue list, never a verified claim for a claimed closure", () => {
    expect(html).toContain(String(seed("SYN-DEMO-KND-001").title));
    expect(html).toContain(en["p5.caveat.claimed"]!);
    expect(html).not.toMatch(/KND-001[\s\S]{0,400}Verified complete/);
  });

  it("renders the API's own score even when it disagrees with the factor sum (the browser never recalculates)", () => {
    const qc = seededClient();
    const bad = { ...RESULT, candidates: [candidate("SYN-DEMO-KND-001", 77, "POSSIBLE_MATCH")] };
    qc.setQueryData(["duplicate-check", NEW_ISSUE.id, JSON.stringify({ category: "POTHOLE", geometry: NEW_ISSUE.geometry, descriptionKeywords: KEYWORDS })], {
      data: duplicateCandidatesResultSchema.parse({ data: bad, correlationId: "c-12345678" }).data,
      correlationId: "c-12345678",
    });
    const out = renderApp(url, { qc, flow: { submitted } });
    expect(out).toContain("77 out of 100");
    expect(out).not.toContain("86 out of 100");
    expect(out).toContain(en["p5.band.POSSIBLE_MATCH"]!);
  });

  it("holds no policy constants: factor keys equal the committed policy weights and sources never import or sum them", () => {
    expect([...FACTOR_KEYS]).toEqual(Object.keys(policy.weights));
    for (const src of [dedupSrc, presentSrc, receiptSrc, reportSrc]) {
      expect(src).not.toMatch(/duplicate-policy|likelySame|probablyDistinct|radiusMeters|windowHours|\.reduce\(/);
    }
  });

  it("marks a recurrence candidate as a possible recurrence, never as a merge", () => {
    const qc = seededClient();
    const rec = { ...RESULT, candidates: [{ ...candidate("SYN-DEMO-KND-001", 90, "LIKELY_SAME"), possibleRecurrence: true }] };
    qc.setQueryData(["duplicate-check", NEW_ISSUE.id, JSON.stringify({ category: "POTHOLE", geometry: NEW_ISSUE.geometry, descriptionKeywords: KEYWORDS })], {
      data: duplicateCandidatesResultSchema.parse({ data: rec, correlationId: "c-12345678" }).data,
      correlationId: "c-12345678",
    });
    expect(renderApp(url, { qc, flow: { submitted } })).toContain("Possible recurrence");
  });

  it("an empty result is an honest empty state: no candidates, only keep-separate is offered, and the report stays submitted", () => {
    const qc = seededClient();
    const empty = { ...RESULT, candidates: [] };
    qc.setQueryData(["duplicate-check", NEW_ISSUE.id, JSON.stringify({ category: "POTHOLE", geometry: NEW_ISSUE.geometry, descriptionKeywords: KEYWORDS })], {
      data: duplicateCandidatesResultSchema.parse({ data: empty, correlationId: "c-12345678" }).data,
      correlationId: "c-12345678",
    });
    const out = renderApp(url, { qc, flow: { submitted } });
    expect(out).toContain(en["p5.dup.empty.title"]!);
    expect(out).not.toContain('data-choice="ENDORSE_EXISTING"');
    expect(out).toContain('data-choice="CREATE_SEPARATE_ISSUE"');
  });

  it("shows a loading state while the check is in flight, an error with retry on failure, and nothing fabricated", () => {
    const loading = renderApp(url, { flow: { submitted } });
    expect(loading).toContain(en["state.loading.title"]!);
    expect(loading).not.toContain("86 out of 100");

    const qc = client();
    const key = ["duplicate-check", NEW_ISSUE.id, JSON.stringify({ category: "POTHOLE", geometry: NEW_ISSUE.geometry, descriptionKeywords: KEYWORDS })];
    qc.getQueryCache()
      .build(qc, { queryKey: key })
      .setState({
        status: "error",
        error: new ApiProblemError({ type: "about:blank", title: "Conflict", status: 409, correlationId: "corr-err-0001", extensions: {} }),
        fetchStatus: "idle",
        errorUpdateCount: 1,
        errorUpdatedAt: Date.now(),
      });
    const err = renderApp(url, { qc, flow: { submitted } });
    expect(err).toContain(en["p5.dup.check.failed"]!);
    expect(err).toContain(en["p1.error.retry"]!);
    expect(err).toContain("corr-err-0001");
    expect(err).not.toContain("out of 100");
  });

  it("handles direct navigation honestly: no id, a malformed id and an unknown id request nothing and show no data", () => {
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
    const none = renderApp("/page-05", { fetchImpl: fetchSpy });
    expect(none).toContain(en["p5.dup.noSubject.title"]!);
    const bad = renderApp("/page-05?issueId=not-valid", { fetchImpl: fetchSpy });
    expect(bad).toContain(en["p5.dup.badId.title"]!);
    expect(bad).not.toContain("not-valid");
    const twice = renderApp(`/page-05?issueId=${NEW_ISSUE.id}&issueId=SYN-DEMO-KND-001`, { fetchImpl: fetchSpy });
    expect(twice).toContain(en["p5.dup.badId.title"]!);
    expect(fetchSpy).not.toHaveBeenCalled();
    // a valid id with no in-memory report starts recovery from the server (loading), without inventing a result
    const recovering = renderApp("/page-05?issueId=SYN-DEMO-KND-RFFFFFFFF", { fetchImpl: fetchSpy });
    expect(recovering).toContain(en["state.loading.title"]!);
    expect(recovering).not.toContain("out of 100");
  });
});

// ----------------------------------------------------------------------------------------------------- PAGE-06 receipt

describe("PAGE-06 submission receipt", () => {
  const evidence = {
    id: "SYN-DEMO-EVD-RFEDCBA98",
    recordVersion: 1,
    issueId: "SYN-DEMO-KND-001",
    stage: "BEFORE",
    caption: "Synthetic note",
    confidence: "CITIZEN_SUBMITTED",
    capturedAt: "2026-11-21T04:20:00Z",
    locationConfidence: "LOCATION_UNVERIFIED",
    mediaStatus: "SYNTHETIC_FIXTURE_REFERENCE_ONLY",
    mediaRef: "fixtures/evidence/SYN-DEMO-EVD-CITIZEN-ABCDEF012345.svg",
    hashBasis: "FIXTURE_REFERENCE_STRING",
    verificationState: "NOT_VERIFIED",
    processingState: "UPLOADED_QUARANTINE",
    caveat: "Synthetic fixture reference only.",
  } as const;

  const url = `/page-06?issueId=${NEW_ISSUE.id}&targetId=SYN-DEMO-KND-001&evidenceId=${evidence.id}`;
  const decision = { choice: "ENDORSE_EXISTING", targetIssueId: "SYN-DEMO-KND-001", evidence, correlationId: "corr-decision-0001" } as const;
  const html = renderApp(url, { flow: { submitted, decision } });

  it("is built from the committed responses: reference id, UTC timestamp, status, support references and evidence state", () => {
    expect(html).toContain(NEW_ISSUE.id);
    expect(html).toContain("2026-11-21 04:30 UTC");
    expect(html).toContain(en["status.SUBMITTED_UNVERIFIED"]!);
    expect(html).toContain("corr-submit-0001");
    expect(html).toContain("corr-decision-0001");
    expect(html).toContain("UPLOADED_QUARANTINE");
    expect(html).toContain("NOT_VERIFIED");
    expect(html).toContain("SYN-DEMO-KND-001");
  });

  it("is truthful: submitted and unverified, linked only as a potential duplicate, verification not reached, not official", () => {
    expect(html).toContain(en["p5.receipt.state.submitted"]!);
    expect(html).toContain(en["p5.receipt.state.unverified"]!);
    expect(html).toContain(en["p5.receipt.state.linked"]!);
    expect(html).toContain(en["p5.receipt.state.notReached"]!);
    expect(html).toContain('data-testid="not-official"');
    expect(html).toMatch(/Not an official BMC submission or acknowledgement/);
    expect(html).toMatch(/remains a separate, unverified record; nothing was merged/);
    // the explicit negation ("No authority has accepted ...") is the one place those words may appear
    const claims = html.replace(/<p class="callout" data-testid="not-official">[^<]*<\/p>/, "");
    expect(claims.toLowerCase().match(/successfully (submitted|completed)|accepted by|(has|was|is|been) (resolved|verified|accepted)|official acknowledg(e)?ment received/)?.[0]).toBeUndefined();
  });

  it("describes a kept-separate decision and a no-decision receipt without claiming a link", () => {
    const sep = renderApp(`/page-06?issueId=${NEW_ISSUE.id}&targetId=${NEW_ISSUE.id}&evidenceId=${evidence.id}`, {
      flow: { submitted, decision: { ...decision, choice: "CREATE_SEPARATE_ISSUE", targetIssueId: NEW_ISSUE.id } },
    });
    expect(sep).toContain(en["p5.receipt.state.separate"]!);
    expect(sep).not.toContain(en["p5.receipt.state.linked"]!);
    const none = renderApp(`/page-06?issueId=${NEW_ISSUE.id}`, { flow: { submitted } });
    expect(none).toContain(en["p5.receipt.state.noDecision"]!);
    expect(none).not.toContain(en["p5.receipt.evidence"]!);
  });

  it("links to the Kundali and the map/list workspace, and back to a new report", () => {
    expect(html).toContain(`href="/page-02?id=${NEW_ISSUE.id}"`);
    expect(html).toContain('href="/page-01"');
    expect(html).toContain('href="/page-04"');
  });

  it("does not fabricate a receipt for a missing or malformed reference, and starts recovery for a valid one", () => {
    expect(renderApp("/page-06")).toContain(en["p5.receipt.missing.title"]!);
    const bad = renderApp("/page-06?issueId=nope");
    expect(bad).toContain(en["p5.receipt.badId.title"]!);
    expect(bad).not.toContain("nope");
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
    const rec = renderApp("/page-06?issueId=SYN-DEMO-KND-RFFFFFFFF", { fetchImpl: fetchSpy });
    expect(rec).toContain(en["state.loading.title"]!);
    expect(rec).not.toContain("SYN-DEMO-KND-RFFFFFFFF</code>");
  });
});

// ---------------------------------------------------------------------------------------------- command calls and contract

describe("P5 command calls", () => {
  function recorder(body: unknown, status = 200) {
    const f = vi.fn(async () =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": status === 200 ? "application/json" : "application/problem+json" } }),
    );
    return { f: f as unknown as typeof fetch, calls: f.mock.calls as unknown as Array<[string, RequestInit]> };
  }
  const api = (f: typeof fetch) => new ApiClient({ baseUrl: "http://localhost:8080", fetch: f, getPersona: () => "citizen", newId: () => "generated-id-0001" });

  it("submitIssue posts { recordVersion: 1, payload } with persona, correlation id and the supplied Idempotency-Key", async () => {
    const { f, calls } = recorder({ data: NEW_ISSUE, correlationId: "c-12345678" });
    const v = validateReport(GOOD);
    if (!v.ok) throw new Error("fixture invalid");
    const r = await submitIssue(api(f), v.payload, "idem-key-0001");
    expect(r.data.id).toBe(NEW_ISSUE.id);
    const [url, init] = calls[0]!;
    expect(url).toBe("http://localhost:8080/v1/issues");
    expect(init.method).toBe("POST");
    const h = init.headers as Record<string, string>;
    expect(h["Idempotency-Key"]).toBe("idem-key-0001");
    expect(h["X-Demo-Persona"]).toBe("citizen");
    expect(h["X-Correlation-Id"]).toBe("generated-id-0001");
    expect(h["If-Match"]).toBeUndefined();
    expect(JSON.parse(init.body as string)).toEqual({ recordVersion: 1, payload: v.payload });
  });

  it("a retry with the same key sends the same key and body (an exact replay), and a malformed success body is an error, not data", async () => {
    const { f, calls } = recorder({ data: NEW_ISSUE, correlationId: "c-12345678" });
    const v = validateReport(GOOD);
    if (!v.ok) throw new Error("fixture invalid");
    await submitIssue(api(f), v.payload, "idem-key-0001");
    await submitIssue(api(f), v.payload, "idem-key-0001");
    expect((calls[0]![1].headers as Record<string, string>)["Idempotency-Key"]).toBe((calls[1]![1].headers as Record<string, string>)["Idempotency-Key"]);
    expect(calls[0]![1].body).toBe(calls[1]![1].body);
    const bad = recorder({ data: { id: "SYN-DEMO-KND-1" }, correlationId: "c-12345678" });
    await expect(submitIssue(api(bad.f), v.payload, "idem-key-0002")).rejects.toThrow();
  });

  it("checkDuplicates and addEvidence target the path id with the contract bodies", async () => {
    const dup = recorder({ data: RESULT, correlationId: "c-12345678" });
    await checkDuplicates(api(dup.f), NEW_ISSUE.id, 1, { category: "POTHOLE", geometry: NEW_ISSUE.geometry, descriptionKeywords: KEYWORDS }, "idem-key-0003");
    expect(dup.calls[0]![0]).toBe(`http://localhost:8080/v1/issues/${NEW_ISSUE.id}/duplicate-candidates`);
    expect(JSON.parse(dup.calls[0]![1].body as string)).toEqual({
      recordVersion: 1,
      payload: { category: "POTHOLE", geometry: NEW_ISSUE.geometry, descriptionKeywords: KEYWORDS },
    });
    const ev = recorder({
      data: { id: "SYN-DEMO-EVD-RFEDCBA98", recordVersion: 1, issueId: "SYN-DEMO-KND-001", stage: "BEFORE", caption: "c", confidence: "CITIZEN_SUBMITTED", capturedAt: "2026-11-21T04:20:00Z", locationConfidence: "LOCATION_UNVERIFIED", mediaStatus: "SYNTHETIC_FIXTURE_REFERENCE_ONLY", mediaRef: "fixtures/evidence/SYN-DEMO-EVD-CITIZEN-AAAAAAAAAAAA.svg", hashBasis: "FIXTURE_REFERENCE_STRING", verificationState: "NOT_VERIFIED", processingState: "UPLOADED_QUARANTINE", caveat: "x" },
      correlationId: "c-12345678",
    });
    const payload = { stage: "BEFORE", caption: "c", sourceType: "CITIZEN_FIXTURE", capturedAt: "2026-11-21T04:20:00Z", mediaRef: "fixtures/evidence/SYN-DEMO-EVD-CITIZEN-AAAAAAAAAAAA.svg", sha256: "a".repeat(64), duplicateChoice: "ENDORSE_EXISTING" } as const;
    const r = await addEvidence(api(ev.f), "SYN-DEMO-KND-001", 1, payload, "idem-key-0004");
    expect(r.data.processingState).toBe("UPLOADED_QUARANTINE");
    expect(ev.calls[0]![0]).toBe("http://localhost:8080/v1/issues/SYN-DEMO-KND-001/evidence");
    expect(Object.keys(JSON.parse(ev.calls[0]![1].body as string).payload).sort()).toEqual(
      ["capturedAt", "caption", "duplicateChoice", "mediaRef", "sha256", "sourceType", "stage"].sort(),
    );
  });

  it("surfaces a 409 and a 422 as typed problems with their correlation id (no silent retry, no fabricated success)", async () => {
    const { f } = recorder({ type: "about:blank", title: "Conflict", status: 409, correlationId: "corr-409-0001" }, 409);
    const v = validateReport(GOOD);
    if (!v.ok) throw new Error("fixture invalid");
    await expect(submitIssue(api(f), v.payload, "idem-key-0005")).rejects.toMatchObject({ kind: "problem", status: 409 });
  });
});

describe("evidence fixture references", () => {
  it("creates unique contract-pattern references and hashes the reference string itself", async () => {
    const a = newFixtureRef();
    const b = newFixtureRef();
    expect(a).toMatch(FIXTURE_REF_PATTERN);
    expect(a).not.toBe(b);
    const h = await sha256Hex(a);
    expect(h).toMatch(/^[a-f0-9]{64}$/);
    // independent oracle: the published SHA-256 test vector for "abc"
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("fails loudly instead of inventing weak identifiers when no crypto source exists", async () => {
    expect(() => newFixtureRef({} as never)).toThrow();
    await expect(sha256Hex("x", {} as never)).rejects.toThrow();
  });
});

describe("drift guards against the frozen contract", () => {
  it("declares exactly the three P5 operations on their committed paths", () => {
    for (const s of [
      /\/v1\/issues:[\s\S]*?post:\s+operationId: submitIssue/,
      /\/v1\/issues\/\{id\}\/duplicate-candidates:\s+post:\s+operationId: checkDuplicates/,
      /\/v1\/issues\/\{id\}\/evidence:\s+post:\s+operationId: addEvidence/,
    ]) {
      expect(openapi).toMatch(s);
    }
  });

  it("uses the contract's response shapes and choices", () => {
    expect(openapi).toContain("const: DEMONSTRATION_HEURISTIC_V1");
    for (const c of DUPLICATE_CHOICES) expect(openapi).toContain(c);
    for (const k of FACTOR_KEYS) expect(openapi).toContain(`- ${k}`);
    expect(new Set(en["p5.report.hint.title"] && Object.keys(en).filter((k) => k.startsWith("p5."))).size).toBeGreaterThan(50);
  });

  it("the full app route table mounts the three pages without placeholders", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <PersonaProvider>
          <ApiClientProvider>
            <QueryClientProvider client={client()}>
              <StaticRouter location="/page-04">
                <App />
              </StaticRouter>
            </QueryClientProvider>
          </ApiClientProvider>
        </PersonaProvider>
      </I18nProvider>,
    );
    expect(html).toContain('class="report"');
    expect(html).not.toContain("Not implemented in this phase");
  });
});

describe("PAGE-05 for a persona that cannot run the check", () => {
  it("asks for Citizen instead of sending a command that would be refused, and shows no result", () => {
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
    const out = renderApp(`/page-05?issueId=${NEW_ISSUE.id}`, { persona: "public", flow: { submitted }, fetchImpl: fetchSpy });
    expect(out).toContain('data-testid="persona-blocked"');
    expect(out).toContain("Switch to Citizen");
    expect(out).not.toContain("out of 100");
    expect(out).not.toContain(en["state.loading.title"]!);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
