# P3 report: live API, runtime PostGIS reads, CivicMapAdapter and PAGE-01 Map/List Workspace (v1.2.3)

Date: 2026-11-20 (IST). Operator: Claude Sonnet 5.5, High effort throughout. Opus and Haiku not invoked. No remote push. This is implementation evidence, not release approval: P-13 and P-14 remain OPEN, as do CAP0-F05, CAP0-F08 and P2-F01..P2-F05.

Baseline checked first: HEAD exactly `aa487b18` (P2), clean tree, `python scripts/validate_package.py` exit 0, `pnpm --filter web build` exit 0, `cargo check --workspace --locked` exit 0. The DB container had exited (the Podman machine had restarted since CAP-0); it was restarted with the documented CAP-0 environment (`podman compose --env-file .env.local up -d db`), became healthy, and the CP-00 data was intact (`mcl-seed verify` matches the manifest digest). Evidence of that bounded recovery: CAP0-F08 is still the reason an operator must export the CAP-0 Podman environment.

## 1. Authoritative scope versus deferred candidates

The controlling files are thin on P3: `TASKS.md` and the plan say "P3 map/list"; `WIREFRAME.md`/`pages.json` fix PAGE-01 (states loading, default, empty, partial-data, error; keyboard, visible focus, 44px target, non-colour status; persistent banner); `DECISIONS.md` fixes direct Leaflet behind `CivicMapAdapter`, Rust/Axum/Tokio/SQLx, API port 8080; `REQUIREMENTS.md` R-01 requires responsive map/list parity; `TESTING.md` requires "map/list parity". The operations, filters and response shapes come from `openapi/openapi.yaml`. The supplementary v1.2.2 guide (non-controlling) also lists `POST /v1/demo/reset` under P3; this prompt keeps it in its later phase, so it is **not** implemented.

| Candidate | Decision | Basis |
|---|---|---|
| `healthLive`, `healthReady`, `getVersion` | Implemented | OpenAPI, `security: []` preserved |
| `getMapFeatures`, `listIssues` | Implemented | OpenAPI; shared filters ward, category, status, dlpOnly |
| `resetDemo` and every other operation | **Not implemented** (404/405 problem) | later phases |
| bbox on `listIssues` | **Not added** | bbox is declared on `getMapFeatures` only. No controlling file requires it on both, so OpenAPI is unchanged and parity is tested across the four filters both operations declare (option B). No narrow P1 correction was made. |
| `CivicMapAdapter` | Implemented, minimal | `setFeatures`, `setSelected`, `destroy` plus callbacks; no clustering, drawing, routing, geocoding or search |
| Ward boundary / asset layers from a ward or asset endpoint | Not implemented | no such operation in the contract |
| TanStack Query | Implemented | first consumer (deferred from P2) |
| `react-leaflet`, tile cache, service worker | Excluded | DECISIONS.md and the P3 brief |
| DOM test tooling (jsdom, Testing Library), Playwright | Not added | not authorised; tests stay Node-based |

New dependencies: **none**. `leaflet` 1.9.4, `@types/leaflet` 1.9.21 and `@tanstack/react-query` 5.90.10 were already frozen in `package.json` and `pnpm-lock.yaml`; `pnpm-lock.yaml` is unchanged. `Cargo.lock` changed only by two internal path-dependency edges (`mcl-application` -> `mcl-domain`/`serde_json`, `mcl-infrastructure` -> `mcl-application`); no external crate was added or re-resolved (CAP0-F05 unchanged, rustc 1.85.0).

## 2. Database identity (mcl_app) and secret handling

Catalog inspected before coding (live `civic_lens`): `mcl_app` exists, `NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`, no members, can connect, has USAGE on `public`, SELECT on every table, INSERT/UPDATE on most tables and INSERT on `lifecycle_events`/`corrections`/`idempotency_records` (all from migration 0003), and EXECUTE on `dlp_status_at`. The frozen P1 tests assert `mcl_app` is `NOT rolcanlogin` and the P1 Python test pins the three-migration list, so enabling LOGIN on `mcl_app` or adding a migration 0004 would have broken accepted P1 tests.

Decision (recorded as P3-F01): keep `mcl_app` NOLOGIN and add a **separate, unprivileged login role** `mcl_api` (`LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT CONNECTION LIMIT 10`) that is a member of `mcl_app` `WITH INHERIT FALSE, SET TRUE`. Every API connection runs `SET ROLE mcl_app` (so `current_user = mcl_app`) in a session with `default_transaction_read_only = on` and `statement_timeout = 5000`. No migration was added: roles are cluster-wide and the password is machine-specific, so provisioning is an owner-authority command, `mcl-seed provision-api-role`, which refuses anything but the local marked `civic_lens` database, requires `APP_DATABASE_URL` to name `mcl_api` with a real secret of at least 16 characters, and applies the password with `format(%L)` from a session setting (never in SQL text, a migration, a log or a report).

Live catalog after provisioning (redacted): `mcl_app` login=f inherit=f super=f; `mcl_api` login=t inherit=f super=f createdb=f createrole=f replication=f connlimit=10; membership `mcl_app -> mcl_api` inherit_option=f set_option=t. Connection target: `127.0.0.1:5432`, database `civic_lens`, login role `mcl_api`, effective role `mcl_app` (credentials never printed).

The API refuses to start unless `runtime_identity` proves: session user `mcl_api`, current user `mcl_app`, not superuser, read-only session, no CREATE on `public`. It never reads `DATABASE_URL`. If the database is unreachable at start it logs a warning and serves `NOT_READY` until it is. Tests (`runtime_identity_is_mcl_app_through_mcl_api_read_only_and_cannot_write_or_create`) prove DELETE, UPDATE, INSERT, TRUNCATE, CREATE TABLE and the `lifecycle_events` mutations are all refused (SQLSTATE 25006 or 42501), that `mcl_api` without `SET ROLE` cannot even read `issues` (42501), and that `mcl_app` stays NOLOGIN.

Secrets: `APP_DATABASE_URL` with the real value exists only in the ignored `.env.local` (`git check-ignore -v .env.local` -> `.gitignore:1`; `git ls-files .env.local` -> empty). `.env.example` has `replace-with-app-local-secret` (the provisioning command rejects that placeholder). A test scans `crates`, `migrations`, `audit`, `openapi`, `scripts`, `tests`, `apps/web/src`, `data` and the top-level docs for the real secret and finds none.

Residual: `mcl_app` still holds the P1 INSERT/UPDATE grants that P3 does not use. They were not revoked (P4+ need them and revoking would alter accepted P1 role design); the P3 API cannot use them because the session is read-only and the code only issues SELECTs.

## 3. API behaviour

Binds `127.0.0.1:8080` by default (`API_HOST`, `API_PORT`); the port must be an integer 1..65535; a non-loopback host needs `API_ALLOW_NON_LOOPBACK=true` and never defaults to `0.0.0.0`. Runtime SQLx queries (no macros), one `PgPool` (5 connections, 3 s acquire timeout).

* `/health/live`: `{"status":"UP"}`, process only, no database access (proved with an app whose pool points at a closed port).
* `/health/ready`: live `postgis_lib_version()` within 3 s -> 200 `{"status":"READY","database":"UP","postgisVersion":"3.5.2"}`; otherwise **503** `{"status":"NOT_READY","database":"DOWN","postgisVersion":null}` (the contract defines the `NOT_READY` body but no 503 response entry; see P3-F02). Failure was tested with an isolated app and an unreachable pool; the shared database was never stopped.
* `/version`: exactly `apiVersion` ("v1"), `packageVersion` ("1.2.3"), `recordNature`; no commit, path, user or toolchain data (test scans the body).
* Errors: RFC 9457 `application/problem+json` with exactly `type`, `title`, `status`, `detail`, `correlationId`; no SQL, stack, path or credential (test scans for leaks). Database outage -> 503 problem; anything else -> generic 500 (kind logged, never returned). 404 and 405 are problems too.
* Correlation: the contract bounds `X-Correlation-Id` to 8..128 characters. Accepted only if visible ASCII (0x21..0x7E); otherwise replaced by a server UUID v7 (never reflected). Tests: absent, valid, 128, 129, 7, embedded space, CRLF injection (extra header does not appear in the response), control character (hyper rejects with 400 before a handler), obs-text byte (replaced).
* CORS: default allowlist is the single exact origin `http://localhost:5173`; one validated extra origin (`http://localhost|127.0.0.1[:port]` only) can be added with `API_CORS_EXTRA_ORIGIN` for an evidence run. Allowed method: `GET`; allowed headers: `content-type`, `x-correlation-id`, `x-demo-persona`; exposed: `x-correlation-id`. Tests: approved origin gets its exact value; six unapproved origins (other port, `127.0.0.1`, `https`, foreign, `null`, suffix trick) get no allowing header and are not rejected; preflight lists exactly the three headers and `GET`; no `*` anywhere. `X-Demo-Persona` is ignored by the server (a presentation lens, never authentication or authorization).

### Filter semantics (one model, `mcl-application::filter`)
Case-sensitive. Omitted = no restriction. Empty value, repeated parameter (multiple values) and unknown parameter name -> 400 (the contract declares single scalars; strictness is P3-F06). `ward` is the ward **code** `K/W` (`^[A-Z](/[A-Z])?$`), not an id or display name; `category` and `status` are the exact upper-case enums; `dlpOnly` accepts `true`/`false`, and `false` equals omitted. `bbox` (map only, required): `minLon,minLat,maxLon,maxLat`, plain decimals, `minLon < maxLon`, `minLat < maxLat`, lon in [-180,180], lat in [-90,90], matched with `ST_Intersects` against `ST_MakeEnvelope(...,4326)` (boundary inclusive; no `ST_SetSRID` is ever applied). Geometry is `ST_AsGeoJSON` of the stored SRID 4326 geometry: `[longitude, latitude]` order, original type (the polygon issue stays a polygon, assets stay lines; no centroid).

Map features (`kind`): `ISSUE` (exactly the issues `listIssues` returns for the same filters), `ASSET`, `PUBLIC_WORK`. Assets and public works appear only when no `category`/`status` filter is set (those are issue enums), and a public work is drawn on the geometry of its own asset; the budget traceability-gap record has no authoritative spatial entity and never appears (tests assert no `-BUD-`, `-TND-` or `-CON-` id and kinds 6/4/1 on the baseline). Because the contract is silent on these semantics (P3-F02) they are P3 decisions awaiting Master Director confirmation.

DLP: never stored (a test asserts no stored DLP-status column). The handler reads the clock **once per request** and binds that instant into `dlp_status_at(work_order, instant)`; the clock is injectable (`AppState::with_clock`). Tests use fixed instants around every boundary (2026-03-31T23:59:59Z not started; 2026-04-01T00:00:00Z active; CAP-0 date active; 2027-03-31T18:29:59Z active; 18:30:00Z expired) and assert one clock read per request. Production uses UTC wall-clock time (P3-F05).

## 4. Map/list parity and live vertical-slice evidence

`push_issue_where` is the single issue-eligibility predicate used by both queries. `map_and_list_have_identical_eligible_issue_ids_for_every_shared_filter_combination` runs **600 combinations** (5 wards incl. an empty one x 5 categories x 8 statuses x 3 dlp values) against the real database and requires, per combination: identical ISSUE id sets on the full-box map and the list; list `total` equal to the list length; and equality with an independent oracle computed in Rust from `data/demo/*.json` and `mcl_domain::dlp::dlp_status_at` (not copied from the server); more than 20 combinations are non-empty. `IssueList` has `total` and the map has none, so no total comparison beyond that was made or invented. The full eligible set is compared (the contract has no pagination); ordering is stable by id.

Live run against the running host-native API (`python -B tests/p3/verify_live.py`, exit 0, 13 checks): `/health/live`, `/health/ready` (postgis 3.5.2), `/version` validate against their OpenAPI schemas; six filter combinations (`(none)`, `ward=K/W`, `ward=K/W&dlpOnly=true`, `category=POTHOLE&status=SUBMITTED_UNVERIFIED`, `status=TRIAGED_ASSIGNED&ward=K/W`, `ward=G/N&dlpOnly=false`) return identical issue ids on both operations and every response validates against `IssueListResult` / `MapFeatureCollectionResult` (strict, `additionalProperties: false`); an invalid bbox (`72.99,18.89,72.77,19.275`) returns 400 `application/problem+json` matching `Problem` with the supplied correlation id echoed; CORS approved/unapproved verified. Each response carried its own server correlation id (listed in the script output). The validator is non-vacuous (corrupted bodies are rejected).

## 5. CivicMapAdapter and Leaflet

`CivicMapAdapter` (`map/CivicMapAdapter.ts`) is a three-method interface (`setFeatures`, `setSelected`, `destroy`) plus options (`onSelect`, `onBasemapUnavailable`, `reducedMotion`, `featureLabel`). `LeafletMapAdapter.ts` is the only module that imports `leaflet` (and `leaflet/dist/leaflet.css` explicitly); `MapPanel` loads it with a dynamic `import()` so everything else stays Node-testable and the Leaflet chunk is split (153 kB, 45 kB gzip). Markers are inline-SVG `divIcon`s (44x44 hit area) with the status glyph; lines/polygons use vector styles with dash patterns that repeat the status tone, so no default marker PNG is requested (the production build emits no separate image file; Leaflet's own stylesheet carries three small data-URI images for controls this page does not use, so there is no image request that could 404) and state is not colour-only. Selection thickens/rings the feature and never moves keyboard focus. Vector paths get `tabindex=0`, `role=button`, an accessible name and Enter/Space activation (a `keydown` handler, because Leaflet's own `keypress` path did not respond to a real Return key in the browser test).

Tiles: OpenStreetMap raster tiles with visible attribution and `strict-origin-when-cross-origin` (meta tag plus the Leaflet option) are optional enrichment. `TileHealth` counts errors and loads and reports unavailability **once** (after four failures with no loaded tile; a one-way latch), so there is no per-tile state-update loop. Then the page shows a non-modal `role=status` notice and the adapter draws a dashed synthetic orientation grid, labelled in the notice as not an official basemap. Vector features are unaffected.

Unit tests (Node): swap `[lon,lat]` -> `[lat,lon]` in one place, polygon rings preserved, bounds, style selection and non-colour dashes, SVG markers contain no `<image>`/`.png`, grid inside Greater Mumbai, `TileHealth` fires once for 500 failures. Source scans (via Vite `import.meta.glob`, over every `apps/web/src` file): no `react-leaflet` import anywhere, not in `package.json` (web or root) or `pnpm-lock.yaml`; Leaflet imported in exactly one module; stylesheet imported; no `L.Icon.Default`/marker image references; no fetch, storage or service worker in the feature. These tests do **not** exercise Leaflet DOM behaviour (Vitest runs in Node without jsdom); that was checked manually (section 6).

## 6. PAGE-01, responsive and accessibility evidence (manual, built-in browser; not Playwright, not axe, not a WCAG claim)

Run once with the real API (`mcl_app`) and real PostGIS, the Vite dev server (`http://localhost:5173`) and the production build served from `http://localhost:4173` (with the validated extra CORS origin; for the tile-failure and CSP run). Viewport emulated with the browser pane; measured with `scrollWidth > clientWidth` and `getBoundingClientRect()`.

| Check | Result |
|---|---|
| 390x844 | no horizontal overflow; Map/List toggle sits before the filters (`aria-pressed`), list hidden in map view and shown in list view; map 358x439; zoom buttons 44x44 after a CSS specificity fix; every control >= 44px except the native checkbox (24x24, inside a 333x48 label that is the real target) |
| 768x1024 | no overflow; stacked filters, map (721x420), list, inspector; no toggle |
| 1440x900 | no overflow; map beside a list-and-inspector column; no overflow |
| Live data | 6 issues in the list, 5 point markers and 6 interactive paths on the map (4 assets, 1 public work, 1 polygon issue); real OSM tiles loaded |
| Filters through the real UI | all, ward K/W, +POTHOLE, +DLP only, G/N (empty), cleared: list ids equal the issue features on the map in every step |
| Selection | list click highlights the map marker (ring) and the inspector, announcement in a polite live region; a real Return key on a focused marker selects it and focus stays on the marker; Enter on a focused polygon selects it; selection is by stable id |
| Keyboard | tab order through the map is the container, the zoom/attribution links and 11 feature stops, so a "Skip the map and go to the issue list" link (visible on focus, 44px) was added and verified; every stop showed a solid focus outline (`:focus-visible` true) |
| Basemap failure | production build with a CSP blocking tile hosts: after the bounded threshold one `Basemap unavailable` status notice appears, a dashed orientation grid is drawn, all 5 markers and 6 paths and the list remain |
| API down | process stopped: both panes show `API unavailable` (alert) with Retry and no data; after restart, Retry recovered to 6 issues without a reload |
| Console | dev run with real tiles: zero console errors, zero uncaught exceptions, zero unhandled rejections (listeners installed). CSP run: the only errors were the expected CSP-blocked third-party tile requests, recorded separately from application errors |
| Inspector | shows only fields from the two responses: status badge with the API's own explanation (a closure claim reads "Closure claimed, pending verification"), category, street, landmark, reported time in UTC, **ward candidate (provisional, not a confirmed jurisdiction)**, linked work order id or "No work order linked", derived DLP flag with a no-blame caveat, and a link to PAGE-02 (a placeholder until P4); no hidden request is made |

Not verified in a browser: `prefers-reduced-motion` (the adapter disables Leaflet animations and the P2 CSS rule exists, but it was not toggled), forced-colors rendering, screen-reader output, axe results, and touch gestures. The mobile "bottom sheet" is simplified to an inspector panel below the active view, and filters are a horizontal bar rather than a rail (P3-F04). Vector lines and polygons are physically tiny at city zoom (3-8 px), so the list is the reliable selection route; markers are 44px. No URL state was added (back/forward not applicable).

## 7. Tests and gates (final run after stabilising edits)

| Command | Result |
|---|---|
| `cargo fmt --all --check` | exit 0 |
| `CARGO_REGISTRIES_CRATES_IO_PROTOCOL=git cargo clippy --workspace --all-targets --locked -- -D warnings` | exit 0 |
| `CARGO_REGISTRIES_CRATES_IO_PROTOCOL=git cargo test --workspace --locked` | exit 0; 51 tests: api lib 5, `p3_api` 13 (real DB), application 7, domain 10, infrastructure lib 6, `p1_database` 10 |
| `CARGO_REGISTRIES_CRATES_IO_PROTOCOL=git cargo check --workspace --locked` | exit 0 |
| `pnpm --filter web test` | exit 0; 9 files, 157 tests (123 from P2 incl. an updated shell test, 34 new) |
| `pnpm --filter web build` | exit 0 (`tsc -b && vite build`); JS 347 kB (107 kB gzip), Leaflet chunk 153 kB, CSS 9.5 kB + 15.6 kB |
| `python -B tests/p3/verify_live.py` (live API) | exit 0, 13 checks |
| P1 Python tests (`tests/p1`, venv with `openapi-spec-validator`) | 25 tests OK (the P2 note that they could not run is superseded; no P1 file changed) |
| `mcl-seed verify` | baseline digest equals `data/demo/reset-manifest.json` (CP-00 intact after all P3 tests) |
| `python scripts/validate_package.py` | exit 0 after the single manifest refresh |

`python scripts/validate_package.py --release` was **not** run and is expected to fail on the six Playwright journey placeholders (`tests/e2e/journey-1..6.spec.ts`), which were not touched. P-13 is not closed.

## 8. Changes to P1 artifacts
None: no OpenAPI, schema, migration, seed, config, domain or reset change (`git diff` on those paths is empty); no narrow P1 correction was needed. Additions only: `crates/application`, `crates/infrastructure/src/read.rs` and the `provision-api-role` subcommand (new code in the P1 `mcl-seed` binary, owner-authority only), plus `.env.example` placeholders.

## 9. Findings (all OPEN, see `audit/OPEN_FINDINGS.json`)
* P3-F01 (MEDIUM): runtime identity is a separate login role (`mcl_api` -> `mcl_app`) created by a command, not a migration; fresh machines need the provisioning step; `mcl_app` keeps unused P1 write grants.
* P3-F02 (MEDIUM): contract silence: no 503 response for readiness, no definition of ASSET/PUBLIC_WORK filter semantics or `dlpActive`, `status` is a free string; P3 decisions need Master Director confirmation (OpenAPI unchanged).
* P3-F03 (MEDIUM): OSM tiles rest on the non-controlling guide and an external service; behaviour behind the corporate proxy and under the OSM tile policy is unproven; degradation is bounded and tested in one real-browser run.
* P3-F04 (MEDIUM): PAGE-01 accessibility/responsive evidence is manual and single-run; no axe/Playwright/forced-colours/reduced-motion/screen-reader runs; 12 map tab stops mitigated by a skip link; tiny vector targets; simplified bottom sheet and filter bar.
* P3-F05 (LOW): production DLP is evaluated at the wall-clock UTC instant; the seeded DLP window ends 2027-03-31T18:29:59Z, so demo output changes after that date; only tests inject a fixed instant.
* P3-F06 (LOW): unknown/empty/repeated query parameters are rejected (stricter than the contract); ward options are fixed to the three DECISIONS.md codes (no ward-list operation exists).
* P3-F07 (LOW): the new `p1.*` strings exist in English only (hi/mr fall back, extending P2-F05).

Carried unchanged: CAP0-F05 (no external crate changed), CAP0-F08 (the DB container needed a restart after a Podman machine restart; the documented environment was required), P-13, P-14, P2-F01..P2-F05.
