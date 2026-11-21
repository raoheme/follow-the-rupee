import { useState } from "react";
import { monsoonUrl, useMonsoon, useOverview, useWards, type J } from "./api";
import { BAND_LABEL, FLAG_CLASSES, FLAG_TYPES, OVERLAP_NOTE, VARIANCE_BANDS } from "./copy";
import { formatInr, formatInt, formatRatio } from "./format";
import { Badge, BandPill, EvidenceLink, Q } from "./ui";

function RatioBar({ billed, expected }: { billed: number | null; expected: number | null }) {
  if (!billed || !expected) return <span className="m-sub">—</span>;
  const ratio = billed / expected;
  const MAX = 3;
  const pct = Math.min(100, (ratio / MAX) * 100);
  const thr = (1.3 / MAX) * 100;
  return (
    <span className="m-ratio" role="img" aria-label={`Recorded is ${ratio.toFixed(2)} times the calculated expectation`}>
      <span className="m-ratio__track">
        <span className={`m-ratio__fill${ratio > 1.3 ? " m-ratio__fill--over" : ""}`} style={{ width: `${pct}%` }} />
        <span className="m-ratio__thr" style={{ left: `${thr}%` }} />
      </span>
      <span className="m-ratio__val">{formatRatio(ratio)}</span>
    </span>
  );
}

function OverviewCards() {
  const q = useOverview();
  return (
    <Q q={q} what="review figures">
      {(o) => {
        const p = o.primary ?? {};
        const rv = p.rate_variance ?? {};
        const bands = rv.bands ?? {};
        const sh = o.false_positive_shields ?? {};
        return (
          <>
            <div className="m-cards3">
              <article className="m-card">
                <h3 className="m-h4">Rate-card variance reviews</h3>
                <p className="m-big">{formatInt(rv.count)} work orders</p>
                <p>
                  <b>{formatInr(rv.calculated_variance_inr)}</b> calculated rate-card variance
                </p>
                <p className="m-sub">
                  Recorded billed value {formatInr(rv.recorded_billed_inr)} · recorded cost exceeds the calculated rate-card expectation by more than 30%.
                </p>
                <p className="m-badges">
                  {VARIANCE_BANDS.map((b) => (
                    <Badge key={b} tone={b.startsWith("VERY") ? "warn" : b.startsWith("HIGH") ? "review" : "neutral"}>
                      {formatInt(bands[b])} {BAND_LABEL[b]}
                    </Badge>
                  ))}
                </p>
              </article>
              <article className="m-card">
                <h3 className="m-h4">Possible duplicate billing candidates</h3>
                <p className="m-big">{formatInt(p.duplicate?.count)} work orders</p>
                <p>
                  <b>{formatInr(p.duplicate?.billed_inr)}</b> billed value
                </p>
                <p className="m-badges">
                  <Badge tone="review">No linked complaint</Badge>
                </p>
                <p className="m-sub">
                  {formatInt(p.duplicate?.also_unlinked)} of these are also unlinked: one review group, never counted twice.
                </p>
              </article>
              <article className="m-card">
                <h3 className="m-h4">DLP surface repair reviews</h3>
                <p className="m-big">{formatInt(p.dlp_surface?.count)} work orders</p>
                <p>
                  <b>{formatInr(p.dlp_surface?.billed_inr)}</b> billed value
                </p>
                <p className="m-sub">Contractual coverage and scope pending review. DLP status does not prove contractual applicability or liability.</p>
              </article>
            </div>
            <section className="m-card m-card--accent" aria-label="Deduplicated summary">
              <p className="m-big">
                {formatInt(p.finding_count)} primary review findings across {formatInt(p.unique_wo_count)} unique work orders
              </p>
              <p>{formatInr(p.unique_billed_inr)} unique billed value touched by one or more primary review findings.</p>
              <p className="m-note">{p.qualification ?? OVERLAP_NOTE}</p>
              <details>
                <summary>Exact overlap matrix</summary>
                <div className="m-scroll">
                  <table className="m-table">
                    <thead>
                      <tr>
                        <th>Flag combination</th>
                        <th>Unique work orders</th>
                        <th>Billed value</th>
                        <th>Rate variance</th>
                        <th>DLP-surface billed</th>
                        <th>Duplicate-candidate billed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(p.overlap_matrix ?? []).map((r: J) => (
                        <tr key={r.combination}>
                          <td>{String(r.combination).replace(/_/g, " ").toLowerCase()}</td>
                          <td>{formatInt(r.unique_wo_count)}</td>
                          <td>{formatInr(r.total_billed_inr)}</td>
                          <td>{formatInr(r.rate_variance_inr)}</td>
                          <td>{formatInr(r.dlp_surface_billed_inr)}</td>
                          <td>{formatInr(r.duplicate_candidate_billed_inr)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </section>
            <section className="m-card m-card--shield" aria-label="Normal variation is protected" data-testid="shield-card">
              <h3 className="m-h4">Catches real problems, not normal variation</h3>
              <ul className="m-list">
                <li>
                  <b>{formatInt(sh.normal_rate_variance_protected_count)}</b> normal-variance jobs (at or below {sh.normal_rate_variance_threshold}×) are not flagged.
                </li>
                <li>
                  <b>{formatInt(sh.linked_exact_area_protected_count)}</b> linked exact-area repeats (
                  {(sh.linked_exact_area_protected_wos ?? []).map((id: string) => (
                    <span key={id}>
                      <EvidenceLink id={id} />{" "}
                    </span>
                  ))}
                  ) stay context-only as Repeated Work Review.
                </li>
                <li>
                  <b>{formatInt(sh.dlp_non_surface_excluded_count)}</b> non-surface drainage/pumping/manhole jobs ({formatInr(sh.dlp_non_surface_excluded_inr)}) on DLP roads are DLP Context Only.
                </li>
              </ul>
            </section>
          </>
        );
      }}
    </Q>
  );
}

export function AuditorPage() {
  const ov = useOverview();
  const wardsQ = useWards();
  const contrQ = useMonsoon("/contractors");
  const [f, setF] = useState({ flag_class: "PRIMARY_REVIEW_FLAG", flag_type: "", variance_band: "", ward: "", contractor: "", q: "" });
  const [limit, setLimit] = useState(100);
  const params = { ...f, limit, offset: 0 };
  const q = useMonsoon("/audit/flags", params);
  const counts = ov.data?.flag_class_counts ?? {};
  const csv = monsoonUrl("/audit/flags", { ...f, limit: 3000, format: "csv" });
  const set = (k: keyof typeof f, v: string) => {
    setLimit(100);
    setF((x) => ({ ...x, [k]: v }));
  };
  return (
    <div className="m-page">
      <h1 id="page-heading" tabIndex={-1} className="m-h1">
        Repair Auditor
      </h1>
      <p className="m-sub">Review flags are prompts for checking records, not findings of wrongdoing. Recorded cost is compared with a calculated rate-card expectation.</p>
      <OverviewCards />

      <section aria-label="Audit rows">
        <h2 className="m-h2">Audit rows</h2>
        <div className="m-seg m-seg--wrap" role="group" aria-label="Flag class">
          {FLAG_CLASSES.map(([k, label]) => (
            <button key={k} type="button" className="m-seg__btn" aria-pressed={f.flag_class === k} onClick={() => set("flag_class", k)}>
              {label} {ov.data && k !== "ALL" ? `(${formatInt(counts[k])})` : ""}
            </button>
          ))}
        </div>
        <div className="m-filters">
          <label className="m-field">
            <span>Flag type</span>
            <select value={f.flag_type} onChange={(e) => set("flag_type", e.target.value)}>
              <option value="">All types</option>
              {FLAG_TYPES.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="m-field">
            <span>Variance band</span>
            <select value={f.variance_band} onChange={(e) => set("variance_band", e.target.value)}>
              <option value="">All bands</option>
              {VARIANCE_BANDS.map((b) => (
                <option key={b} value={b}>
                  {BAND_LABEL[b]}
                </option>
              ))}
            </select>
          </label>
          <label className="m-field">
            <span>Ward</span>
            <select value={f.ward} onChange={(e) => set("ward", e.target.value)}>
              <option value="">All wards</option>
              {(wardsQ.data?.wards ?? []).map((w: J) => (
                <option key={w.ward_code} value={w.ward_code}>
                  {w.ward_code}
                </option>
              ))}
            </select>
          </label>
          <label className="m-field">
            <span>Contractor</span>
            <select value={f.contractor} onChange={(e) => set("contractor", e.target.value)}>
              <option value="">All contractors</option>
              {(contrQ.data?.contractors ?? []).map((c: J) => (
                <option key={c.contractor_id} value={c.contractor_id}>
                  {c.contractor_name}
                </option>
              ))}
            </select>
          </label>
          <label className="m-field">
            <span>Search</span>
            <input type="search" value={f.q} placeholder="WO25-…, RD…, text" onChange={(e) => set("q", e.target.value)} />
          </label>
          <a className="m-btn m-btn--primary" href={csv} data-testid="audit-csv">
            Download Audit CSV
          </a>
        </div>
        <Q q={q} what="audit rows">
          {(d) => (
            <>
              <p className="m-sub" data-testid="audit-total">
                Showing {formatInt((d.rows ?? []).length)} of {formatInt(d.total)} rows. {OVERLAP_NOTE}
              </p>
              <div className="m-scroll">
                <table className="m-table m-table--rows">
                  <thead>
                    <tr>
                      <th>Work order</th>
                      <th>Finding</th>
                      <th>Recorded vs calculated expectation</th>
                      <th>Triage band</th>
                      <th>Reason</th>
                      <th>Ward</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(d.rows ?? []).map((r: J) => (
                      <tr key={r.flag_id}>
                        <td>
                          <EvidenceLink id={r.work_order_id} />
                          <div className="m-sub">{r.contractor_name}</div>
                        </td>
                        <td>
                          <b>{r.display_label}</b>
                          <div className="m-sub">{String(r.flag_class ?? "").replace(/_/g, " ").toLowerCase()}</div>
                        </td>
                        <td>
                          <RatioBar billed={r.billed_cost_inr} expected={r.expected_cost_inr} />
                          <div className="m-sub">
                            {formatInr(r.billed_cost_inr)} vs {formatInr(r.expected_cost_inr)}
                          </div>
                        </td>
                        <td>
                          <BandPill band={r.variance_band} />
                        </td>
                        <td className="m-reason">{r.public_reason}</td>
                        <td>{r.ward_code}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {(d.rows ?? []).length < (d.total ?? 0) ? (
                <p>
                  <button type="button" className="m-btn" onClick={() => setLimit((l) => Math.min(3000, l + 200))}>
                    Show more rows
                  </button>
                </p>
              ) : null}
            </>
          )}
        </Q>
      </section>
    </div>
  );
}
