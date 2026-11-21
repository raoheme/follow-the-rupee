# P6 report: authority command, jurisdiction resolution and DLP work linkage (Journeys 3 and 4)

Date: 2026-11-21 (IST). Operator: Claude Sonnet 5.5, High effort throughout. Opus and Haiku not invoked, no Extra effort, nothing pushed. This is implementation evidence, not release approval: **P-13 and P-14 remain OPEN**, as do CAP0-F05, CAP0-F08, CAP0-F09, GEO-F01, P2-F01..P2-F05, P3-F01..P3-F07, P4-F01..P4-F04 and P5-F01..P5-F08. CON-P4-001 stays resolved. P7, P8 and GEO-01 were not started.

## 1. Gates before any edit

| Gate | Result |
|---|---|
| `git status`, `git diff --exit-code HEAD -- CLAUDE.md`, `git diff`, `git rev-parse HEAD`, ancestry, `git log`, `git diff --stat` | clean tree; `CLAUDE.md` equals HEAD; HEAD is exactly `7b1b641cea9a723c44eb67a2431fd703e168d7ab`; the ancestry check passed and there are no intervening commits. `CLAUDE.md` was re-checked after the work and still equals HEAD. |
| `podman ps` | `mumbai-civic-lens_db_1` (PostGIS 17-3.5) Up, `(healthy)`, 5432 published |
| `podman compose --env-file .env.local ps` | failed with the known CAP0-F08 named-pipe error; the healthy database was proven by `podman ps` and by the API and `mcl-seed` connecting; no environment change was needed |
| `python scripts/validate_package.py` | `PACKAGE VALID` |
| `pnpm install --frozen-lockfile`, `pnpm --filter web build`, `CARGO_REGISTRIES_CRATES_IO_PROTOCOL=git cargo check --workspace --locked` | exit 0 |
| `mcl-seed verify` (`cargo run -p mcl-infrastructure --bin mcl-seed -- verify`) | `baseline matches CP-00`, digest `967586872548df061a9035ef72b44a93ac937ccf4dcea74b22d2f85cc562989c` |

## 2. Authoritative scope and operations

**Where the scope comes from.** `TASKS.md` (gates) assigns P6 "authority/jurisdiction/DLP" and P7 "verification/correction/audit/reset". `SPEC.md` names the journeys (J3 unlinked defect, potential active DLP, work link; J4 provisional cross-department or external jurisdiction) and the pages (08 Authority, 09 Jurisdiction/Work, 10 Completion/DLP). `P01-P12_IMPLEMENTATION_PLAN.md` does not define P6 beyond P-01..P-14, so the controlling files above and `openapi/openapi.yaml`, `config/jurisdiction-state-machine.json`, `wireframes/pages.json` and `traceability/journeys.json` decided it. The non-controlling reference guide (section 13) agrees (PAGE-08, PAGE-09, PAGE-10 DLP and safe disclaimer) and names a different commit message; the prompt's own fallback message was used.

**Operations (the only new ones; the contract is unchanged: 23 operations, 22 paths, same operationIds, pinned by `crates/api/tests/p6_api.rs` and the live verifier).**

| operationId | method and path | pool and identity | headers | concurrency and idempotency | emitted event |
|---|---|---|---|---|---|
| `getAuthorityDashboard` | `GET /v1/authority/dashboard` | read pool, `mcl_api` -> `mcl_app`, read-only | `X-Demo-Persona: authority` | REPEATABLE READ snapshot, one evaluation instant | none |
| `listDlpExceptions` | `GET /v1/authority/dlp-exceptions` | read pool | `X-Demo-Persona: authority` | same | none |
| `resolveJurisdiction` | `POST /v1/authority/issues/{id}/jurisdiction` | command pool, `mcl_api_write` -> `mcl_command` | persona, `Idempotency-Key`, `X-Correlation-Id`, `If-Match` (quoted version) | body `recordVersion` of the **jurisdiction** record is the authority; `If-Match` must equal it (400 if absent or malformed, 409 if it differs); response ETag `"{recordVersion}"` | `JURISDICTION_CONFIRMED_BMC_WARD`, `JURISDICTION_EXTERNAL_AGENCY_ASSIGNED` or `JURISDICTION_HANDOFF_LOGGED` (from the committed machine) |
| `linkWork` | `POST /v1/authority/issues/{id}/work-link` | command pool | persona, `Idempotency-Key`, `X-Correlation-Id` (no `If-Match`: the contract declares none) | body `recordVersion` of the **issue**; ETag from it | `ISSUE_WORK_LINKED` (P6-F03: no committed name exists) |

Actor roles: `authority` only (the machine's `allowedRoles`). Persona gate per the contract's own responses: a missing or unrecognised `X-Demo-Persona` is **401**; any other recognised persona is **403** (a simulated workflow rule, never authentication). Not in P6: `claimCompletion`, `verifyResolution`, corrections, `getAuditTimeline`, `getIssue` and `resetDemo` stay absent (tested 404/405).

**Request and response bodies** are the contract's: `ResolveJurisdictionCommand` (`targetStatus` in `CONFIRMED_BMC_WARD | EXTERNAL_AGENCY_ASSIGNED | HANDOFF_LOGGED`, nullable `externalAgencyLabel`, `rationale`), `LinkWorkCommand`, `AuthorityDashboardResult`, `DlpExceptionListResult`, `JurisdictionResult`, `CivicIssueResult`. All 200 bodies and every error were validated strictly against the OpenAPI component schemas by `tests/p6/verify_live.py`.

**Tables touched.** Reads: `issues`, `jurisdictions`, `work_orders`, `dlp_status`, `budgets`. Writes (command pool): `jurisdictions` (UPDATE of six columns), `issues` (UPDATE of three columns), `lifecycle_events` (INSERT), `idempotency_records` (INSERT).

## 3. Database role, privilege and transaction evidence

**Identities stay separate.** Reads use the read pool only (`SET ROLE mcl_app`, `default_transaction_read_only = on`; an UPDATE through it fails `25006`, tested). Commands use the command pool only (`mcl_api_write` -> `SET ROLE mcl_command`). The API sources still never reference the owner credential (P5 test, still green). Startup verifies both identities and refuses to start on any excess.

**The grant extension and why it was necessary.** P5's `mcl_command` was insert-only. The two P6 commands change one jurisdiction row and one issue row, which requires UPDATE. The smallest repository-approved mechanism (`mcl-seed provision-command-roles`, idempotent, owner-side, guarded to the marked `civic_lens`; migrations 0001 to 0003 were not edited and no migration was added) now also grants, at **column level**:

- `UPDATE (status, external_agency_label, confirmation_basis, confidence_note, record_version, updated_at) ON jurisdictions`
- `UPDATE (work_order_id, record_version, updated_at) ON issues`
- `SELECT ON work_orders` (the asset check for linkage)

`spatial_match_method`, `distance_to_boundary_meters`, `candidate_ward_id`, `source_conflict_note`, `legal_ownership_asserted`, `established_at`, `issue_id` and every other issue column are not updatable, so the inferred spatial facts and the recorded conflict cannot be rewritten by this identity. This is the same column-level pattern 0003 already uses for `corrections`. The identity check now also compares the live catalogue (`has_column_privilege`) to the committed column list, so an extra or missing column fails startup (`command_identity` unit tests and `the_command_identity_holds_exactly_the_committed_column_level_updates`).

**Tests that prove the boundary (`crates/api/tests/p6_api.rs`, real database).** Positive: the exact permitted UPDATEs succeed in a rolled-back transaction. Negative, all `42501`: every other column of the two tables; UPDATE on `lifecycle_events`, `corrections`, `evidence`, `work_orders`, `dlp_status`, `idempotency_records`, `wards`; DELETE and TRUNCATE on `issues`, `jurisdictions`, `lifecycle_events`, `corrections`; INSERT on `work_orders` and `corrections`; DDL (`CREATE`, `DROP`, `ALTER ... DISABLE TRIGGER`), role administration, `GRANT mcl_app`, `SET ROLE` to `mcl_app`, `mcl_api`, `civic`, `postgres`; the guarded reset fails as this identity. A self-`GRANT` by the non-owner is a PostgreSQL no-op and the identity re-check afterwards is unchanged. Lifecycle history stays non-mutable at the trigger level too (owner UPDATE fails `55000`). The database digest is unchanged after the whole refusal matrix.

**Every mutation** runs in one explicit transaction that re-proves `current_user = mcl_command` and not read-only, takes the idempotency-key advisory lock, then a record advisory lock (`record:<id>`), validates, UPDATEs with `WHERE id = $1 AND record_version = $2` (zero rows updated is a 409), appends the hash-linked lifecycle event (the existing chain trigger re-verifies it) and records the key. `recordVersion` is the sole concurrency authority; the ETag is derived from it.

- Atomicity: with the next event id pre-occupied, both commands return 409 and the domain UPDATE is rolled back (issue still version 1 unlinked; jurisdiction still `CONFLICT_DISPUTED` version 1 with its seeded label; no idempotency record).
- Stale versions: 409 consistently (body version, `If-Match` mismatch, and a stale retry on a new key).
- Replay: the same key and body returns the committed record and writes nothing; the same key with a different body is 409; keys are scoped by operation and persona. Six concurrent identical `linkWork` requests produce one event and one record version. Five concurrent different-key `resolveJurisdiction` requests on one version produce exactly one 200 and four 409, one event, and no key left behind by the losers.
- P5 design-debt rule 4 is respected: P6 derives **no** identifier from an idempotency key. Event ids come from the entity's chain sequence.

## 4. Jurisdiction and work-linkage evidence

**Jurisdiction (J4, `KND-003`).** The committed machine is embedded and validated at startup (`crates/domain/src/jurisdiction.rs`); a drift test pins the frontend's offered steps to the same JSON. Legal commandable steps: provisional or disputed to a confirmed ward or an external agency; external agency to a logged handoff. Everything else is refused with 409: provisional to handoff, any step out of `CONFIRMED_BMC_WARD` or `HANDOFF_LOGGED`, and a repeat. `CONFLICT_DISPUTED` and the first spatial inference are not commandable through this contract (`targetStatus` offers three values), so they return 400.

Live walk (`tests/p6/verify_live.py`, then repeated through the UI): `CONFLICT_DISPUTED` v1 -> `EXTERNAL_AGENCY_ASSIGNED` v2 -> `HANDOFF_LOGGED` v3. Each step wrote one event named by the machine (`JURISDICTION_EXTERNAL_AGENCY_ASSIGNED`, `JURISDICTION_HANDOFF_LOGGED`) whose text states the previous and new state, the "not a legal determination" caveat and the bounded rationale; the seven earlier events are byte-for-byte unchanged and the chain verifies; the issue itself (status, version 1) is untouched; spatial method, distance 553.5 m, candidate ward and the source-conflict note stay as recorded; `legalOwnershipAsserted` stays `false`. Confirming a ward requires a confirmation basis (the rationale) and clears any candidate agency label, which is preserved in the audit text ("Candidate agency label withdrawn"). Reads, listings and map proximity never change a provisional jurisdiction (tested). No OSM or proximity inference decides ownership anywhere in the code.

**Work linkage (J3, `KND-004` -> `WO-001`).** Accepted only for an open, unlinked issue whose asset equals the work order's asset; refused with 409 (stale, already linked: a link is never replaced, not open) or 422 (unknown work order, different asset, accusatory or unbounded rationale). On success the issue gains `workOrderId` at version 2 (ETag `"2"`), one `ISSUE_WORK_LINKED` event is appended (text: "a relationship only: not a finding of liability, contractual applicability or any cost outcome"), the three earlier events are unchanged, the chain verifies, and the issue **status is unchanged** (linking is not a state transition). The case where no work order is on the asset (`KND-003`, drain asset against the road work order) is refused.

## 5. DLP evaluation and claim-safety evidence

- DLP status is never stored or competing: no table gains a DLP status column (tested against `information_schema`); it is derived with the existing explicit-instant `dlp_status_at(work, instant)`.
- One evaluation instant per request (`state.clock`, injected in tests, wall clock live). `dlp_membership_follows_the_injected_instant_with_an_inclusive_end` pins the boundaries: 2026-03-31T23:59:59Z NOT_STARTED (0 exceptions), 2026-11-21T04:30:00Z ACTIVE (2), 2027-03-31T18:29:59Z last active second (2), 2027-03-31T18:30:00Z EXPIRED (0).
- A DLP exception is an unlinked open issue, reported inside the window, on the same asset as a certified work order with an active DLP at that instant. It is labelled a temporal match: `potentialSpendLabel` is always `SYNTHETIC_POTENTIAL_NOT_REALIZED_SAVINGS`; the warranty note says "pending contractual verification"; no response, event or page text says zero cost, liability, realized saving or contractor fault (scanned in the tests and in the i18n bundle).
- Seeds give two exceptions, `KND-002` and `KND-004`, both on `AST-ROAD-001`; after the link, `KND-004` leaves the queue and its Kundali shows the linked work with a derived ACTIVE DLP view.
- The live verifier checks the dashboard and the exception list against an independent oracle over `data/demo/*.json` using the server's own reported instant.

## 6. Authority page and live journey evidence

**Pages (reusing the accepted shell, disclosure, persona lens, i18n fallback, tiles/cards and responsive system; no new dependency, no map, no animation).** `apps/web/src/features/authority/`:

- **PAGE-08 Authority Command** (`AuthorityPage`): two requests in total (dashboard plus the public issue list for titles; none per row). Four summary tiles, each with an icon, count, text label and an explicit "Needs a decision" or "For information" tag (border style, not colour, separates them). Decisions: jurisdiction not confirmed; potential active DLP exceptions. Information: closure claims awaiting verification (explicitly "silence never verifies"); budget traceability gaps (links to PAGE-03).
- **PAGE-09 Jurisdiction/Work Link** (`JurisdictionWorkPage`): `?issueId=` validated locally before any request; one public read (`getKundali`) for issue, jurisdiction record, linked work and audit tail. Shows the department, workflow post and escalation post (no person), the jurisdiction state as text plus a glyph with its caveats behind native disclosures, the resolve form offering only the machine-legal steps, the work-link form (candidate from the DLP queue fills a field and links nothing), and the audit tail. Final states say so and offer nothing. Stale 409 offers "Reload record".
- **PAGE-10 Completion/DLP** (`DlpPage`): the DLP exception view with the derived status tag, window, synthetic estimate (integer paise through the shared formatter) and claim-safe wording; the completion-claim half is an honest not-in-this-phase notice (P6-F10).

Every state is truthful: loading, empty ("Nothing in this queue" / "No exceptions at this time"), partial (missing titles), error (the shared honest error vocabulary with correlation id) and a persona gate for every persona except Authority, for which **no authority request is made** (tested with a fetch spy). Jurisdiction and DLP states are text plus distinct glyphs, never colour alone. Targets are at least 44x44 via the shared CSS; radios have programmatic names and descriptions; forms use a labelled error summary that takes focus.

**Live journeys.**

- `tests/p6/verify_live.py` against the running Axum API and real `civic_lens`: **76 checks, 0 failed**: the 401/403 matrix on all four operations, dashboard and DLP oracle equality, the full J3 and J4 walks, replay, every refusal path, scope absence of unapproved operations, 23/22 contract inventory, then guarded reset and the accepted digest.
- Built-in browser (manual, not Playwright): as the Authority persona, PAGE-08 at 1440x900 and 390x844, J4 first step through the UI on PAGE-09 at 1440x900 (disputed -> external agency, "Recorded", audit entry #8 shown), J3 through the UI at 390x844 (validation summary, candidate button, link, linked view with the claim-safe DLP wording, audit entry #4), PAGE-09 at 768x1024 and PAGE-10 at desktop. No console errors. Honest limits: P6-F09. During the UI walk the first-attempt link confirmation was lost when the form unmounted after the refreshed record showed the link; it was fixed (the card now keeps the confirmation) and checked only by type-check and the unchanged render tests, not re-run in the browser.
- CP-00 was restored after every mutating run with the guarded `mcl-seed reset` and `mcl-seed verify` proved `967586872548df061a9035ef72b44a93ac937ccf4dcea74b22d2f85cc562989c` again. The API and Vite processes started by this session were stopped; only the database container remains.

## 7. Test, build and package-validation evidence

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | up to date |
| `cargo fmt --all --check` | clean |
| `CARGO_REGISTRIES_CRATES_IO_PROTOCOL=git cargo clippy --workspace --all-targets --locked -- -D warnings` | clean |
| `CARGO_REGISTRIES_CRATES_IO_PROTOCOL=git cargo test --workspace --locked` | 136 tests pass: api unit 5, `p3_api` 13, `p4_api` 13, `p5_api` 16, **`p6_api` 21 (new)**, application 29, domain 13, infrastructure unit 16, `p1_database` 10 |
| `CARGO_REGISTRIES_CRATES_IO_PROTOCOL=git cargo check --workspace --locked` | exit 0 |
| `pnpm --filter web test` | 262 tests pass in 13 files (228 before; 34 new in `features/authority/authority.test.tsx`, plus the shell test for PAGE-08/09/10) |
| `pnpm --filter web build` | exit 0 (`tsc -b` and `vite build`) |
| `python -B tests/p6/verify_live.py` | 76 checks, 0 failed |
| regression live scripts `tests/p3`, `tests/p4`, `tests/p5` | 13, 28, 30 checks, 0 failed |
| `mcl-seed verify` | `baseline matches CP-00` |
| `python scripts/validate_package.py` | see section 9 |

Not run: `tests/p1` (host Python lacks `openapi-spec-validator`; see P6-F09; no P1 artifact changed). The six Playwright journey specs remain placeholders, so `--release` validation is still an expected failure and **no release validation is claimed**.

**Prior-phase test expectations changed (narrowly, because P6 legitimately widened scope).** `p4_api` no longer asserts the two authority GETs are 404; `p5_api` no longer lists the jurisdiction and work-link POSTs as absent and now expects `If-Match` among the allowed CORS headers; `p3_api`'s exact CORS header list gained `if-match`; `tests/p5/verify_live.py` probes `completion-claim` instead of `work-link` for its "unapproved operation" check; the shell test treats PAGE-08/09/10 as implemented. No assertion was weakened beyond those scope changes.

## 8. P1 to P5 integrity and artifacts changed

Untouched: `openapi/`, `schemas/`, `config/`, `migrations/`, `data/demo/`, `traceability/`, `wireframes/`, `compose.yaml`, `CLAUDE.md`, lockfiles, and every P1 to P5 report. The database digest equals CP-00. Existing P3/P4/P5 behaviour is unchanged (their live scripts pass). A non-fatal process note: one command (`git stash`) was run by mistake mid-session and immediately undone with `git stash pop`; the working tree was re-checked (diff intact, formatting clean, `CLAUDE.md` unchanged).

New: `crates/domain/src/jurisdiction.rs`, `crates/api/tests/p6_api.rs`, `tests/p6/verify_live.py`, `apps/web/src/features/authority/*` (8 files), `apps/web/src/i18n/resources.p6.ts`, this report.
Changed: `crates/api/src/{lib,main}.rs`, `crates/application/src/{commands,dto}.rs`, `crates/domain/src/lib.rs`, `crates/infrastructure/src/{command,read}.rs`, `crates/infrastructure/src/bin/mcl_seed.rs`, `apps/web/src/{App.tsx,styles.css,i18n/resources.ts,components/shell.test.tsx}`, the four prior-phase test files above, `TASKS.md`, `audit/OPEN_FINDINGS.json`, `PACKAGE_MANIFEST.json`. `audit/CONTRADICTIONS.json` was not changed: no genuine authority conflict arose (the gaps found are P6-F03 and P6-F06, recorded as findings).

## 9. Git checkpoint

One local commit, no push. Message: `feat(p6): implement authority jurisdiction and dlp workflows` (the controlling plan names none; the non-controlling reference guide suggests a different string, which was not used). The commit hash is deliberately not written into any manifested file. The final tree is clean.

## 10. Open findings and authorized next state

New (all OPEN, `audit/OPEN_FINDINGS.json`): **P6-F01** (column-level grants cannot enforce row or value rules; app-level enforcement and tests, optional migration 0004 triggers), P6-F02 (effective rationale length), P6-F03 (no committed event name for linkWork), P6-F04 (keyword screen limits), P6-F05 (silent queue bound and null-estimate omission), P6-F06 (no assigned-awaiting-handoff queue), **P6-F07** (self-asserted persona; not authentication), P6-F08 (replay returns current record), P6-F09 (manual browser evidence; tests/p1 not run), P6-F10 (completion half deferred to P7).

P6 closes no earlier finding. Nothing here closes P-13 or P-14. This report authorizes P7 (verification, correction, audit, reset) only if the master director accepts the P6 verdict. GEO-01 and any release step remain unstarted.
