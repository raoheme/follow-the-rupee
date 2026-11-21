import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { monsoonUrl, useMonsoon, useWards, type J } from "./api";
import { DLP_CAVEAT, DLP_DEFER, SURVIVAL_LABEL } from "./copy";
import { formatInr, formatInt, formatPct } from "./format";
import { RoadCard } from "./RoadCard";
import { Badge, Q } from "./ui";

function RateTable({ rows, unit, title }: { rows: J[]; unit: string; title: string }) {
  return (
    <div className="m-card">
      <h4 className="m-h4">{title}</h4>
      <div className="m-scroll">
        <table className="m-table m-table--tight">
          <thead>
            <tr>
              <th>Method</th>
              <th>Jobs</th>
              <th>Standard rate ({unit})</th>
              <th>Non-reopen in 30 days</th>
              <th>{SURVIVAL_LABEL}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.repair_method}>
                <td>{r.repair_method}</td>
                <td>{formatInt(r.wo_jobs)}</td>
                <td>{formatInr(r.standard_rate_inr)}</td>
                <td>{formatPct(r.non_reopen_30d_pct)}</td>
                <td>{formatInr(r.survival_adjusted_30d_rate_inr)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function PlannerPage() {
  const [sp, setSp] = useSearchParams();
  const ward = sp.get("ward") ?? "";
  const [override, setOverride] = useState(false);
  const [budget, setBudget] = useState(2_500_000);
  const [debounced, setDebounced] = useState(budget);
  const [lane, setLane] = useState<"new" | "dlp">("new");
  const wardsQ = useWards();
  useEffect(() => {
    const t = setTimeout(() => setDebounced(budget), 250);
    return () => clearTimeout(t);
  }, [budget]);
  const params = { ward, budget_override_inr: override ? debounced : "" };
  const q = useMonsoon("/next-rupee", params);
  const wards: J[] = wardsQ.data?.wards ?? [];
  const setWard = (w: string) => {
    const n = new URLSearchParams(sp);
    if (w) n.set("ward", w);
    else n.delete("ward");
    setSp(n, { replace: true });
  };
  const chip = (code: string) => {
    const w = wards.find((x) => x.ward_code === code);
    return w?.over_budget ? `${code} (over budget)` : code;
  };
  const csv = monsoonUrl("/next-rupee", { ...params, format: "csv" });
  return (
    <div className="m-page">
      <h1 id="page-heading" tabIndex={-1} className="m-h1">
        Next-Rupee Planner
      </h1>
      <p className="m-sub">Where would the next rupee of road-repair money do the most good? Risk rank comes from evidence and never changes with budget; the budget only decides “affordable now”.</p>
      <div className="m-chips" role="group" aria-label="Quick ward chips">
        <button type="button" className="m-chip" aria-pressed={ward === ""} onClick={() => setWard("")}>
          All Mumbai
        </button>
        {["F/N", "P/N", "F/S", "L", "E"].map((c) => (
          <button key={c} type="button" className="m-chip" aria-pressed={ward === c} onClick={() => setWard(c)}>
            {chip(c)}
          </button>
        ))}
        <label className="m-field m-field--inline">
          <span>Ward</span>
          <select value={ward} onChange={(e) => setWard(e.target.value)}>
            <option value="">All wards</option>
            {wards.map((w) => (
              <option key={w.ward_code} value={w.ward_code}>
                {w.ward_code} — {w.ward_name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <section className="m-card" aria-label="Budget simulator">
        <label className="m-check">
          <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} /> What-if: set a budget instead of the ward's remaining budget
        </label>
        <div className="m-slider">
          <input
            type="range"
            min={0}
            max={10_000_000}
            step={100_000}
            value={budget}
            disabled={!override}
            onChange={(e) => setBudget(Number(e.target.value))}
            aria-label="What-if budget in rupees"
          />
          <b>{override ? formatInr(budget) : "Using remaining ward budget"}</b>
        </div>
        <p className="m-sub">
          {q.data ? `Budget used for “affordable now”: ${formatInr(q.data.ward_remaining_budget_inr ?? (override ? budget : null))}. ` : ""}Risk ranks are unchanged by this slider.
        </p>
      </section>

      <div className="m-toolbar">
        <div className="m-seg" role="tablist" aria-label="Action lanes">
          <button type="button" role="tab" className="m-seg__btn" aria-selected={lane === "new"} aria-pressed={lane === "new"} onClick={() => setLane("new")}>
            New Budget Candidates {q.data ? `(${formatInt((q.data.new_budget_lane ?? []).length)})` : ""}
          </button>
          <button type="button" role="tab" className="m-seg__btn" aria-selected={lane === "dlp"} aria-pressed={lane === "dlp"} onClick={() => setLane("dlp")}>
            DLP Review First {q.data ? `(${formatInt((q.data.dlp_review_lane ?? []).length)})` : ""}
          </button>
        </div>
        <a className="m-btn m-btn--primary" href={csv} data-testid="plan-csv">
          Download Plan CSV
        </a>
      </div>

      <Q q={q} what="ranked roads">
        {(d) => {
          const rows: J[] = lane === "new" ? (d.new_budget_lane ?? []) : (d.dlp_review_lane ?? []);
          return (
            <>
              {lane === "dlp" ? (
                <section className="m-note" data-testid="dlp-lane-note">
                  <b>DLP Review First.</b> {DLP_DEFER}. {d.allocation_note ?? ""} {d.potential_spend_label ? `${d.potential_spend_label} (not quantified unless shown on a road).` : ""} <br />
                  {d.dlp_caveat ?? DLP_CAVEAT}
                </section>
              ) : (
                <p className="m-sub">
                  <Badge tone="info">New Budget Candidates</Badge> Roads not under a defect liability period, ranked by evidence-based risk. Cost estimate = rate card × assumed area; engineering review decides scope.
                </p>
              )}
              <div className="m-roadlist" data-testid={lane === "new" ? "lane-new" : "lane-dlp"}>
                {rows.map((r, i) => (
                  <RoadCard key={r.road_id} road={r} rank={r.citywide_lane_rank ?? i + 1} />
                ))}
                {rows.length === 0 ? <p className="m-note">No roads in this lane for the selected ward.</p> : null}
              </div>
              {d.rate_card ? (
                <section aria-label="Rate reference">
                  <h2 className="m-h2">{d.rate_card.label ?? SURVIVAL_LABEL}</h2>
                  <p className="m-sub">Illustrative reference only: the standard rate divided by the share of repairs that stayed closed for 30 days. It is not a long-term durability claim, and the two unit groups are never ranked together.</p>
                  <RateTable title="Surface methods (₹ per sqm)" unit="₹/sqm" rows={d.rate_card.per_sqm_surface ?? []} />
                  <RateTable title="Per-job interventions (₹ per job)" unit="₹/job" rows={d.rate_card.per_job_intervention ?? []} />
                </section>
              ) : null}
            </>
          );
        }}
      </Q>
    </div>
  );
}
