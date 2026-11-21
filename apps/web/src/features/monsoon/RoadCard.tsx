import type { J } from "./api";
import { DLP_CAVEAT, DLP_DEFER, ENG_REVIEW, TREATMENT_LABEL } from "./copy";
import { formatInr, formatPct } from "./format";
import { Badge, EvidenceLink } from "./ui";

export const FACTOR_NAMES: Record<string, string> = {
  C: "Complaints",
  R: "Reopens",
  F: "Flooding",
  A: "Accidents",
  V: "Vulnerable sites",
  D: "Damage extent",
  T: "Traffic",
};

export function FactorPills({ factors }: { factors: J }) {
  if (!factors) return null;
  return (
    <ul className="m-pills" aria-label="Risk factors (0 to 1)">
      {Object.keys(FACTOR_NAMES).map((k) => {
        const v = factors[k];
        return (
          <li key={k} className="m-pill" title={`${FACTOR_NAMES[k]}: normalised factor, 0 to 1`}>
            <b>{k}</b> {typeof v === "number" ? v.toFixed(2) : "n/a"}
          </li>
        );
      })}
    </ul>
  );
}

export function RoadCard({ road, compact = false, rank }: { road: J; compact?: boolean; rank?: number }) {
  const dlp = road.lane === "DLP_REVIEW_FIRST_LANE" || road.under_dlp === "Y";
  const lowCov = typeof road.evidence_coverage_pct === "number" && road.evidence_coverage_pct < 70;
  return (
    <article className={`m-road${dlp ? " m-road--dlp" : ""}`} data-road={road.road_id}>
      <header className="m-road__head">
        <div>
          <h3 className="m-road__title">
            {rank ? <span className="m-road__rank">#{rank}</span> : null} {road.road_name} <EvidenceLink id={road.road_id} />
          </h3>
          <p className="m-sub">
            Ward {road.ward_code} · {road.road_type} · {road.surface}
          </p>
        </div>
        <div className="m-road__score" aria-label="Risk score">
          <span className="m-road__score-val">{typeof road.risk_score === "number" ? road.risk_score.toFixed(2) : "—"}</span>
          <span className="m-sub">Risk (balanced profile)</span>
        </div>
      </header>
      <p className="m-ranks">
        <Badge tone={road.lane === "DLP_REVIEW_FIRST_LANE" ? "review" : "ok"}>{road.lane === "DLP_REVIEW_FIRST_LANE" ? "DLP Review First" : "New Budget Candidate"}</Badge>{" "}
        <Badge tone="info">
          #{road.ward_rank ?? "—"} in Ward {road.ward_code}
        </Badge>{" "}
        <Badge tone="info">#{road.citywide_lane_rank ?? "—"} in Mumbai</Badge>{" "}
        {typeof road.top10_profile_count === "number" ? (
          <Badge tone={road.top10_profile_count >= 3 ? "ok" : "neutral"}>Top-10 in {road.top10_profile_count}/4 profiles</Badge>
        ) : null}{" "}
        <Badge tone={lowCov ? "warn" : "neutral"}>Evidence coverage {formatPct(road.evidence_coverage_pct, 0)}</Badge>
      </p>
      {lowCov ? <p className="m-note m-note--warn">Top-3 excluded: low evidence coverage (below 70%).</p> : null}
      {!compact ? <FactorPills factors={road.factors} /> : null}
      <p className="m-treat">
        <span className="m-sub">{TREATMENT_LABEL}</span>
        <br />
        {road.dominant_issue_type ? (
          <>
            <b>{road.dominant_issue_type}</b> → {road.candidate_treatment ?? ENG_REVIEW}
          </>
        ) : (
          <b>{ENG_REVIEW}</b>
        )}
      </p>
      {dlp ? (
        <div className="m-dlp">
          <p>
            <b>{DLP_DEFER}.</b> {road.allocation_note ?? "New municipal repair allocation: defer pending DLP scope review."}
          </p>
          <p className="m-sub">
            {road.potential_spend_avoided_label ?? "Potential new spend avoided if contractual coverage is confirmed"}:{" "}
            {typeof road.potential_spend_avoided_inr === "number" ? formatInr(road.potential_spend_avoided_inr) : "not quantified"}
          </p>
          <p className="m-sub">{road.dlp_caveat ?? DLP_CAVEAT}</p>
        </div>
      ) : (
        <p className="m-afford">
          Est. cost {formatInr(road.estimated_candidate_cost_inr)}{" "}
          {road.affordable_now === true ? (
            <Badge tone="ok">Affordable now: Yes</Badge>
          ) : road.affordable_now === false ? (
            <Badge tone="warn">Affordable now: No</Badge>
          ) : null}
          {road.affordable_now === false ? (
            <span className="m-sub">
              {" "}
              Within this ward's remaining budget the estimate needs an administrative action (reallocation or approval). The risk rank is unchanged.
            </span>
          ) : null}
        </p>
      )}
      {!compact ? (
        <p className="m-sub">
          {road.primary_flag_count ?? 0} primary review flags · {road.reopen_count ?? 0} reopened · {road.open_backlog_count ?? 0} open backlog
        </p>
      ) : null}
      {!compact ? (
        <p>
          <EvidenceLink id={road.road_id} kind="button">
            Inspect Evidence
          </EvidenceLink>
        </p>
      ) : null}
    </article>
  );
}
