import { z } from "zod";

/**
 * RFC 9457 problem details as the contract defines them (openapi.yaml components.schemas.Problem: type, title, status
 * 400-599, optional detail, correlationId). `instance` is the RFC 9457 member; any other member is preserved verbatim
 * in `extensions`.
 */
export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail?: string;
  readonly instance?: string;
  readonly correlationId: string;
  readonly extensions: Readonly<Record<string, unknown>>;
}

const problemShape = z
  .object({
    type: z.string(),
    title: z.string().min(1),
    status: z.number().int().min(400).max(599),
    detail: z.string().optional(),
    instance: z.string().optional(),
    correlationId: z.string().min(1),
  })
  .passthrough();

/** Returns a typed problem, or null when the body is not a valid problem document. Never fabricates one. */
export function parseProblem(body: unknown): ProblemDetails | null {
  const parsed = problemShape.safeParse(body);
  if (!parsed.success) return null;
  const { type, title, status, detail, instance, correlationId, ...extensions } = parsed.data;
  return {
    type,
    title,
    status,
    ...(detail !== undefined ? { detail } : {}),
    ...(instance !== undefined ? { instance } : {}),
    correlationId,
    extensions,
  };
}

/** A valid application/problem+json answer from the server. */
export class ApiProblemError extends Error {
  readonly kind = "problem" as const;
  constructor(readonly problem: ProblemDetails) {
    super(`${problem.status} ${problem.title}`);
    this.name = "ApiProblemError";
  }
  get status(): number {
    return this.problem.status;
  }
  /** 409: recordVersion (and any If-Match derived from it) is stale; the record must be re-read before retrying. */
  get isStaleWrite(): boolean {
    return this.problem.status === 409;
  }
}

/**
 * An HTTP response exists but it is not a usable contract answer: an error status without a valid problem body
 * (HTML from a proxy, plain text, malformed problem JSON), or a success status whose body cannot be read as JSON.
 * Only the status line and content type are kept; no server Problem is invented.
 */
export class ApiHttpError extends Error {
  readonly kind = "http" as const;
  constructor(
    readonly status: number,
    readonly statusText: string,
    readonly reason: "non-problem-response" | "malformed-problem" | "unreadable-success-body" | "unexpected-shape",
    readonly contentType: string | null,
  ) {
    super(`HTTP ${status} ${statusText} (${reason})`);
    this.name = "ApiHttpError";
  }
}

/** The request never produced an HTTP response (DNS, refused connection, CORS, offline). */
export class ApiNetworkError extends Error {
  readonly kind = "network" as const;
  constructor(cause: unknown) {
    super("Network request failed", { cause });
    this.name = "ApiNetworkError";
  }
}

export class ApiTimeoutError extends Error {
  readonly kind = "timeout" as const;
  constructor(readonly timeoutMs: number) {
    super(`Request timed out after ${timeoutMs} ms`);
    this.name = "ApiTimeoutError";
  }
}

/** The caller aborted via its own AbortSignal. */
export class ApiAbortError extends Error {
  readonly kind = "aborted" as const;
  constructor() {
    super("Request aborted");
    this.name = "ApiAbortError";
  }
}

export type ApiError = ApiProblemError | ApiHttpError | ApiNetworkError | ApiTimeoutError | ApiAbortError;

export function isApiError(value: unknown): value is ApiError {
  return (
    value instanceof ApiProblemError ||
    value instanceof ApiHttpError ||
    value instanceof ApiNetworkError ||
    value instanceof ApiTimeoutError ||
    value instanceof ApiAbortError
  );
}
