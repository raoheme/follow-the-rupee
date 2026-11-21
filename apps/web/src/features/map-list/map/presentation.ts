import { STATUS_PRESENTATION, type IssueStatus, type StatusTone } from "../../../components/status";
import type { Geometry, MapFeature } from "../model";

/** Library-independent drawing rules for map features. Pure functions, unit tested in Node. */

/** GeoJSON [longitude, latitude] -> Leaflet [latitude, longitude]. The only place the order is swapped. */
export function toLatLng(position: readonly [number, number]): [number, number] {
  return [position[1], position[0]];
}

export type LatLng = [number, number];

/** Vertex lists per geometry, as Leaflet latitude/longitude pairs; Polygons keep every ring, never reduced to a centroid. */
export function geometryLatLngs(g: Geometry): LatLng | LatLng[] | LatLng[][] {
  switch (g.type) {
    case "Point":
      return toLatLng(g.coordinates);
    case "LineString":
      return g.coordinates.map(toLatLng);
    case "Polygon":
      return g.coordinates.map((ring) => ring.map(toLatLng));
  }
}

function eachPosition(g: Geometry, visit: (p: readonly [number, number]) => void): void {
  if (g.type === "Point") visit(g.coordinates);
  else if (g.type === "LineString") g.coordinates.forEach(visit);
  else g.coordinates.forEach((ring) => ring.forEach(visit));
}

/** `[[south, west], [north, east]]` covering every vertex, or null when there are no features. */
export function boundsOf(features: readonly MapFeature[]): [LatLng, LatLng] | null {
  let s = Infinity;
  let w = Infinity;
  let n = -Infinity;
  let e = -Infinity;
  for (const f of features)
    eachPosition(f.geometry, ([lon, lat]) => {
      s = Math.min(s, lat);
      n = Math.max(n, lat);
      w = Math.min(w, lon);
      e = Math.max(e, lon);
    });
  return Number.isFinite(s) ? [[s, w], [n, e]] : null;
}

/** Greater Mumbai, used for the initial view and the orientation grid. */
export const MUMBAI_BOUNDS: [LatLng, LatLng] = [[18.89, 72.77], [19.275, 72.99]];

export interface VectorStyle {
  readonly color: string;
  readonly weight: number;
  readonly dashArray: string | undefined;
  readonly fillColor: string;
  readonly fillOpacity: number;
  readonly opacity: number;
}

const TONE_COLOR: Record<StatusTone, string> = {
  neutral: "#5b6b7b",
  pending: "#8a5a00",
  active: "#14283d",
  verified: "#167a4a",
  disputed: "#b42318",
};

/** Dash patterns repeat the status tone without colour: solid, dashed, long dash, dotted, double-weight. */
const TONE_DASH: Record<StatusTone, string | undefined> = {
  neutral: "2 6",
  pending: "8 6",
  active: undefined,
  verified: undefined,
  disputed: "1 5",
};

export function isIssueStatus(s: string | null): s is IssueStatus {
  return s !== null && s in STATUS_PRESENTATION;
}

/** Stroke/fill for lines and polygons. Selection only thickens the stroke and adds fill; hue is not the selection cue. */
export function vectorStyle(f: MapFeature, selected: boolean): VectorStyle {
  const { kind, status, dlpActive } = f.properties;
  if (kind === "ISSUE") {
    const tone: StatusTone = isIssueStatus(status) ? STATUS_PRESENTATION[status].tone : "neutral";
    return {
      color: TONE_COLOR[tone],
      weight: selected ? 7 : 4,
      dashArray: TONE_DASH[tone],
      fillColor: TONE_COLOR[tone],
      fillOpacity: selected ? 0.4 : 0.18,
      opacity: 1,
    };
  }
  if (kind === "PUBLIC_WORK")
    return {
      color: "#6b3fa0",
      weight: selected ? 7 : dlpActive ? 5 : 3,
      dashArray: "10 4 2 4",
      fillColor: "#6b3fa0",
      fillOpacity: 0.1,
      opacity: 0.9,
    };
  return {
    color: "#5b6b7b",
    weight: selected ? 6 : 3,
    dashArray: undefined,
    fillColor: "#5b6b7b",
    fillOpacity: 0.08,
    opacity: 0.85,
  };
}

/**
 * Inline SVG for a point marker (no image files, so a Vite build has no broken default-icon requests). The glyph is the
 * same icon the status badge uses, so state is carried by shape and text-like glyph, not by colour alone.
 */
export function markerSvg(f: MapFeature, selected: boolean): string {
  const status = f.properties.status;
  const tone: StatusTone = isIssueStatus(status) ? STATUS_PRESENTATION[status].tone : "neutral";
  const glyph = isIssueStatus(status) ? STATUS_PRESENTATION[status].icon : "•";
  const color = TONE_COLOR[tone];
  const ring = selected ? `<circle cx="22" cy="22" r="20" fill="none" stroke="#14283d" stroke-width="4"/>` : "";
  const dash = TONE_DASH[tone] ? ` stroke-dasharray="${TONE_DASH[tone]!.split(" ")[0]} 3"` : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44" aria-hidden="true" focusable="false">` +
    ring +
    `<circle cx="22" cy="22" r="14" fill="#ffffff" stroke="${color}" stroke-width="3"${dash}/>` +
    `<text x="22" y="27.5" text-anchor="middle" font-size="16" font-family="system-ui,sans-serif" fill="${color}">${glyph}</text>` +
    `</svg>`
  );
}

/** Orientation-grid line positions (degrees) for the synthetic fallback shown only when the basemap is unavailable. */
export function gridLines(
  bounds: [LatLng, LatLng] = MUMBAI_BOUNDS,
  step = 0.05,
): { lats: number[]; lons: number[] } {
  const [[s, w], [n, e]] = bounds;
  const range = (lo: number, hi: number) => {
    const out: number[] = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
    return out;
  };
  return { lats: range(s, n), lons: range(w, e) };
}
