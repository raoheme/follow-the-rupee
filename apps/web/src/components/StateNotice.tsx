import { useI18n } from "../i18n/I18nContext";

/**
 * Honest data-state vocabulary shared by every page. These are distinct states, never interchangeable:
 * loading (request in flight), empty (API answered with nothing), partial (some linked records missing),
 * unavailable (API could not be reached), notImplemented (this phase has not built the page yet).
 * None of them displays records; seeded data is never presented as live unless the real API call succeeded.
 */
export const STATE_KINDS = ["loading", "empty", "partial", "unavailable", "notImplemented"] as const;
export type StateKind = (typeof STATE_KINDS)[number];

const ICONS: Record<StateKind, string> = {
  loading: "⟳",
  empty: "∅",
  partial: "◑",
  unavailable: "⚠",
  notImplemented: "⋯",
};

export function StateNotice({ kind, headingLevel = 2 }: { kind: StateKind; headingLevel?: 2 | 3 }) {
  const { t } = useI18n();
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <section className="state-notice" data-state={kind} aria-label={t(`state.${kind}.title`)}>
      <span className="state-notice__icon" aria-hidden="true">
        {ICONS[kind]}
      </span>
      <div>
        <Heading className="state-notice__title">{t(`state.${kind}.title`)}</Heading>
        <p>{t(`state.${kind}.body`)}</p>
      </div>
    </section>
  );
}
