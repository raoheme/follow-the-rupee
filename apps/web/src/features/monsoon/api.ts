import { useQuery } from "@tanstack/react-query";
import { API_BASE_URL } from "../../api/config";

/** Loose JSON shape for monsoon responses: the server owns the contract; the UI reads fields defensively. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type J = any;

export class MonsoonApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function monsoonUrl(path: string, params?: Record<string, string | number | boolean | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== null && v !== undefined && v !== "") q.set(k, String(v));
  }
  const s = q.toString();
  return `${API_BASE_URL}/v1/monsoon${path}${s ? `?${s}` : ""}`;
}

export async function getJson(url: string, signal?: AbortSignal): Promise<J> {
  const r = await fetch(url, { headers: { Accept: "application/json" }, signal });
  if (!r.ok) {
    let detail = r.statusText;
    try {
      const b = await r.json();
      detail = b.detail ?? b.title ?? detail;
    } catch {
      /* non-JSON error body */
    }
    throw new MonsoonApiError(r.status, detail);
  }
  return r.json();
}

type Params = Record<string, string | number | boolean | null | undefined>;

export function useMonsoon(path: string, params?: Params, enabled = true) {
  const url = monsoonUrl(path, params);
  return useQuery<J>({
    queryKey: ["monsoon", url],
    queryFn: ({ signal }) => getJson(url, signal),
    enabled,
    staleTime: 60_000,
    retry: false,
  });
}

export const useOverview = () => useMonsoon("/overview");
export const useWards = () => useMonsoon("/wards");
