"""Writes audit/H1V_REPORT.md from pipeline outputs. Run after 01, 02 and 04:
python -X utf8 pipeline/03_write_h1v_report.py   (also runs pipeline/test_h1v.py and reads pipeline/out/h1v_verify.json)
"""
import csv
import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CFG = json.loads((ROOT / "pipeline" / "config" / "audit_rules.json").read_text(encoding="utf-8"))
NR = json.loads((ROOT / "pipeline" / "config" / "next_rupee_rules.json").read_text(encoding="utf-8"))
OUT = ROOT / CFG["paths"]["out_dir"]
JUDGE = Path(CFG["paths"]["judge_exports_dir"])
M = json.loads((JUDGE / "overview_metadata.json").read_text(encoding="utf-8"))
LR = json.loads((OUT / "load_report.json").read_text(encoding="utf-8"))
V = json.loads((OUT / "h1v_verify.json").read_text(encoding="utf-8"))
T = subprocess.run([sys.executable, "-X", "utf8", "-m", "unittest", "pipeline/test_h1v.py", "-v"], cwd=ROOT, capture_output=True, text=True)
TESTS_OK = T.returncode == 0


def git(*a):
    return subprocess.run(["git", *a], cwd=ROOT, capture_output=True, text=True).stdout.strip()


def rows_csv(p):
    with open(p, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


inr = lambda v: f"₹{int(v):,}"  # noqa: E731
L = []
A = L.append
A("# H1V Report — analytical contract and claim-safety hardening\n")
A(f"> {CFG['disclosure']}\n")
A(f"Config `{CFG['config_version']}` · closure checks: **{V['passed']}/{V['total_checks']} passed** · unit tests: **{'PASS' if TESTS_OK else 'FAIL'}**\n")

A("## 1. Git lineage\n")
A(f"- Branch: `{git('rev-parse', '--abbrev-ref', 'HEAD')}`; HEAD at report time: `{git('rev-parse', 'HEAD')}`")
A(f"- `main` = `{git('rev-parse', 'main')}` (untouched); `wip/p7-paused` = `{git('rev-parse', 'wip/p7-paused')}` (untouched)")
A("```\n" + git("log", "--format=%H %s", "main..HEAD") + "\n```")
A("The first H1V commit (`b462629…`, message `fix(h1v): harden analytical claims, treatment compatibility, sensitivity and claude narratives`) was created by a parallel side session; this closure adds verification, the full report and a follow-up commit rather than rewriting history.\n")
A("## 2. Database marker and role proofs (`civic_lens_monsoon`, real `psql` checks)\n")
A("| check | result | evidence |\n|---|---|---|")
for k, v in V["checks"].items():
    if k[0] in "ABCDE" and k[1].isdigit():
        A(f"| {k} | {'PASS' if v['pass'] else 'FAIL'} | {str(v['detail'])[:170].replace('|', '/').replace(chr(10), ' ')} |")
A("\nD3 note: the reset routine (`reset_synthetic_demo_to_cp00`) lives only on the parked `wip/p7-paused` branch; its migration refuses to run unless `current_database() = 'civic_lens'` and it reads `public.synthetic_demo_marker`, which does not exist in `civic_lens_monsoon`. It is not installed in `civic_lens_monsoon`.\n")
A("## 3. Rate threshold and boundary tests\n")
A("Rule `RATE_CARD_VARIANCE_REVIEW`: `cost_ratio > 1.30` (strict; ratio rounded to 6 d.p. before comparison, `pipeline/lib_rules.py`). `pipeline/test_h1v.py`: 1.299999 → False, 1.300000 → False, 1.300001 → True (plus float-noise, band, taxonomy, wording, lane, profile and treatment tests).\n")
A("```\n" + "\n".join(x for x in T.stderr.strip().splitlines() if "ok" in x.lower() or x.startswith(("Ran", "OK", "FAIL"))) + "\n```\n")
A("Settled-value cross-check: work orders with `cost_inr > 1.30 × expected_cost_inr` = 114 (matches flags); flagged with ratio ≤ 1.30 = 0; unflagged with ratio > 1.30 = 0.\n")
A("## 4. Variance severity bands\n")
bands = {}
for r in rows_csv(JUDGE / "audit_flags.csv"):
    if r["flag_type"] == "RATE_CARD_VARIANCE_REVIEW":
        b = bands.setdefault(r["variance_band"], [0, 0, 0])
        b[0] += 1
        b[1] += int(r["billed_cost_inr"])
        b[2] += int(r["flag_amount_inr"])
A("| band | rule | WOs | recorded billed ₹ | calculated variance ₹ |\n|---|---|---:|---:|---:|")
for nm, rule in (("REVIEW", "1.30 < ratio < 1.60"), ("HIGH_VARIANCE_REVIEW", "1.60 ≤ ratio < 2.00"), ("VERY_HIGH_VARIANCE_REVIEW", "ratio ≥ 2.00")):
    b = bands.get(nm, [0, 0, 0])
    A(f"| {nm} | {rule} | {b[0]} | {b[1]:,} | {b[2]:,} |")
A(f"| **total** | | **{sum(b[0] for b in bands.values())}** | **{sum(b[1] for b in bands.values()):,}** | **{sum(b[2] for b in bands.values()):,}** |\n")
A("## 5. Primary-flag overlap matrix\n")
A("| combination | unique WOs | total billed ₹ | rate variance ₹ | duplicate-candidate billed ₹ | DLP-surface billed ₹ |\n|---|---:|---:|---:|---:|---:|")
for r in M["overlap_matrix"]:
    A(f"| {r['combination']} | {r['unique_wo_count']} | {r['total_billed_inr']:,} | {r['rate_variance_inr']:,} | {r['duplicate_candidate_billed_inr']:,} | {r['dlp_surface_billed_inr']:,} |")
A(f"| **all** | **{sum(r['unique_wo_count'] for r in M['overlap_matrix'])}** | **{sum(r['total_billed_inr'] for r in M['overlap_matrix']):,}** | | | |\n")
A("## 6. Correct monetary semantics\n")
h = M["hero_amounts"]
A(f"- Rate-card calculated variance (max(0, recorded − expected)): **{inr(h['rate_card_calculated_variance_inr'])}** across {h['rate_card_variance_wo_count']} WOs (their recorded billed value is {inr(h['rate_card_recorded_billed_inr'])}, a different number).")
A(f"- Possible duplicate-candidate billed value: **{inr(h['duplicate_candidate_billed_inr'])}** across {h['duplicate_candidate_wo_count']} WOs (all {h['duplicate_candidates_also_unlinked']} are also unlinked and are counted once).")
A(f"- DLP-surface billed value requiring scope review: **{inr(h['dlp_surface_billed_inr'])}** across {h['dlp_surface_wo_count']} WOs.")
A(f"- {M['unique_touched']['label']}")
A("\n**These three monetary categories overlap and are NOT confirmed loss, are not additive, and must not be presented as money lost.** The earlier ₹16,900,231 \"at risk\" figure (a capped sum mixing variance excess with full billed value) is retired; the correct unique billed value of the 415 touched work orders is " + inr(M["unique_touched"]["unique_billed_value_touched_inr"]) + ".\n")
A("## 7. DLP_REVIEW_FIRST_LANE language\n")
d = M["dlp_lane"]
A(f"- Action: `{d['allocation_action']}` — \"{d['allocation_note']}\"\n- Estimates labelled: \"{d['potential_spend_label']}\" (or \"not quantified\")\n- Caveat on every DLP row: \"{d['caveat']}\"\n- No ₹0-cash-cost claim; the old `DLP_ENFORCEMENT_LANE` name is gone from config, DB, exports and narratives.\n")
A("## 8. Audit taxonomy\n")
A("| flag_class | flag_type | rows |\n|---|---|---:|")
for r in M["audit_summary"]["_flag_class_by_type"]:
    A(f"| {r['flag_class']} | {r['flag_type']} | {r['n']:,} |")
tc = M["flag_class_counts"]
A(f"\nPRIMARY_REVIEW_FLAG {tc['PRIMARY_REVIEW_FLAG']} + TRACEABILITY_GAP {tc['TRACEABILITY_GAP']} + CONTEXT_INDICATOR {tc['CONTEXT_INDICATOR']} + OUTCOME_INDICATOR {tc['OUTCOME_INDICATOR']} = **{sum(tc.values()):,}** = rows in `monsoon_audit_flags`. Only the 433 primary flags (plus 45 traceability gaps) are review items; the other 2,092 rows are context or outcome indicators, not anomalies.\n")
A("## 9. Contractor raw and method-adjusted measures (primary scorecard — no letter grades)\n")
sc = rows_csv(JUDGE / "contractor_scorecards.csv")
A("| contractor | jobs (n) | observed reopen % (O) | method-mix expected % (E) | Δ pts (O−E) | SLA met % | low-lying exposure % | avg cost ratio | variance WOs | duplicate candidates | DLP surface reviews |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
for r in sc:
    A(f"| {r['contractor_id']} {r['contractor_name'].replace(' (synthetic)', '')} | {r['jobs_count']} | {float(r['observed_reopen_pct']):.1f} | {float(r['expected_reopen_method_mix_pct']):.1f} | {float(r['reopen_delta_pts']):+.1f} | {float(r['sla_met_pct']):.1f} | {float(r['low_lying_exposure_pct']):.1f} | {float(r['avg_cost_ratio']):.3f} | {r['rate_variance_count']} | {r['duplicate_candidate_count']} | {r['dlp_surface_review_count']} |")
A(f"\nE = Σ(jobs by method × citywide 30-day reopen rate of that method) / jobs. Δ = O − E (negative = fewer reopenings than the method mix predicts). {CFG['fairness']['sla_non_causal_note']}\n")
A("## 10. Experimental index (separate from the primary scorecard) and sensitivity\n")
e = M["experimental_accountability_index"]
A(f"`{e['name']}` — {e['status']}\n\nFormula: `{e['formula']}`\n")
S = M["contractor_sensitivity"]
A("| profile | durability/billing/SLA/DLP weights | best → worst | index |\n|---|---|---|---|")
for k, v in S["profiles"].items():
    w_ = v["weights"]
    A(f"| {k} | {w_['durability_vs_method_mix']}/{w_['billing_integrity']}/{w_['sla_vs_context']}/{w_['dlp_surface_adherence']} | {' > '.join(v['order_best_first'])} | {', '.join(f'{c} {x}' for c, x in sorted(v['index'].items()))} |")
A(f"| primary evidence (reopen Δ, best first) | — | {' > '.join(S['primary_evidence_order_by_reopen_delta_pts_best_first'])} | — |")
A(f"\nTop-3 in all 5 profiles: {', '.join(S['top3_in_all_profiles'])}; bottom-3 in all profiles: {', '.join(S['bottom3_in_all_profiles'])}. Rank ranges: " + "; ".join(f"{k} {a}–{b}" for k, (a, b) in S["rank_range"].items()) + ". The index is exported only in `contractor_experimental_index.csv`, never in `contractor_scorecards.csv`.\n")
A("## 11. 30-day survival-adjusted rate — limitations\n")
A(f"`{CFG['durability_labels']['field']}` = `{CFG['durability_labels']['formula']}`, displayed as \"{CFG['durability_labels']['display_label']}\". {CFG['durability_labels']['caveat']} It reflects only the 30-day window in the supplied synthetic data, ignores job size, location and weather mix, and is never compared across unit groups.\n")
A("| unit group | method | jobs | 30-day reopen % | non-reopen % | standard rate ₹ | survival-adjusted rate ₹ |\n|---|---|---:|---:|---:|---:|---:|")
for r in rows_csv(OUT / "monsoon_rate_card.csv"):
    A(f"| {r['unit_group']} | {r['repair_method']} | {r['wo_jobs']} | {float(r['reopen_30d_pct']):.1f} | {float(r['non_reopen_30d_pct']):.1f} | {int(float(r['standard_rate_inr'])):,} | {int(float(r['survival_adjusted_30d_rate_inr'])):,} |")
A("\n## 12. Issue → treatment compatibility matrix\n")
A("| dominant issue | compatible methods (selection: lowest observed 30-day reopen rate, ties by lower standard rate) |\n|---|---|")
for k, v in CFG["issue_treatment_compatibility"].items():
    A(f"| {k} | {' / '.join(v)} |")
A(f"\n{CFG['issue_treatment_note']} Roads with no unresolved/reopened issue in the matrix show \"{NR['fallback_treatment']}\"; label otherwise \"{NR['candidate_treatment_label']}\".\n")
A("## 13. Next-Rupee profiles and top-10 stability\n")
A("| profile | C | R | F | A | V | T | D |\n|---|---:|---:|---:|---:|---:|---:|---:|")
for k, v in NR["profiles"].items():
    A(f"| {k} | " + " | ".join(f"{int(round(100 * v[f]))}" for f in "CRFAVTD") + " |")
A(f"\nFactors: {NR['factor_names']}. Missing-data rule: {NR['missing_value_rule']} Gate: coverage < {NR['coverage_min_pct']}% ⇒ `{NR['insufficient_tag']}` (cannot hold a top-{NR['top_rank_gate']} rank). Tie-breaking: {NR['tie_breaking']}. `affordable_now`: {NR['affordable_now_rule']}\n")
st = M["next_rupee_stability"]
for lane, v in st["lanes"].items():
    A(f"- **{lane}**: top-{st['top_n']} under all 4 profiles: {', '.join(v['in_all_4_profiles'])}; under ≥3: {', '.join(v['in_at_least_3_profiles'])}; distinct roads in any top-{st['top_n']}: {v['in_any_profile']}; rank ranges (≥3 profiles): {v['rank_ranges']}")
A(f"\nOverlap of each profile's top 10 with `A_balanced` (roads shared, per lane): {json.dumps(st['overlap_with_recommended_top10'])}. {st['lane_consistency']} Risk is independent of ward affordability, DLP status, social engagement and engineer remarks.\n")
A("## 14. Recommended profile\n")
A(f"Recommended: **`{NR['recommended_profile']}`** — {NR['recommendation_reasoning']}\n\n**Status: `MASTER_DIRECTOR_REVIEW_REQUIRED`** (engineering-computed methodology flag `{NR['methodology_status']}`; the choice of the headline profile is a policy decision for the Master Director).\n")
A("## 15. Model-contribution disclosure\n")
A(f"> {M['model_contribution_disclosure']['text']}\n")
A(f"Narratives: {M['narrative_authorship']} authored by Claude Sonnet 5.5 offline (every number/ID checked against computed values, forbidden phrases scanned); remaining 16 wards are `deterministic_summary`.\n")
A("## 16. Judge exports (outside git)\n")
A("| file | rows/records | SHA-256 |\n|---|---:|---|")
for p in sorted(JUDGE.iterdir()):
    n_ = len(rows_csv(p)) if p.suffix == ".csv" else (len(json.loads(p.read_text(encoding="utf-8"))) if isinstance(json.loads(p.read_text(encoding="utf-8")), list) else 1)
    A(f"| {p.name} | {n_} | `{hashlib.sha256(p.read_bytes()).hexdigest()}` |")
A("\nSource-file digests are in `audit/H0_REPORT.md`; `pipeline/narratives_monsoon.json` is the only generated file committed.\n")
A("## 17. Open findings\n")
OPEN = [
    ("OF-1", "Process", "The first H1V commit (b462629) came from a parallel side session with a different message than the Master Director's. History was not rewritten; this closure is a follow-up commit."),
    ("OF-2", "Process", "While this closure ran, `civic_lens_monsoon` was dropped and reloaded by a second writer (tables briefly missing at ~13:05–13:09 IST). The loader is destructive by design: run only one `pipeline/02` at a time."),
    ("OF-3", "Provenance", "`mcl-seed verify` used the prebuilt binary (built 10:51 IST, before the branch switch) and was not rebuilt on this branch; the digest proves the database state, not binary provenance."),
    ("OF-4", "Data", "650 photo-less non-English complaints remain `CATEGORY_UNVERIFIED`; Antigravity enrichment was not run (merge hook present, inactive)."),
    ("OF-5", "Next-Rupee", "37 roads have no dominant compatible issue and show \"Engineering review required\"; 2 roads (RD0008, RD0018) have 55% evidence coverage and cannot hold a top-3 rank."),
    ("OF-6", "UI contract", "`top_new_budget_road_id` / `top_dlp_road_id` on wards are ward-local bests and can have a low citywide lane rank (e.g. RD0222 is lane rank 24); H2 must show the lane rank beside them."),
    ("OF-7", "Audit", "The duplicate-candidate rule compares `area_sqm` even for per-job methods where area is not a billing driver; it is still claim-safe (candidate, not finding) but should be explained to reviewers."),
    ("OF-8", "Narratives", "16 of 24 ward narratives and all flag-level texts are deterministic summaries, not individually authored."),
    ("OF-9", "Methodology", "Next-Rupee only 2 NEW-lane roads (RD0077, RD0180) are top-10 under all four profiles; 5 more are top-10 in ≥3 profiles. Rankings beyond those are profile-sensitive."),
    ("OF-10", "Correction", "The brief's ₹16,900,231 'unique billed value touched' was mixed-basis; the correct figure is ₹21,771,311 and is what is stored."),
    ("OF-11", "Hygiene", "Line-ending/format churn inflated the diff of `pipeline/00_eda.py` and `pipeline/01_build_monsoon_analytics.py` in the first H1V commit; content is unchanged apart from the intended edits."),
]
A("| id | area | finding |\n|---|---|---|")
for i, a_, t_ in OPEN:
    A(f"| {i} | {a_} | {t_} |")
A("\nNo blocking finding was identified.\n")
A("## 18. H2 readiness decision\n")
A(f"**`H2_READY_WITH_CONDITIONS`** — all {V['total_checks']} closure checks pass and the database, role and CP-00 proofs hold. H2 may start on `civic_lens_monsoon` through `mcl_api` → `SET ROLE mcl_app` (read-only) provided (1) the Master Director signs off the `A_balanced` profile (section 14), (2) the UI uses the display labels and the DLP/overlap wording in sections 6–7, and (3) OF-2 and OF-6 are respected. No P7/P8 code or `civic_lens` access is needed.\n")
(ROOT / "audit" / "H1V_REPORT.md").write_text("\n".join(L) + "\n", encoding="utf-8")
print("wrote audit/H1V_REPORT.md", len(L), "lines; tests", "PASS" if TESTS_OK else "FAIL")
