import { useI18n } from "../../i18n/I18nContext";

/**
 * Compact synthetic-data disclosure and the do-not-enter-personal-data instruction. Both are always present on PAGE-04 and
 * repeated, shorter, wherever free text is collected on PAGE-05.
 */
export function SafetyNotices({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="safety-notices" data-compact={compact ? "true" : undefined}>
      <p className="callout" data-testid="synthetic-notice">
        <strong>{t("p5.syntheticNotice.title")}.</strong> {compact ? null : t("p5.syntheticNotice.body")}
      </p>
      <p className="callout callout--pii" data-testid="pii-notice">
        <strong>{t("p5.pii.title")}.</strong> {t("p5.pii.body")}
      </p>
    </div>
  );
}

export type Step = "report" | "review" | "receipt";

/** Where the user is in the three-step flow. The current step is named in text and marked with `aria-current`. */
export function StepIndicator({ current }: { current: Step }) {
  const { t } = useI18n();
  const steps: readonly Step[] = ["report", "review", "receipt"];
  return (
    <nav aria-label={t("p5.steps.label")}>
      <ol className="steps">
        {steps.map((s) => (
          <li key={s} aria-current={s === current ? "step" : undefined} data-current={s === current ? "true" : undefined}>
            {t(`p5.steps.${s === "review" ? "review" : s}`)}
          </li>
        ))}
      </ol>
    </nav>
  );
}
