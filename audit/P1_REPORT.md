# P1 report: strict contracts, migrations, synthetic seed and guarded reset (v1.2.3)

Date: 2026-11-20 (IST). Operator: Claude Sonnet 5.5, High effort. Opus not invoked. This is implementation evidence, not release approval: P-13 and P-14 remain OPEN.

## Rulings applied (Master Director delta)
- Operations preserved: 23 operations on 22 paths, `(method, path, operationId)` identical to CAP-0 commit 96a9c22.
- Concurrency: `recordVersion` is the only authority; `ETag` is derived as `"{recordVersion}"`; stale writes return 409 (the 412 response was removed). `If-Match` stays on `resolveJurisdiction` only because the package validator requires it and must equal the quoted `recordVersion`.
- Identifiers: HEAD ids unchanged, no alias fields; gap budget is `SYN-DEMO-BUD-002` (recorded RESOLVED in `audit/CONTRADICTIONS.json`).
- Money is integer paise only (no persisted display text); DLP status is derived, never stored; `mcl_app` role has no UPDATE, DELETE or TRUNCATE on the lifecycle log; the reset bypass setting was removed; reset is guarded and uses one non-CASCADE TRUNCATE.

## Real database proof (civic_lens, PostgreSQL 17.5, PostGIS 3.5.2, Podman rootless)
| Check | Command / query | Result |
|---|---|---|
| Migrations from clean | `mcl-seed migrate` (exit 0); `select version, success from _sqlx_migrations` | versions 1, 2, 3 all `t` |
| Tables | information_schema count (base tables excluding `spatial_ref_sys`) | 19 (16 domain + idempotency_records + synthetic_demo_marker + _sqlx_migrations) |
| Seed counts | `mcl-seed reset` (exit 0) | wards 3, departments 5, assets 4, contractors 1, budgets 2, tenders 2, contracts 1, work_orders 1, dlp_status 1, issues 6, jurisdictions 6, evidence 3, completion_claims 1, verifications 1, corrections 2, lifecycle_events 27 |
| Primary Kundali | join issue to budget | SYN-DEMO-KND-001 > SYN-DEMO-AST-ROAD-001 > SYN-DEMO-WO-001 > SYN-DEMO-CON-001 > SYN-DEMO-TND-001 > SYN-DEMO-BUD-001 |
| Money chain | same join | budget 250000000 paise (25 lakh rupees); work order 180000000 paise (18 lakh rupees) |
| Traceability gap | SYN-DEMO-BUD-002 | last proven link TENDER; missing next link STREET_LEVEL_GEOMETRY; 1 tender, 0 contracts, no work order, no asset |
| DLP | `dlp_status_at('SYN-DEMO-WO-001', timestamptz '2026-11-20T00:00:00Z')` | ACTIVE (explicit instant; no wall clock) |
| Evidence stages | evidence by issue | KND-001 BEFORE and CLAIMED_AFTER; KND-004 DISPUTED_OR_RECURRING |
| Events | KND-001 ordered; `lifecycle_chain_is_valid` | 9 events in sequence; 7 of 7 entity chains valid |
| Spatial, SRID 32643 | `ST_Distance(ST_Transform(a.geometry,32643), ST_Transform(b.geometry,32643))` for KND-001 and KND-002 | 9.513 m; `spatial_ref_sys` has SRID 32643 |
| J2 against configured radius | integration test reads `config/duplicate-policy.json` POTHOLE radius | measured 9.513 m is within the configured 20 m; KND-004 measures 77.128 m (outside) |
| Reset and reseed | `mcl-seed reset` twice; `mcl-seed verify` | digest `967586872548df061a9035ef72b44a93ac937ccf4dcea74b22d2f85cc562989c` both times; matches `reset-manifest.json` |

## Test evidence
| Command | Exit | Result |
|---|---|---|
| `cargo fmt --all --check` | 0 | clean |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | 0 | clean (no pre-existing warnings either) |
| `cargo test --workspace --locked` | 0 | domain 10 passed; infrastructure unit 3 passed; PostGIS integration 10 passed (scratch databases `mcl_p1_*`, dropped after each test) |
| `cargo check --workspace --locked` | 0 | finished |
| `python -B -m unittest discover -s tests/p1 -v` (venv with `tests/p1/requirements.txt`) | 0 | 25 passed: OpenAPI 3.1 semantic validation, 23/22 operations preserved, strict schema acceptance and rejection, seed integrity, hash chains, PII and claim scan |
| `python scripts/validate_package.py` | 0 | PACKAGE VALID |
| `python scripts/validate_package.py --release` | 1 | EXPECTED_FAIL: only the six placeholder journey specs; release readiness is not claimed |

Rust integration tests cover: clean migration and re-run; no reset-bypass function; guarded reset refusal (wrong database, marker naming another database, missing marker, non-owner role, demo policy on a scratch database); `mcl_app` UPDATE, DELETE and TRUNCATE denied with SQLSTATE 42501 while the trigger still stops the owner (55000); owner reset succeeds; derived DLP agrees between SQL and Rust at five instants; invalid enum, state, money, jurisdiction and chain inputs rejected.

## Known limits
- Rust API handlers, UI, persona switcher, duplicate scoring and SVG fixtures are later phases; evidence media is a fixture reference only (`fixtures/evidence/*.svg` are not created in P1).
- The six Playwright journey specs are unchanged placeholders.
- Host workarounds from CAP0-F08 still apply; the database host in `DATABASE_URL` is `127.0.0.1`.
- A database named `civic_lens_p1_trial_superseded` holds an earlier trial of these migrations; it was renamed, not deleted.
