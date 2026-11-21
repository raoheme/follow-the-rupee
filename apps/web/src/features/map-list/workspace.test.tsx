import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import issuesSeed from "../../../../../data/demo/issues.json";
import { ApiClientProvider } from "../../api/ApiClientContext";
import { ApiNetworkError, ApiProblemError, parseProblem } from "../../api/errors";
import { I18nProvider } from "../../i18n/I18nContext";
import { PersonaProvider } from "../../state/PersonaContext";
import { ErrorNotice } from "./DataNotice";
import { NO_FILTERS } from "./filters";
import { Inspector, formatUtc } from "./Inspector";
import { IssueList } from "./IssueList";
import { issueListResultSchema, mapFeatureCollectionResultSchema, type IssueSummary, type MapFeature } from "./model";
import { createQueryClient, queryKeys } from "./queries";
import { MapListWorkspace, resolveSelection } from "./Workspace";

const seed = issuesSeed as unknown as Array<Record<string, unknown>>;
const issues: IssueSummary[] = issueListResultSchema.parse({ data: { items: seed, total: seed.length }, correlationId: "cid-1" }).data.items;

const features: MapFeature[] = mapFeatureCollectionResultSchema.parse({
  data: {
    type: "FeatureCollection",
    features: seed.map((i) => ({
      type: "Feature",
      id: i.id,
      geometry: i.geometry,
      properties: {
        kind: "ISSUE",
        recordId: i.id,
        title: i.title,
        category: i.category,
        status: i.status,
        wardId: i.wardCandidateId,
        dlpActive: i.id === "SYN-DEMO-KND-001",
        recordNature: "SYNTHETIC_DEMONSTRATION",
      },
    })),
  },
  correlationId: "cid-2",
}).data.features;

function render(setup: (qc: QueryClient) => void = () => undefined): string {
  const qc = createQueryClient();
  // server rendering never fetches, so a primed failure must not be turned back into a pending retry on mount
  qc.setDefaultOptions({ queries: { retry: false, retryOnMount: false, refetchOnWindowFocus: false } });
  setup(qc);
  return renderToStaticMarkup(
    <I18nProvider>
      <PersonaProvider>
        <ApiClientProvider>
          <QueryClientProvider client={qc}>
            <MemoryRouter>
              <MapListWorkspace />
            </MemoryRouter>
          </QueryClientProvider>
        </ApiClientProvider>
      </PersonaProvider>
    </I18nProvider>,
  );
}

const prime = (qc: QueryClient, list: IssueSummary[] | null, map: MapFeature[] | null) => {
  if (list) qc.setQueryData(queryKeys.issues(NO_FILTERS), { data: { items: list, total: list.length }, correlationId: "cid-l" });
  if (map) qc.setQueryData(queryKeys.map(NO_FILTERS), { data: map, correlationId: "cid-m" });
};
const fail = (qc: QueryClient, key: readonly unknown[], error: Error) =>
  qc.getQueryCache().build(qc, { queryKey: key }).setState({ status: "error", error, fetchStatus: "idle", errorUpdateCount: 1, errorUpdatedAt: 1 });

describe("PAGE-01 honest states from live responses", () => {
  it("shows loading (never data) until the real API has answered", () => {
    const html = render();
    expect(html.match(/data-state="loading"/g)?.length).toBe(2); // map and list
    expect(html).not.toMatch(/SYN-DEMO-KND/);
    expect(html).not.toContain("issue-row");
  });

  it("renders every issue from the list response with an icon+text status and no verified claim for a closure claim", () => {
    const html = render((qc) => prime(qc, issues, features));
    expect(html.match(/class="issue-row"/g)?.length).toBe(6);
    expect(html).toContain("Closure claimed, pending verification");
    expect(html).toContain('data-status="CLOSURE_CLAIMED_PENDING_VERIFICATION"');
    expect(html).not.toContain('data-status="VERIFIED_COMPLETE"');
    expect(html).toMatch(/Issues<span class="count">[^<]*\(6\)/);
    expect(html).toContain('aria-pressed="false"');
    expect(html).not.toContain('data-state="partial"'); // parity holds
    expect(html).toContain("Select an issue from the list or the map");
    // keyboard users can skip the map's many tab stops and reach the list
    expect(html).toMatch(/<a class="skip-inline" href="#list-heading">Skip the map and go to the issue list<\/a>/);
    expect(html).toContain('id="list-heading" tabindex="-1"');
  });

  it("is empty (not loading, not an error) when the API answers with no matching issues", () => {
    const html = render((qc) => prime(qc, [], []));
    expect(html).toContain("No issues match");
    expect(html).toContain('data-state="empty"');
    expect(html).not.toContain('data-state="loading"');
  });

  it("flags a map/list disagreement as partial data instead of hiding it", () => {
    const html = render((qc) => prime(qc, issues, features.slice(1)));
    expect(html).toContain("Map and list disagree");
    expect(html).toContain('data-state="partial"');
    expect(html.match(/class="issue-row"/g)?.length).toBe(6); // both sides shown as received
  });

  it("keeps the list usable when only the map request failed, and says the API is unavailable for a network error", () => {
    const html = render((qc) => {
      prime(qc, issues, null);
      fail(qc, queryKeys.map(NO_FILTERS), new ApiNetworkError(new Error("x")));
    });
    expect(html.match(/class="issue-row"/g)?.length).toBe(6);
    expect(html).toContain("API unavailable");
    expect(html).toContain('data-state="unavailable"');
    expect(html).toContain('role="alert"');
  });

  it("shows a server problem with its own title, detail and correlation id, and the HTTP status", () => {
    const problem = parseProblem({ type: "/problems/invalid-request", title: "Invalid request", status: 400, detail: "ward must be a ward code such as K/W", correlationId: "cid-777" })!;
    const html = render((qc) => {
      fail(qc, queryKeys.issues(NO_FILTERS), new ApiProblemError(problem));
      prime(qc, null, []);
    });
    expect(html).toContain("The API rejected the request");
    expect(html).toContain("ward must be a ward code such as K/W");
    expect(html).toContain("cid-777");
    expect(html).toContain("400");
    expect(html).not.toContain("issue-row");
  });

  it("does not invent a Problem for an error that carried none", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <ErrorNotice error={new ApiNetworkError(new Error("offline"))} />
      </I18nProvider>,
    );
    expect(html).not.toContain("Correlation id");
    expect(html).not.toContain("HTTP status");
  });
});

describe("selection by stable id and the inspector", () => {
  it("resolves by issue id regardless of list order or index", () => {
    const reversed = [...issues].reverse();
    expect(resolveSelection("SYN-DEMO-KND-003", issues, features)).toMatchObject({ type: "issue", issue: { id: "SYN-DEMO-KND-003" } });
    expect(resolveSelection("SYN-DEMO-KND-003", reversed, features)).toMatchObject({ type: "issue", issue: { id: "SYN-DEMO-KND-003" } });
    expect(resolveSelection("SYN-DEMO-KND-001", issues, features)).toMatchObject({ dlpActive: true });
    expect(resolveSelection("SYN-DEMO-KND-002", issues, features)).toMatchObject({ dlpActive: false });
    expect(resolveSelection("SYN-DEMO-KND-002", issues, undefined)).toMatchObject({ dlpActive: null });
    expect(resolveSelection("SYN-DEMO-NOPE", issues, features)).toBeNull();
    expect(resolveSelection(null, issues, features)).toBeNull();
  });

  it("marks only the selected row, tracked by id", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <IssueList items={issues} selectedId="SYN-DEMO-KND-004" onSelect={() => undefined} />
      </I18nProvider>,
    );
    expect(html.match(/aria-pressed="true"/g)?.length).toBe(1);
    expect(html).toMatch(/id="issue-row-SYN-DEMO-KND-004"[^>]*aria-pressed="true"/);
  });

  it("shows only supplied fields, a provisional ward candidate, a pending claim and a link to PAGE-02", () => {
    const sel = resolveSelection("SYN-DEMO-KND-001", issues, features);
    const html = renderToStaticMarkup(
      <I18nProvider>
        <MemoryRouter>
          <Inspector selection={sel} />
        </MemoryRouter>
      </I18nProvider>,
    );
    expect(html).toContain("Ward candidate (provisional, not a confirmed jurisdiction)");
    expect(html).toContain("SYN-DEMO-WARD-KW");
    expect(html).toContain("Closure claimed, pending verification");
    expect(html).toContain("Completion is claimed, not verified");
    expect(html).toContain("SYN-DEMO-WO-001");
    expect(html).toContain("Active for the linked work (derived for this request; responsibility is not decided here)");
    expect(html).toContain('href="/page-02?id=SYN-DEMO-KND-001"');
    expect(html).toContain(">View Kundali<");
    expect(html).not.toMatch(/confirmed jurisdiction(?!\))|₹|zero[- ]cost|contractor/i);
    // an issue without a work order says so instead of guessing
    const unlinked = renderToStaticMarkup(
      <I18nProvider>
        <MemoryRouter>
          <Inspector selection={resolveSelection("SYN-DEMO-KND-004", issues, features)} />
        </MemoryRouter>
      </I18nProvider>,
    );
    expect(unlinked).toContain("No work order linked");
    expect(unlinked).toContain("Not active for this record");
  });

  it("formats API timestamps as UTC text and leaves unrecognised values untouched", () => {
    expect(formatUtc("2026-10-05T04:15:00Z")).toBe("2026-10-05 04:15 UTC");
    expect(formatUtc("not a date")).toBe("not a date");
  });
});
