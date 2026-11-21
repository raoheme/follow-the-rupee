import { ApiAbortError, ApiHttpError, ApiNetworkError, ApiProblemError, ApiTimeoutError } from "../../api/errors";

/**
 * Maps an API failure to what the page may honestly say. Distinctions are kept:
 * - unavailable: the API produced no usable HTTP answer (network, timeout) or said 503; no data is shown.
 * - problem: a valid RFC 9457 problem from the server, shown with its own title, detail and correlation id.
 * - unexpected: an HTTP answer that is not a contract answer (HTML from a proxy, malformed problem, wrong shape).
 * No server Problem is ever invented for the cases that did not carry one.
 */
export type ErrorView =
  | { readonly kind: "unavailable"; readonly status?: number; readonly title?: string; readonly detail?: string; readonly correlationId?: string }
  | { readonly kind: "problem"; readonly status: number; readonly title: string; readonly detail?: string; readonly correlationId: string }
  | { readonly kind: "unexpected"; readonly status?: number }
  | { readonly kind: "aborted" };

export function describeError(error: unknown): ErrorView {
  if (error instanceof ApiAbortError) return { kind: "aborted" };
  if (error instanceof ApiNetworkError || error instanceof ApiTimeoutError) return { kind: "unavailable" };
  if (error instanceof ApiProblemError) {
    const p = error.problem;
    if (p.status === 503)
      return {
        kind: "unavailable",
        status: p.status,
        title: p.title,
        ...(p.detail !== undefined ? { detail: p.detail } : {}),
        correlationId: p.correlationId,
      };
    return {
      kind: "problem",
      status: p.status,
      title: p.title,
      ...(p.detail !== undefined ? { detail: p.detail } : {}),
      correlationId: p.correlationId,
    };
  }
  if (error instanceof ApiHttpError) return { kind: "unexpected", status: error.status };
  return { kind: "unexpected" };
}
