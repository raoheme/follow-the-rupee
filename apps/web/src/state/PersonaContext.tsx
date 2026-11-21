import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { DEFAULT_PERSONA, coercePersona, isDemoPersona, type DemoPersona } from "./personas";

interface PersonaValue {
  persona: DemoPersona;
  /** Returns false (and keeps the current persona) when the value is not in the fixed enum. */
  setPersona: (next: unknown) => boolean;
  /** Stable reader for the API client; always returns the latest persona without re-creating the client. */
  getPersona: () => DemoPersona;
}

const PersonaContext = createContext<PersonaValue | null>(null);

/**
 * Holds the simulated persona in memory above the router so it survives client-side navigation.
 * Deliberately not persisted in any browser storage or cookie: no controlling P2 file permits browser persistence,
 * so a reload returns to the "public" default. Nothing here is a credential or an authorization decision.
 */
export function PersonaProvider({ initial, children }: { initial?: unknown; children: ReactNode }) {
  const [persona, setPersonaState] = useState<DemoPersona>(() => coercePersona(initial ?? DEFAULT_PERSONA));
  const ref = useRef<DemoPersona>(persona);
  ref.current = persona;

  const setPersona = useCallback((next: unknown) => {
    if (!isDemoPersona(next)) return false;
    ref.current = next;
    setPersonaState(next);
    return true;
  }, []);
  const getPersona = useCallback(() => ref.current, []);

  const value = useMemo(() => ({ persona, setPersona, getPersona }), [persona, setPersona, getPersona]);
  return <PersonaContext.Provider value={value}>{children}</PersonaContext.Provider>;
}

export function usePersona(): PersonaValue {
  const ctx = useContext(PersonaContext);
  if (!ctx) throw new Error("usePersona must be used inside PersonaProvider");
  return ctx;
}
