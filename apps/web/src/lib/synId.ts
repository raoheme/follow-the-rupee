/**
 * Local validation of path identifiers, identical to the contract pattern (`^SYN-DEMO-[A-Z0-9][A-Z0-9-]*$`) plus the same
 * 128-character bound the API applies. Deep links are checked here BEFORE any request is made, and a rejected value is
 * never echoed into the page or placed in a request path.
 */
export const SYN_ID_PATTERN = /^SYN-DEMO-[A-Z0-9][A-Z0-9-]*$/;
export const MAX_ID_LENGTH = 128;

export function isSynId(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_ID_LENGTH && SYN_ID_PATTERN.test(value);
}

export type ParamState =
  | { readonly kind: "absent" }
  | { readonly kind: "valid"; readonly id: string }
  | { readonly kind: "malformed" };

/** One query parameter as an identifier: absent, valid, or malformed (empty, repeated, wrong pattern or too long). */
export function readIdParam(params: URLSearchParams, name: string): ParamState {
  const all = params.getAll(name);
  if (all.length === 0) return { kind: "absent" };
  if (all.length > 1) return { kind: "malformed" };
  const v = all[0]!;
  return isSynId(v) ? { kind: "valid", id: v } : { kind: "malformed" };
}
