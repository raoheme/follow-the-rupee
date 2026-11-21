import { useI18n } from "../../i18n/I18nContext";
import { statusLabelKey, type IssueStatus } from "../../components/status";
import {
  CATEGORY_OPTIONS,
  hasActiveFilters,
  NO_FILTERS,
  STATUS_OPTIONS,
  WARD_OPTIONS,
  type WorkspaceFilters,
} from "./filters";
import type { IssueCategory } from "./model";

/** Shared filters for the map and the list. Native controls, each with a visible label; changes apply immediately. */
export function FilterBar({ value, onChange }: { value: WorkspaceFilters; onChange: (next: WorkspaceFilters) => void }) {
  const { t } = useI18n();
  return (
    <form className="filters" aria-label={t("p1.filters.label")} onSubmit={(e) => e.preventDefault()}>
      <div className="control">
        <label htmlFor="filter-ward">{t("p1.filter.ward")}</label>
        <select id="filter-ward" value={value.ward} onChange={(e) => onChange({ ...value, ward: e.target.value })}>
          <option value="">{t("p1.filter.any")}</option>
          {WARD_OPTIONS.map((w) => (
            <option key={w.code} value={w.code}>
              {t(w.labelKey)}
            </option>
          ))}
        </select>
      </div>
      <div className="control">
        <label htmlFor="filter-category">{t("p1.filter.category")}</label>
        <select
          id="filter-category"
          value={value.category}
          onChange={(e) => onChange({ ...value, category: e.target.value as IssueCategory | "" })}
        >
          <option value="">{t("p1.filter.any")}</option>
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c} value={c}>
              {t(`p1.category.${c}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="control">
        <label htmlFor="filter-status">{t("p1.filter.status")}</label>
        <select
          id="filter-status"
          value={value.status}
          onChange={(e) => onChange({ ...value, status: e.target.value as IssueStatus | "" })}
        >
          <option value="">{t("p1.filter.any")}</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {t(statusLabelKey(s))}
            </option>
          ))}
        </select>
      </div>
      <div className="control control--check">
        {/* the label wraps the checkbox so the whole row is the 44px target */}
        <label htmlFor="filter-dlp" className="check-label">
          <input
            id="filter-dlp"
            type="checkbox"
            checked={value.dlpOnly}
            onChange={(e) => onChange({ ...value, dlpOnly: e.target.checked })}
          />
          <span>{t("p1.filter.dlp")}</span>
        </label>
      </div>
    </form>
  );
}

/** One removable chip per active filter, always visible, plus "Clear filters" only while at least one filter is active. */
export function ActiveFilters({ value, onChange }: { value: WorkspaceFilters; onChange: (next: WorkspaceFilters) => void }) {
  const { t } = useI18n();
  if (!hasActiveFilters(value)) return null;
  const chips: Array<{ key: string; label: string; clear: WorkspaceFilters }> = [];
  if (value.ward) {
    const w = WARD_OPTIONS.find((o) => o.code === value.ward);
    chips.push({ key: "ward", label: `${t("p1.filter.ward")}: ${w ? t(w.labelKey) : value.ward}`, clear: { ...value, ward: "" } });
  }
  if (value.category) {
    chips.push({ key: "category", label: `${t("p1.filter.category")}: ${t(`p1.category.${value.category}`)}`, clear: { ...value, category: "" } });
  }
  if (value.status) {
    chips.push({ key: "status", label: `${t("p1.filter.status")}: ${t(statusLabelKey(value.status))}`, clear: { ...value, status: "" } });
  }
  if (value.dlpOnly) chips.push({ key: "dlp", label: t("p1.filter.dlpShort"), clear: { ...value, dlpOnly: false } });
  return (
    <div className="chips" role="group" aria-label={t("p1.filters.active")}>
      {chips.map((c) => (
        <button key={c.key} type="button" className="chip" aria-label={`${t("p1.filter.remove")}: ${c.label}`} onClick={() => onChange(c.clear)}>
          <span>{c.label}</span>
          <span aria-hidden="true"> ✕</span>
        </button>
      ))}
      <button type="button" className="chip chip--clear" onClick={() => onChange(NO_FILTERS)}>
        {t("p1.filter.reset")}
      </button>
    </div>
  );
}
