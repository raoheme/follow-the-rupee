import { createContext, useContext, useMemo, type ReactNode } from "react";
import { usePersona } from "../state/PersonaContext";
import { ApiClient } from "./client";

const ApiClientContext = createContext<ApiClient | null>(null);

/** One client per app; it reads the persona lens through a stable getter, so persona changes never rebuild it. */
export function ApiClientProvider({ client, children }: { client?: ApiClient; children: ReactNode }) {
  const { getPersona } = usePersona();
  const value = useMemo(() => client ?? new ApiClient({ getPersona }), [client, getPersona]);
  return <ApiClientContext.Provider value={value}>{children}</ApiClientContext.Provider>;
}

export function useApiClient(): ApiClient {
  const c = useContext(ApiClientContext);
  if (!c) throw new Error("useApiClient must be used inside ApiClientProvider");
  return c;
}
