# H2 report: Follow the Rupee decision interface

Branch `hackathon/follow-the-rupee`, parent `981f4e4` (H1V_PASS). Not a release approval; not pushed.

## Delivered
- **API** (`crates/api/src/monsoon.rs`, read-only second pool `mcl_api -> SET ROLE mcl_app`, `default_transaction_read_only=on`, `statement_timeout=5000`):
  `GET /v1/monsoon/overview`, `/wards`, `/ward-detail?ward=` (+ `/wards/{*code}` fallback), `/map-triage`, `/audit/flags` (+ CSV), `/contractors`, `/next-rupee` (+ CSV), `/kundali/{id}`, and `GET /health/capabilities`.
  All SQL is parameterised; ward/mode/class/band/format/sort are whitelisted; limits are clamped integers. No analytical rule is computed in Rust or TypeScript: ranks, amounts, labels, shields, narratives and disclosures are read from `civic_lens_monsoon`. The only derived presentation values are ward rank (`rank()` over the stored risk score) and the budget what-if `affordable_now`.
- **UI** (`apps/web/src/features/monsoon/`, `MonsoonApp.tsx`): Map Triage, Repair Auditor, Fair Contractor Scorecards + 24-ward money trail, Next-Rupee Planner, Trail Kundali with ID search, one reusable Evidence Drawer (opens from map, auditor, planner, kundali). Aliases `/page-01 -08 -03 -09 -02`; `/page-04` redirects to `/kundali`. No new Rust crates or npm packages.
- Old P3-P6 pages are unrouted (the legacy `App` is untouched); no mutation request is made by the new UI.

## Cut or deferred
Citizen Bot (`CITIZEN_BOT_DEFERRED`), JSON download endpoints/buttons, accident/flood map layers, per-record export in the drawer, Hindi/Marathi static labels beyond the persona/language switchers.

## Evidence
- Live endpoints verified 200 from `civic_lens_monsoon`; slash wards `F/S`, `K/W`, `R/C` via `?ward=`; audit CSV `text/csv; charset=utf-8`, `attachment; filename="mumbai_civic_lens_audit_flags.csv"`, 433 primary rows / 415 unique work orders with `limit=3000` (UI button sends `limit=3000`, so not capped at the 100-row table page).
- Next-Rupee: `RD0220` is `#1` in ward L and `#1` in Mumbai in the DLP Review First lane (affordable_now null, no ₹0 claim). Budget 0 flips all 25 New Budget roads to Affordable now: No with identical ranks and scores (API test and browser).
- Browser walk at 1440x900 and 390x844: all five routes load without error states or horizontal overflow; ward `F/S` shows "Showing 183 of 183 issues", ward `L` 304 of 304 (1 unresolved counted, not pinned); Evidence Drawer opened from the Auditor (`WO25-02486`, `WO25-00772`) and from the map flagged-work-order list; Kundali for `WO25-00611`, `BMC25-004589`, `RD0220`; unknown id shows a clean 404 message. The only console error is the intentional 404 resource load for the unknown id probe `WO25-99999`; no uncaught errors.

## OF-H2-CMD-ROLE (hackathon-branch-only exception)
The `civic_lens` command role carries grants from the paused P7 work, which the committed P6 identity check rejects. On this branch `main.rs` no longer refuses to start: it logs an error (no URL or credential) and starts with the command pool unattached, so every original write path answers 503 before any command transaction. `GET /health/capabilities` reports `commands: DISABLED`, `monsoonReads: AVAILABLE`; `/health/ready` is unchanged (`READY`, probes the civic_lens read pool). Do not merge this change to `main` without security review.

## Tests
- `cargo fmt --all --check`, `cargo check --workspace --locked`: pass.
- `crates/api/tests/h2_monsoon.rs` (8 live read-only tests incl. slash wards, CSV headers, rank invariance, no letter grades, 404 problem+json, read-only role, command-disabled 503) and lib unit tests: pass. Existing p3-p6 integration tests were not run (they reset and reseed `civic_lens`): `OF-H2-LEGACY-TESTS`.
- `pnpm --filter web build` exit 0; `pnpm --filter web test`: 16 files, 311 tests pass (includes `formatInr`, forbidden-wording and no-letter-grade scans, monsoon rendering). Only `map-list.test.ts` was adjusted.
- `mcl-seed verify`: baseline matches CP-00 (`967586...989c`); `civic_lens` untouched. `civic_lens_monsoon` was not reloaded.
