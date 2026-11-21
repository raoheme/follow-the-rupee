import type { ReactNode } from "react";
import { AUTHOR_LABEL, BAND_LABEL } from "./copy";
import { MonsoonApiError, type J } from "./api";
import { useEvidence } from "./EvidenceDrawer";

export function Loading({ what = "data" }: { what?: string }) {
  return (
    <p className="m-note" role="status" data-state="loading">
      Loading {what}…
    </p>
  );
}

export function ErrorNote({ error, what = "data" }: { error: unknown; what?: string }) {
  const msg = error instanceof MonsoonApiError ? `${error.status} ${error.message}` : "Could not reach the API";
  return (
    <p className="m-note m-note--err" role="alert" data-state="error">
      Could not load {what} ({msg}). Is the API running on 127.0.0.1:8080?
    </p>
  );
}

export function Q({ q, what, children }: { q: { isLoading: boolean; error: unknown; data?: J }; what?: string; children: (d: J) => ReactNode }) {
  if (q.isLoading) return <Loading what={what} />;
  if (q.error) return <ErrorNote error={q.error} what={what} />;
  if (!q.data) return null;
  return <>{children(q.data)}</>;
}

export function Badge({ tone = "neutral", children, title }: { tone?: "neutral" | "info" | "warn" | "ok" | "review" | "dlp"; children: ReactNode; title?: string }) {
  return (
    <span className={`m-badge m-badge--${tone}`} title={title}>
      {children}
    </span>
  );
}

export function AuthorBadge({ author }: { author: string | null | undefined }) {
  const claude = !!author && author.toLowerCase().includes("claude");
  return <Badge tone={claude ? "info" : "neutral"}>{AUTHOR_LABEL(author)}</Badge>;
}

export function BandPill({ band }: { band: string | null | undefined }) {
  if (!band) return null;
  return <Badge tone={band.startsWith("VERY") ? "warn" : band.startsWith("HIGH") ? "review" : "neutral"}>{BAND_LABEL[band] ?? band}</Badge>;
}

/** CSS-only horizontal bar. `value` and `max` share a unit. */
export function Bar({ value, max, tone = "blue", label }: { value: number; max: number; tone?: "blue" | "amber" | "red" | "green" | "grey"; label?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <span className="m-bar" role="img" aria-label={label ?? `${pct.toFixed(0)}%`}>
      <span className={`m-bar__fill m-bar__fill--${tone}`} style={{ width: `${pct}%` }} />
    </span>
  );
}

/** Button that opens the shared Evidence Drawer for any WO25-*, RD*, BMC25-* or issue id. */
export function EvidenceLink({ id, children, kind = "link" }: { id: string; children?: ReactNode; kind?: "link" | "button" }) {
  const { open } = useEvidence();
  return (
    <button type="button" className={kind === "button" ? "m-btn m-btn--small" : "m-link"} onClick={() => open(id)} aria-label={`Open evidence for ${id}`}>
      {children ?? id}
    </button>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div className={`m-stat${tone ? ` m-stat--${tone}` : ""}`}>
      <span className="m-stat__label">{label}</span>
      <span className="m-stat__value">{value}</span>
      {sub ? <span className="m-stat__sub">{sub}</span> : null}
    </div>
  );
}
