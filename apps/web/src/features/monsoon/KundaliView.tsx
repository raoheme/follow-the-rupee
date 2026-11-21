import type { J } from "./api";
import { DLP_CAVEAT } from "./copy";
import { formatInr, formatPct, formatRatio, indianiseUnits } from "./format";
import { RoadCard } from "./RoadCard";
import { AuthorBadge, Badge, BandPill, EvidenceLink } from "./ui";

function ProvBadges({ c }: { c: J }) {
  return (
    <p className="m-badges">
      <Badge tone={c.coord_provenance === "SOURCE_GPS" ? "ok" : "warn"}>
        {c.coord_provenance === "SOURCE_GPS"
          ? `Source GPS${typeof c.gps_accuracy_m === "number" ? ` ±${Math.round(c.gps_accuracy_m)} m` : ""}`
          : c.coord_provenance === "LOCALITY_CENTROID"
            ? "Locality centroid (coarse, not exact GPS)"
            : "Coordinates unresolved"}
      </Badge>
      <Badge>Ward source: {c.ward_provenance ?? "n/a"}</Badge>
      {c.ward_border_review ? <Badge tone="review">Ward border review (source ward {c.source_ward_code})</Badge> : null}
      <Badge>{c.language}</Badge>
      <Badge>{c.channel}</Badge>
    </p>
  );
}

/** One trail renderer shared by the Evidence Drawer (compact) and the Trail Kundali page. */
export function KundaliView({ data, compact = false }: { data: J; compact?: boolean }) {
  const wos: J[] = data.work_orders ?? [];
  const complaints: J[] = data.complaints ?? [];
  const roadSection = (
    <>
      {data.road ? (
        <section className="m-step">
          <h3>Road segment</h3>
          <RoadCard road={data.road} compact />
          <p className="m-sub">
            Last resurfaced {data.road.last_resurfaced ?? "n/a"} · {data.road.accidents_surface_cause ?? 0} surface-related recorded accidents · {data.road.hotspots_within_radius ?? 0} flood hotspots nearby ·{" "}
            {(data.road.emergency_hospitals ?? 0) + (data.road.schools ?? 0)} hospitals/schools nearby
          </p>
        </section>
      ) : null}
    </>
  );
  return (
    <div className="m-kundali" data-kind={data.kind}>
      <p className="m-sub">
        Record <b>{data.id}</b> ({data.kind})
        {data.road ? <> · Road {data.road.road_id}</> : null}
        {data.road?.ward_code ? <> · Ward {data.road.ward_code}</> : null}
        {wos[0]?.contractor_name ? <> · {wos[0].contractor_name}</> : null}
      </p>

      {data.kind === "road" ? roadSection : null}

      {complaints.length > 0 ? (
        <section className="m-step">
          <h3>Complaint{complaints.length > 1 ? "s" : ""}</h3>
          {complaints.slice(0, compact ? 3 : 8).map((c) => (
            <div key={c.complaint_id} className="m-card m-card--flat">
              <p>
                <b>{c.complaint_id}</b> <span className="m-sub">{c.received_at}</span> <Badge tone="info">{c.status}</Badge>{" "}
                <span className="m-sub">{c.linkage_bucket}</span>
              </p>
              <blockquote lang={c.language === "hi" ? "hi" : c.language === "mr" ? "mr" : "en"} className="m-quote">
                {c.description}
              </blockquote>
              {c.photo_description ? <p className="m-sub">Photo description: {c.photo_description}</p> : null}
              <p className="m-sub">
                Reported category: {c.category_reported} · Resolved category: {c.resolved_category} ({c.category_status}) · Ward {c.ward_final} · {c.locality_text}
              </p>
              <ProvBadges c={c} />
            </div>
          ))}
        </section>
      ) : null}

      {(data.social_posts ?? []).length > 0 ? (
        <section className="m-step">
          <h3>Community signal (social)</h3>
          <p className="m-sub">Corroborating posts are context only. They carry zero audit or risk weight.</p>
          {(data.social_posts as J[]).slice(0, compact ? 2 : 5).map((p) => (
            <p key={p.post_id} className="m-card m-card--flat">
              <Badge>{p.source}</Badge> {p.text}
            </p>
          ))}
        </section>
      ) : null}

      {data.issue ? (
        <section className="m-step">
          <h3>Deduplicated issue</h3>
          <p>
            <b>{data.issue.issue_id}</b> · {data.issue.category} · {data.issue.complaint_count} complaints across {data.issue.channel_count} channels · status {data.issue.issue_status}
          </p>
        </section>
      ) : null}

      {wos.length > 0 ? (
        <section className="m-step">
          <h3>Work order{wos.length > 1 ? "s" : ""} and rate-card math</h3>
          {wos.map((w) => (
            <div key={w.work_order_id} className="m-card m-card--flat">
              <p>
                <b>{w.work_order_id}</b> · {w.work_type} · {w.repair_method} · {w.contractor_name} <BandPill band={w.variance_band} />
              </p>
              <table className="m-table m-table--tight">
                <tbody>
                  <tr>
                    <th scope="row">Recorded (billed)</th>
                    <td>{formatInr(w.cost_inr)}</td>
                    <th scope="row">Calculated rate-card expectation</th>
                    <td>{formatInr(w.expected_cost_inr)}</td>
                  </tr>
                  <tr>
                    <th scope="row">Ratio</th>
                    <td>{formatRatio(w.cost_ratio)}</td>
                    <th scope="row">Positive variance</th>
                    <td>{formatInr(w.rate_variance_inr)}</td>
                  </tr>
                  <tr>
                    <th scope="row">Area / rate</th>
                    <td>
                      {w.area_sqm} sqm · {formatInr(w.standard_rate_inr)} standard
                    </td>
                    <th scope="row">Outcome</th>
                    <td>
                      SLA met: {w.sla_met} · Reopened within 30 days: {w.reopened_within_30d}
                    </td>
                  </tr>
                </tbody>
              </table>
              <ul className="m-flags">
                {(w.flags ?? []).map((f: J) => (
                  <li key={f.flag_id}>
                    <Badge tone={f.flag_class === "PRIMARY_REVIEW_FLAG" ? "review" : "neutral"}>{String(f.flag_class ?? "").replace(/_/g, " ").toLowerCase()}</Badge> <b>{f.display_label}</b>
                    <span className="m-sub"> — {f.public_reason}</span>
                  </li>
                ))}
              </ul>
              {w.engineer_remark ? (
                <p className="m-sub">
                  Engineer remark: “{w.engineer_remark}” (audit weight {w.engineer_remark_audit_weight ?? 0}: shown as context only, never used in a review rule.)
                </p>
              ) : null}
              <p className="m-sub">
                DLP status: {w.under_dlp === "Y" ? "under DLP" : "not under DLP"}
                {w.under_dlp === "Y" ? ` — ${DLP_CAVEAT}` : ""}
              </p>
              {w.unlinked ? <Badge tone="review">No linked complaint</Badge> : null}
            </div>
          ))}
        </section>
      ) : null}

      {data.kind !== "road" ? roadSection : null}

      {data.contractor ? (
        <section className="m-step">
          <h3>Contractor metrics</h3>
          <p>
            <b>{data.contractor.contractor_name}</b> · n={data.contractor.jobs_count} · Observed reopen {formatPct(data.contractor.observed_reopen_pct)} vs method-mix expected{" "}
            {formatPct(data.contractor.expected_reopen_method_mix_pct)} · SLA {formatPct(data.contractor.sla_met_pct, 0)} (low-lying exposure {formatPct(data.contractor.low_lying_exposure_pct, 0)}) · Avg cost ratio{" "}
            {formatRatio(data.contractor.avg_cost_ratio)}
          </p>
        </section>
      ) : null}

      {data.ward ? (
        <section className="m-step">
          <h3>Ward budget</h3>
          <p>
            Ward {data.ward.ward_code}: spent {formatInr(data.ward.actual_spend_inr)} of {formatInr(data.ward.monsoon_repair_budget_inr_2025)} ({formatPct(data.ward.utilization_pct)}) · spend associated with 30-day reopenings{" "}
            {formatInr(data.ward.reopened_30d_spend_inr)}
          </p>
          {data.ward.narrative ? (
            <p className="m-sub">
              {data.ward.narrative_author ? <AuthorBadge author={data.ward.narrative_author} /> : null} {indianiseUnits(data.ward.narrative)}
            </p>
          ) : null}
        </section>
      ) : null}

      {(data.notes ?? []).length > 0 ? (
        <ul className="m-sub">
          {(data.notes as string[]).map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
      {!compact && wos.length > 0 ? (
        <p className="m-sub">
          Related ids: {wos.slice(0, 5).map((w) => (
            <span key={w.work_order_id}>
              <EvidenceLink id={w.work_order_id} />{" "}
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}
