import type { MapFeature } from "../model";

/**
 * The seam between PAGE-01 and the mapping library. It carries only what P3 needs: draw the features the API returned,
 * show which one is selected, tell the page when the user picks one, and report that the basemap is unavailable.
 * (No clustering, drawing, routing, geocoding or search: those belong to later phases.)
 *
 * The page never imports Leaflet. The Leaflet implementation lives in `LeafletMapAdapter.ts` and is loaded on demand,
 * so everything that is not map-library specific stays testable in Node.
 */
export interface CivicMapAdapter {
  /** Replace the drawn features. Selection is kept if the selected id is still present. */
  setFeatures(features: readonly MapFeature[]): void;
  /** Highlight one feature by its stable record id (or none). Never moves keyboard focus. */
  setSelected(id: string | null): void;
  /** Lightly emphasise one feature while the pointer or keyboard focus is on its list row (or none). Never moves focus. */
  setHighlighted(id: string | null): void;
  /** Ask the basemap to try again without reloading the page or touching the vector features. */
  retryBasemap(): void;
  destroy(): void;
}

export interface CivicMapAdapterOptions {
  /** Called with the stable record id when the user activates a feature on the map. */
  onSelect(id: string): void;
  /** Pointer or keyboard focus entered (id) or left (null) a feature on the map. */
  onHover?(id: string | null): void;
  /** Called once when the basemap tiles are judged unavailable (bounded; see TileHealth). Vector features stay. */
  onBasemapUnavailable(): void;
  /** `prefers-reduced-motion: reduce`: disable zoom, fade and marker animations. */
  reducedMotion: boolean;
  /** Accessible names for features, e.g. "Pothole, SYN-DEMO-KND-001". Supplied by the page so they are translated. */
  featureLabel(feature: MapFeature): string;
}

export type CivicMapAdapterFactory = (container: HTMLElement, options: CivicMapAdapterOptions) => CivicMapAdapter;
