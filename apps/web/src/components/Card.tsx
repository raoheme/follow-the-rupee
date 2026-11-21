import type { ReactNode } from "react";

/** A titled content section. The heading is the accessible name of the region; nothing is announced on render. */
export function Card({
  id,
  title,
  children,
  className,
  headingLevel = 2,
}: {
  id: string;
  title: string;
  children: ReactNode;
  className?: string;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <section className={className ? `card ${className}` : "card"} aria-labelledby={id}>
      <Heading id={id} className="card__title">
        {title}
      </Heading>
      {children}
    </section>
  );
}

/** Label/value rows. The label is a term and the value its description, so assistive technology reads them as pairs. */
export function Facts({ children, compact = true }: { children: ReactNode; compact?: boolean }) {
  return <dl className={compact ? "facts facts--compact" : "facts"}>{children}</dl>;
}

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export type TagTone = "neutral" | "pending" | "active" | "verified" | "disputed";

/**
 * A small state label. The meaning is always carried by the text and a distinct glyph; the tone only adds a border style and
 * tint (the same dashed / double / solid vocabulary as StatusBadge), so no state depends on colour.
 */
export function Tag({ tone, icon, label }: { tone: TagTone; icon: string; label: string }) {
  return (
    <span className="tag" data-tone={tone}>
      <span className="tag__icon" aria-hidden="true">
        {icon}
      </span>
      <span>{label}</span>
    </span>
  );
}

/** Native disclosure for secondary detail. Keyboard and screen-reader operable without script. */
export function Disclosure({ summary, children, id }: { summary: string; children: ReactNode; id?: string }) {
  return (
    <details className="disclosure" {...(id ? { id } : {})}>
      <summary>{summary}</summary>
      <div className="disclosure__body">{children}</div>
    </details>
  );
}
