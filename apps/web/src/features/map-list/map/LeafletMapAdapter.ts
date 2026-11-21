import * as L from "leaflet";
// Explicit stylesheet import: Leaflet's own CSS is required for correct pane layout. Only vector layers and inline-SVG
// divIcons are used below, so no default marker PNG is ever requested.
import "leaflet/dist/leaflet.css";
import type { MapFeature } from "../model";
import type { CivicMapAdapter, CivicMapAdapterFactory, CivicMapAdapterOptions } from "./CivicMapAdapter";
import { boundsOf, geometryLatLngs, gridLines, markerSvg, MUMBAI_BOUNDS, vectorStyle, type LatLng } from "./presentation";
import { TileHealth } from "./tileHealth";

/** Direct Leaflet 1.9.4 behind CivicMapAdapter. Not importable in Node (Leaflet needs `window`), so it is loaded lazily. */
export const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const DRAW_ORDER: Record<MapFeature["properties"]["kind"], number> = { ASSET: 0, PUBLIC_WORK: 1, ISSUE: 2 };

interface Drawn {
  readonly feature: MapFeature;
  readonly layer: L.Marker | L.Path;
  readonly halo?: L.Polyline;
}

export const createLeafletMapAdapter: CivicMapAdapterFactory = (container: HTMLElement, options: CivicMapAdapterOptions): CivicMapAdapter => {
  const rm = options.reducedMotion;
  const map = L.map(container, {
    zoomAnimation: !rm,
    fadeAnimation: !rm,
    markerZoomAnimation: !rm,
    keyboard: true,
  });
  map.fitBounds(MUMBAI_BOUNDS, { animate: false });

  // Basemap: optional enrichment. Vector features below do not depend on it and are never removed when tiles fail.
  const tiles = L.tileLayer(TILE_URL, {
    maxZoom: 19,
    attribution: TILE_ATTRIBUTION,
    referrerPolicy: "strict-origin-when-cross-origin",
  }).addTo(map);
  const grid = L.layerGroup();
  const health = new TileHealth(() => {
    // Synthetic orientation aid only (labelled as such by the page), never an official basemap.
    const { lats, lons } = gridLines();
    const [[s, w], [n, e]] = MUMBAI_BOUNDS;
    const style: L.PolylineOptions = { color: "#9aa7b4", weight: 1, opacity: 0.6, dashArray: "2 6", interactive: false };
    for (const lat of lats) L.polyline([[lat, w], [lat, e]], style).addTo(grid);
    for (const lon of lons) L.polyline([[s, lon], [n, lon]], style).addTo(grid);
    grid.addTo(map);
    options.onBasemapUnavailable();
  });
  tiles.on("tileload", () => health.tileLoaded());
  tiles.on("tileerror", () => health.tileFailed());

  const group = L.layerGroup().addTo(map);
  let drawn = new Map<string, Drawn>();
  let selectedId: string | null = null;
  let highlightedId: string | null = null;

  const icon = (f: MapFeature, selected: boolean) =>
    L.divIcon({ html: markerSvg(f, selected), className: "mcl-marker", iconSize: [44, 44], iconAnchor: [22, 22] });

  const activate = (id: string) => options.onSelect(id);

  /** Make a rendered map element a labelled button that Enter or Space activates (no reliance on Leaflet's keypress path). */
  function operable(el: Element | undefined | null, id: string, label: string) {
    if (!el) return;
    el.setAttribute("tabindex", "0");
    el.setAttribute("role", "button");
    el.setAttribute("aria-label", label);
    if (el.getAttribute("data-mcl-key") === "1") return;
    el.setAttribute("data-mcl-key", "1");
    el.addEventListener("focus", () => options.onHover?.(id));
    el.addEventListener("blur", () => options.onHover?.(null));
    el.addEventListener("keydown", (ev: Event) => {
      const k = (ev as KeyboardEvent).key;
      if (k === "Enter" || k === " ") {
        ev.preventDefault();
        ev.stopPropagation();
        activate(id);
      }
    });
  }

  function draw(f: MapFeature): Drawn {
    const id = f.id;
    const label = options.featureLabel(f);
    const selected = id === selectedId;
    const emphasised = selected || id === highlightedId;
    const g = f.geometry;
    if (g.type === "Point") {
      const marker = L.marker(geometryLatLngs(g) as LatLng, {
        icon: icon(f, emphasised),
        keyboard: true,
        title: label,
        zIndexOffset: selected ? 1000 : 0,
      });
      marker.on("click", () => activate(id));
      marker.on("mouseover", () => options.onHover?.(id));
      marker.on("mouseout", () => options.onHover?.(null));
      marker.on("add", () => operable(marker.getElement(), id, label));
      marker.addTo(group);
      return { feature: f, layer: marker };
    }
    const style = vectorStyle(f, emphasised);
    const opts: L.PolylineOptions = {
      color: style.color,
      weight: style.weight,
      dashArray: style.dashArray,
      opacity: style.opacity,
      fillColor: style.fillColor,
      fillOpacity: style.fillOpacity,
      bubblingMouseEvents: false,
    };
    let halo: L.Polyline | undefined;
    if (f.properties.dlpActive && g.type === "LineString") {
      halo = L.polyline(geometryLatLngs(g) as LatLng[], { color: "#d97706", weight: 14, opacity: 0.35, interactive: false });
      halo.addTo(group);
    }
    const layer: L.Path =
      g.type === "Polygon" ? L.polygon(geometryLatLngs(g) as LatLng[][], opts) : L.polyline(geometryLatLngs(g) as LatLng[], opts);
    layer.on("click", () => activate(id));
    layer.on("mouseover", () => options.onHover?.(id));
    layer.on("mouseout", () => options.onHover?.(null));
    // Vector paths are not focusable by default: make them keyboard-operable buttons with an accessible name.
    layer.on("add", () => operable(layer.getElement(), id, label));
    layer.addTo(group);
    return { feature: f, layer, halo };
  }

  function restyle(d: Drawn, selected: boolean) {
    const emphasised = selected || d.feature.id === highlightedId;
    if (d.layer instanceof L.Marker) {
      d.layer.setIcon(icon(d.feature, emphasised));
      d.layer.setZIndexOffset(selected ? 1000 : 0);
      operable(d.layer.getElement(), d.feature.id, options.featureLabel(d.feature));
    } else {
      const s = vectorStyle(d.feature, emphasised);
      d.layer.setStyle({ color: s.color, weight: s.weight, dashArray: s.dashArray, fillOpacity: s.fillOpacity });
      if (selected) d.layer.bringToFront();
    }
  }

  // Fit to the drawn features (or Greater Mumbai). A programmatic fit is not a user gesture; once the user pans or zooms,
  // later size changes only re-measure the container and never move their view.
  let fitTarget: [LatLng, LatLng] = MUMBAI_BOUNDS;
  let programmatic = false;
  let userMoved = false;
  const fit = () => {
    programmatic = true;
    // extra top-left room keeps markers clear of the 44px zoom control
    map.fitBounds(fitTarget, { animate: false, paddingTopLeft: [68, 48], paddingBottomRight: [32, 32], maxZoom: 16 });
    programmatic = false;
  };
  map.on("dragstart zoomstart", () => {
    if (!programmatic) userMoved = true;
  });
  const observer =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
          map.invalidateSize({ animate: false });
          if (!userMoved) fit();
        });
  observer?.observe(container);

  return {
    setFeatures(features) {
      group.clearLayers();
      drawn = new Map();
      const ordered = [...features].sort((a, b) => DRAW_ORDER[a.properties.kind] - DRAW_ORDER[b.properties.kind]);
      for (const f of ordered) drawn.set(f.id, draw(f));
      if (selectedId && !drawn.has(selectedId)) selectedId = null;
      fitTarget = boundsOf(features) ?? MUMBAI_BOUNDS;
      map.invalidateSize({ animate: false });
      fit();
    },
    setSelected(id) {
      const prev = selectedId ? drawn.get(selectedId) : undefined;
      selectedId = id;
      if (prev) restyle(prev, false);
      const next = id ? drawn.get(id) : undefined;
      if (next) restyle(next, true);
    },
    setHighlighted(id) {
      const prev = highlightedId ? drawn.get(highlightedId) : undefined;
      highlightedId = id;
      if (prev) restyle(prev, prev.feature.id === selectedId);
      const next = id ? drawn.get(id) : undefined;
      if (next) restyle(next, next.feature.id === selectedId);
    },
    retryBasemap() {
      // Clear the orientation grid and the failure latch, then ask the tile layer to request its visible tiles again.
      grid.clearLayers();
      map.removeLayer(grid);
      health.reset();
      tiles.redraw();
    },
    destroy() {
      observer?.disconnect();
      map.remove();
    },
  };
};
