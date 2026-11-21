import { Component, type ErrorInfo, type ReactNode } from "react";
import { useI18n } from "../i18n/I18nContext";

export function ErrorFallback({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <section className="state-notice" data-state="error" role="alert" aria-labelledby="error-title">
      <span className="state-notice__icon" aria-hidden="true">
        ⚠
      </span>
      <div>
        <h2 id="error-title" className="state-notice__title">
          {t("error.boundary.title")}
        </h2>
        <p>{t("error.boundary.body")}</p>
        <button type="button" onClick={onRetry}>
          {t("error.boundary.retry")}
        </button>
      </div>
    </section>
  );
}

interface State {
  failed: boolean;
}

/** Contains render failures inside <main> so the disclosure banner, header and navigation stay on screen. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("Page render failed", error, info.componentStack);
  }

  componentDidUpdate(prev: { resetKey?: string }): void {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  render(): ReactNode {
    return this.state.failed ? <ErrorFallback onRetry={() => this.setState({ failed: false })} /> : this.props.children;
  }
}
