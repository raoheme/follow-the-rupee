import { useState } from "react";
import { Link } from "react-router-dom";
import { useMonsoon, useWards, type J } from "./api";
import { SLA_NOTE } from "./copy";
import { formatInr, formatInt, formatPct, formatRatio, indianiseUnits, signed } from "./format";
import { AuthorBadge, Badge, Bar, EvidenceLink, Q } from "./ui";

type SortKey = "reopen_delta_pts" | "jobs_count" | "contractor_name";

function DeltaBar({ delta }: { delta: number | null }) {
  if (delta === null || delta === undefined) return null;
  const MAX = 15;
  const w = Math.min(50, (Math.abs(delta) / MAX) * 50);
  return (
    <span className="m-delta" role="img" aria-label={`Observed minus expected reopen rate: ${signed(delta)} points`}>
      <span className="m-delta__axis" />
      <span className={`m-delta__fill ${delta > 0 ? "m-delta__fill--pos" : "m-delta__fill--neg"}`} style={delta > 0 ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }} />
    </span>
  );
}

function ContractorCard({ c }: { c: J }) {
  const claude = typeof c.narrative_author === "string" && c.narrative_author.toLowerCase().includes("claude");
  return (
    <article className="m-card" data-testid="contractor-card">
      <h3 className="m-h4">{c.contractor_name}</h3>
      <p className="m-sub">
        n = {formatInt(c.jobs_count)} jobs · {formatInr(c.total_spend_inr)} recorded spend
      </p>
      <dl className="m-metrics">
        <div>
          <dt>Observed reopen O</dt>
          <dd>{formatPct(c.observed_reopen_pct)}</dd>
        </div>
        <div>
          <dt>Method-mix expected E</dt>
          <dd>{formatPct(c.expected_reopen_method_mix_pct)}</dd>
        </div>
        <div>
          <dt>Δ (O − E), points</dt>
          <dd>{signed(c.reopen_delta_pts)}</dd>
        </div>
      </dl>
      <DeltaBar delta={c.reopen_delta_pts} />
      <dl className="m-metrics">
        <div>
          <dt>SLA met</dt>
          <dd>{formatPct(c.sla_met_pct, 0)}</dd>
        </div>
        <div>
          <dt>Low-lying exposure</dt>
          <dd>{formatPct(c.low_lying_exposure_pct, 0)}</dd>
        </div>
        <div>
          <dt>Avg cost ratio</dt>
          <dd>{formatRatio(c.avg_cost_ratio)}</dd>
        </div>
      </dl>
      <p className="m-sub">{c.sla_non_causal_note ?? SLA_NOTE}</p>
      <p>
        <b>{formatInt(c.unique_primary_flagged_wo)}</b> work orders with primary review flags ({formatInt(c.rate_variance_count)} rate-card variance · {formatInt(c.duplicate_candidate_count)} possible duplicate · {formatInt(c.dlp_surface_review_count)} DLP surface review)
      </p>
      <p className="m-sub">{formatInr(c.reopened_30d_spend_inr)} spend associated with repairs reopened within 30 days</p>
      {claude && c.narrative ? (
        <div className="m-narr">
          <AuthorBadge author={c.narrative_author} />
          <p>{indianiseUnits(c.narrative)}</p>
        </div>
      ) : null}
    </article>
  );
}

function Contractors() {
  const q = useMonsoon("/contractors");
  const [sort, setSort] = useState<SortKey>("reopen_delta_pts");
  return (
    <Q q={q} what="contractor measures">
      {(d) => {
        const list: J[] = [...(d.contractors ?? [])].sort((a, b) =>
          sort === "contractor_name" ? String(a.contractor_name).localeCompare(String(b.contractor_name)) : sort === "jobs_count" ? b.jobs_count - a.jobs_count : (a.reopen_delta_pts ?? 0) - (b.reopen_delta_pts ?? 0),
        );
        const m = d.methodology;
        return (
          <>
            <section className="m-card m-card--accent">
              <h3 className="m-h4">How to read these measures</h3>
              <p>
                O is the observed share of a contractor's repairs reopened within 30 days. E is the share expected from the mix of repair methods the contractor was given. Δ is O minus E in percentage points. Reopening is not weather-adjusted.
              </p>
              <p className="m-note">{d.sla_note ?? SLA_NOTE}</p>
            </section>
            <label className="m-field">
              <span>Order by</span>
              <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                <option value="reopen_delta_pts">Δ reopen vs method-mix (lowest first)</option>
                <option value="jobs_count">Number of jobs n (highest first)</option>
                <option value="contractor_name">Name</option>
              </select>
            </label>
            <div className="m-cards3">
              {list.map((c) => (
                <ContractorCard key={c.contractor_id} c={c} />
              ))}
            </div>
            {m ? (
              <details className="m-card">
                <summary>Methodology &amp; Sensitivity</summary>
                <p className="m-sub">
                  {m.name} — {m.status}. A supporting view only; the measures above are the primary evidence. No letter grades.
                </p>
                <p className="m-sub">{m.formula}</p>
                <div className="m-scroll">
                  <table className="m-table">
                    <thead>
                      <tr>
                        <th>Weighting profile</th>
                        <th>Contractor order under this weighting</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(m.profiles ?? {}).map(([name, p]: [string, J]) => (
                        <tr key={name}>
                          <td>{name}</td>
                          <td>{(p.order_best_first ?? []).join(" › ")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="m-scroll">
                  <table className="m-table">
                    <thead>
                      <tr>
                        <th>Contractor</th>
                        {Object.keys(m.profiles ?? {}).map((k) => (
                          <th key={k}>{k}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((c) => (
                        <tr key={c.contractor_id}>
                          <td>{c.contractor_id}</td>
                          {Object.keys(m.profiles ?? {}).map((k) => (
                            <td key={k}>{typeof c.idx?.[k] === "number" ? c.idx[k].toFixed(1) : "—"}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            ) : null}
          </>
        );
      }}
    </Q>
  );
}

function Breakdown({ rows, labelKey, title }: { rows: J[]; labelKey: string; title: string }) {
  if (!rows || rows.length === 0) return null;
  const max = Math.max(1, ...rows.map((r) => r.spend_inr ?? 0));
  return (
    <div>
      <h4 className="m-h4">{title}</h4>
      <ul className="m-bars">
        {rows.slice(0, 6).map((r) => (
          <li key={r[labelKey]}>
            <span className="m-bars__label">{r[labelKey]}</span>
            <Bar value={r.spend_inr ?? 0} max={max} label={`${r[labelKey]} spend`} />
            <span className="m-bars__val">{formatInr(r.spend_inr)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function WardsView() {
  const q = useWards();
  const [code, setCode] = useState<string>("");
  const detail = useMonsoon("/ward-detail", { ward: code }, !!code);
  return (
    <Q q={q} what="ward money trail">
      {(d) => {
        const wards: J[] = d.wards ?? [];
        const w = wards.find((x) => x.ward_code === code);
        const over = wards.filter((x) => x.over_budget);
        return (
          <>
            <p className="m-sub">
              {over.length} wards are over budget: {over.map((x) => `${x.ward_code} ${formatPct(x.utilization_pct)}`).join(" · ")}.
            </p>
            <div className="m-wardgrid" role="list">
              {wards.map((x) => (
                <button key={x.ward_code} type="button" role="listitem" className={`m-ward${x.over_budget ? " m-ward--over" : ""}`} aria-pressed={code === x.ward_code} onClick={() => setCode(x.ward_code)}>
                  <b>{x.ward_code}</b>
                  <span className="m-sub">{formatPct(x.utilization_pct)}</span>
                  <Bar value={Math.min(x.utilization_pct ?? 0, 100)} max={100} tone={x.over_budget ? "red" : "blue"} label={`Ward ${x.ward_code} budget used`} />
                  {x.over_budget ? <Badge tone="warn">Over budget</Badge> : null}
                </button>
              ))}
            </div>
            {w ? (
              <section className="m-card" data-testid="ward-detail">
                <h3 className="m-h3">
                  Ward {w.ward_code} · {w.ward_name}
                </h3>
                <p>
                  Spent {formatInr(w.actual_spend_inr)} of {formatInr(w.monsoon_repair_budget_inr_2025)} budget ({formatPct(w.utilization_pct)}) · remaining {formatInr(w.remaining_inr)}
                </p>
                <Bar value={Math.min(w.actual_spend_inr ?? 0, w.monsoon_repair_budget_inr_2025 ?? 1)} max={w.monsoon_repair_budget_inr_2025 ?? 1} tone={w.over_budget ? "red" : "blue"} label="Spend versus budget" />
                <p className="m-sub">
                  {formatInr(w.reopened_30d_spend_inr)} spend associated with repairs reopened within 30 days ({formatInt(w.reopened_30d_jobs)} jobs) · {formatInt(w.unique_touched_wo_count)} work orders touched by primary review flags · {formatInt(w.open_complaints)} open complaints
                </p>
                <div className="m-cols2">
                  <Breakdown rows={w.contractor_breakdown} labelKey="contractor_name" title="Spend by contractor" />
                  <Breakdown rows={w.method_breakdown} labelKey="repair_method" title="Spend by repair method" />
                </div>
                {w.narrative ? (
                  <div className="m-narr">
                    {w.narrative_author ? <AuthorBadge author={w.narrative_author} /> : null}
                    <p>{indianiseUnits(w.narrative)}</p>
                  </div>
                ) : null}
                {detail.data?.top_primary_wos?.length ? (
                  <p className="m-sub">
                    Top work orders with primary review flags:{" "}
                    {(detail.data.top_primary_wos as J[]).slice(0, 5).map((x) => (
                      <span key={x.work_order_id}>
                        <EvidenceLink id={x.work_order_id} />{" "}
                      </span>
                    ))}
                  </p>
                ) : null}
                <p>
                  <Link className="m-btn m-btn--small" to={`/planner?${new URLSearchParams({ ward: w.ward_code })}`}>
                    Open in Next-Rupee Planner →
                  </Link>
                </p>
              </section>
            ) : (
              <p className="m-note">Select a ward for its budget, contractor and method breakdown.</p>
            )}
          </>
        );
      }}
    </Q>
  );
}

export function ScorecardsPage() {
  const [tab, setTab] = useState<"contractors" | "wards">("contractors");
  return (
    <div className="m-page">
      <h1 id="page-heading" tabIndex={-1} className="m-h1">
        Scorecards &amp; Wards
      </h1>
      <div className="m-seg" role="group" aria-label="Scorecards view">
        <button type="button" className="m-seg__btn" aria-pressed={tab === "contractors"} onClick={() => setTab("contractors")}>
          Fair Contractor Scorecards
        </button>
        <button type="button" className="m-seg__btn" aria-pressed={tab === "wards"} onClick={() => setTab("wards")}>
          24-Ward Money Trail
        </button>
      </div>
      {tab === "contractors" ? <Contractors /> : <WardsView />}
    </div>
  );
}
