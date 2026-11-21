# P5 report: citizen reporting and deterministic duplicate review (Journey 2)

Date: 2026-11-21 (IST). Operator: Claude Sonnet 5.5, High effort throughout. Opus and Haiku not invoked, no Extra effort, nothing pushed. This is implementation evidence, not release approval: **P-13 and P-14 remain OPEN**, as do CAP0-F05, CAP0-F08, CAP0-F09, GEO-F01, P2-F01..P2-F05, P3-F01..P3-F07 and P4-F01..P4-F04. CON-P4-001 stays resolved. P6 to P8 and GEO-01 were not started.

## 1. Gates before any edit

| Gate | Result |
|---|---|
| `git status`, `git diff --exit-code HEAD -- CLAUDE.md`, `git diff`, `git rev-parse HEAD`, ancestry, `git log`, `git diff --stat` | clean tree; `CLAUDE.md` equals HEAD; HEAD is exactly `e222aa89ea7a9ed696465cfe06aa5a03b3d94dc1`; no unexpected controlling-file change was seen at any point of P5 |
| `podman ps` | `mumbai-civic-lens_db_1` (PostGIS 17-3.5) Up, `(healthy)`, 5432 published |
| `podman compose --env-file .env.local ps` | failed with the known CAP0-F08 named-pipe error (`npipe:////./pipe/podman-machine-default` absent); healthy database proven by `podman ps` and by the API and `mcl-seed` connecting; no environment change was needed |
| `python scripts/validate_package.py` | `PACKAGE VALID` |
| `pnpm install --frozen-lockfile`, `pnpm --filter web build`, `cargo check --workspace --locked` | exit 0 |
| `mcl-seed verify` | `baseline matches CP-00`, digest `967586872548df061a9035ef72b44a93ac937ccf4dcea74b22d2f85cc562989c` |

## 2. Authoritative scope and operations

Read in the stated order (CLAUDE.md, GUARDRAILS, DECISIONS, REQUIREMENTS, SPEC, ARCHITECTURE, plan, TASKS, TESTING, WIREFRAME, `wireframes/pages.json`, `openapi/openapi.yaml`, `config/duplicate-policy.json`, the state machines, P1 to P4 reports, findings, contradictions and the P1/P3/P4 code). `audit/CONTRADICTIONS.json` was not changed: no genuine authority conflict was found.

| Operation | Method and path | Verified in the contract | Implemented |
|---|---|---|---|
| `submitIssue` | `POST /v1/issues` | `SubmitIssueCommand`, `CivicIssueResult`, required `X-Correlation-Id` and `Idempotency-Key`, 200/400/409/422, ETag `"{recordVersion}"`; ISSUE machine `DRAFT_LOCAL -> SUBMITTED_UNVERIFIED` allows `citizen` and `authority`, idempotency REQUIRED, `RECORD_VERSION_REQUIRED` | yes |
| `checkDuplicates` | `POST /v1/issues/{id}/duplicate-candidates` | `CheckDuplicatesCommand`, `DuplicateCandidatesResult`, 200/400/404/409/422, no ETag | yes |
| `addEvidence` | `POST /v1/issues/{id}/evidence` | `AddEvidenceCommand` (carries `duplicateChoice`), `EvidenceResult`, ETag, 200/400/404/409/422; the master guide assigns `/evidence` to P5 | yes |

`If-Match` is not declared on any of the three, so it is not required, accepted in CORS or sent. 23 operations on 22 paths and every operationId are unchanged (pinned by `p3_api.rs`, re-asserted in `p5_api.rs` and the web drift test). No operation was added, removed, renamed or broadened.

Journey 2 order, from the committed contract: PAGE-04 `submitIssue` -> PAGE-05 `checkDuplicates` on the new issue id -> a choice recorded with `addEvidence` (`ENDORSE_EXISTING` and `ADD_EVIDENCE_TO_EXISTING` target the chosen earlier issue, `CREATE_SEPARATE_ISSUE` targets the new issue) -> PAGE-06. Because `checkDuplicates` needs an existing id, the report is stored before the review (finding **P5-F01**): after Endorse or Add evidence the citizen's own report stays a separate unverified record, and PAGE-06 says exactly that. No 24th operation was needed, so `P5_BLOCKED_CONTRACT` does not apply.

## 3. Database roles, privileges and transactions

* **Read pool** unchanged: `mcl_api -> SET ROLE mcl_app`, `default_transaction_read_only = on`; used by every GET.
* **Command pool** (new, separate): `mcl_api_write` (LOGIN, NOINHERIT, NOSUPERUSER/CREATEDB/CREATEROLE/REPLICATION/BYPASSRLS, `CONNECTION LIMIT 6`) may `SET ROLE mcl_command` only; `mcl_command` is NOLOGIN, owns nothing, member of nothing. Pool of 3, `statement_timeout` 5 s.
* **Provisioning**: `mcl-seed provision-command-roles` (owner-only, idempotent, run twice, same result). It reads `APP_WRITE_DATABASE_URL` from the ignored `.env.local`, requires host local, database `civic_lens`, the `synthetic_demo_marker` row and a secret of at least 16 characters that is not the placeholder, applies the password through a session setting and `format(%L)`, and ends by logging in as the new identity to prove it. No migration was added (0001 to 0003 untouched, the P1 pin holds).
* **Grants** (restated from scratch on each run): `USAGE` on schema `public`; `SELECT` on `assets, departments, evidence, idempotency_records, issues, jurisdictions, lifecycle_events, wards`; `INSERT` on `evidence, idempotency_records, issues, jurisdictions, lifecycle_events`. Nothing else: no UPDATE, DELETE, TRUNCATE, TRIGGER or REFERENCES anywhere, no CREATE, no sequence, no ownership. SELECT on `lifecycle_events` is required because the existing chain-guard trigger reads it as the invoker.
* **Startup proof**: `mcl-api` refuses to start unless `command_identity()` shows exactly `mcl_api_write` / `mcl_command`, no privileged attribute, no schema CREATE, no owned relation, insertable tables equal to the five above, no destructive privilege on any table, login memberships exactly `[mcl_command]`, no effective memberships. The log records only host, port, database, role names and table names; the URL is never printed (a grep of the run log for `password`, `postgresql://` and `APP_WRITE` found nothing).
* **Axum holds no owner credential**: `main.rs` and `lib.rs` read only `APP_DATABASE_URL` and `APP_WRITE_DATABASE_URL`; a test asserts the API sources never name `DATABASE_URL`, `POSTGRES_PASSWORD` or the reset functions.
* **Transactions**: each mutation begins an explicit transaction and re-proves `current_user = mcl_command` and not read-only; takes a per-key advisory lock; validates before writing; appends its lifecycle events (hash computed by the existing SQL function, verified by the existing trigger, serialised per entity) and the idempotency record in the same transaction.
* **Idempotency** (the table holds only key, operation and a hash): stored key = SHA-256 of `operationId|persona|Idempotency-Key`; stored hash = SHA-256 request fingerprint (`operationId|path id|canonical body`); created ids are derived from the scoped key, so an exact replay re-reads the committed record and writes nothing, and the same key with another fingerprint is 409 (finding **P5-F06**).
* **recordVersion** is the only version authority: new report requires 1; `checkDuplicates` and `addEvidence` require the target issue's current version; stale is 409; ETag is `"{recordVersion}"` on `submitIssue` and `addEvidence` (and the existing GETs).

Privilege and transaction tests (`crates/api/tests/p5_api.rs`, all against the real database): read pool read-only and unable to insert (SQLSTATE 25006); command identity least-privilege and different from the read identity; every forbidden statement fails with 42501: unapproved INSERT targets (including `corrections`, `synthetic_demo_marker`, `_sqlx_migrations`), arbitrary UPDATE/DELETE/TRUNCATE, `lifecycle_events` and `corrections` UPDATE/DELETE/TRUNCATE, CREATE TABLE, DROP TABLE, ALTER TABLE, CREATE ROLE, ALTER ROLE, GRANT, CREATE SCHEMA, `SET ROLE` to `mcl_app`, `mcl_api`, `civic`, `postgres`, `pg_write_all_data`; the guarded reset fails as this identity and the digest is unchanged; a forged lifecycle row fails the chain guard (23514). Atomicity: with the next event id pre-occupied, the report and its jurisdiction roll back together (409, zero rows, no idempotency record), and the evidence insert rolls back with a failed event. Six concurrent requests with one key produce one issue, one idempotency record and exactly two events.

## 4. Deterministic duplicate policy

* `crates/application/src/dedup.rs` embeds `config/duplicate-policy.json` with `include_str!`, parses and validates it at startup (label equals the contract constant, weights total 100, contiguous bands, three choices, silent rejection forbidden). No weight, radius, window or threshold appears in Rust code, SQL or TypeScript; a unit test changes the policy values and the result follows.
* Policy as committed: label `DEMONSTRATION_HEURISTIC_V1` (file version 1.2.3); weights 40/20/20/10/10 for `sameAssetOrSegment`, `sameCategory`, `withinConfiguredRadius`, `withinConfiguredWindow`, `keywordOverlap`; bands 80-100 likely same, 55-79 possible, 0-54 probably distinct; POTHOLE radius 20 m and window 720 h (with `considerCarriagewaySide`), WATERLOGGING 150 m and 12 h.
* Semantics (documented, each from the policy file or its stated absence): asset points when the subject and candidate share a non-null asset; category points on equal category; radius points when the PostGIS geography distance is at or below the category radius; window points when the hours between the two `reportedAt` instants are at or below the category window; keyword points are `floor(weight * matched / submitted)` over lower-case alphanumeric tokens; categories with no committed radius or window earn none of those two (P5-F03); a `VERIFIED_COMPLETE` candidate sets `possibleRecurrence` and is never merged. Order is score descending then issue id ascending. No wall clock is read: the window uses stored timestamps.
* Candidate generation is one PostGIS query: earlier reports (strictly before the subject by `(reportedAt, id)`, never the subject) within `ST_DWithin(geometry::geography, subject::geography, radius)` or on the same asset, ordered by distance then id, `LIMIT 50`; the existing GiST geography index serves it. SRID 4326 geometry cast to geography (the accepted P1/P3 convention).
* The seeded candidate: `ST_Distance` between `SYN-DEMO-KND-001` and `SYN-DEMO-KND-002` is 9.513 m (asserted to within 0.01 m) against the 20 m POTHOLE radius; `SYN-DEMO-KND-004` is outside the radius and matches only by asset.
* Oracle test: for subject `KND-002` with keywords `pothole, paliram, junction` the expected set, factors, scores and bands are computed in the test from the policy JSON and the seed JSON (not from the server); the server matches, `KND-005` and `KND-006` are excluded, the subject is excluded, a repeat under a second key is identical, and the exact replay writes no event. The live script repeats this with an independent haversine oracle for a brand-new report: `KND-002` 96, `KND-001` 86, `KND-004` 75.
* The contract returns no distance and no policy version (P4-F04); PAGE-05 shows the label and the API's own factor points.

## 5. PAGE-04, PAGE-05 and PAGE-06

Files: `apps/web/src/features/report/` (`model`, `form`, `evidence`, `queries`, `flow`, `present`, `shared`, `ReportPage`, `DuplicatePage`, `ReceiptPage`, `report.test.tsx`), `i18n/resources.p5.ts` (English complete; Hindi and Marathi fall back to English), P5 CSS appended to `styles.css`. No new dependency.

* **PAGE-04**: native keyboard form (Enter in a field submits); category, title (160), description (400, live counter), landmark (160), asset (from the live map features), longitude/latitude (GeoJSON order, Greater Mumbai bounds) plus a one-click demonstration location; validation summary (`role="alert"`, focus moved to it, links to fields) and inline errors with icon and text; submit disabled while in flight; a retry of identical text reuses its Idempotency-Key, an edit gets a new one; always-present compact practice notice and the instruction not to enter names, phone numbers, email addresses, home addresses, government identifiers, vehicle registration numbers, or faces or descriptions of identifiable people; no personal-data input exists (asserted). No map, geocoding, GEO-01 asset or basemap dependency. Advisory note and disabled submit for a persona the committed machine does not allow (server enforces it too).
* **PAGE-05**: identifier, category, status badge and caveat from the public issue list; band as glyph plus words (`≈ Likely the same`, `~ Possible match`, `≠ Probably distinct`); the API's score as "N out of 100"; a five-row factor table with the API's points; recurrence note; the policy label; a plain statement that the score is not a probability, AI confidence, fraud or risk rating or legal conclusion and that nothing is merged or silently rejected. All three contract choices are offered (Endorse and Add per candidate, Keep separate once); each opens a short synthetic-note form that creates a fixture reference `fixtures/evidence/SYN-DEMO-EVD-CITIZEN-<12 hex>.svg` and the SHA-256 of that string (no file, camera, EXIF, GPS or upload; stated on the page). Loading, empty, error-with-Retry and persona-blocked states. A test renders an API score that disagrees with the factor sum and the page shows the API's score; source files hold no policy constants and never sum a breakdown.
* **PAGE-06**: built from the committed responses (reference id, UTC time, status badge, next workflow state, decision text, target issue, evidence id and state, support correlation ids, links to PAGE-02, PAGE-01 and PAGE-04). States are separate and worded: Submitted, Unverified, Linked as a potential duplicate or Kept as a separate report or No duplicate decision, Verified or resolved: Not reached. "Not an official BMC submission or acknowledgement" is explicit. No success, acceptance or resolution claim exists (asserted).
* **Direct navigation and refresh**: `?issueId=` (PAGE-05), `?issueId=&targetId=&evidenceId=` (PAGE-06); every identifier is validated before any request and never echoed; nothing sensitive enters the URL or browser storage. The in-memory hand-off is lost on refresh, so PAGE-05 re-reads the report through `getKundali` and re-runs the idempotent check (same result), and PAGE-06 is rebuilt from the Kundalis of both issues and says "Recovered from the server", omitting what only the original response held and never inventing a decision (P5-F06).

## 6. Live Journey 2 and database evidence

Host-native API (`127.0.0.1:8080`, pid 30140) and Vite (5173, pid 27656) from this session; startup logged both identities verified (read: `mcl_api`/`mcl_app` read-only; command: `mcl_api_write`/`mcl_command` insert-only on the five tables).

Browser run (CP-00 baseline, persona Citizen): empty submit -> validation summary focused, zero requests; filled form -> **Enter** submitted -> PAGE-05 listed `SYN-DEMO-KND-002` 96 (likely same), `SYN-DEMO-KND-001` 86 (likely same), `SYN-DEMO-KND-004` 75 (possible match) for the new report `SYN-DEMO-KND-R03D86361` -> "Add my evidence to this report" on `KND-002` -> note -> PAGE-06 receipt (submitted, unverified, decision recorded against `KND-002`, evidence `SYN-DEMO-EVD-RE411808F` quarantined and not verified, two correlation ids). Reloading PAGE-06 and PAGE-05 gave the honest recovery states; after a reload the persona lens resets to Public (P2-F03), PAGE-05 then asks for Citizen instead of sending a refused request, and the check ran as soon as Citizen was chosen.

Bounded SQL afterwards: `current_database() = civic_lens`, marker present; the new `issues` row (`SUBMITTED_UNVERIFIED`, version 1, POTHOLE, ward K/West, asset ROAD-001); its `jurisdictions` row (`SPATIALLY_INFERRED_PROVISIONAL`, `ST_COVERS`, `legal_ownership_asserted = false`); its chain `ISSUE_SUBMITTED_UNVERIFIED` (citizen) -> `JURISDICTION_SPATIALLY_INFERRED_PROVISIONAL` (system) -> `DUPLICATE_CHECK_EVALUATED` (five, one per distinct key); `KND-002` gained `DUPLICATE_EVIDENCE_ADDED_TO_EXISTING`; `lifecycle_chain_is_valid` true for every touched entity; the `evidence` row `UPLOADED_QUARANTINE`, `NOT_VERIFIED`, `LOCATION_UNVERIFIED`, `CITIZEN_FIXTURE`; idempotency rows by operation: submitIssue 1, checkDuplicates 5, addEvidence 1.

Viewports 390x844, 768x1024 and 1440x900 on PAGE-04, PAGE-05 (three candidates) and PAGE-06: `scrollWidth = clientWidth` at each (no horizontal overflow), no element wider than the viewport, no interactive target under 44 px. No essential action needs the basemap.

`python -B tests/p5/verify_live.py` (real API, real database): **30 of 30 checks pass**: strict JSON Schema validation of every 200 body against `CivicIssueResult`, `DuplicateCandidatesResult`, `EvidenceResult`, `KundaliResult` and of every error against `Problem`; ETags; replay and key-conflict behaviour; the independent oracle; 400, 404, 409 and 422 cases; sanitized correlation id; absence of reset, authority and PUT operations. It then ran the guarded `mcl-seed reset` and `mcl-seed verify`: the accepted digest `9675868725...2989c` returned and the six committed issues were back.

## 7. Tests, builds and package validation

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | up to date |
| `cargo fmt --all --check` | clean |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | clean |
| `cargo test --workspace --locked` | 102 passed, 0 failed (65 before P5); new: 16 in `p5_api.rs`, 16 in `mcl-application` (scoring and request validation), 5 in `command.rs` |
| `cargo check --workspace --locked` | exit 0 |
| `pnpm --filter web test` | 228 passed (190 before; 38 new in `report.test.tsx`; the shell test now treats PAGE-04 to PAGE-06 as live pages) |
| `pnpm --filter web build` | exit 0 |
| `python -B tests/p5/verify_live.py` | 30 of 30 |
| `mcl-seed verify` | baseline matches CP-00 |
| P1 Python tests (`tests/p1`, outside-repo venv with `openapi-spec-validator`) | 25 OK |
| `python scripts/validate_package.py` | `PACKAGE VALID` after manifest registration (section 9) |

The six Playwright journey specs are still placeholders, so release validation does not pass and is not claimed (P-13 OPEN). P5 browser checks were manual, not Playwright or axe.

## 8. Edits to accepted artifacts

* `crates/api/tests/p3_api.rs`, two assertions only, as the addendum allowed: the preflight now expects `GET,POST` and the extra `idempotency-key` header (no wildcard, no `If-Match`), and the "POST /v1/issues is 405" probe now uses `PUT`, because `POST /v1/issues` is the confirmed `submitIssue`. The other P3/P4 tests are unchanged and pass.
* `crates/api/src/lib.rs` (routes, CORS, handlers, state), `main.rs` (second pool and its startup proof), `crates/infrastructure/src/read.rs` (three helpers made `pub(crate)`), `bin/mcl_seed.rs` and `lib.rs` (new subcommand and module), `crates/application/src/lib.rs`, `.env.example` (placeholder only), `apps/web/src/App.tsx`, `components/shell.test.tsx`, `features/map-list/model.ts` (optional `recordVersion` on the issue summary), `i18n/resources.ts`, `styles.css`.
* Not touched: `compose.yaml`, migrations 0001 to 0003, P1 seeds and schemas, the CP-00 specification, `scripts/validate_package.py`, the six Playwright files, `traceability/*`, the external inputs under `C:\Projects\Mumbai Civic Lens\external-inputs` (no GEO-01 work).

## 9. Process hygiene and secrets

The API and Vite started by this session were stopped (`taskkill` of their pids); ports 8080 and 5173 are free; no `mcl-api` process remains; only the database container runs. `.env.local` is git-ignored and untracked, holds the generated write secret (never printed or committed); `.env.example` carries a clearly fake placeholder. Scratch files lived outside the repository and were removed.

## 10. Findings and next state

New, all OPEN (`audit/OPEN_FINDINGS.json`): **P5-F01** (report stored before the review; no link operation), **P5-F02** (decision rides `addEvidence`; J2 traceability lists no evidence operation), **P5-F03** (policy gaps: carriageway side, drain and facility categories), **P5-F04** (no distance or policy version in the contract), **P5-F05** (Point-only form, no map pick), **P5-F06** (derived identifiers; re-run check on refresh adds an audit event), **P5-F07** (undiagnosed intermittent DB test connection failures), **P5-F08** (undocumented 503; manual browser evidence only).
