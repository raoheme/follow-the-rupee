import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nContext";
import { DataNotice } from "./DataNotice";
import type { CivicMapAdapter } from "./map/CivicMapAdapter";
import type { MapFeature } from "./model";

/**
 * Hosts the map. Leaflet is loaded on demand behind CivicMapAdapter and is created once per mount; features and the
 * selection are pushed into it as they change. `features === null` means no map answer yet (loading or failed): the base
 * map still renders so a late answer can be drawn. The map never takes keyboard focus on selection.
 *
 * When the OpenStreetMap basemap cannot be loaded, the canvas stays a light neutral surface with a plain orientation grid
 * and the vector features the API returned; a single compact notice offers "Retry basemap", which re-requests tiles
 * without reloading the page. No ward polygons or labels are drawn or invented on the fallback.
 */
export function MapPanel({
  features,
  selectedId,
  highlightedId,
  onSelect,
  onHover,
}: {
  features: readonly MapFeature[] | null;
  selectedId: string | null;
  highlightedId: string | null;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<CivicMapAdapter | null>(null);
  const [ready, setReady] = useState(false);
  const [basemapDown, setBasemapDown] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);

  // Latest callbacks and labels without re-creating the map.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onHoverRef = useRef(onHover);
  onHoverRef.current = onHover;
  const labelRef = useRef((f: MapFeature) => f.properties.title);
  labelRef.current = (f) => `${t(`p1.kind.${f.properties.kind}`)}: ${f.properties.title} (${f.properties.recordId})`;
  const featuresRef = useRef(features);
  featuresRef.current = features;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;
    import("./map/LeafletMapAdapter")
      .then(({ createLeafletMapAdapter }) => {
        if (cancelled) return;
        const adapter = createLeafletMapAdapter(container, {
          onSelect: (id) => onSelectRef.current(id),
          onHover: (id) => onHoverRef.current(id),
          onBasemapUnavailable: () => {
            setRetrying(false);
            setBasemapDown(true);
          },
          reducedMotion: typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches,
          featureLabel: (f) => labelRef.current(f),
        });
        adapterRef.current = adapter;
        if (featuresRef.current) adapter.setFeatures(featuresRef.current);
        adapter.setSelected(selectedRef.current);
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setMapFailed(true);
      });
    return () => {
      cancelled = true;
      adapterRef.current?.destroy();
      adapterRef.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    if (ready && features) adapterRef.current?.setFeatures(features);
  }, [ready, features]);

  useEffect(() => {
    if (ready) adapterRef.current?.setSelected(selectedId);
  }, [ready, selectedId]);

  useEffect(() => {
    if (ready) adapterRef.current?.setHighlighted(highlightedId);
  }, [ready, highlightedId]);

  const retry = useCallback(() => {
    setBasemapDown(false);
    setRetrying(true);
    adapterRef.current?.retryBasemap();
    // the status text is transient; a second failure reports through onBasemapUnavailable and shows the notice again
    window.setTimeout(() => setRetrying(false), 4000);
  }, []);

  return (
    <section className="map-pane" aria-label={t("p1.map.label")} aria-describedby="map-hint">
      <a
        className="skip-inline"
        href="#list-heading"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("list-heading")?.focus();
        }}
      >
        {t("p1.map.skip")}
      </a>
      <p id="map-hint" className="map-hint">
        {t("p1.map.hint")}
      </p>
      <div className="map-frame" data-basemap={basemapDown ? "down" : "up"}>
        {basemapDown ? (
          <div className="basemap-note" role="status" data-testid="basemap-note">
            <span>{t("p1.basemap.note")}</span>
            <button type="button" onClick={retry}>
              {t("p1.basemap.retry")}
            </button>
          </div>
        ) : null}
        <div ref={containerRef} className="map-canvas" data-testid="map-canvas" />
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {retrying ? t("p1.basemap.retrying") : ""}
      </p>
      {mapFailed ? (
        <DataNotice state="unavailable" title={t("p1.map.unavailable.title")} live="status">
          <p>{t("p1.map.unavailable.body")}</p>
        </DataNotice>
      ) : null}
    </section>
  );
}
