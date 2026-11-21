import { useI18n } from "../i18n/I18nContext";
import { STATUS_PRESENTATION, statusLabelKey, type IssueStatus } from "./status";

export function StatusBadge({ status }: { status: IssueStatus }) {
  const { t } = useI18n();
  const { icon, tone } = STATUS_PRESENTATION[status];
  return (
    <span className="status-badge" data-status={status} data-tone={tone}>
      <span className="status-badge__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="status-badge__label">{t(statusLabelKey(status))}</span>
    </span>
  );
}
