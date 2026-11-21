# P4 report: bounded experience uplift (P4A) and Journey 1 completion (P4B)

Date: 2026-11-21. Model: Sonnet 5.5, High effort throughout; no model switch. Baseline: `dfa9c76` (P3, accepted), working tree clean apart from two untracked items that pre-existed P4 (a user-supplied `docs/reference/*.docx` and `maps/`, see section 8). **This is not release approval.** P-13 and P-14 remain OPEN. Nothing was pushed. P5 to P8 were not started.

## 1. Baseline verification (before any edit)
| Check | Result |
| --- | --- |
| `git rev-parse HEAD` | `dfa9c765c41a64655ca7911d848b0de9f17252c0`; `dfa9c765` is an ancestor; no commits after it |
| Database container | `mumbai-civic-lens_db_1` Up and healthy (the Podman machine was running; `podman compose ps` through the Docker compose provider failed on the missing Podman named pipe, so `podman ps` was used) |
| `pnpm --filter web build`, `cargo check --workspace --locked` | exit 0 |
| `python scripts/validate_package.py` | **INVALID before P4**: the user-supplied `docs/reference/Municipal Operational Governance, Contracting Frameworks, and Technical Architecture.docx` (added 2026-11-21 00:11, untracked) is unmanifested. Not a P4 regression; the validator was not weakened. It was left untouched while P4 ran and was then moved out of the repository root (see section 8); after that the validator passes |
| CP-00 | `mcl-seed verify`: baseline digest `967586872548df061a9035ef72b44a93ac937ccf4dcea74b22d2f85cc562989c` equals the expected digest, before and after all P4 work |

## 2. CAP0-F09: PostgreSQL host exposure
Recorded as **MEDIUM, OPEN** (see `audit/OPEN_FINDINGS.json`). `compose.yaml` was not changed.
* Configuration: `ports: ["5432:5432"]` with no host IP, which Podman publishes on all interfaces.
* `podman port`: `5432/tcp -> 0.0.0.0:5432` and `:::5432`.
* `Get-NetTCPConnection -LocalPort 5432`: LISTEN on `0.0.0.0`, `::`, `127.0.0.1`, `::1`, one owning host process (`dllhost`, the WSL/Podman forwarder).
* Loopback test succeeds. A connection from the host to its own Wi-Fi LAN address on 5432 also succeeds.
* **Not proven:** reachability from another machine. No off-host probe was made; the host profile is domain-authenticated; a bounded firewall scan found no 5432-specific allow rule and the default inbound action is `NotConfigured`. Hence MEDIUM, not HIGH. Controlled hardening test required (publish `127.0.0.1:5432:5432` in a copy, confirm only loopback listens, re-verify CP-00); not done because P4 forbids editing `compose.yaml`.

## 3. P4B backend: endpoint authority and read-only evidence
* **Implemented (3):** `getKundali` `GET /v1/kundalis/{id}`, `getWorkOrder` `GET /v1/works/{id}`, `getBudgetTrace` `GET /v1/budget-traces/{id}`. These are the operations PAGE-02/PAGE-03 need under the accepted contract.
* **Deferred (not implemented, return 404, tested):** `getIssue`, `getAuditTimeline`, the authority operations and every write including `POST /v1/demo/reset`. The Kundali already carries the issue and an ordered audit preview, so the two extra reads were not strictly necessary (finding P4-F01).
* **Inventory unchanged:** 23 operations on 22 paths, identical operationIds (pinned by `p3_api.rs::openapi_inventory_is_unchanged...`, which still passes). No route renamed or broadened; `openapi/openapi.yaml` untouched.
* **Runtime identity:** unchanged P3 identity (`mcl_api` login, `SET ROLE mcl_app`, `default_transaction_read_only = on`, 5 s statement timeout). The API was never run as `civic`.
* **Queries:** runtime SQLx (no compile-time macros), values always bound; table/column names are fixed literals in `read.rs`. Each operation reads inside one `REPEATABLE READ` read-only transaction, so every section shares a snapshot. Rows come back as `to_jsonb`, are converted to the contract's camelCase names and RFC 3339 UTC timestamps, then deserialized into the strict domain records (unknown or malformed stored data fails loudly instead of being served). Kundali issues a fixed, bounded set of about twenty queries (one per section, plus the budget-trace chain), each keyed by ids already read; the count does not grow with the number of events or evidence items, and there is no per-row or per-event follow-up query. The browser made exactly one request for a Kundali page.
* **Derived DLP:** one UTC instant per request (`state.clock`, injectable); status computed by the existing SQL function `dlp_status_at`; never stored (tests assert no stored column) and the instant is returned as `evaluatedAt`.
* **Responses:** exact OpenAPI shapes (validated live against `KundaliResult`, `WorkOrderDetailResult`, `BudgetTraceResult`), integer paise only, `ETag` = quoted `recordVersion`, `Cache-Control: no-store`, sanitized `X-Correlation-Id`. 400 (malformed id, any query string, over-long id), 404 (valid but absent, including wrong-kind ids) and 503/500 are `application/problem+json` with no SQL, path or credential text and no echo of caller input.
* **P1 frozen artifacts:** no migration, schema, seed, config, OpenAPI, domain or reset change.

Tests: `crates/api/tests/p4_api.rs` (13 tests, real Axum router on a loopback socket, real PostGIS, expectations computed from `data/demo/*.json` by an independent oracle), plus a `contract_json` unit test in `read.rs`.

## 4. P4A: experience uplift
Done with existing React, CSS and Leaflet only; no new dependency, no router or token change.
* **Disclosure:** exactly one static named region on every route (including 404): `Mumbai Civic Lens • Demonstration environment • Not an official BMC service`, plus ONE native `details` "About this demo" holding the detailed caveats (claim is not verification; gap/DLP notes are not findings; persona is not authentication; OSM is community reference). Not a live region. Routine headings no longer repeat "synthetic demonstration"; a test asserts `<main>` does not.
* **Header:** persona and language moved behind one disclosure button below 960 px; the persona explanation is an accessible helper disclosure that is still the select's `aria-describedby`. Inline on desktop.
* **PAGE-01:** Map / List / Split control (Split on desktop only), collapsible Filters with a count, removable active-filter chips and "Clear filters" shown only while a filter is active, stronger card and selection presentation, hover and focus cross-highlighting between list and map (no animation), a "View Kundali" primary action in the selected-issue panel, lightweight loading notices.
* **Basemap:** see section 5.
* **Multilingual:** all P4 UI strings exist in English; Hindi and Marathi carry a short, unreviewed subset only; deterministic English fallback; **P2-F05 and P3-F07 stay OPEN**. A live check at 390 px with Hindi and Marathi selected found no horizontal overflow on PAGE-01/02 (open and closed disclosures).

### UX acceptance (the 10 conditions), checked in the live browser at 390x844 unless stated
| # | Condition | Result |
| --- | --- | --- |
| 1 | Disclosure no longer dominates the first mobile viewport | Banner is 59 px (52 px in Hindi/Marathi); one line plus an "About" link |
| 2 | PAGE-01 title and primary interaction visible earlier | Title and Map/List/Filters controls are above the fold, with the map below them; the persona text is no longer in the first screen |
| 3 | Map/List and Filter reachable without persona text | Yes; they sit directly under the title |
| 4 | Active filters visible without reopening the panel | Chips shown (e.g. "Category: Pothole", "Clear filters") with the panel closed |
| 5 | Collapsed filters do not fill the viewport | Collapsed by default on mobile; one toolbar row (44 px) |
| 6 | Clear primary action to PAGE-02 | "View Kundali" is the first element in the selected-issue panel; verified href `/page-02?id=SYN-DEMO-KND-001` |
| 7 | Desktop map/list/inspector hierarchy obvious | Split layout: map left, list above inspector on the right, nav rail left (1440x900 screenshot) |
| 8 | Basemap failure no longer a dominant grey diagnostic | One compact notice above a light neutral canvas that still shows the grid and issue markers |
| 9 | No essential claim-safety meaning lost | Claim-not-verification text kept in the badge, the explanation, the Kundali and the About disclosure |
| 10 | No route less keyboard accessible | Checked at 768 px: first tab stops are skip link, About, header controls, Menu, then page actions; a real Tab press yields a solid navy `:focus-visible` outline; all disclosures use native `details`; no positive tabindex; no visible button, summary, select or input under 44 px on the three pages. Not a screen-reader or full keyboard-walkthrough result |

## 5. Basemap diagnostics (time-boxed, well under 20 minutes)
Online OSM stays optional; nothing was added for tiles.
* **Observed (dev server and production preview, redacted):** in the in-app browser the application requested `https://tile.openstreetmap.org/{z}/{x}/{y}.png` (`referrerPolicy: strict-origin-when-cross-origin`, no CSP meta tag) and tiles decoded and rendered normally (9 decoded tiles). Resource-timing entries report status 0 for cross-origin images without `Timing-Allow-Origin`; this is not a failure signal. No tile-load test, enumeration or bulk download was run, nothing was cached or redistributed, and OSM attribution stayed visible.
* **Classification: UNRESOLVED (not reproduced).** In this session the basemap loaded on both the dev server and the production preview, which rules application configuration (the tile URL, attribution and referrer policy are as designed), CSP (none is set), DNS and TLS out *for this run*. The earlier P3 grey-canvas failure was not reproduced, so no root cause can be assigned to it; the remaining candidates are external service intermittency or throttling and the browser/network environment of that earlier session. I did not change the trust store, add tokens or providers, or touch proxy settings, and no proxy address, credential or certificate path is recorded here. **P3-F03 stays OPEN.**
* **Failure path was exercised deliberately** by redirecting tile image URLs inside the page only (a diagnostic harness, not a code path): the bounded `TileHealth` latch fires, the compact notice appears, the vector markers remain, and no ward polygons or labels are drawn.
* **Retry basemap:** new `CivicMapAdapter.retryBasemap()` clears the orientation grid and the failure latch and redraws tiles without reloading the app. Verified live: after the harness was removed, one click removed the notice and 9 tiles decoded with the 5 markers intact. Unit tests cover `TileHealth.reset`.
* **Light fallback:** neutral `#f4f6f8` canvas, lighter dashed grid, the note placed above the canvas (not over it) so it never covers markers. Ward labels are not drawn on the fallback because no approved ward polygon or centroid source exists in the responses.
* **Also fixed:** the map now re-fits to the features whenever the container is re-measured (until the user pans or zooms), with extra top-left padding so markers clear the zoom control. This fixed markers being hidden behind the zoom control after a layout change.
* **GEO-F01 (non-blocking, OPEN):** the downloaded Mumbai packages under `maps/` (about 272 MB) are untracked, not manifested and unread by P4; see section 9.

## 6. PAGE-02 and PAGE-03 (live API at 127.0.0.1:8080 and the real database)
Canonical IDs verified from `data/demo/*.json` before use: issues `SYN-DEMO-KND-001..006`; work order `SYN-DEMO-WO-001`; budgets `SYN-DEMO-BUD-001` (complete) and `SYN-DEMO-BUD-002` (gap); tenders `SYN-DEMO-TND-001/002`; contract `SYN-DEMO-CON-001`; contractor `SYN-DEMO-VND-001`; asset `SYN-DEMO-AST-ROAD-001`. No alias was created.
* **Deep links:** `/page-02?id=` and `/page-03?budgetId=&workOrderId=` are parsed with `URLSearchParams` and validated locally (pattern plus the 128-char bound) before any request; a malformed value shows a "not valid" state without echoing it and makes no request; a valid absent id shows a not-found state; selecting another trace updates the URL (browser Back restored the previous trace in a live run); detail queries are keyed by id so there is no duplicate request. Opening `/page-02` or `/page-03` with no parameters shows a live bounded selector (the existing P3 issue list; two committed traces), never a dead page. A manual budget-id input is validated locally and calls only the existing trace endpoint; no autocomplete, enumeration or new endpoint.
* **PAGE-02:** issue summary with colour-independent status; completion claim and verification shown as distinct sections with different glyphs ("Completion claimed, not verified" vs "Verification window open"); "silence never verifies" is stated once, in the API's own text, in the verification section; responsibility and jurisdiction strictly from committed fields (post titles, department, provisional/confirmed/disputed, `legalOwnershipAsserted` is always false and the page says legal ownership is not asserted); linked work, derived DLP and money formatted from integer paise, with the exact claim-safe DLP sentence inside an expandable "Contractual details", shown only while the server-derived status is ACTIVE; ordered bounded audit preview from the same response (first 5, remainder behind a disclosure, not described as immutable); corrections list from the response.
* **Synthetic illustrations:** three local self-contained SVGs (before, claimed-after, disputed/recurring), flat schematic road drawings labelled "Synthetic demonstration illustration", no person, plate, house number or external reference, selected only by the committed evidence `stage`; timestamps, captions, source type and verification state come from the API; the hash is shown only as a "fixture reference hash (not proof of authenticity)". See P4-F03 for the limits.
* **PAGE-03:** the two committed traces from live `getBudgetTrace` (and `getWorkOrder` when a work order id is present). Complete chain: all five links proven; gap chain: budget and tender proven, contract and work order "not available in the record", street-level geometry "missing next link", the API's own gap sentence ("not an allegation"), no invented geometry or link.
* **Audit preview decision:** the Kundali response already includes the events, so the page renders them and `getAuditTimeline` stays deferred. **QR decision:** deferred; no page specification requires it in P4; no QR rendered. Both recorded in P4-F01.
* **Contract-bounded display:** every displayed field is a committed schema field derived from committed P1 data; no endpoint was widened for visual completeness.

## 7. Tests and live evidence
All commands were run from the repository root in this order after the edits stabilized.
| # | Command | Exit | Result |
| --- | --- | --- | --- |
| 1 | `pnpm install --frozen-lockfile` | 0 | already up to date |
| 2 | `cargo fmt --all --check` | 0 | clean |
| 3 | `cargo clippy --workspace --all-targets --locked -- -D warnings` | 0 | no warnings |
| 4 | `cargo test --workspace --locked` | 0 (second run) | **first run: one P3 test failed once (finding P4-F04), then passed on the immediately following targeted run and on the full rerun**; final counts: api lib 5, `p3_api` 13, `p4_api` 13, application 7, domain 10, infrastructure lib 7, `p1_database` 10 = 65 |
| 5 | `cargo check --workspace --locked` | 0 | ok |
| 6 | `pnpm --filter web test` | 0 | 190 tests in 11 files (157 before P4) |
| 7 | `pnpm --filter web build` | 0 | JS 393 kB (119 kB gzip), CSS about 21 kB, Leaflet chunk 154 kB |
| 8 | `python -B tests/p4/verify_live.py` | 0 | 28 checks, 0 failed (live API) |
| 9 | `mcl-seed verify` | 0 | baseline matches CP-00 (digest in section 1) |
| 10 | `python scripts/validate_package.py` | at the first run: 1 (only the 11 untracked `maps/*` and `.docx` files listed, see section 8 and `CON-P4-001`) and `PACKAGE VALID` on a clean copy of the tracked and new P4 files. **After the Master Director chose to move those items out of the repository root: 0, `PACKAGE VALID` in the real working tree, validator unchanged** | passes |

`--release` was **not** run and is expected to fail on the six Playwright placeholders (`tests/e2e/journey-1..6.spec.ts`), which were not touched. The unit tests use contract-shaped fixtures built from the seed files; they are rendering tests, not live proof. Live proof is `tests/p4/verify_live.py` and the browser runs below.

CP-00 discipline: every P4 HTTP and browser flow was GET only; `POST /v1/demo/reset` was never called (the live verifier asserts it is refused); the digest was verified identical before and after.

## 8. Process hygiene and repository state
* Before starting servers, ports 8080, 5173, 4173 were checked (free). Project processes started by P4 were recorded and stopped afterwards (final run: API pid 24824, Vite preview pid 28880; earlier runs used other pids, all stopped). No unrelated process was stopped. The only container left running is `mumbai-civic-lens_db_1`.
* `docs/reference/Municipal Operational Governance, Contracting Frameworks, and Technical Architecture.docx` (user-supplied before P4) and `maps/` (about 272 MB, Mumbai OSM source packages): both were untracked and unmanifested, which made `validate_package.py` fail. Contradiction `CON-P4-001` recorded the conflict; the Master Director chose to move them out. They now live outside the repository under `C:\Projects\Mumbai Civic Lens\external-inputs\`: the map packages at `geospatial\osm-bombay` and the `.docx` at `reference`. Nothing inside either was read, edited, committed, manifested or hash-pinned, the validator was not changed, and `CON-P4-001` is RESOLVED. The later GEO-01 task should read the packages from the `geospatial\osm-bombay` path.
* `maps/` (about 272 MB): untracked, not gitignored, not staged, not manifested. The validator would also flag it as unmanifested; same decision needed.
* `.env.local` is gitignored (`.gitignore:1`) and not tracked; no secret, `target`, `node_modules`, `dist`, cache, temporary script or screenshot dump is staged. Scratch files live outside the repository in `C:\Users\<LOCAL_USER>\p4-scratch`.

## 9. Visual and live Journey 1 browser evidence
Manual, single-run, in-app browser against the live API. **No Playwright or axe proof is claimed and no WCAG conformance is claimed.** Screenshots are stored outside the repository by the browser tool under `C:\Users\<LOCAL_USER>\.claude\projects\C--Projects-Mumbai-Civic-Lens-mumbai-civic-lens\ff2e84ca-c176-4f34-a21f-f1e836757fe3\tool-results\` (not copied into the repo, not staged).

| Viewport | Page and state | Test route | Live API | Overflow | Keyboard / focus |
| --- | --- | --- | --- | --- | --- |
| 390x844 | PAGE-01, map, basemap loaded, markers clear of the zoom control | `/page-01` | 200s | none | 44 px minimum is set in CSS; target sizes were measured at 768 px |
| 1440x900 | PAGE-01, Split, first issue selected, View Kundali shown | `/page-01` | 200s | none | a real Tab press produced a solid navy `:focus-visible` outline (checked at 768 px) |
| 390x844 | PAGE-02, Journey 1 dossier top | `/page-02?id=SYN-DEMO-KND-001` | 200 (1 request) | none | not separately keyboard-tested at this size |
| 1440x900 | PAGE-02, two-column dossier | same | 200 | none | |
| 390x844 | PAGE-03, traceability-gap trace | `/page-03?budgetId=SYN-DEMO-BUD-002` | 200 | none | |
| 1440x900 | PAGE-03, complete chain with work order | `/page-03?budgetId=SYN-DEMO-BUD-001&workOrderId=SYN-DEMO-WO-001` | 200 | none | |
| 390x844 | basemap-unavailable fallback with Retry | `/page-01` (tile URLs redirected in-page) | 200 | none | Retry basemap is a native button with the 44 px minimum |

Also checked at 768x1024: PAGE-01/02/03 and `/page-03` with no params: no horizontal overflow, no interactive target under 44 px. Full Journey 1 navigation PAGE-01 -> filter chips -> select -> View Kundali -> Open work and budget trace -> gap trace -> browser Back, all with live data: passed.

Visual limitations: the in-app browser is one Chromium engine; the 390 and 768 sizes are emulated, not physical devices; screen-reader, forced-colours, reduced-motion and 200% zoom were not run; screenshots were not independently reviewed for aesthetics; the three evidence illustrations are deliberately plain.

## 10. Findings and next state
New: **CAP0-F09** (MEDIUM), **GEO-F01** (LOW, non-blocking), **P4-F01** (MEDIUM, contract coverage and deferrals), **P4-F02** (LOW, evidence limits), **P4-F03** (LOW, wall-clock DLP and illustration limits), **P4-F04** (LOW, one non-reproduced P3 test failure). Carried unchanged: CAP0-F05, CAP0-F08, P-13, P-14, P2-F01..P2-F05, P3-F01..P3-F07 (P3-F03 stays open; P3-F06 strict query validation is the same model the P4 routes use: no query parameters accepted at all).

**Recommendation (not started):** a separate **GEO-01** K/West offline-basemap feasibility task after P4: use the existing `Bombay.osm.pbf` with Pyrosm as a candidate processing tool in an isolated environment, ArcGIS Pro for inspection, and compare bounded GeoJSON, local raster MBTiles and Shortbread vector MBTiles for ODbL attribution, licence, provenance, size, load time and `CivicMapAdapter` fit.
