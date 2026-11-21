import { ApiProblemError } from "../../api/errors";
import { useI18n } from "../../i18n/I18nContext";
import { DataNotice, ErrorNotice } from "../map-list/DataNotice";

export function LoadingNotice() {
  const { t } = useI18n();
  return (
    <DataNotice state="loading" title={t("state.loading.title")} live="status">
      <p>{t("state.loading.body")}</p>
    </DataNotice>
  );
}

/** A deep link whose identifier failed local validation. Nothing was requested and the rejected text is never shown. */
export function MalformedNotice({ which }: { which: "issue" | "budget" | "work" }) {
  const { t } = useI18n();
  return (
    <DataNotice state="error" title={t("p4.malformed.title")} live="status">
      <p>{t(`p4.malformed.body.${which}`)}</p>
    </DataNotice>
  );
}

export function NotFoundNotice() {
  const { t } = useI18n();
  return (
    <DataNotice state="empty" title={t("p4.notfound.title")} live="status">
      <p>{t("p4.notfound.body")}</p>
    </DataNotice>
  );
}

/** 404 is "valid identifier, no such record"; everything else is described by the shared honest error vocabulary. */
export function QueryFailure({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  if (error instanceof ApiProblemError && error.status === 404) return <NotFoundNotice />;
  if (error instanceof ApiProblemError && error.status === 400) return <MalformedNotice which="issue" />;
  return <ErrorNotice error={error} onRetry={onRetry} />;
}
