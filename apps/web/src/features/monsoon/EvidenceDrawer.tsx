import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useMonsoon } from "./api";
import { KundaliView } from "./KundaliView";
import { Q } from "./ui";

interface Ctx {
  open: (id: string) => void;
  close: () => void;
  id: string | null;
}
const EvidenceCtx = createContext<Ctx>({ open: () => undefined, close: () => undefined, id: null });
export const useEvidence = () => useContext(EvidenceCtx);

function Drawer({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useMonsoon(`/kundali/${encodeURIComponent(id)}`);
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <aside className="m-drawer" role="dialog" aria-modal="false" aria-labelledby="drawer-title" data-testid="evidence-drawer">
      <header className="m-drawer__head">
        <h2 id="drawer-title">Evidence · {id}</h2>
        <div className="m-drawer__actions">
          <Link className="m-btn m-btn--small" to={`/kundali?id=${encodeURIComponent(id)}`} onClick={onClose}>
            Open Kundali →
          </Link>
          <button type="button" className="m-btn m-btn--small" onClick={onClose} aria-label="Close evidence drawer">
            Close
          </button>
        </div>
      </header>
      <div className="m-drawer__body">
        <Q q={q} what="evidence trail">
          {(d) => <KundaliView data={d} compact />}
        </Q>
      </div>
    </aside>
  );
}

export function EvidenceProvider({ children }: { children: ReactNode }) {
  const [id, setId] = useState<string | null>(null);
  const open = useCallback((x: string) => setId(x), []);
  const close = useCallback(() => setId(null), []);
  const v = useMemo(() => ({ open, close, id }), [open, close, id]);
  return (
    <EvidenceCtx.Provider value={v}>
      {children}
      {id ? <Drawer id={id} onClose={close} /> : null}
    </EvidenceCtx.Provider>
  );
}
