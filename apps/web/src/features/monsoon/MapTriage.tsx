import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type * as LT from "leaflet";
import { TileHealth } from "../map-list/map/tileHealth";
import { useMonsoon, useOverview, useWards, type J } from "./api";
import { CENTROID_BADGE, DLP_CAVEAT, OVERLAP_NOTE } from "./copy";
import { formatInr, formatInt, formatPct, indianiseUnits } from "./format";
import { RoadCard } from "./RoadCard";
import { AuthorBadge, Badge, Bar, ErrorNote, EvidenceLink, Loading } from "./ui";

type Mode = "trail" | "audit" | "next_rupee";
const MODES: ReadonlyArray<readonly [Mode, string, string]> = [
  ["trail", "Trail Triage", "Wards shaded by open complaints; roads with open backlog or reopenings emphasised."],
  ["audit", "Audit Alerts", "Wards shaded by unique work orders touched by primary review flags; flagged roads emphasised."],
  ["next_rupee", "Next-Rupee Priority", "Wards shaded by budget utilisation; top-ranked roads emphasised. Dashed = DLP Review First."],
];
const RAMP = ["#eaf1f8", "#c6dcee", "#8fbbdc", "#4f8fc2", "#1f5f98"];
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

function wardValue(w: J, mode: Mode): number {
  if (mode === "trail") return w.open_complaints ?? 0;
  if (mode === "audit") return w.unique_touched_wo_count ?? 0;
  return w.utilization_pct ?? 0;
}
function ramp(v: number, max: number): string {
  if (max <= 0) return RAMP[0]!;
  const i = Math.min(RAMP.length - 1, Math.floor((v / max) * RAMP.length));
  return RAMP[i]!;
}

export function HeroStrip() {
  const q = useOverview();
  if (q.isLoading) return <Loading what="headline figures" />;
  if (q.error || !q.data) return <ErrorNote error={q.error} what="headline figures" />;
  const o = q.data;
  const h = o.hero ?? {};
  const p = o.primary ?? {};
  return (
    <section className="m-hero" aria-label="Headline figures" data-testid="hero-strip">
      <div className="m-hero__cell">
        <b>{formatInt(h.ward_count)}</b> BMC wards
      </div>
      <div className="m-hero__cell">
        <b>{formatInt(h.wo_count)}</b> work orders
      </div>
      <div className="m-hero__cell">
        <b>
          {formatInr(h.spend_inr)} / {formatInr(h.budget_inr)}
        </b>{" "}
        spent of budget
      </div>
      <div className="m-hero__cell m-hero__cell--wide">
        <b>{formatInt(p.finding_count)}</b> primary review findings across <b>{formatInt(p.unique_wo_count)}</b> unique work orders
      </div>
      <div className="m-hero__cell">
        <b>{formatInr(h.reopened_30d_spend_inr)}</b> spend associated with repairs reopened within 30 days
      </div>
      <div className="m-hero__cell">
        <b>{formatInt(h.open_backlog_count)}</b> open backlog complaints
      </div>
      <p className="m-hero__note">
        {formatInr(p.unique_billed_inr)} unique billed value touched by one or more primary review findings. {p.qualification ?? OVERLAP_NOTE}
      </p>
    </section>
  );
}

type Sel = { type: "ward"; ward: J } | { type: "road"; road: J } | { type: "issue"; issue: J } | { type: "wo"; wo: J } | null;

export function MapTriage() {
  const wardsQ = useWards();
  const [mode, setMode] = useState<Mode>("trail");
  const [ward, setWard] = useState<string>("");
  const [layers, setLayers] = useState({ wards: true, roads: true, issues: true, facilities: false });
  const [sel, setSel] = useState<Sel>(null);
  const [basemapDown, setBasemapDown] = useState(false);
  const triageQ = useMonsoon("/map-triage", { ward, mode, include_overlays: layers.facilities ? "true" : "" });
  const wards: J[] = wardsQ.data?.wards ?? [];

  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<{ L: typeof LT; map: LT.Map; groups: Record<string, LT.LayerGroup>; tiles: LT.TileLayer; health: TileHealth } | null>(null);
  const [ready, setReady] = useState(false);
  const fitted = useRef<string>("__none__");

  useEffect(() => {
    let dead = false;
    let cleanup = () => undefined as void;
    void (async () => {
      const L = (await import("leaflet")) as typeof LT;
      await import("leaflet/dist/leaflet.css");
      if (dead || !el.current) return;
      const map = L.map(el.current, { preferCanvas: true, zoomControl: true, minZoom: 9 });
      map.setView([19.07, 72.88], 11);
      const tiles = L.tileLayer(TILE_URL, { maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
      const health = new TileHealth(() => setBasemapDown(true));
      tiles.on("tileload", () => health.tileLoaded());
      tiles.on("tileerror", () => health.tileFailed());
      const groups = { wards: L.layerGroup().addTo(map), roads: L.layerGroup().addTo(map), issues: L.layerGroup().addTo(map), facilities: L.layerGroup().addTo(map), flagged: L.layerGroup().addTo(map) };
      mapRef.current = { L, map, groups, tiles, health };
      setReady(true);
      cleanup = () => {
        map.remove();
        mapRef.current = null;
      };
    })();
    return () => {
      dead = true;
      cleanup();
    };
  }, []);

  const roads: J[] = triageQ.data?.roads ?? [];
  const issues: J[] = triageQ.data?.issues ?? [];
  const flagged: J[] = triageQ.data?.flagged_work_orders ?? [];
  const facilities: J[] = triageQ.data?.overlays?.facilities ?? [];
  const maxWard = useMemo(() => Math.max(1, ...wards.map((w) => wardValue(w, mode))), [wards, mode]);

  // Ward polygons (choropleth)
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !ready) return;
    const { L, groups } = m;
    groups.wards!.clearLayers();
    if (!layers.wards) return;
    for (const w of wards) {
      if (!w.geometry) continue;
      const selected = w.ward_code === ward;
      const layer = L.geoJSON({ type: "Feature", properties: {}, geometry: w.geometry } as GeoJSON.Feature, {
        style: { color: selected ? "#14283d" : w.over_budget && mode === "next_rupee" ? "#b42318" : "#5b6b7b", weight: selected ? 3 : 1, fillColor: ramp(wardValue(w, mode), maxWard), fillOpacity: 0.55 },
      });
      layer.bindTooltip(`Ward ${w.ward_code} · ${w.ward_name ?? ""} · ${mode === "trail" ? `${formatInt(w.open_complaints)} open complaints` : mode === "audit" ? `${formatInt(w.unique_touched_wo_count)} work orders touched by primary review flags` : `${formatPct(w.utilization_pct)} of budget used`}`, { sticky: true });
      layer.on("click", () => {
        setWard(w.ward_code);
        setSel({ type: "ward", ward: w });
      });
      layer.addTo(groups.wards!);
    }
  }, [ready, wards, mode, maxWard, ward, layers.wards]);

  // Zoom on ward selection
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !ready || wards.length === 0) return;
    if (fitted.current === ward) return;
    fitted.current = ward;
    if (!ward) {
      m.map.setView([19.07, 72.88], 11);
      return;
    }
    const w = wards.find((x) => x.ward_code === ward);
    if (w?.geometry) m.map.fitBounds(m.L.geoJSON(w.geometry as GeoJSON.GeometryObject).getBounds(), { padding: [20, 20] });
  }, [ready, ward, wards]);

  // Roads + flagged work orders
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !ready) return;
    const { L, groups } = m;
    groups.roads!.clearLayers();
    groups.flagged!.clearLayers();
    if (layers.roads) {
      for (const r of roads) {
        if (!r.geometry) continue;
        const dlp = r.lane === "DLP_REVIEW_FIRST_LANE";
        const topNew = r.lane === "NEW_BUDGET_CANDIDATE_LANE" && (r.citywide_lane_rank ?? 99) <= 10;
        let color = "#7b8794";
        let weight = 2;
        if (mode === "audit") {
          if ((r.primary_flag_count ?? 0) > 0) {
            color = "#c2410c";
            weight = 4;
          }
        } else if (mode === "next_rupee") {
          if (topNew) {
            color = "#9f1239";
            weight = 5;
          } else if (dlp && (r.citywide_lane_rank ?? 99) <= 10) {
            color = "#6d28d9";
            weight = 4;
          }
        } else if ((r.open_backlog_count ?? 0) > 0 || (r.reopen_count ?? 0) > 0) {
          color = (r.reopen_count ?? 0) > 0 ? "#b42318" : "#0f766e";
          weight = 3.5;
        }
        const layer = L.geoJSON({ type: "Feature", properties: {}, geometry: r.geometry } as GeoJSON.Feature, {
          style: { color: dlp ? "#6d28d9" : color, weight, opacity: 0.95, dashArray: dlp ? "6 5" : undefined },
        });
        layer.bindTooltip(`${r.road_id} · ${r.road_name} (ward ${r.ward_code})${dlp ? " · DLP Review First" : ""}`, { sticky: true });
        layer.on("click", () => setSel({ type: "road", road: r }));
        layer.addTo(groups.roads!);
      }
    }
    if (mode === "audit") {
      for (const f of flagged) {
        if (typeof f.lat !== "number") continue;
        const c = L.circleMarker([f.lat, f.lon], { radius: 6, color: "#7c2d12", weight: 2, fillColor: "#fb923c", fillOpacity: 0.9 });
        c.bindTooltip(`${f.work_order_id} · ${(f.display_labels ?? []).join("; ")}`);
        c.on("click", () => setSel({ type: "wo", wo: f }));
        c.addTo(groups.flagged!);
      }
    }
  }, [ready, roads, flagged, mode, layers.roads]);

  // Issue markers: only once a ward is selected
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !ready) return;
    const { L, groups } = m;
    groups.issues!.clearLayers();
    if (!layers.issues || !ward) return;
    for (const i of issues) {
      if (typeof i.lat !== "number" || typeof i.lon !== "number") continue;
      const gps = i.coord_provenance === "SOURCE_GPS";
      const c = gps
        ? L.circleMarker([i.lat, i.lon], { radius: 5, color: "#14283d", weight: 1, fillColor: i.has_ambulance_urgent_social ? "#b42318" : "#2563eb", fillOpacity: 0.9 })
        : L.circleMarker([i.lat, i.lon], { radius: 9, color: "#7a1f2b", weight: 2, dashArray: "3 3", fill: false, opacity: 0.95 });
      c.bindTooltip(`${i.category ?? "Issue"} · ${gps ? "Source GPS" : CENTROID_BADGE}`);
      c.on("click", () => setSel({ type: "issue", issue: i }));
      c.addTo(groups.issues!);
    }
  }, [ready, issues, ward, layers.issues]);

  useEffect(() => {
    const m = mapRef.current;
    if (!m || !ready) return;
    const { L, groups } = m;
    groups.facilities!.clearLayers();
    if (!layers.facilities) return;
    for (const f of facilities) {
      const c = L.circleMarker([f.lat, f.lon], { radius: 4, color: "#166534", weight: 1, fillColor: f.type === "Hospital" ? "#22c55e" : "#a7f3d0", fillOpacity: 0.9 });
      c.bindTooltip(`${f.name} (${f.type})`);
      c.addTo(groups.facilities!);
    }
  }, [ready, facilities, layers.facilities]);

  const retryBasemap = () => {
    const m = mapRef.current;
    if (!m) return;
    m.health.reset();
    setBasemapDown(false);
    m.tiles.redraw();
  };
  const toggle = (k: keyof typeof layers) => setLayers((l) => ({ ...l, [k]: !l[k] }));
  const modeNote = MODES.find((x) => x[0] === mode)![2];

  return (
    <div className="m-map">
      <div className="m-map__controls">
        <div className="m-seg" role="group" aria-label="Triage mode">
          {MODES.map(([k, label]) => (
            <button key={k} type="button" className="m-seg__btn" aria-pressed={mode === k} onClick={() => setMode(k)}>
              {label}
            </button>
          ))}
        </div>
        <label className="m-field">
          <span>Ward</span>
          <select
            value={ward}
            onChange={(e) => {
              setWard(e.target.value);
              const w = wards.find((x) => x.ward_code === e.target.value);
              setSel(w ? { type: "ward", ward: w } : null);
            }}
          >
            <option value="">All {wards.length || ""} wards</option>
            {wards.map((w) => (
              <option key={w.ward_code} value={w.ward_code}>
                {w.ward_code} — {w.ward_name}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="m-layers">
          <legend>Layers</legend>
          <label>
            <input type="checkbox" checked={layers.wards} onChange={() => toggle("wards")} /> {wards.length || ""} Wards
          </label>
          <label>
            <input type="checkbox" checked={layers.roads} onChange={() => toggle("roads")} /> {roads.length || ""} Roads
          </label>
          <label>
            <input type="checkbox" checked={layers.issues} onChange={() => toggle("issues")} /> Issues {ward ? "" : "(select a ward)"}
          </label>
          <label>
            <input type="checkbox" checked={layers.facilities} onChange={() => toggle("facilities")} /> Hospitals &amp; schools
          </label>
        </fieldset>
      </div>
      <p className="m-sub">{modeNote}</p>
      <div className="m-map__body">
        <div className="m-map__canvas-wrap">
          <div ref={el} className="m-map__canvas" role="region" aria-label="Map of Mumbai wards and roads" data-testid="map-canvas" />
          {basemapDown ? (
            <p className="m-map__basemap" role="status">
              Basemap unavailable — wards and roads are still drawn.{" "}
              <button type="button" className="m-btn m-btn--small" onClick={retryBasemap}>
                Retry basemap
              </button>
            </p>
          ) : null}
          <Legend />
          {triageQ.isLoading ? <p className="m-map__loading">Loading roads…</p> : null}
        </div>
        <aside className="m-inspector" aria-label="Triage inspector">
          {triageQ.error ? <ErrorNote error={triageQ.error} what="map data" /> : null}
          {ward && triageQ.data ? (
            <p className="m-note" data-testid="issue-count">
              Showing {formatInt(triageQ.data.issues_returned ?? issues.length)} of {formatInt(triageQ.data.issues_total ?? issues.length)} issues in ward {ward}. Unresolved coordinates ({formatInt(triageQ.data.unresolved_count ?? 0)}) are counted, never pinned.
            </p>
          ) : (
            <p className="m-note">Select a ward on the map to load its complaint markers.</p>
          )}
          <Inspector sel={sel} flagged={flagged} />
        </aside>
      </div>
    </div>
  );
}

function Legend() {
  return (
    <ul className="m-legend" aria-label="Map legend">
      <li>
        <i className="m-key m-key--gps" /> Source GPS (solid)
      </li>
      <li>
        <i className="m-key m-key--centroid" /> {CENTROID_BADGE} (hollow, dashed)
      </li>
      <li>
        <i className="m-key m-key--dlp" /> DLP Review First road (dashed)
      </li>
      <li>
        <i className="m-key m-key--flag" /> Primary-review-flagged road / work order
      </li>
      <li>
        <i className="m-key m-key--priority" /> Top Next-Rupee priority road
      </li>
    </ul>
  );
}

function Inspector({ sel, flagged }: { sel: Sel; flagged: J[] }) {
  if (!sel) return <p className="m-note">Click a ward, road or marker for its detail and evidence.</p>;
  if (sel.type === "ward") {
    const w = sel.ward;
    const wardFlagged = flagged.filter((f) => f.ward_code === w.ward_code).slice(0, 6);
    return (
      <div data-testid="ward-inspector">
        <h2 className="m-h3">
          Ward {w.ward_code} · {w.ward_name}
        </h2>
        <p>
          {w.narrative_author ? <AuthorBadge author={w.narrative_author} /> : null} {indianiseUnits(w.narrative)}
        </p>
        <p className="m-sub">
          Spent {formatInr(w.actual_spend_inr)} of {formatInr(w.monsoon_repair_budget_inr_2025)} ({formatPct(w.utilization_pct)})
        </p>
        <Bar value={w.actual_spend_inr ?? 0} max={w.monsoon_repair_budget_inr_2025 ?? 1} tone={w.over_budget ? "red" : "blue"} label="Budget used" />
        <p className="m-sub">
          {formatInr(w.reopened_30d_spend_inr)} spend associated with repairs reopened within 30 days · {formatInt(w.open_complaints)} open complaints · {formatInt(w.unique_touched_wo_count)} work orders touched by primary review flags
        </p>
        {wardFlagged.length > 0 ? (
          <>
            <h3 className="m-h4">Flagged work orders in this ward</h3>
            <ul className="m-list">
              {wardFlagged.map((f) => (
                <li key={f.work_order_id}>
                  <EvidenceLink id={f.work_order_id} /> <span className="m-sub">{(f.display_labels ?? []).join("; ")}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <p>
          <Link className="m-btn m-btn--small" to={`/planner?${new URLSearchParams({ ward: w.ward_code })}`}>
            Open ward in Next-Rupee Planner →
          </Link>
        </p>
      </div>
    );
  }
  if (sel.type === "road") {
    return (
      <div data-testid="road-inspector">
        <RoadCard road={sel.road} />
        <p>
          <Link className="m-btn m-btn--small" to={`/kundali?id=${sel.road.road_id}`}>
            Open Kundali →
          </Link>
        </p>
      </div>
    );
  }
  if (sel.type === "wo") {
    const f = sel.wo;
    return (
      <div>
        <h2 className="m-h3">{f.work_order_id}</h2>
        <p>{(f.display_labels ?? []).join("; ")}</p>
        <p className="m-sub">{f.one_line_reason}</p>
        <p className="m-sub">Billed {formatInr(f.billed_inr)} · {f.variance_band ?? "no variance band"}</p>
        <p>
          <EvidenceLink id={f.work_order_id} kind="button">
            Open evidence
          </EvidenceLink>
        </p>
      </div>
    );
  }
  const i = sel.issue;
  const gps = i.coord_provenance === "SOURCE_GPS";
  return (
    <div data-testid="issue-inspector">
      <h2 className="m-h3">{i.category ?? "Issue"}</h2>
      <p className="m-badges">
        <Badge tone={gps ? "ok" : "warn"}>{gps ? `Source GPS${typeof i.gps_accuracy_m === "number" ? ` ±${Math.round(i.gps_accuracy_m)} m` : ""}` : CENTROID_BADGE}</Badge>
        <Badge>Ward source: {i.ward_provenance}</Badge>
        {i.ward_border_review ? <Badge tone="review">Ward border review (source ward {i.source_ward_code})</Badge> : null}
        {i.has_ambulance_urgent_social ? <Badge tone="warn">Ambulance-urgent social signal</Badge> : null}
      </p>
      <p className="m-sub">
        {i.complaint_count} complaints · {i.total_upvotes} upvotes · {i.languages} · {i.channels} · status {i.issue_status}
      </p>
      {i.sample_description ? <blockquote className="m-quote">{i.sample_description}</blockquote> : null}
      {(i.linked_wo_ids ?? []).length > 0 ? (
        <p className="m-sub">
          Linked work orders:{" "}
          {(i.linked_wo_ids as string[]).slice(0, 4).map((id) => (
            <span key={id}>
              <EvidenceLink id={id} />{" "}
            </span>
          ))}
        </p>
      ) : (
        <p className="m-sub">No linked work order.</p>
      )}
      <p>
        <EvidenceLink id={i.issue_id} kind="button">
          Open evidence
        </EvidenceLink>{" "}
        <Link className="m-btn m-btn--small" to={`/kundali?id=${i.issue_id}`}>
          Open Kundali →
        </Link>
      </p>
      <p className="m-sub">{DLP_CAVEAT}</p>
    </div>
  );
}
