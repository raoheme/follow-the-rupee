# Mumbai Civic Lens · Follow the Rupee: Hackathon submission (branch `hackathon/follow-the-rupee` only)

<!-- VIDEO_LINK_START -->
**Demo video (YouTube, unlisted):** https://youtu.be/ZRAC-8WIdjA
<!-- VIDEO_LINK_END -->

**Synthetic dataset disclosure.** This uses a synthetic challenge dataset. It is not official BMC data; contractors, amounts, dates, coordinates and transactions are fictional. Real Mumbai place names appear only for realism.
**Model contribution.** Claude was used during development for multilingual interpretation and reviewed plain-language explanations grounded in deterministic PostGIS calculations. All monetary calculations, audit rules and rankings are deterministic and reproducible. The live demo works offline and calls no model. Ward and contractor briefs carry an author badge: "Claude-authored brief (offline reviewed)" only where the stored row says so, otherwise "Deterministic summary".

## What it does
One evidence-to-action journey: **select a ward → risk-ranked road (ward rank and citywide lane rank) → work-order history and rate-card math → caveats → New Budget vs DLP Review First → CSV evidence.**
Rust/Axum + SQLx read-only API (`mcl_api → SET ROLE mcl_app`, read-only session, 5 s timeout) over PostGIS database `civic_lens_monsoon`; React + Leaflet UI. No analytical rule lives in Rust or TypeScript: every figure, label, caveat and narrative is read from the database loaded by the accepted H1V pipeline. No new crates or npm packages.

## Rubric proof (live figures)
| Criterion | Evidence |
|---|---|
| **Audit 25%** | **433 primary review findings across 415 unique work orders**, ₹2.18 Cr unique billed value touched. Three separate, non-additive figures: ₹60.66 lakh calculated rate-card variance (114 WOs: 10 Review · 40 High · 64 Very high), ₹25.91 lakh billed value of possible duplicate candidates (45, all also unlinked), ₹87.29 lakh DLP-surface billed value needing scope review (274). Permanent line: *Categories overlap and are not an estimate of confirmed loss.* Shields: 2,385 normal-variance jobs not flagged, 3 linked repeats context-only, 219 non-surface DLP-road jobs (₹1.75 Cr) context-only. Audit CSV = all 433 rows (parity-checked against the judge export). |
| **Fair accountability 20%** | 8 fictional contractors with raw n, observed reopen **O** vs method-mix expected **E** (Δ pts), SLA beside low-lying exposure with the non-causal note, average cost ratio, review counts. No letter grades; the experimental index sits only in a collapsed methodology section. |
| **Budget smarts 20%** | Next-Rupee Planner: New Budget Candidates (25 citywide) vs **DLP Review First** (15; `RD0220` is #1 in ward L and #1 in Mumbai, defer pending DLP scope review). Risk rank never changes with budget (budget 0 flips Affordable now only). Ward rank and citywide rank shown together; over-budget wards (E, R/C, L, M/W, A, R/S) stay rankable. Two split 30-day survival-adjusted rate tables (₹/sqm and ₹/job). |
| **Trail 15%** | Reusable Evidence Drawer and Trail Kundali: complaint (en/hi/hi-en/mr, photo description, GPS vs centroid provenance) → issue → work order and rate-card math → flags → road/DLP → contractor → 30-day outcome. Spotlights `WO25-00611`, `WO25-02486`, `WO25-01723`, `BMC25-004589`, `RD0220`. |
| **Usable + demo 20%** | One-command launch; 1440×900 and 390×844 walks with zero console errors and no horizontal overflow; map survives with the basemap blocked (24 ward polygons and 291 roads drawn from API geometry); distinct solid-GPS vs hollow-dashed centroid markers; unresolved coordinates counted, never pinned. |

Hero: 24 wards · 2,499 work orders · ₹13.43 Cr of ₹14.91 Cr spent · ₹3.07 Cr spend associated with repairs reopened within 30 days (not a loss figure) · 896 open backlog complaints.

## Launch (one command)
```powershell
.\scripts\start_hackathon_demo.ps1
```
Stage URLs: `http://localhost:5173/` and `http://127.0.0.1:8080/health/capabilities`. Stop: `.\scripts\stop_hackathon_demo.ps1` (leaves the database container up). Verify: `python -I tests/hackathon/verify_h3.py` (185 checks).

## 3-minute live demo script
1. **Map Triage (0:00)**: hero strip; disclosure strip; choose ward `F/S`: solid GPS dots vs dashed centroid rings; "Showing 183 of 183 issues"; click a ring: "coarse, not exact GPS".
2. **Repair Auditor (0:40)**: three review cards, 433 across 415, caveat line, shields; search `WO25-02486` → Evidence Drawer; **Download Audit CSV**.
3. **Scorecards (1:20)**: O vs E, SLA beside low-lying note, no grades.
4. **Next-Rupee Planner (1:50)**: New Budget vs **DLP Review First**; open `RD0220` evidence (#1/#1, defer pending DLP scope review); slide budget to 0: ranks unchanged.
5. **Trail Kundali (2:30)**: `BMC25-004589` (Hindi, ambulance-entry) → `WO25-00611`.

Judge exports: `evidence/judge_exports/` in this repository (audit_flags.csv/json, contractor_scorecards.csv, contractor_experimental_index.csv, next_rupee_plan.csv/json, ward_summary.csv).

## Open findings and limitations
- `CITIZEN_BOT_DEFERRED`: no Citizen Bot; the Kundali page has deterministic ID search instead.
- `OF-H2-CMD-ROLE`: on this branch the `civic_lens` command role carries paused-P7 grants that the committed P6 check rejects, so the API starts with **write operations disabled (503)** instead of refusing to start. `/health/ready` is unchanged and probes only the `civic_lens` read pool, so it is **not** sufficient for this demo; use `/health/capabilities` (`monsoonReads=AVAILABLE`, `commands=DISABLED`) plus `/v1/monsoon/overview`. Branch-only exception: do not merge to `main` without security review.
- `OF-H2-LEGACY-TESTS`: p3–p6 integration tests reset/reseed `civic_lens` and were not run.
- `OF-H2-NARRATIVE-UNITS`: stored narratives contain some compact "M" units; the UI converts them to lakh/Cr (unit-tested). Source text not regenerated.
- `OF-H2-MAP-OVERLAYS`: accident/flood map layers cut (served by the API; shown as road-drawer factors).
- `OF-H2-MOBILE-TOUCH`: map layer checkboxes and Leaflet controls are below 44 px on 390×844.
