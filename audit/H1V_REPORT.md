# H1V Report — analytical contract and claim-safety hardening

> Synthetic challenge dataset. Not official BMC data. Contractors, amounts, dates, coordinates and transactions are fictional. Real Mumbai geographic names are used only for challenge realism.

Config `h1v.1` · closure checks: **51/51 passed** · unit tests: **PASS**

## 1. Git lineage

- Branch: `hackathon/follow-the-rupee`; HEAD at report time: `b46262963696f13107d9d6c94124ceeb6124349d`
- `main` = `e456b87dbd81d32e29ae5d0ec57e9190137aa607` (untouched); `wip/p7-paused` = `17c22717f0ac0b12a9451f37255bfd765145afb6` (untouched)
```
b46262963696f13107d9d6c94124ceeb6124349d fix(h1v): harden analytical claims, treatment compatibility, sensitivity and claude narratives
ea3e0facbf541ba969cdee6ec583c4ef3b806025 feat(h1): implement follow-the-rupee audit, method-mix fairness, next-rupee planner and postgis loader
3df41dc3d8c7d2f33157f2da6a961e8a2196c668 feat(h0): add deterministic follow-the-rupee forensic eda
```
The first H1V commit (`b462629…`, message `fix(h1v): harden analytical claims, treatment compatibility, sensitivity and claude narratives`) was created by a parallel side session; this closure adds verification, the full report and a follow-up commit rather than rewriting history.

## 2. Database marker and role proofs (`civic_lens_monsoon`, real `psql` checks)

| check | result | evidence |
|---|---|---|
| A1 current_database | PASS | civic_lens_monsoon |
| A2 hackathon_dataset_marker exactly once | PASS | Claude-Impact-Labs-data-2/true |
| A3 synthetic_demo_marker absent | PASS | no relation named synthetic_demo_marker in any schema |
| A4 15 expected tables | PASS | ['hackathon_dataset_marker', 'monsoon_accidents', 'monsoon_audit_flags', 'monsoon_complaints', 'monsoon_contractors', 'monsoon_facilities', 'monsoon_flood_hotspots', 'mon |
| B1 mcl_api direct SELECT denied | PASS | ERROR:  permission denied for table monsoon_wards |
| B2 mcl_api SET ROLE mcl_app SELECT all 15 | PASS | {'hackathon_dataset_marker': 1, 'monsoon_accidents': 420, 'monsoon_audit_flags': 2570, 'monsoon_complaints': 6501, 'monsoon_contractors': 8, 'monsoon_facilities': 160, 'm |
| B3 mcl_app (via mcl_api) cannot INSERT/UPDATE/DELETE/TRUNCATE or run DDL | PASS | {'insert into': True, 'update monsoon_wards': True, 'delete from': True, 'truncate monsoon_roads': True, 'create table': True, 'alter table': True, 'drop table': True, 'c |
| B4 mcl_api direct DDL denied | PASS | ERROR:  permission denied for schema public LINE 1: create table public.zz_ddl_p |
| B5 no probe objects created | PASS | 0 |
| C1 mcl_command no write on any monsoon table | PASS | {'SELECT': 0, 'INSERT': 0, 'UPDATE': 0, 'DELETE': 0, 'TRUNCATE': 0} |
| C2 mcl_api_write no effective write authority | PASS | {'SELECT': 0, 'INSERT': 0, 'UPDATE': 0, 'DELETE': 0, 'TRUNCATE': 0} |
| C3 role memberships reviewed | PASS | mcl_app->mcl_api(set=true,inherit=false); mcl_command->mcl_api_write(set=true,inherit=false) |
| C4 mcl_api cannot SET ROLE to a write role | PASS | no membership in mcl_command/mcl_api_write/mcl_reset |
| C5 mcl_command / mcl_api_write cannot CONNECT | PASS | CONNECT false |
| D1 reset routine absent in civic_lens_monsoon | PASS | no non-system function containing 'reset'; reset_synthetic_demo_to_cp00 not registered |
| D2 reset roles cannot connect/execute here | PASS | CONNECT false for mcl_reset and mcl_api_reset |
| D3 parked P7 routine is gated on synthetic_demo_marker / current database (static review of wip/p7-paused) | PASS | ["IF pg_catalog.current_database() <> 'civic_lens' THEN", "RAISE EXCEPTION 'reset refused: the connected database is not civic_lens' USING ERRCODE = '55000';", 'SELECT pg |
| D4 serving API reads APP_* URLs, not the owner DATABASE_URL (static review of main.rs at e456b87) | PASS | {'APP_DATABASE_URL referenced': True, 'plain DATABASE_URL read': False} |
| D5 no owner role in serving credentials | PASS | {'APP_DATABASE_URL': 'mcl_api', 'APP_WRITE_DATABASE_URL': 'mcl_api_write', 'APP_RESET_DATABASE_URL': 'mcl_api_reset'} |
| E1 civic_lens CP-00 digest | PASS | ['baselineDigest: 967586872548df061a9035ef72b44a93ac937ccf4dcea74b22d2f85cc562989c', 'expectedDigest: 967586872548df061a9035ef72b44a93ac937ccf4dcea74b22d2f85cc562989c', ' |

D3 note: the reset routine (`reset_synthetic_demo_to_cp00`) lives only on the parked `wip/p7-paused` branch; its migration refuses to run unless `current_database() = 'civic_lens'` and it reads `public.synthetic_demo_marker`, which does not exist in `civic_lens_monsoon`. It is not installed in `civic_lens_monsoon`.

## 3. Rate threshold and boundary tests

Rule `RATE_CARD_VARIANCE_REVIEW`: `cost_ratio > 1.30` (strict; ratio rounded to 6 d.p. before comparison, `pipeline/lib_rules.py`). `pipeline/test_h1v.py`: 1.299999 → False, 1.300000 → False, 1.300001 → True (plus float-noise, band, taxonomy, wording, lane, profile and treatment tests).

```
test_coverage_gate (pipeline.test_h1v.DlpAndNextRupee.test_coverage_gate) ... ok
test_dlp_lane_has_no_zero_cash_claim (pipeline.test_h1v.DlpAndNextRupee.test_dlp_lane_has_no_zero_cash_claim) ... ok
test_profiles_sum_to_one (pipeline.test_h1v.DlpAndNextRupee.test_profiles_sum_to_one) ... ok
test_treatment_matrix_and_pick (pipeline.test_h1v.DlpAndNextRupee.test_treatment_matrix_and_pick) ... ok
test_bands (pipeline.test_h1v.RateCardBoundary.test_bands) ... ok
test_exact_boundaries (pipeline.test_h1v.RateCardBoundary.test_exact_boundaries) ... ok
test_float_noise_on_boundary_is_not_flagged (pipeline.test_h1v.RateCardBoundary.test_float_noise_on_boundary_is_not_flagged) ... ok
test_threshold_locked (pipeline.test_h1v.RateCardBoundary.test_threshold_locked) ... ok
test_every_rule_has_exactly_one_class (pipeline.test_h1v.Taxonomy.test_every_rule_has_exactly_one_class) ... ok
test_no_accusatory_public_wording_in_config (pipeline.test_h1v.Taxonomy.test_no_accusatory_public_wording_in_config) ... ok
Ran 10 tests in 0.001s
OK
```

Settled-value cross-check: work orders with `cost_inr > 1.30 × expected_cost_inr` = 114 (matches flags); flagged with ratio ≤ 1.30 = 0; unflagged with ratio > 1.30 = 0.

## 4. Variance severity bands

| band | rule | WOs | recorded billed ₹ | calculated variance ₹ |
|---|---|---:|---:|---:|
| REVIEW | 1.30 < ratio < 1.60 | 10 | 698,221 | 239,321 |
| HIGH_VARIANCE_REVIEW | 1.60 ≤ ratio < 2.00 | 40 | 3,220,789 | 1,413,349 |
| VERY_HIGH_VARIANCE_REVIEW | ratio ≥ 2.00 | 64 | 7,446,404 | 4,413,644 |
| **total** | | **114** | **11,365,414** | **6,066,314** |

## 5. Primary-flag overlap matrix

| combination | unique WOs | total billed ₹ | rate variance ₹ | duplicate-candidate billed ₹ | DLP-surface billed ₹ |
|---|---:|---:|---:|---:|---:|
| DLP_SURFACE_REPAIR_REVIEW | 257 | 7,846,199 | 0 | 0 | 7,846,199 |
| RATE_CARD_VARIANCE_REVIEW | 100 | 10,521,714 | 5,650,634 | 0 | 0 |
| HIGH_CONFIDENCE_DUPLICATE_CANDIDATE + UNLINKED_WORK_ORDER | 40 | 2,489,329 | 0 | 2,489,329 | 0 |
| RATE_CARD_VARIANCE_REVIEW + DLP_SURFACE_REPAIR_REVIEW | 13 | 812,746 | 408,246 | 0 | 812,746 |
| HIGH_CONFIDENCE_DUPLICATE_CANDIDATE + UNLINKED_WORK_ORDER + DLP_SURFACE_REPAIR_REVIEW | 4 | 70,369 | 0 | 70,369 | 70,369 |
| RATE_CARD_VARIANCE_REVIEW + HIGH_CONFIDENCE_DUPLICATE_CANDIDATE + UNLINKED_WORK_ORDER | 1 | 30,954 | 7,434 | 30,954 | 0 |
| **all** | **415** | **21,771,311** | | | |

## 6. Correct monetary semantics

- Rate-card calculated variance (max(0, recorded − expected)): **₹6,066,314** across 114 WOs (their recorded billed value is ₹11,365,414, a different number).
- Possible duplicate-candidate billed value: **₹2,590,652** across 45 WOs (all 45 are also unlinked and are counted once).
- DLP-surface billed value requiring scope review: **₹8,729,314** across 274 WOs.
- 415 unique work orders touched by primary review flags (₹21,771,311 unique billed value touched; categories overlap and are not an estimate of confirmed loss)

**These three monetary categories overlap and are NOT confirmed loss, are not additive, and must not be presented as money lost.** The earlier ₹16,900,231 "at risk" figure (a capped sum mixing variance excess with full billed value) is retired; the correct unique billed value of the 415 touched work orders is ₹21,771,311.

## 7. DLP_REVIEW_FIRST_LANE language

- Action: `DEFER_PENDING_DLP_SCOPE_REVIEW` — "New municipal repair allocation: defer pending DLP scope review."
- Estimates labelled: "Potential new spend avoided if contractual coverage is confirmed" (or "not quantified")
- Caveat on every DLP row: "DLP status is temporal/contextual evidence and does not prove contractual applicability or liability."
- No ₹0-cash-cost claim; the old `DLP_ENFORCEMENT_LANE` name is gone from config, DB, exports and narratives.

## 8. Audit taxonomy

| flag_class | flag_type | rows |
|---|---|---:|
| CONTEXT_INDICATOR | DLP_CONTEXT_ONLY | 219 |
| CONTEXT_INDICATOR | REPEATED_WORK_REVIEW | 3 |
| OUTCOME_INDICATOR | REOPENED_WITHIN_30D | 611 |
| OUTCOME_INDICATOR | SLA_MISSED | 1,259 |
| PRIMARY_REVIEW_FLAG | DLP_SURFACE_REPAIR_REVIEW | 274 |
| PRIMARY_REVIEW_FLAG | HIGH_CONFIDENCE_DUPLICATE_CANDIDATE | 45 |
| PRIMARY_REVIEW_FLAG | RATE_CARD_VARIANCE_REVIEW | 114 |
| TRACEABILITY_GAP | UNLINKED_WORK_ORDER | 45 |

PRIMARY_REVIEW_FLAG 433 + TRACEABILITY_GAP 45 + CONTEXT_INDICATOR 222 + OUTCOME_INDICATOR 1870 = **2,570** = rows in `monsoon_audit_flags`. Only the 433 primary flags (plus 45 traceability gaps) are review items; the other 2,092 rows are context or outcome indicators, not anomalies.

## 9. Contractor raw and method-adjusted measures (primary scorecard — no letter grades)

| contractor | jobs (n) | observed reopen % (O) | method-mix expected % (E) | Δ pts (O−E) | SLA met % | low-lying exposure % | avg cost ratio | variance WOs | duplicate candidates | DLP surface reviews |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| CT01 Sahyadri Infra Works | 337 | 13.6 | 24.6 | -10.9 | 62.3 | 37.1 | 1.059 | 3 | 8 | 41 |
| CT02 Konkan Roadcon Pvt Ltd | 337 | 26.7 | 24.1 | +2.6 | 46.0 | 36.5 | 1.062 | 5 | 4 | 32 |
| CT03 Mahalaxmi Civil Contractors | 303 | 37.6 | 24.7 | +12.9 | 39.3 | 34.3 | 1.193 | 44 | 10 | 33 |
| CT04 Western Coast Asphalt Co | 299 | 38.8 | 24.6 | +14.2 | 47.2 | 32.8 | 1.071 | 5 | 3 | 22 |
| CT05 Deccan Paving Solutions | 287 | 9.1 | 23.8 | -14.7 | 59.6 | 36.6 | 1.043 | 4 | 5 | 28 |
| CT06 Shivneri Construction | 289 | 26.3 | 24.3 | +2.0 | 47.1 | 39.4 | 1.055 | 5 | 8 | 29 |
| CT07 Arabian Sea Engineering | 328 | 32.3 | 24.7 | +7.6 | 43.6 | 34.1 | 1.159 | 38 | 3 | 42 |
| CT08 Mithi Infra Projects | 319 | 11.6 | 24.8 | -13.2 | 51.7 | 42.0 | 1.083 | 10 | 4 | 47 |

E = Σ(jobs by method × citywide 30-day reopen rate of that method) / jobs. Δ = O − E (negative = fewer reopenings than the method mix predicts). SLA performance is shown alongside low-lying ward exposure. The dataset does not establish causation.

## 10. Experimental index (separate from the primary scorecard) and sensitivity

`experimental_accountability_index` — EXPERIMENTAL - supporting view only; no letter grades; the primary evidence metrics above are what the UI leads with.

Formula: `0.35*durability + 0.30*billing_integrity + 0.20*sla_vs_context + 0.15*dlp_adherence; durability = clip(75 - 2.5*delta_pts, 0, 100); billing = clip(100 - 4*flagged_share_pct, 0, 100); sla = clip(75 + 2*sla_vs_benchmark_pts, 0, 100); dlp = clip(100 - 3*dlp_surface_review_share_pct, 0, 100)`

| profile | durability/billing/SLA/DLP weights | best → worst | index |
|---|---|---|---|
| Primary | 0.35/0.3/0.2/0.15 | CT05 > CT01 > CT08 > CT02 > CT06 > CT04 > CT07 > CT03 | CT01 90.6, CT02 75.1, CT03 44.3, CT04 66.0, CT05 90.8, CT06 74.1, CT07 56.3, CT08 84.3 |
| Reopen-Dominant | 0.55/0.15/0.15/0.15 | CT05 > CT01 > CT08 > CT06 > CT02 > CT04 > CT07 > CT03 | CT01 92.6, CT02 72.0, CT03 45.9, CT04 57.1, CT05 93.0, CT06 72.1, CT07 56.9, CT08 87.9 |
| SLA-Dominant | 0.15/0.15/0.55/0.15 | CT01 > CT05 > CT08 > CT06 > CT02 > CT04 > CT07 > CT03 | CT01 92.6, CT02 71.8, CT03 50.2, CT04 68.7, CT05 91.0, CT06 72.4, CT07 59.3, CT08 80.3 |
| Billing-Dominant | 0.15/0.55/0.15/0.15 | CT05 > CT01 > CT08 > CT02 > CT06 > CT04 > CT07 > CT03 | CT01 87.3, CT02 80.3, CT03 40.3, CT04 77.0, CT05 88.0, CT06 77.5, CT07 54.5, CT08 80.9 |
| Equal-Balanced | 0.25/0.25/0.25/0.25 | CT05 > CT01 > CT08 > CT02 > CT06 > CT04 > CT07 > CT03 | CT01 87.6, CT02 74.3, CT03 48.0, CT04 68.8, CT05 88.3, CT06 73.5, CT07 57.4, CT08 79.8 |
| primary evidence (reopen Δ, best first) | — | CT05 > CT08 > CT01 > CT06 > CT02 > CT07 > CT03 > CT04 | — |

Top-3 in all 5 profiles: CT01, CT05, CT08; bottom-3 in all profiles: CT03, CT04, CT07. Rank ranges: CT01 1–2; CT02 4–5; CT03 8–8; CT04 6–6; CT05 1–2; CT06 4–5; CT07 7–7; CT08 3–3. The index is exported only in `contractor_experimental_index.csv`, never in `contractor_scorecards.csv`.

## 11. 30-day survival-adjusted rate — limitations

`survival_adjusted_30d_rate_inr` = `standard_rate_inr / (non_reopen_30d_pct / 100)`, displayed as "30-day survival-adjusted standard rate (illustrative)". Not a cost per durable repair and not a long-term durability claim; incompatible unit groups are never ranked together. It reflects only the 30-day window in the supplied synthetic data, ignores job size, location and weather mix, and is never compared across unit groups.

| unit group | method | jobs | 30-day reopen % | non-reopen % | standard rate ₹ | survival-adjusted rate ₹ |
|---|---|---:|---:|---:|---:|---:|
| PER_JOB_INTERVENTION | Manhole cover replaced + grating | 202 | 17.3 | 82.7 | 45,000 | 54,431 |
| PER_JOB_INTERVENTION | Dewatering pump deployed | 200 | 14.0 | 86.0 | 60,000 | 69,767 |
| PER_JOB_INTERVENTION | Desilting and garbage removal | 232 | 22.4 | 77.6 | 70,000 | 90,222 |
| PER_JOB_INTERVENTION | Drain desilting | 221 | 26.2 | 73.8 | 90,000 | 122,025 |
| PER_JOB_INTERVENTION | Pump + debris removal | 198 | 22.2 | 77.8 | 110,000 | 141,429 |
| PER_JOB_INTERVENTION | Excavation, pipeline repair, PQC patch | 96 | 21.9 | 78.1 | 180,000 | 230,400 |
| PER_SQM_SURFACE | Cold mix patch | 602 | 32.2 | 67.8 | 1,800 | 2,656 |
| PER_SQM_SURFACE | Hot mix patch | 318 | 22.6 | 77.4 | 2,600 | 3,361 |
| PER_SQM_SURFACE | Paver blocks relaid | 132 | 22.7 | 77.3 | 3,000 | 3,882 |
| PER_SQM_SURFACE | Mastic asphalt | 298 | 25.8 | 74.2 | 4,200 | 5,663 |

## 12. Issue → treatment compatibility matrix

| dominant issue | compatible methods (selection: lowest observed 30-day reopen rate, ties by lower standard rate) |
|---|---|
| Pothole | Hot mix patch / Mastic asphalt / Cold mix patch |
| Broken paver blocks | Paver blocks relaid |
| Road cave-in | Excavation, pipeline repair, PQC patch |
| Waterlogging | Drain desilting / Pump + debris removal / Dewatering pump deployed |
| Choked drain / nullah overflow | Desilting and garbage removal |
| Open or broken manhole | Manhole cover replaced + grating |

Derived strictly from the dataset: each work_type is paired in work_orders.csv only with the listed repair_methods (1:1 family). Selection = lowest observed 30-day reopen rate among compatible methods, ties by lower standard rate. Roads with no unresolved/reopened issue in the matrix show "Engineering review required"; label otherwise "Candidate treatment for engineering review".

## 13. Next-Rupee profiles and top-10 stability

| profile | C | R | F | A | V | T | D |
|---|---:|---:|---:|---:|---:|---:|---:|
| A_balanced | 20 | 20 | 15 | 15 | 15 | 10 | 5 |
| B_backlog_durability | 30 | 30 | 10 | 10 | 10 | 5 | 5 |
| C_safety_facility | 10 | 10 | 10 | 30 | 30 | 5 | 5 |
| D_flood_traffic | 10 | 10 | 30 | 15 | 10 | 20 | 5 |

Factors: {'C': 'Unresolved complaint burden', 'R': 'Reopened repair burden', 'F': 'Flood-hotspot exposure', 'A': 'Accident severity', 'V': 'Vulnerable-facility access', 'T': 'Traffic and two-wheeler exposure', 'D': 'Durability opportunity'}. Missing-data rule: Missing factors are not zero-filled: risk = sum(w_f x norm_f) / sum(w_f) over observed factors; evidence_coverage_pct = 100 x sum(observed weights). Gate: coverage < 70% ⇒ `INSUFFICIENT_EVIDENCE_FOR_TOP_RANK` (cannot hold a top-3 rank). Tie-breaking: risk_score descending, then road_id ascending. `affordable_now`: Independent of risk rank: ward monsoon budget minus recorded ward spend >= candidate treatment estimate (rate card x assumed area). Evaluated only in NEW_BUDGET_CANDIDATE_LANE.

- **DLP_REVIEW_FIRST_LANE**: top-10 under all 4 profiles: RD0076, RD0101, RD0107, RD0176, RD0211, RD0220, RD0243; under ≥3: RD0076, RD0083, RD0101, RD0107, RD0176, RD0211, RD0220, RD0235, RD0243; distinct roads in any top-10: 13; rank ranges (≥3 profiles): {'RD0076': [2, 5], 'RD0083': [3, 12], 'RD0101': [2, 9], 'RD0107': [5, 10], 'RD0176': [3, 8], 'RD0211': [2, 9], 'RD0220': [1, 1], 'RD0235': [6, 11], 'RD0243': [4, 10]}
- **NEW_BUDGET_CANDIDATE_LANE**: top-10 under all 4 profiles: RD0077, RD0180; under ≥3: RD0055, RD0057, RD0058, RD0077, RD0173, RD0175, RD0180; distinct roads in any top-10: 21; rank ranges (≥3 profiles): {'RD0055': [7, 12], 'RD0057': [1, 12], 'RD0058': [2, 11], 'RD0077': [1, 5], 'RD0173': [3, 19], 'RD0175': [4, 17], 'RD0180': [2, 6]}

Overlap of each profile's top 10 with `A_balanced` (roads shared, per lane): {"A_balanced": {"DLP_REVIEW_FIRST_LANE": 10, "NEW_BUDGET_CANDIDATE_LANE": 10}, "B_backlog_durability": {"DLP_REVIEW_FIRST_LANE": 9, "NEW_BUDGET_CANDIDATE_LANE": 5}, "C_safety_facility": {"DLP_REVIEW_FIRST_LANE": 8, "NEW_BUDGET_CANDIDATE_LANE": 6}, "D_flood_traffic": {"DLP_REVIEW_FIRST_LANE": 9, "NEW_BUDGET_CANDIDATE_LANE": 8}}. Lane is fixed by roads.under_dlp (a road never changes lane between profiles). Risk is independent of ward affordability, DLP status, social engagement and engineer remarks.

## 14. Recommended profile

Recommended: **`A_balanced`** — A_balanced keeps every factor visible and weights the two evidence-of-failure factors (open complaints, reopened repairs) equally with the two harm factors, so no single data source can dominate; the other three profiles are used only to prove stability.

**Status: `MASTER_DIRECTOR_REVIEW_REQUIRED`** (engineering-computed methodology flag `VALIDATED_SENSITIVITY_CHECKED`; the choice of the headline profile is a policy decision for the Master Director).

## 15. Model-contribution disclosure

> Claude was used during development for multilingual interpretation and reviewed plain-language explanations grounded in deterministic PostGIS calculations. All monetary calculations, audit rules and rankings are deterministic and reproducible. The live demo works offline.

Narratives: {'contractors': 8, 'wards': 8, 'cases': 4, 'roads': 5} authored by Claude Sonnet 5.5 offline (every number/ID checked against computed values, forbidden phrases scanned); remaining 16 wards are `deterministic_summary`.

## 16. Judge exports (outside git)

| file | rows/records | SHA-256 |
|---|---:|---|
| audit_flags.csv | 2570 | `d374469f71bb49dad9be16485dfd2f443fe310ac3e82fae2307108a77fa6629d` |
| audit_flags.json | 2570 | `1b062d2b3f8a7ee6236ef840b535ad00273975e54b40febded91632047a12545` |
| contractor_experimental_index.csv | 8 | `b7d87d33708594cdbe70c6253e08bdc33084320aa40dc3649eea9b8303816f94` |
| contractor_scorecards.csv | 8 | `bd156554b5644b0ac7d5fe365e73019f4b380fc3a17f5ff4730b31530d3d6fd5` |
| next_rupee_plan.csv | 291 | `b9f95fb50efb1b2418118b2abaf41987d60398240b499ed7dcb79345b57a53bd` |
| next_rupee_plan.json | 291 | `9aafb9e8709d4786936beda6db985fc83325e38318396b399aeaf3581a9a9ed1` |
| overview_metadata.json | 1 | `a868cf7547065dbfcb6d85d96a79093833cb101a7717562ca9c777105e59bb59` |
| ward_summary.csv | 24 | `2915a2a08822535f0e100be7326472ae2b7b8165e3073839758c7c70ce66742f` |

Source-file digests are in `audit/H0_REPORT.md`; `pipeline/narratives_monsoon.json` is the only generated file committed.

## 17. Open findings

| id | area | finding |
|---|---|---|
| OF-1 | Process | The first H1V commit (b462629) came from a parallel side session with a different message than the Master Director's. History was not rewritten; this closure is a follow-up commit. |
| OF-2 | Process | While this closure ran, `civic_lens_monsoon` was dropped and reloaded by a second writer (tables briefly missing at ~13:05–13:09 IST). The loader is destructive by design: run only one `pipeline/02` at a time. |
| OF-3 | Provenance | `mcl-seed verify` used the prebuilt binary (built 10:51 IST, before the branch switch) and was not rebuilt on this branch; the digest proves the database state, not binary provenance. |
| OF-4 | Data | 650 photo-less non-English complaints remain `CATEGORY_UNVERIFIED`; Antigravity enrichment was not run (merge hook present, inactive). |
| OF-5 | Next-Rupee | 37 roads have no dominant compatible issue and show "Engineering review required"; 2 roads (RD0008, RD0018) have 55% evidence coverage and cannot hold a top-3 rank. |
| OF-6 | UI contract | `top_new_budget_road_id` / `top_dlp_road_id` on wards are ward-local bests and can have a low citywide lane rank (e.g. RD0222 is lane rank 24); H2 must show the lane rank beside them. |
| OF-7 | Audit | The duplicate-candidate rule compares `area_sqm` even for per-job methods where area is not a billing driver; it is still claim-safe (candidate, not finding) but should be explained to reviewers. |
| OF-8 | Narratives | 16 of 24 ward narratives and all flag-level texts are deterministic summaries, not individually authored. |
| OF-9 | Methodology | Next-Rupee only 2 NEW-lane roads (RD0077, RD0180) are top-10 under all four profiles; 5 more are top-10 in ≥3 profiles. Rankings beyond those are profile-sensitive. |
| OF-10 | Correction | The brief's ₹16,900,231 'unique billed value touched' was mixed-basis; the correct figure is ₹21,771,311 and is what is stored. |
| OF-11 | Hygiene | Line-ending/format churn inflated the diff of `pipeline/00_eda.py` and `pipeline/01_build_monsoon_analytics.py` in the first H1V commit; content is unchanged apart from the intended edits. |

No blocking finding was identified.

## 18. H2 readiness decision

**`H2_READY_WITH_CONDITIONS`** — all 51 closure checks pass and the database, role and CP-00 proofs hold. H2 may start on `civic_lens_monsoon` through `mcl_api` → `SET ROLE mcl_app` (read-only) provided (1) the Master Director signs off the `A_balanced` profile (section 14), (2) the UI uses the display labels and the DLP/overlap wording in sections 6–7, and (3) OF-2 and OF-6 are respected. No P7/P8 code or `civic_lens` access is needed.

