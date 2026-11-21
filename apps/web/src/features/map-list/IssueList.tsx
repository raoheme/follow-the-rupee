import { StatusBadge } from "../../components/StatusBadge";
import { useI18n } from "../../i18n/I18nContext";
import type { IssueSummary } from "./model";

export const issueRowId = (id: string) => `issue-row-${id}`;

/**
 * The accessible, authoritative alternative to the map: every eligible issue, in the API's stable id order. Selection is
 * tracked by the stable issue id (never by list index) and exposed with `aria-pressed`.
 */
export function IssueList({
  items,
  selectedId,
  highlightedId = null,
  onSelect,
  onHover,
}: {
  items: readonly IssueSummary[];
  selectedId: string | null;
  highlightedId?: string | null;
  onSelect: (id: string) => void;
  onHover?: (id: string | null) => void;
}) {
  const { t } = useI18n();
  return (
    <ul className="issue-list" aria-label={t("p1.list.heading")}>
      {items.map((i) => {
        const selected = i.id === selectedId;
        return (
          <li key={i.id}>
            <button
              type="button"
              id={issueRowId(i.id)}
              className="issue-row"
              aria-pressed={selected}
              data-selected={selected}
              data-highlighted={i.id === highlightedId && !selected}
              onClick={() => onSelect(i.id)}
              onMouseEnter={() => onHover?.(i.id)}
              onMouseLeave={() => onHover?.(null)}
              onFocus={() => onHover?.(i.id)}
              onBlur={() => onHover?.(null)}
            >
              <span className="issue-row__title">{i.title}</span>
              <span className="issue-row__meta">
                <StatusBadge status={i.status} />
                <span>{t(`p1.category.${i.category}`)}</span>
              </span>
              <span className="issue-row__meta">
                <span>{i.streetName}</span>
                <code>{i.id}</code>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
