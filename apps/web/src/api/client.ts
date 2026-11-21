import type { DemoPersona } from "../state/personas";
import { API_BASE_URL } from "./config";
import {
  ApiAbortError,
  ApiHttpError,
  ApiNetworkError,
  ApiProblemError,
  ApiTimeoutError,
  parseProblem,
} from "./errors";
import { newOperationalId } from "./ids";

/**
 * Minimal typed HTTP foundation for openapi/openapi.yaml. It is deliberately not a generated or hand-copied model of
 * the API: P3+ pages declare the response type they expect per operation. The header names below are asserted against
 * openapi.yaml in client.test.ts so contract drift fails the test run instead of silently diverging.
 */
export const HEADER_PERSONA = "X-Demo-Persona";
export const HEADER_CORRELATION_ID = "X-Correlation-Id";
export const HEADER_IDEMPOTENCY_KEY = "Idempotency-Key";
export const HEADER_IF_MATCH = "If-Match";

/**
 * `If-Match` compatibility value for resolveJurisdiction. recordVersion is the only concurrency source; the header is
 * always derived from it as the quoted string, e.g. 3 -> "\"3\"" (never stored or tracked separately).
 */
export function ifMatchFor(recordVersion: number): string {
  assertRecordVersion(recordVersion);
  return `"${recordVersion}"`;
}

function assertRecordVersion(v: number): void {
  if (!Number.isSafeInteger(v) || v < 1) throw new RangeError(`recordVersion must be an integer >= 1: ${v}`);
}

export interface ApiClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Current simulated persona (a presentation lens, not a credential). Omit to send no persona header. */
  getPersona?: () => DemoPersona | undefined;
  timeoutMs?: number;
  newId?: () => string;
}

export interface RequestOptions {
  query?: Readonly<Record<string, string | number | boolean | undefined>>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Contract command envelope: every mutation body is { recordVersion, payload }. */
export interface CommandOptions<P> extends Omit<RequestOptions, "query"> {
  recordVersion: number;
  payload: P;
  /** Send If-Match derived from recordVersion (only resolveJurisdiction requires it). */
  ifMatch?: boolean;
  idempotencyKey?: string;
}

export const DEFAULT_TIMEOUT_MS = 15_000;

export class ApiClient {
  private readonly baseUrl: string;
  private readonly doFetch: typeof fetch;
  private readonly getPersona: () => DemoPersona | undefined;
  private readonly timeoutMs: number;
  private readonly newId: () => string;

  constructor(opts: ApiClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? API_BASE_URL).replace(/\/+$/, "");
    this.doFetch = opts.fetch ?? ((...a) => globalThis.fetch(...a));
    this.getPersona = opts.getPersona ?? (() => undefined);
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.newId = opts.newId ?? (() => newOperationalId());
  }

  get<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    return this.send<T>("GET", path, undefined, {}, opts);
  }

  /** POST a contract command ({ recordVersion, payload }) with correlation id, idempotency key and optional If-Match. */
  async command<T, P>(path: string, opts: CommandOptions<P>): Promise<T> {
    assertRecordVersion(opts.recordVersion);
    const extra: Record<string, string> = {
      [HEADER_IDEMPOTENCY_KEY]: opts.idempotencyKey ?? this.newId(),
    };
    if (opts.ifMatch) extra[HEADER_IF_MATCH] = ifMatchFor(opts.recordVersion);
    const body = JSON.stringify({ recordVersion: opts.recordVersion, payload: opts.payload });
    return this.send<T>("POST", path, body, extra, opts);
  }

  private url(path: string, query: RequestOptions["query"]): string {
    const u = new URL(`${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) u.searchParams.set(k, String(v));
    return u.toString();
  }

  private async send<T>(
    method: "GET" | "POST",
    path: string,
    body: string | undefined,
    extraHeaders: Record<string, string>,
    opts: RequestOptions,
  ): Promise<T> {
    const headers: Record<string, string> = {
      Accept: "application/json, application/problem+json",
      [HEADER_CORRELATION_ID]: this.newId(),
      ...extraHeaders,
    };
    const persona = this.getPersona();
    if (persona) headers[HEADER_PERSONA] = persona;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const timeoutMs = opts.timeoutMs ?? this.timeoutMs;
    const controller = new AbortController();
    let timedOut = false;
    let callerAborted = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onCallerAbort = () => {
      callerAborted = true;
      controller.abort();
    };
    if (opts.signal?.aborted) onCallerAbort();
    else opts.signal?.addEventListener("abort", onCallerAbort, { once: true });

    try {
      let res: Response;
      let text: string;
      try {
        res = await this.doFetch(this.url(path, opts.query), { method, headers, body, signal: controller.signal });
        text = await res.text();
      } catch (e) {
        if (timedOut) throw new ApiTimeoutError(timeoutMs);
        if (callerAborted) throw new ApiAbortError();
        throw new ApiNetworkError(e);
      }
      return this.interpret<T>(res, text);
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onCallerAbort);
    }
  }

  private interpret<T>(res: Response, text: string): T {
    const contentType = res.headers.get("content-type");
    const isJson = /\bjson\b/i.test(contentType ?? "");
    if (res.ok) {
      if (res.status === 204 || text === "") return undefined as T;
      if (!isJson) throw new ApiHttpError(res.status, res.statusText, "unreadable-success-body", contentType);
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new ApiHttpError(res.status, res.statusText, "unreadable-success-body", contentType);
      }
    }
    if (!/application\/problem\+json/i.test(contentType ?? "")) {
      throw new ApiHttpError(res.status, res.statusText, "non-problem-response", contentType);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ApiHttpError(res.status, res.statusText, "malformed-problem", contentType);
    }
    const problem = parseProblem(parsed);
    if (!problem) throw new ApiHttpError(res.status, res.statusText, "malformed-problem", contentType);
    throw new ApiProblemError(problem);
  }
}
