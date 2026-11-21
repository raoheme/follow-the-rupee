import { describe, expect, it, vi } from "vitest";
import issuesSeed from "../../../../../data/demo/issues.json";
import webPackage from "../../../package.json";
import rootPackageText from "../../../../../package.json?raw";
import lockText from "../../../../../pnpm-lock.yaml?raw";
import adapterSource from "./map/LeafletMapAdapter.ts?raw";
import panelSource from "./MapPanel.tsx?raw";
import { ApiClient, HEADER_CORRELATION_ID, HEADER_PERSONA } from "../../api/client";
import { ApiAbortError, ApiHttpError, ApiNetworkError, ApiProblemError, ApiTimeoutError, parseProblem } from "../../api/errors";
import { describeError } from "./describeError";
import { issuesQuery, mapQuery, NO_FILTERS, hasActiveFilters, WARD_OPTIONS, type WorkspaceFilters } from "./filters";
import { boundsOf, geometryLatLngs, gridLines, isIssueStatus, markerSvg, MUMBAI_BOUNDS, toLatLng, vectorStyle } from "./map/presentation";
import { TileHealth } from "./map/tileHealth";
import {
  compareParity,
  FULL_BBOX,
  geometrySchema,
  issueIdsOnMap,
  issueListResultSchema,
  mapFeatureCollectionResultSchema,
  parseResult,
  type MapFeature,
} from "./model";
import { fetchIssues, fetchMapFeatures } from "./queries";

const seedIssues = issuesSeed as unknown as Array<Record<string, unknown>>;

/** Responses shaped like the live API, built from the committed synthetic seed (test input, not product data). */
function listBody(items: Array<Record<string, unknown>> = seedIssues, correlationId = "cid-list-1") {
  return { data: { items, total: items.length }, correlationId };
}
function featureOf(i: Record<string, unknown>, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
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
      dlpActive: false,
      recordNature: "SYNTHETIC_DEMONSTRATION",
      ...over,
    },
  };
}
const mapBody = (features: unknown[]) => ({ data: { type: "FeatureCollection", features }, correlationId: "cid-map-1" });

describe("shared filters feed both requests identically", () => {
  const f: WorkspaceFilters = { ward: "K/W", category: "POTHOLE", status: "TRIAGED_ASSIGNED", dlpOnly: true };

  it("sends the same ward, category, status and dlpOnly to the list and to the map; bbox only on the map", () => {
    expect(issuesQuery(f)).toEqual({ ward: "K/W", category: "POTHOLE", status: "TRIAGED_ASSIGNED", dlpOnly: "true" });
    expect(mapQuery(f)).toEqual({ bbox: FULL_BBOX, ...issuesQuery(f) });
    expect("bbox" in issuesQuery(f)).toBe(false);
  });

  it("omits empty filters, and dlpOnly=false is never sent (it equals omitting it)", () => {
    expect(issuesQuery(NO_FILTERS)).toEqual({});
    expect(mapQuery(NO_FILTERS)).toEqual({ bbox: "72.77,18.89,72.99,19.275" });
    expect(issuesQuery({ ...NO_FILTERS, dlpOnly: false })).toEqual({});
  });

  it("offers ward codes (not ids or names) and reports when any filter is active", () => {
    expect(WARD_OPTIONS.map((w) => w.code)).toEqual(["K/W", "G/N", "M/E"]);
    expect(hasActiveFilters(NO_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...NO_FILTERS, dlpOnly: true })).toBe(true);
  });
});

describe("response models", () => {
  it("accepts a live-shaped list and map response", () => {
    expect(issueListResultSchema.safeParse(listBody()).success).toBe(true);
    expect(mapFeatureCollectionResultSchema.safeParse(mapBody(seedIssues.map((i) => featureOf(i)))).success).toBe(true);
  });

  it("rejects a position that is swapped ([latitude, longitude]) or outside Greater Mumbai", () => {
    expect(geometrySchema.safeParse({ type: "Point", coordinates: [72.83, 19.12] }).success).toBe(true);
    expect(geometrySchema.safeParse({ type: "Point", coordinates: [19.12, 72.83] }).success).toBe(false);
    expect(geometrySchema.safeParse({ type: "Point", coordinates: [0, 0] }).success).toBe(false);
  });

  it("rejects unknown statuses and non-synthetic records instead of rendering them", () => {
    const bad = structuredClone(listBody());
    (bad.data.items[0] as Record<string, unknown>).status = "TOTALLY_FIXED";
    expect(issueListResultSchema.safeParse(bad).success).toBe(false);
    const nonSyn = structuredClone(listBody());
    (nonSyn.data.items[0] as Record<string, unknown>).recordNature = "OFFICIAL_RECORD";
    expect(issueListResultSchema.safeParse(nonSyn).success).toBe(false);
  });

  it("turns a malformed success body into an HTTP-level error, not data", () => {
    expect(() => parseResult(issueListResultSchema, { data: {}, correlationId: "x" })).toThrow(ApiHttpError);
    try {
      parseResult(issueListResultSchema, null);
    } catch (e) {
      expect((e as ApiHttpError).reason).toBe("unexpected-shape");
    }
  });

  it("compares map and list by stable issue id and ignores assets and public works", () => {
    const feats = [
      featureOf(seedIssues[0]!),
      { ...featureOf(seedIssues[1]!), properties: { ...(featureOf(seedIssues[1]!).properties as object), kind: "ASSET" } },
    ].map((f) => mapFeatureCollectionResultSchema.shape.data.shape.features.element.parse(f));
    expect(issueIdsOnMap(feats)).toEqual([seedIssues[0]!.id]);
    expect(compareParity(["a", "b"], ["b", "a"]).ok).toBe(true);
    expect(compareParity(["a", "b"], ["a", "c"])).toEqual({ ok: false, onlyInList: ["b"], onlyOnMap: ["c"] });
  });
});

describe("live fetchers use the contract paths, headers and error distinctions", () => {
  function client(handler: (url: URL, init: RequestInit) => Response | Promise<Response>, persona?: "authority") {
    const calls: Array<{ url: URL; headers: Record<string, string> }> = [];
    const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push({ url, headers: init?.headers as Record<string, string> });
      return handler(url, init ?? {});
    });
    let n = 0;
    return {
      calls,
      c: new ApiClient({
        baseUrl: "http://localhost:8080",
        fetch: fetchStub as unknown as typeof fetch,
        getPersona: () => persona,
        newId: () => `corr-${++n}-xxxxxxxx`,
      }),
    };
  }
  const json = (b: unknown, status = 200, type = "application/json") =>
    new Response(JSON.stringify(b), { status, headers: { "content-type": type } });

  it("GETs /v1/issues and /v1/map/features with the shared query, a correlation id and the persona wire value", async () => {
    const { c, calls } = client((u) => (u.pathname === "/v1/issues" ? json(listBody()) : json(mapBody([]))), "authority");
    const f: WorkspaceFilters = { ward: "K/W", category: "", status: "", dlpOnly: true };
    const issues = await fetchIssues(c, f);
    const map = await fetchMapFeatures(c, f);
    expect(issues.data.total).toBe(6);
    expect(issues.correlationId).toBe("cid-list-1");
    expect(map.data).toEqual([]);
    expect(calls[0]!.url.pathname + calls[0]!.url.search).toBe("/v1/issues?ward=K%2FW&dlpOnly=true");
    expect(calls[1]!.url.searchParams.get("bbox")).toBe(FULL_BBOX);
    expect(calls[1]!.url.searchParams.get("ward")).toBe("K/W");
    expect(calls[1]!.url.searchParams.get("dlpOnly")).toBe("true");
    for (const call of calls) {
      expect(call.headers[HEADER_PERSONA]).toBe("authority");
      expect(call.headers[HEADER_CORRELATION_ID]).toMatch(/^corr-\d+-xxxxxxxx$/);
    }
  });

  it("keeps network, timeout, abort, non-JSON, problem and wrong-shape failures distinct", async () => {
    const net = client(() => {
      throw new TypeError("Failed to fetch");
    });
    await expect(fetchIssues(net.c, NO_FILTERS)).rejects.toBeInstanceOf(ApiNetworkError);

    const html = client(() => new Response("<html>bad gateway</html>", { status: 502, headers: { "content-type": "text/html" } }));
    await expect(fetchIssues(html.c, NO_FILTERS)).rejects.toMatchObject({ kind: "http", reason: "non-problem-response", status: 502 });

    const problem = { type: "/problems/invalid-request", title: "Invalid request", status: 400, detail: "ward must be a ward code", correlationId: "cid-9" };
    const bad = client(() => json(problem, 400, "application/problem+json"));
    await expect(fetchMapFeatures(bad.c, NO_FILTERS)).rejects.toBeInstanceOf(ApiProblemError);

    const shape = client(() => json({ data: { items: "nope" }, correlationId: "c" }));
    await expect(fetchIssues(shape.c, NO_FILTERS)).rejects.toMatchObject({ kind: "http", reason: "unexpected-shape" });

    const ac = new AbortController();
    const hang = client((_u, init) => new Promise<Response>((_res, rej) => init.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")))));
    const p = fetchIssues(hang.c, NO_FILTERS, ac.signal);
    ac.abort();
    await expect(p).rejects.toBeInstanceOf(ApiAbortError);
    const slow = client((_u, init) => new Promise<Response>((_res, rej) => init.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")))));
    await expect(slow.c.get("/v1/issues", { timeoutMs: 10 })).rejects.toBeInstanceOf(ApiTimeoutError);
  });

  it("maps failures to what the page may say without inventing a Problem", () => {
    expect(describeError(new ApiNetworkError(new Error("x")))).toEqual({ kind: "unavailable" });
    expect(describeError(new ApiTimeoutError(5))).toEqual({ kind: "unavailable" });
    expect(describeError(new ApiAbortError())).toEqual({ kind: "aborted" });
    expect(describeError(new ApiHttpError(502, "Bad Gateway", "non-problem-response", "text/html"))).toEqual({ kind: "unexpected", status: 502 });
    const p503 = parseProblem({ type: "about:blank", title: "Data source unavailable", status: 503, correlationId: "c-1" })!;
    expect(describeError(new ApiProblemError(p503))).toMatchObject({ kind: "unavailable", status: 503, correlationId: "c-1" });
    const p400 = parseProblem({ type: "/p", title: "Invalid request", status: 400, detail: "d", correlationId: "c-2" })!;
    expect(describeError(new ApiProblemError(p400))).toEqual({ kind: "problem", status: 400, title: "Invalid request", detail: "d", correlationId: "c-2" });
    expect(describeError(new Error("boom"))).toEqual({ kind: "unexpected" });
  });
});

describe("map presentation (library independent)", () => {
  const point = geometrySchema.parse({ type: "Point", coordinates: [72.8315, 19.1197] });
  const polygon = geometrySchema.parse({ type: "Polygon", coordinates: [[[72.83, 19.11], [72.84, 19.11], [72.84, 19.12], [72.83, 19.12], [72.83, 19.11]]] });
  const mk = (id: string, geometry: MapFeature["geometry"], over: Partial<MapFeature["properties"]> = {}): MapFeature => ({
    type: "Feature",
    id,
    geometry,
    properties: { kind: "ISSUE", recordId: id, title: id, category: "POTHOLE", status: "SUBMITTED_UNVERIFIED", wardId: null, dlpActive: false, recordNature: "SYNTHETIC_DEMONSTRATION", ...over },
  });

  it("swaps GeoJSON [lon, lat] to Leaflet [lat, lon] in exactly one place and keeps polygons as polygons", () => {
    expect(toLatLng([72.8315, 19.1197])).toEqual([19.1197, 72.8315]);
    expect(geometryLatLngs(point)).toEqual([19.1197, 72.8315]);
    const rings = geometryLatLngs(polygon) as number[][][];
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(5);
    expect(rings[0]![0]).toEqual([19.11, 72.83]);
  });

  it("computes [[south, west], [north, east]] bounds over every vertex, or null when empty", () => {
    expect(boundsOf([])).toBeNull();
    expect(boundsOf([mk("SYN-DEMO-A", point), mk("SYN-DEMO-B", polygon)])).toEqual([[19.11, 72.83], [19.12, 72.84]]);
  });

  it("styles by status without relying on colour alone and thickens (not recolours) the selection", () => {
    const base = vectorStyle(mk("SYN-DEMO-A", polygon, { status: "CLOSURE_CLAIMED_PENDING_VERIFICATION" }), false);
    const sel = vectorStyle(mk("SYN-DEMO-A", polygon, { status: "CLOSURE_CLAIMED_PENDING_VERIFICATION" }), true);
    expect(sel.weight).toBeGreaterThan(base.weight);
    expect(sel.color).toBe(base.color);
    // the claimed status is dashed (pending) and distinct from a verified one, which is solid
    expect(base.dashArray).toBeDefined();
    expect(vectorStyle(mk("SYN-DEMO-V", polygon, { status: "VERIFIED_COMPLETE" }), false).dashArray).toBeUndefined();
    expect(vectorStyle(mk("SYN-DEMO-W", polygon, { kind: "PUBLIC_WORK", status: "COMPLETION_CERTIFIED_IN_DLP", dlpActive: true }), false).dashArray).toBeDefined();
    expect(isIssueStatus("IN_PROGRESS")).toBe(true);
    expect(isIssueStatus("COMPLETION_CERTIFIED_IN_DLP")).toBe(false);
  });

  it("draws markers as inline SVG with a status glyph: no image files, so no broken default-icon request", () => {
    const svg = markerSvg(mk("SYN-DEMO-A", point, { status: "CLOSURE_CLAIMED_PENDING_VERIFICATION" }), false);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).not.toMatch(/<image|\.png|marker-icon|url\(/i);
    expect(svg).toContain("⚑");
    expect(markerSvg(mk("SYN-DEMO-A", point), true)).toContain('stroke-width="4"'); // selection ring
    expect(markerSvg(mk("SYN-DEMO-A", point), false)).not.toContain('r="20"');
  });

  it("builds a synthetic orientation grid inside Greater Mumbai", () => {
    const { lats, lons } = gridLines();
    expect(lats.length).toBeGreaterThan(5);
    expect(Math.min(...lats)).toBeGreaterThanOrEqual(MUMBAI_BOUNDS[0][0]);
    expect(Math.max(...lons)).toBeLessThanOrEqual(MUMBAI_BOUNDS[1][1]);
  });
});

describe("basemap degradation is bounded", () => {
  it("reports unavailable exactly once after the threshold of failures with no successful tile", () => {
    const spy = vi.fn();
    const h = new TileHealth(spy, 4);
    for (let i = 0; i < 3; i++) h.tileFailed();
    expect(spy).not.toHaveBeenCalled();
    for (let i = 0; i < 500; i++) h.tileFailed(); // an unbounded per-tile error stream
    expect(spy).toHaveBeenCalledTimes(1);
    expect(h.unavailable).toBe(true);
    h.tileLoaded();
    h.tileFailed();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("does not report when tiles are loading normally", () => {
    const spy = vi.fn();
    const h = new TileHealth(spy, 2);
    h.tileLoaded();
    for (let i = 0; i < 50; i++) h.tileFailed();
    expect(spy).not.toHaveBeenCalled();
  });
});

// --------------------------------------------------------------------------------------------------- source and package scans

/** Every frontend source file under apps/web/src, read as text by Vite (working tree == tracked tree once committed). */
const allSources = import.meta.glob("../../**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const sources = Object.entries(allSources).filter(([path]) => !/\.test\.tsx?$/.test(path));
const nameOf = (path: string) => path.split("/").pop();

describe("direct Leaflet only, behind the adapter", () => {
  const importOf = (name: string) => new RegExp(String.raw`(?:from|import)\s*\(?\s*["']${name}(?:["'/])`);

  it("scans real source files (not an empty list)", () => {
    expect(sources.length).toBeGreaterThan(20);
    expect(sources.map(([p]) => nameOf(p))).toContain("LeafletMapAdapter.ts");
  });

  it("has no react-leaflet import in any frontend source file, no dependency and no lockfile entry", () => {
    for (const [path, text] of sources) expect(text, path).not.toMatch(importOf("react-leaflet"));
    for (const text of [JSON.stringify(webPackage), rootPackageText, lockText]) expect(text).not.toMatch(/react-leaflet/);
    expect(webPackage.dependencies.leaflet).toBe("1.9.4");
    expect(webPackage.dependencies["@tanstack/react-query"]).toBe("5.90.10");
  });

  it("imports leaflet in exactly one module (the adapter); the page only loads it on demand", () => {
    // H2: monsoon Map Triage (features/monsoon) loads Leaflet directly and on demand; this rule still binds the legacy map-list feature.
    const importers = sources.filter(([p]) => !/monsoon/.test(p)).filter(([, text]) => importOf("leaflet").test(text) || /import\s+["']leaflet\//.test(text));
    expect(importers.map(([p]) => nameOf(p))).toEqual(["LeafletMapAdapter.ts"]);
    expect(panelSource).toContain('import("./map/LeafletMapAdapter")');
    expect(panelSource).not.toMatch(/^import .* from "\.\/map\/LeafletMapAdapter"/m);
  });

  it("imports Leaflet's stylesheet explicitly and never touches the default marker images", () => {
    expect(adapterSource).toMatch(/import\s+"leaflet\/dist\/leaflet\.css"/);
    expect(adapterSource).not.toMatch(/L\.Icon\.Default|marker-icon|marker-shadow|layers(-2x)?\.png|images\//);
    expect(adapterSource).toContain("divIcon");
    // the basemap is optional: tile errors only feed the bounded detector
    expect(adapterSource).toMatch(/tileerror/);
    expect(adapterSource).toContain("openstreetmap.org/copyright");
    expect(adapterSource).not.toMatch(/geocod|routing|markercluster|startDrawing|leaflet-draw|L\.Draw/i);
  });

  it("keeps the page free of fetch calls other than the two typed live reads, and of browser persistence", () => {
    for (const [path, text] of sources.filter(([p]) => /features\/map-list/.test(p))) {
      expect(text, path).not.toMatch(/fetch\(|XMLHttpRequest|localStorage|sessionStorage|navigator\.serviceWorker/);
    }
  });
});
