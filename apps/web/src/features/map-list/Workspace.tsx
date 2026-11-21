import { useCallback, useMemo, useState } from "react";
import { statusLabelKey } from "../../components/status";
import { useI18n } from "../../i18n/I18nContext";
import { DataNotice, ErrorNotice } from "./DataNotice";
import { ActiveFilters, FilterBar } from "./FilterBar";
import { Inspector, type Selection } from "./Inspector";
import { IssueList, issueRowId } from "./IssueList";
import { MapPanel } from "./MapPanel";
import { activeFilterCount, NO_FILTERS, type WorkspaceFilters } from "./filters";
import { compareParity, issueIdsOnMap, type IssueSummary, type MapFeature } from "./model";
import { useIssuesQuery, useMapFeaturesQuery } from "./queries";

type View = "map" | "list" | "split";

/** Desktop-width check for the initial layout only (the CSS owns the actual responsive behaviour). False when not in a browser. */
function isWide(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(min-width: 960px)").matches;
}

/** Resolve the selection by stable record id from the two live responses. */
export function resolveSelection(
  selectedId: string | null,
  issues: readonly IssueSummary[] | undefined,
  features: readonly MapFeature[] | undefined,
): Selection {
  if (!selectedId) return null;
  const issue = issues?.find((i) => i.id === selectedId);
  if (issue) {
    const f = features?.find((x) => x.id === selectedId && x.properties.kind === "ISSUE");
    return { type: "issue", issue, dlpActive: f ? f.properties.dlpActive : null };
  }
  const feature = features?.find((x) => x.id === selectedId);
  return feature ? { type: "feature", feature } : null;
}

/**
 * PAGE-01: the Map/List workspace. Both panes are driven by the same filters and by live API responses only; nothing is
 * seeded, cached across reloads or invented. The list is the accessible alternative to the map.
 */
export function MapListWorkspace() {
  const { t } = useI18n();
  const [filters, setFilters] = useState<WorkspaceFilters>(NO_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<View>(() => (isWide() ? "split" : "map"));
  const [filtersOpen, setFiltersOpen] = useState<boolean>(() => isWide());
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const issuesQ = useIssuesQuery(filters);
  const mapQ = useMapFeaturesQuery(filters);
  const issues = issuesQ.data?.data.items;
  const features = mapQ.data?.data;

  const parity = useMemo(
    () => (issues && features ? compareParity(issues.map((i) => i.id), issueIdsOnMap(features)) : null),
    [issues, features],
  );
  const selection = resolveSelection(selectedId, issues, features);
  const effectiveSelectedId = selection ? selectedId : null;

  const announceSelection = useCallback(
    (id: string) => {
      const sel = resolveSelection(id, issues, features);
      if (!sel) return;
      const label =
        sel.type === "issue" ? `${sel.issue.title}, ${t(statusLabelKey(sel.issue.status))}` : sel.feature.properties.title;
      setAnnouncement(`${t("p1.live.selected")}: ${label}`);
    },
    [issues, features, t],
  );

  const selectFromList = useCallback(
    (id: string) => {
      setSelectedId(id);
      announceSelection(id);
    },
    [announceSelection],
  );

  // A map selection updates the inspector and the list without moving keyboard focus.
  const selectFromMap = useCallback(
    (id: string) => {
      setSelectedId(id);
      announceSelection(id);
      document.getElementById(issueRowId(id))?.scrollIntoView({ block: "nearest" });
    },
    [announceSelection],
  );

  const changeFilters = (next: WorkspaceFilters) => {
    setFilters(next);
    setSelectedId(null);
    setAnnouncement(t("p1.live.cleared"));
  };

  const listCount = issues?.length;
  const resultMessage = listCount === undefined ? "" : `${listCount} ${t("p1.live.loaded")}`;

  const activeCount = activeFilterCount(filters);

  return (
    <article aria-labelledby="page-heading" className="workspace" data-view={view}>
      <h1 id="page-heading" tabIndex={-1}>
        {t("page.PAGE-01.name")}
      </h1>
      <p className="workspace__sub">{t("p1.intro")}</p>

      <div className="workspace__toolbar">
        <div className="workspace__toggle" role="group" aria-label={t("p1.view.label")}>
          <button type="button" aria-pressed={view === "map"} onClick={() => setView("map")}>
            {t("p1.view.map")}
          </button>
          <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}>
            {t("p1.view.list")}
          </button>
          <button type="button" className="workspace__split" aria-pressed={view === "split"} onClick={() => setView("split")}>
            {t("p1.view.split")}
          </button>
        </div>
        <button
          type="button"
          className="filters-toggle"
          aria-expanded={filtersOpen}
          aria-controls="filters-panel"
          onClick={() => setFiltersOpen((o) => !o)}
        >
          {t("p1.filters.toggle")}
          {activeCount > 0 ? ` (${activeCount})` : ""}
        </button>
      </div>

      <div className="workspace__chips">
        <ActiveFilters value={filters} onChange={changeFilters} />
      </div>

      <div id="filters-panel" className="workspace__filters" hidden={!filtersOpen}>
        <FilterBar value={filters} onChange={changeFilters} />
      </div>

      <div className="workspace__map">
        <MapPanel features={features ?? null} selectedId={effectiveSelectedId} highlightedId={hoveredId} onSelect={selectFromMap} onHover={setHoveredId} />
        {mapQ.isError ? (
          <ErrorNotice error={mapQ.error} onRetry={() => void mapQ.refetch()} />
        ) : mapQ.isPending ? (
          <DataNotice state="loading" title={t("state.loading.title")} live="status">
            <p>{t("state.loading.body")}</p>
          </DataNotice>
        ) : null}
      </div>

      <section className="workspace__list" aria-labelledby="list-heading">
        <h2 id="list-heading" tabIndex={-1}>
          {t("p1.list.heading")}
          {listCount !== undefined ? <span className="count"> ({listCount})</span> : null}
        </h2>
        {issuesQ.isPending ? (
          <DataNotice state="loading" title={t("state.loading.title")} live="status">
            <p>{t("state.loading.body")}</p>
          </DataNotice>
        ) : issuesQ.isError ? (
          <ErrorNotice error={issuesQ.error} onRetry={() => void issuesQ.refetch()} />
        ) : issues && issues.length === 0 ? (
          <DataNotice state="empty" title={t("p1.list.emptyTitle")} live="status">
            <p>{t("p1.list.emptyBody")}</p>
          </DataNotice>
        ) : issues ? (
          <>
            {parity && !parity.ok ? (
              <DataNotice state="partial" title={t("p1.parity.title")} live="status">
                <p>{t("p1.parity.body")}</p>
              </DataNotice>
            ) : null}
            <p className="hint">{t("p1.list.select")}</p>
            <IssueList items={issues} selectedId={effectiveSelectedId} highlightedId={hoveredId} onSelect={selectFromList} onHover={setHoveredId} />
          </>
        ) : null}
      </section>

      <section className="workspace__inspector" aria-labelledby="inspector-heading">
        <h2 id="inspector-heading">{t("p1.inspector.heading")}</h2>
        <Inspector selection={selection} />
      </section>

      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement || resultMessage}
      </div>
    </article>
  );
}
