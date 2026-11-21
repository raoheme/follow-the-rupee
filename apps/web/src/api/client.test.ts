import { describe, expect, it, vi } from "vitest";
import { ApiClient, HEADER_CORRELATION_ID, HEADER_IDEMPOTENCY_KEY, HEADER_IF_MATCH, HEADER_PERSONA, ifMatchFor } from "./client";
import { DEFAULT_API_BASE_URL, resolveApiBaseUrl } from "./config";
import {
  ApiAbortError,
  ApiHttpError,
  ApiNetworkError,
  ApiProblemError,
  ApiTimeoutError,
  isApiError,
  parseProblem,
} from "./errors";
import { newOperationalId } from "./ids";
import type { DemoPersona } from "../state/personas";

const PROBLEM = { type: "about:blank", title: "Conflict", status: 409, correlationId: "corr-12345678" };

function respond(body: string | null, init: { status?: number; contentType?: string }): typeof fetch {
  return vi.fn(async () => {
    const headers = new Headers();
    if (init.contentType) headers.set("content-type", init.contentType);
    return new Response(body, { status: init.status ?? 200, headers });
  }) as unknown as typeof fetch;
}

function lastCall(f: typeof fetch) {
  const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)! as [string, RequestInit];
  return { url, init, headers: init.headers as Record<string, string> };
}

describe("API base URL", () => {
  it("defaults to http://localhost:8080 and honours VITE_API_BASE_URL", () => {
    expect(DEFAULT_API_BASE_URL).toBe("http://localhost:8080");
    expect(resolveApiBaseUrl(undefined)).toBe("http://localhost:8080");
    expect(resolveApiBaseUrl("")).toBe("http://localhost:8080");
    expect(resolveApiBaseUrl("https://api.example.test/")).toBe("https://api.example.test");
  });
});

describe("correlation / idempotency identifiers", () => {
  it("uses crypto.randomUUID when present", () => {
    expect(newOperationalId({ randomUUID: () => "11111111-2222-4333-8444-555555555555" })).toBe(
      "11111111-2222-4333-8444-555555555555",
    );
    expect(newOperationalId()).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("falls back to a v4 UUID from getRandomValues (never Math.random)", () => {
    const spy = vi.spyOn(Math, "random");
    const id = newOperationalId({ getRandomValues: (a) => a.fill(0xab) });
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(id.length).toBeGreaterThanOrEqual(8);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("throws rather than inventing weak ids when no crypto source exists", () => {
    expect(() => newOperationalId({})).toThrow(/random source/);
  });
});

describe("recordVersion / If-Match derivation", () => {
  it("derives the quoted If-Match from recordVersion", () => {
    expect(ifMatchFor(3)).toBe('"3"');
    expect(ifMatchFor(1)).toBe('"1"');
  });

  it.each([0, -1, 1.5, Number.NaN])("rejects invalid recordVersion %s", (v) => {
    expect(() => ifMatchFor(v)).toThrow(RangeError);
  });

  it("sends { recordVersion, payload } and an If-Match derived from the same recordVersion", async () => {
    const f = respond("{}", { contentType: "application/json" });
    const client = new ApiClient({ fetch: f, baseUrl: "http://x.test", newId: () => "id-12345678" });
    await client.command("/v1/authority/issues/SYN-DEMO-KND-003/jurisdiction", {
      recordVersion: 7,
      payload: { a: 1 },
      ifMatch: true,
    });
    const { init, headers } = lastCall(f);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ recordVersion: 7, payload: { a: 1 } });
    expect(headers[HEADER_IF_MATCH]).toBe('"7"');
    expect(headers[HEADER_IDEMPOTENCY_KEY]).toBe("id-12345678");
    expect(headers[HEADER_CORRELATION_ID]).toBe("id-12345678");
  });

  it("omits If-Match unless requested and refuses a stale/invalid version before sending", async () => {
    const f = respond("{}", { contentType: "application/json" });
    const client = new ApiClient({ fetch: f, baseUrl: "http://x.test" });
    await client.command("/v1/issues/SYN-DEMO-KND-001/evidence", { recordVersion: 2, payload: {} });
    expect(lastCall(f).headers[HEADER_IF_MATCH]).toBeUndefined();
    await expect(client.command("/x", { recordVersion: 0, payload: {} })).rejects.toThrow(RangeError);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("persona header", () => {
  it("attaches X-Demo-Persona with the exact wire value and tracks changes without a new client", async () => {
    let current: DemoPersona = "independent_reviewer";
    const f = respond("{}", { contentType: "application/json" });
    const client = new ApiClient({ fetch: f, baseUrl: "http://x.test", getPersona: () => current });
    await client.get("/v1/issues");
    expect(lastCall(f).headers[HEADER_PERSONA]).toBe("independent_reviewer");
    current = "demo_admin";
    await client.get("/v1/issues");
    expect(lastCall(f).headers[HEADER_PERSONA]).toBe("demo_admin");
  });

  it("sends no persona header when none is set and builds query strings", async () => {
    const f = respond("[]", { contentType: "application/json" });
    const client = new ApiClient({ fetch: f, baseUrl: "http://x.test/" });
    await client.get("/v1/map/features", { query: { bbox: "72.8,19.1,72.9,19.2", dlpOnly: true, ward: undefined } });
    const { url, headers } = lastCall(f);
    expect(headers[HEADER_PERSONA]).toBeUndefined();
    expect(url).toBe("http://x.test/v1/map/features?bbox=72.8%2C19.1%2C72.9%2C19.2&dlpOnly=true");
  });
});

describe("RFC 9457 and failure handling", () => {
  it("returns parsed JSON on success", async () => {
    const f = respond('{"ok":true}', { contentType: "application/json" });
    await expect(new ApiClient({ fetch: f }).get("/v1/x")).resolves.toEqual({ ok: true });
  });

  it("turns application/problem+json into a typed error preserving all members", async () => {
    const body = { ...PROBLEM, detail: "stale", instance: "/v1/x/1", currentRecordVersion: 9 };
    const f = respond(JSON.stringify(body), { status: 409, contentType: "application/problem+json; charset=utf-8" });
    const err = await new ApiClient({ fetch: f }).get("/v1/x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiProblemError);
    const p = (err as ApiProblemError).problem;
    expect(p).toMatchObject({ type: "about:blank", title: "Conflict", status: 409, detail: "stale", instance: "/v1/x/1" });
    expect(p.correlationId).toBe("corr-12345678");
    expect(p.extensions).toEqual({ currentRecordVersion: 9 });
  });

  it("parses a 409 stale write explicitly", async () => {
    const f = respond(JSON.stringify(PROBLEM), { status: 409, contentType: "application/problem+json" });
    const err = (await new ApiClient({ fetch: f }).get("/v1/x").catch((e: unknown) => e)) as ApiProblemError;
    expect(err.isStaleWrite).toBe(true);
    const f404 = respond(JSON.stringify({ ...PROBLEM, status: 404, title: "Not found" }), {
      status: 404,
      contentType: "application/problem+json",
    });
    const e2 = (await new ApiClient({ fetch: f404 }).get("/v1/x").catch((e: unknown) => e)) as ApiProblemError;
    expect(e2.isStaleWrite).toBe(false);
  });

  it("does not fabricate a Problem for non-JSON HTTP errors", async () => {
    const f = respond("<html>Bad gateway</html>", { status: 502, contentType: "text/html" });
    const err = await new ApiClient({ fetch: f }).get("/v1/x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiHttpError);
    expect(err).not.toBeInstanceOf(ApiProblemError);
    expect(err).toMatchObject({ status: 502, reason: "non-problem-response", contentType: "text/html" });
  });

  it.each([
    ["invalid JSON", "{not json"],
    ["wrong shape", JSON.stringify({ title: "x" })],
    ["status out of contract range", JSON.stringify({ ...PROBLEM, status: 200 })],
    ["a JSON array", "[]"],
  ])("treats a malformed problem body (%s) as an HTTP error, not a Problem", async (_n, body) => {
    const f = respond(body, { status: 500, contentType: "application/problem+json" });
    const err = await new ApiClient({ fetch: f }).get("/v1/x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiHttpError);
    expect(err).toMatchObject({ status: 500, reason: "malformed-problem" });
  });

  it("reports an unreadable success body", async () => {
    const f = respond("oops", { status: 200, contentType: "application/json" });
    await expect(new ApiClient({ fetch: f }).get("/v1/x")).rejects.toMatchObject({ reason: "unreadable-success-body" });
  });

  it("maps a failed fetch to ApiNetworkError", async () => {
    const f = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const err = await new ApiClient({ fetch: f }).get("/v1/x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiNetworkError);
    expect(isApiError(err)).toBe(true);
    expect(isApiError(new Error("x"))).toBe(false);
  });

  it("maps a stalled request to ApiTimeoutError and a caller abort to ApiAbortError", async () => {
    const hang = (_u: unknown, init?: RequestInit) =>
      new Promise<Response>((_res, rej) => {
        const abort = () => rej(new DOMException("aborted", "AbortError"));
        if (init?.signal?.aborted) abort();
        else init?.signal?.addEventListener("abort", abort);
      });
    const slow = new ApiClient({ fetch: hang as unknown as typeof fetch, timeoutMs: 20 });
    await expect(slow.get("/v1/x")).rejects.toBeInstanceOf(ApiTimeoutError);

    const ctl = new AbortController();
    const patient = new ApiClient({ fetch: hang as unknown as typeof fetch, timeoutMs: 5_000 });
    const pending = patient.get("/v1/x", { signal: ctl.signal });
    ctl.abort();
    await expect(pending).rejects.toBeInstanceOf(ApiAbortError);
    await expect(patient.get("/v1/x", { signal: ctl.signal })).rejects.toBeInstanceOf(ApiAbortError);
  });
});

describe("parseProblem", () => {
  it("accepts the contract shape and rejects anything else", () => {
    expect(parseProblem(PROBLEM)?.extensions).toEqual({});
    expect(parseProblem(null)).toBeNull();
    expect(parseProblem({ ...PROBLEM, correlationId: "" })).toBeNull();
    expect(parseProblem({ ...PROBLEM, title: "" })).toBeNull();
  });
});
