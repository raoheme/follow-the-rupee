export const DEFAULT_API_BASE_URL = "http://localhost:8080";

/** `VITE_API_BASE_URL || "http://localhost:8080"`, without a trailing slash. */
export function resolveApiBaseUrl(configured: string | undefined): string {
  return (configured || DEFAULT_API_BASE_URL).replace(/\/+$/, "");
}

export const API_BASE_URL = resolveApiBaseUrl(import.meta.env.VITE_API_BASE_URL);
