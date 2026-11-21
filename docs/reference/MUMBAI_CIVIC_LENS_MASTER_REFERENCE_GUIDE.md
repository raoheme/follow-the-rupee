Below is the complete, self-contained, export-ready Master Reference Guide consolidating every verified decision, architecture rule, contract, state machine, seed dataset, wireframe specification, audit lesson, the final 2-minute `B-01` patch, model-routing strategy, same-day execution plan, and copy-paste Claude Desktop / Claude Code prompts.

---

```markdown
# MUMBAI CIVIC LENS — MASTER PLANNING, IMPLEMENTATION & DELIVERY REFERENCE GUIDE

> **Document Purpose:** Single authoritative operational reference for planning, implementing, auditing, and demonstrating the **Mumbai Civic Lens** prototype with **Claude Desktop / Claude Code**.  
> **Project Title:** Mumbai Civic Lens — *Budget. Work. Evidence. Accountability.*  
> **Reference Date & Target Delivery:** 20 November 2026 (Same-Day Working Demonstration Prototype)  
> **Canonical Physical Package Baseline:** `mumbai-civic-lens-claude-desktop-v1.2.2.zip` (`85` manifested files)  
> **Current Readiness Verdict:** **`HOLD FOR 1 REPRODUCIBLE BLOCKER (B-01)` → `GO FOR CAP-0` immediately after applying the 2-minute `scripts/validate_package.py` patch in Section 9.**  
> **Operational Classification:** `READY_FOR_CAP0_AND_CONTRACT_VERIFICATION_NOT_COMPLETED_PROTOTYPE` — **NOT AN OFFICIAL BMC PORTAL.**

---

## TABLE OF CONTENTS

1. [Executive Status, Readiness Boundary & Package Evolution](#1-executive-status-readiness-boundary--package-evolution)
2. [Project Mission, Authority Hierarchy & Non-Negotiable Guardrails](#2-project-mission-authority-hierarchy--non-negotiable-guardrails)
3. [Mumbai & BMC Institutional Domain Reference (Verified Nov 2026)](#3-mumbai--bmc-institutional-domain-reference-verified-nov-2026)
4. [Frozen Technical Architecture, Stack & Same-Day Simplifications](#4-frozen-technical-architecture-stack--same-day-simplifications)
5. [Physical Repository Inventory (v1.2.2) & Contract Reference](#5-physical-repository-inventory-v122--contract-reference)
6. [Six Domain State Machines & Deterministic Duplicate Policy](#6-six-domain-state-machines--deterministic-duplicate-policy)
7. [UX, Wireframes & 12-Page Compressed UI Architecture](#7-ux-wireframes--12-page-compressed-ui-architecture)
8. [Six Canonical Journeys, Synthetic Seed Registry & Demo Playbook](#8-six-canonical-journeys-synthetic-seed-registry--demo-playbook)
9. [MANDATORY PRE-CAP-0 PATCH (`B-01`) — Exact Drop-In Fix](#9-mandatory-pre-cap-0-patch-b-01--exact-drop-in-fix)
10. [Security, Privacy, Licensing & Claim-Safety Governance](#10-security-privacy-licensing--claim-safety-governance)
11. [Claude Desktop / Claude Code Autonomy, Model Routing & Budget Policy](#11-claude-desktop--claude-code-autonomy-model-routing--budget-policy)
12. [Same-Day Delivery Execution Plan (CAP-0 through P8)](#12-same-day-delivery-execution-plan-cap-0-through-p8)
13. [Copy-Paste Prompt Library for Claude Desktop / Claude Code](#13-copy-paste-prompt-library-for-claude-desktop--claude-code)
14. [Pre-Flight Go/No-Go & Final Release Checklists](#14-pre-flight-gono-go--final-release-checklists)

---

## 1. EXECUTIVE STATUS, READINESS BOUNDARY & PACKAGE EVOLUTION

### 1.1 Two-Target Readiness Separation (Frozen — ADR-001)
Never conflate demonstration readiness with production or institutional pilot readiness:

| Target | Status | Governing Boundary |
|---|---|---|
| **Target A: Demonstration Prototype (Due Today)** | **GO FOR CAP-0** *(after 2-min `B-01` patch)* | End-to-end working, responsive, accessible prototype using clearly labelled `SYN-DEMO-*` synthetic operational data and bounded reference geography (`K/West` primary). |
| **Target B: Public / BMC-Operated Pilot** | **NO-GO** | Permanently gated until official BMC sponsorship, MoU/data-sharing agreement, legal/privacy sign-off, verified official GIS boundaries, and production security controls exist. |

### 1.2 Audit Evolution & Lessons Preserved (Why v1.2.2 Exists)
| Revision | Outcome | Key Lesson Permanently Enforced |
|---|---|---|
| **v1.0 Research** | Conceptual thesis accepted; 25–30% corrected | Separated elected oversight from administrative/engineering execution; rejected ML dedup, browser cell-tower triangulation, and "zero-knowledge" mislabelling. |
| **v1.1 Package** | **REJECTED** (10 blockers `B1`–`B10`) | Generator created only 25 spec fragments while claiming completeness; forced all 22 states onto every screen; omitted OpenAPI, schemas, state machines, seeds, and code foundations. |
| **Argon v1.2 Doc vs Copilot v1.2 ZIP** | **HOLD → CONDITIONAL GO** | Argon's 131-page doc repeated false completeness and pinned obsolete Rust `1.82.0`. Copilot's physical 195-file ZIP had real structure (`rust-toolchain = stable`, clean Compose), but still had a 6-endpoint `:3001` OpenAPI stub, 12 `additionalProperties: true` schemas, 5 identical empty GeoJSON stubs, `"latest"` npm tags, and Vitest `it.todo` tests. |
| **v1.2.1 Physical ZIP** | **HOLD** (`F-01`–`F-05`) | Consolidated cleanly to 84 files with pinned deps, `:8080`, `docker.io/postgis/postgis:17-3.5`, strict schemas, and 12-page compression — but had committed `.pyc`, `--release` missing `test.skip`, seeds failing schemas, untyped OpenAPI, dead-end states, and corrupted `traceability/journeys.json`. |
| **v1.2.2 Physical ZIP** | **`F-02`–`F-05` CLOSED; 1 Blocker (`B-01`)** | All seeds pass strict schemas; contractor + unlinked J3 issue added; OpenAPI has request/response/Problem envelopes; all 6 state machines fixed; traceability covers all 12 pages. **Only `scripts/validate_package.py` needs the 2-minute `B-01` fix** (Windows backslash paths, ignoring `.git`/`node_modules`/`target`/`.env.local`, `--release` regex word boundaries, and restoring prohibited-phrase scan). |

---

## 2. PROJECT MISSION, AUTHORITY HIERARCHY & NON-NEGOTIABLE GUARDRAILS

### 2.1 Core Product Thesis
Do **not** build another isolated complaint app. Build an **integration-first spatial accountability and evidence layer ("Civic Issue Kundali")** proving how fragmented municipal information connects end-to-end:

```text
Citizen Report
  → Geospatial Location (Point / LineString / Polygon)
  → Deterministic Duplicate Check (DEMONSTRATION_HEURISTIC_V1)
  → Civic Asset (Road / Drain / Facility)
  → Administrative Ward Candidate
  → Provisional vs Confirmed Jurisdiction (BMC Ward / Central / External Agency)
  → Responsible Institution, Department & Institutional Post Title
  → Civic Issue Kundali (Canonical Lifecycle Dossier)
  → Budget Allocation (Budget A / B / E / G)
  → Tender & Contract
  → Work Order & Recorded Contractor
  → Milestones & Expenditure (Integer Paise)
  → Authority Completion Claim + Evidence
  → Citizen or Independent Physical Verification
  → Correction, Appeal, Reopening & Append-Only Hash-Linked Audit History
```

### 2.2 Seven Core Questions the Prototype Must Answer
1. Where is public money allocated, contracted, and spent?
2. Which public work is associated with a specific physical street/asset location?
3. Which institution, department, and official post owns the next operational action?
4. Was a civic promise or public work actually physically delivered?
5. What evidence (and confidence signals) supports the claimed status?
6. Might a reported defect fall within an active **Defect Liability Period (DLP)** requiring contractual verification?
7. How are disputed closures, source conflicts, corrections, appeals, and reopenings preserved without rewriting history?

### 2.3 Explicit Non-Goals (Never Build Today)
- NOT an official BMC portal or live complaint submission endpoint
- NOT a replacement for MyBMC / 1916 / SAP / Mahatenders
- NOT an accusation, defamation, or contractor "corruption/honesty ranking" engine
- NOT a production system with real citizen PII, OTP auth, live BMC APIs/scraping, WhatsApp/SMS, video/ML processing, 3D digital twin, citywide vector tiles, Kafka, Redis, or Kubernetes

### 2.4 Authoritative Precedence Hierarchy (Levels 0–12)
```text
Level  0: Applicable law, verified licence terms, security & privacy policy
Level  1: GUARDRAILS.md (and claim-safety rules)
Level  2: DECISIONS.md and accepted ADRs
Level  3: REQUIREMENTS.md (R-01 to R-10)
Level  4: SPEC.md
Level  5: Machine-readable state machines (config/*-state-machine.json) & config/duplicate-policy.json
Level  6: openapi/openapi.yaml & schemas/*.schema.json
Level  7: WIREFRAME.md & wireframes/pages.json
Level  8: ARCHITECTURE.md
Level  9: Use cases & demo journeys (data/demo/demo-journeys.json, traceability/journeys.json)
Level 10: TASKS.md & P01-P12_IMPLEMENTATION_PLAN.md
Level 11: Synthetic demonstration data (data/demo/*.json)
Level 12: Research references (informational ONLY — NEVER override levels 0–11)
```

### 2.5 Mandatory Fail-Closed Contradiction Stop Protocol
Whenever any conflict is detected between two controlling artifacts:
1. **Do NOT silently pick a convenient interpretation.**
2. Record the conflict in `audit/CONTRADICTIONS.json` with affected files, conflicting clauses, severity (`BLOCKER` if contract-breaking), and `"status": "OPEN"`.
3. Halt the affected task/phase (`validate_package.py` exits non-zero while any `OPEN` `BLOCKER` exists).
4. Propose one bounded resolution, update the higher-ranking controlling artifact, mark the contradiction `RESOLVED`, and resume.

### 2.6 Non-Negotiable Guardrails & Claim-Safety Dictionary

| Domain | REQUIRED Safe Representation | STRICTLY PROHIBITED Claim / Behaviour |
|---|---|---|
| **Demo Identity** | Persistent maroon top banner on every page; `SYN-DEMO-*` IDs; `recordNature: "SYNTHETIC_DEMONSTRATION"` | Implying official BMC portal, live BMC data, or verified government expenditure |
| **Accountability** | Institution + Department + Official Post Title (e.g., *Assistant Engineer (Roads), K/West Ward*); Elected ward oversight shown in a separate deliberative box | Personal BMC officer names/phones/emails; blaming individuals; contractor performance/corruption rankings (`officialPerformanceRating: null`) |
| **Closure vs Verification** | `CLOSURE_CLAIMED_PENDING_VERIFICATION` ≠ `VERIFIED_COMPLETE`; silence lapses to `CLOSURE_CLAIMED_UNVERIFIED_LAPSED` / `WINDOW_EXPIRED_NO_VERDICT` | Auto-closing complaints as verified after silence; erasing prior closure claims on reopen |
| **Jurisdiction** | Spatial containment/proximity yields `SPATIALLY_INFERRED_PROVISIONAL` (`spatialMatchMethod`, `distanceToBoundaryMeters`) | Treating map/OSM proximity or nearest-ward snapping as authoritative legal ownership |
| **DLP Warranty** | *"Potential DLP recovery or contractor rectification obligation. Financial responsibility pending contractual verification."* | Claiming `"₹0 municipal repair cost"` or automatic contractor legal liability |
| **Audit Trail** | *"Append-only, hash-linked audit log"* (backed by PostgreSQL `BEFORE UPDATE OR DELETE` trigger) | Calling a database hash chain `"immutable"` or `"tamper-proof"` |
| **Citizen Evidence** | Confidence signals (`CITIZEN_SUBMITTED`, `LOCATION_CONSISTENT`, `TIME_CONSISTENT`, `CORROBORATED`, `AUTHORITY_SUBMITTED`, `INDEPENDENTLY_VERIFIED`); pre-redacted local fixtures | Calling browser GPS/EXIF/camera capture `"authenticated evidence"` or `"forensically verified"` |
| **Deduplication** | Explicit `DEMONSTRATION_HEURISTIC_V1` badge; 3-way citizen choice (`Endorse Existing`, `Add Evidence`, `Create Separate`) | Silently dropping/rejecting reports; claiming AI/ML deduplication |
| **Secrets & PII** | Zero real citizen PII; synthetic personas via `X-Demo-Persona`; `.env.local` ignored & never printed | Hardcoded passwords in `compose.yaml`; committing `.env.local`, keys, or real user data |
| **Numeric Precision** | Money strictly in integer **paise** (`1 INR = 100 paise`); timestamps in **ISO-8601 UTC**; GeoJSON in **`[longitude, latitude]`** | Floating-point rupees; local-timezone ambiguous timestamps; `[lat, lon]` swapped GeoJSON |

---

## 3. MUMBAI & BMC INSTITUTIONAL DOMAIN REFERENCE (VERIFIED NOV 2026)

### 3.1 Official BMC Reality Check (Verified 20 November 2026)
- **FY 2026–27 Budget:** Approximately **₹80,952.56 crore** (tabled 25 Feb 2026), split across **Budget A** (General — Roads, SWD, SWM, Gardens, etc.), **Budget B** (Improvement/Slum), **Budget E** (Education), **Budget G** (Water Supply & Sewerage), plus Health funds.
- **Elected Representation (Official Primary Sources):** State Election Commission, Maharashtra (`mahasec.maharashtra.gov.in`) and official BMC (`portal.mcgm.gov.in`) confirm the 2025–26 municipal corporation election across **227 electoral wards (Prabhags)**.
  - **Prototype Rule:** Do **not** cite Wikipedia and do **not** embed personal names of elected councillors or BMC officers. Keep **deliberative ward-committee oversight** strictly separate from **administrative/engineering execution**, and keep community 2017 electoral GIS overlays explicitly tagged `2017 delimitation / context only`.
- **Official BMC Grievance & Disclosure Channels (`OFFICIAL_SOURCE_PENDING` for integration — no live connectors today):** `portal.mcgm.gov.in`, 24×7 helpline `1916`, Ward Citizen Facilitation Centres (CFCs), MyBMC Android/iOS apps, `mybmc Assist` WhatsApp chatbot (`+918999228999`), `SWD Desilting Dashboard 2026-27`, and `BMC_English Diary_2026.pdf` (updated Oct 2026). Note that BMC’s complaint system routes to special administrative units beyond the 24 geographic wards, proving pure polygon containment cannot guarantee operational routing.
- **Multi-Agency Overlap in Mumbai:** Roads, drains, transit corridors, and facilities within Mumbai’s geography may belong to **BMC**, **MMRDA** (Metro corridors), **MSRDC**, **PWD Maharashtra**, **MHADA**, **SRA**, **Indian Railways**, **Mumbai Port Authority (MbPA)**, or **BEST**.

### 3.2 BMC 7 Administrative Zones & 24 Administrative Wards Reference
| Zone | Region | Administrative Wards | Prototype Role |
|---|---|---|---|
| **Zone I** | Island City (South) | `A`, `B`, `C`, `D`, `E` | Reference list only |
| **Zone II** | Island City (North) | `F/S`, `F/N`, `G/S`, `G/N` | `G/N` comparative label only |
| **Zone III** | Western Suburbs (South) | `H/E`, `H/W`, `K/E` | Reference list only |
| **Zone IV** | Western Suburbs (Central) | **`K/W`**, `P/S`, `P/N` | **`K/W` (Andheri W / Juhu / Versova) PRIMARY DEMO WARD** |
| **Zone V** | Eastern Suburbs (South) | `L`, `M/E`, `M/W` | `M/E` comparative label only |
| **Zone VI** | Eastern Suburbs (North) | `N`, `S`, `T` | Reference list only |
| **Zone VII** | Western Suburbs (North) | `R/S`, `R/C`, `R/N` | Reference list only |

### 3.3 Ward-Level Institutional Post Matrix (Post Titles Only — Never Personal Names)
| Civic Domain | Ward-Level Institutional Post | Supervisory Reporting | Core Scope |
|---|---|---|---|
| Ward Administration | Assistant Municipal Commissioner (Ward Officer) | Zonal DMC (Zone I–VII) | Overall ward coordination across ~18 departments |
| Roads & Traffic | Assistant Engineer (Roads) | Dy. Chief Engineer (Roads) | Resurfacing, potholes, utility trench reinstatement |
| General Maintenance | Executive Engineer / AE (Maintenance) | Assistant Commissioner (Ward) | Footpaths, municipal markets, gardens, public toilets |
| Storm Water Drains (SWD) | Assistant Engineer (SWD) | Dy. Chief Engineer (SWD) | Nallah desilting, roadside drains, waterlogging pumps |
| Water Supply | Assistant Engineer (Water Works — AEWW) | Dy. Hydraulic Engineer | Pipelines, leakages, water pressure |
| Solid Waste (SWM) | Assistant Head Supervisor / Junior Overseer | Chief Engineer (SWM) | Waste collection, street sweeping |
| Public Health | Medical Officer of Health (MOH) | Zonal Dy. EHO | Municipal dispensaries, *Aapla Davakhana*, vector control |
| Education / Schools | Administrative Officer (Schools) / Ward Maintenance | Education Officer / Central Bldg Maintenance | Municipal school facility upkeep |

### 3.4 Four-Tier Source & Licence Provenance Classification
1. **VERIFIED (Official Primary Facts):** BMC FY 2026–27 budget framing, 2025–26 SEC 227-seat municipal structure, official MyBMC channels, DPDP Act 2023 + DPDP Rules 2025 timeline, CERT-In 2022 Directions, OWASP ASVS 5.0 / API Top 10 (2023), GIGW 3.0, OSMF Tile Usage Policy.
2. **COMMUNITY-REFERENCE (Context Only — Never Authoritative Jurisdiction):**
   - OpenStreetMap raster tiles (`© OpenStreetMap contributors`, `ODbL 1.0`): requires HTTPS, visible attribution, valid `Referer` (`Referrer-Policy: strict-origin-when-cross-origin`), no bulk caching/scraping, and an **offline neutral coordinate-grid fallback** if tiles are unreachable.
   - Bharatlas / OpenCity 24 admin wards & 2017 electoral wards (`CC0-1.0`): context reference only, never legal jurisdiction.
3. **SYNTHETIC (Default Operational Data):** All `SYN-DEMO-*` records in `data/demo/*.json` and self-generated local SVG/WebP fixture imagery.
4. **PENDING / EXCLUDED TODAY:** Authoritative BMC legal GIS boundaries, 2026 electoral delimitation GIS, live BMC APIs/SAP/CCRS, officer personal contacts, contractor fault records, Google Street View (ToS bans scraping/caching), and Mapillary/KartaView (`CC-BY-SA`/`CC-BY-NC-SA` excluded from demo repo).

---

## 4. FROZEN TECHNICAL ARCHITECTURE, STACK & SAME-DAY SIMPLIFICATIONS

### 4.1 Frozen Target Stack
| Layer | Frozen Selection | Exact Configuration / Policy |
|---|---|---|
| **Frontend** | React `18.3.1` + TypeScript `5.9.3` (strict) + Vite `6.4.1` | React Router `6.30.2`, TanStack Query `5.90.10`, Zod `3.25.76`, i18next `25.6.2`, Vitest `3.2.4`, Playwright + `@axe-core/playwright` (install in CAP-0). |
| **Mapping** | Vanilla **Leaflet `1.9.4`** behind `CivicMapAdapter` | **NO `react-leaflet`** (avoids v4/v5 React 18/19 peer conflict). MapLibre GL JS & PMTiles deferred post-demo (`protomaps-leaflet` is maintenance-mode / non-interactive). |
| **Backend** | **Rust (`stable`)** + **Axum `0.8`** + **Tokio `1`** + **SQLx `0.8`** | Port **`:8080`**. Modular monolith across 4 lean workspace crates (`api`, `domain`, `application`, `infrastructure`). OpenAPI 3.1 YAML is authoritative (**Utoipa deferred**). |
| **Database & GIS** | **PostgreSQL 17 + PostGIS 3.5** | Image `docker.io/postgis/postgis:17-3.5` (exact `@sha256` digest locked in CAP-0). Storage `EPSG:4326`; metre calculations via PostGIS `geography` / `EPSG:32643`. **No SQLite fallback.** |
| **Local Containers** | **Rootless Podman** (Windows 11 + WSL2) | `compose.yaml` runs **ONLY `db` (PostGIS)** during normal dev (`podman compose up -d db`). Rust API & Vite Web run natively on the host for fast edit-compile-test loops. |
| **Contracts** | OpenAPI `3.1.0` + JSON Schema `Draft 2020-12` | `openapi/openapi.yaml` + 12 strict `schemas/*.schema.json` (`additionalProperties: false`) + 6 `config/*-state-machine.json` + `config/duplicate-policy.json`. |
| **Tooling** | `pnpm` + Cargo workspace + `justfile` + Python 3 | Lock `Cargo.lock` and `pnpm-lock.yaml` on host in CAP-0. Note: update root `package.json` `packageManager` from `pnpm@11.28.9` to host-installed patched pnpm (`11.28.11` or `12.22.x`) if workspace linking hits issue `#17485`. |

### 4.2 Five Non-Dead-End Simplifications Adopted for Same-Day Delivery
1. **Runtime SQLx Queries (`sqlx::query` / `sqlx::query_as`):** Avoids `sqlx::query!` offline macro cache churn while preserving real PostgreSQL/PostGIS execution verified by SQLx integration tests.
2. **Contract-First OpenAPI YAML (Defer `utoipa`):** `openapi/openapi.yaml` is the single source of truth; generate TypeScript types (`openapi-typescript`) without fighting Rust OpenAPI proc-macros.
3. **Direct `leaflet@1.9.4` Inside `CivicMapAdapter`:** Eliminates `react-leaflet` peer-dependency churn and keeps a clean adapter seam for future MapLibre GL JS migration (triggered only at >5,000 live features, vector tiles/PMTiles, or 2.5D/3D approval).
4. **Podman DB-Only During Dev:** Never compile Rust inside a container during iterative development; run `podman compose up -d db` and run `cargo run` + `pnpm dev` natively on the host.
5. **Thin 4-Crate Rust Workspace (`api`, `domain`, `application`, `infrastructure`):** Avoid premature `async_trait` / `dyn Repository` trait-object boilerplate; pass `&PgPool` cleanly through concrete repositories.

### 4.3 `CivicMapAdapter` Interface & 12-Layer Z-Order
```ts
export interface CivicMapAdapter {
  initialize(container: HTMLElement): Promise<void>;
  setView(center: [number, number], zoom: number): void; // [lon, lat]
  renderWardBoundaries(wards: GeoJSON.FeatureCollection): void;
  renderAssets(assets: GeoJSON.FeatureCollection): void;
  renderPublicWorks(works: GeoJSON.FeatureCollection): void;
  renderIssues(issues: GeoJSON.FeatureCollection): void;
  startDrawing(mode: "Point" | "LineString" | "Polygon", onComplete: (geom: GeoJSON.Geometry) => void): void;
  highlightFeature(id: string): void;
  fitToGeometry(geometry: GeoJSON.Geometry): void;
  destroy(): void;
}
```
**Layer Stack Order (Bottom → Top):** `1` Basemap (`ODbL` + offline grid fallback) → `2` Admin Wards → `3` Optional Electoral Overlay (2017 context) → `4` Roads → `5` Drains (SWD) → `6` Facilities (Schools/Dispensaries) → `7` Public Works (Amber/Purple DLP halo) → `8` Civic Issues (`Point`/`LineString`/`Polygon`) → `9` Active Selection → `10` Citizen Drawing Geometry → `11` Duplicate-Search Radius Preview → `12` Tooltips/Popovers.

### 4.4 PostGIS Spatial & Audit Rules
- **Coordinate Order:** Strictly GeoJSON RFC 7946 `[longitude, latitude]` validated within Greater Mumbai bounds (`72.77 ≤ lon ≤ 72.99`, `18.89 ≤ lat ≤ 19.275`).
- **Indexes:** Create **both** raw `EPSG:4326` GIST indexes (for `ST_MakeEnvelope` bbox viewport queries) and `geography` / `ST_Transform(geom, 32643)` metric queries (for `ST_DWithin`, `ST_Distance`, duplicate radii, and geometry-aware completion proof).
- **Spatial Containment vs Jurisdiction:** Use `ST_Covers` for points (boundary-safe) and `ST_Intersects` for `LineString`/`Polygon` features (detecting multi-ward corridors). Always output `spatialMatchMethod`, `distanceToBoundaryMeters`, and `jurisdictionStatus = SPATIALLY_INFERRED_PROVISIONAL` — never auto-confirm legal ownership.
- **Validity & Append-Only Protection:** Enforce `CHECK (ST_IsValid(geom))` on spatial columns, and enforce a PostgreSQL `BEFORE UPDATE OR DELETE` trigger raising an exception on `lifecycle_events` / `append_only_audit_log`.

---

## 5. PHYSICAL REPOSITORY INVENTORY (v1.2.2) & CONTRACT REFERENCE

### 5.1 v1.2.2 Physical Layout (`85` Manifested Files)
```text
mumbai-civic-lens/
├── ARCHITECTURE.md, CLAUDE.md, DECISIONS.md, GUARDRAILS.md, README.md,
│   REQUIREMENTS.md, SPEC.md, TASKS.md, TESTING.md, WIREFRAME.md,
│   PROTOTYPE_DEFINITION_OF_DONE.md, P01-P12_IMPLEMENTATION_PLAN.md,
│   PACKAGE_RELEASE_NOTES.md, GEMINI_NARROW_CLOSURE_REVIEW_PROMPT.md
├── PACKAGE_MANIFEST.json (85 entries, SELF), PACKAGE_LOCK.json (CAP0_PENDING)
├── .env.example, .gitignore, compose.yaml, justfile
├── Cargo.toml, rust-toolchain.toml, package.json, pnpm-workspace.yaml
├── apps/web/
│   ├── index.html, package.json, tsconfig.json, vite.config.ts
│   └── src/ (main.tsx, styles.css)
├── crates/
│   ├── api/ (Cargo.toml, src/main.rs)
│   ├── application/ (Cargo.toml, src/lib.rs)
│   ├── domain/ (Cargo.toml, src/lib.rs)
│   └── infrastructure/ (Cargo.toml, src/lib.rs)
├── migrations/
│   └── 0001_core.sql
├── openapi/
│   └── openapi.yaml (22 operations on :8080)
├── schemas/ (12 strict Draft 2020-12 schemas, additionalProperties: false)
│   ├── budget-allocation.schema.json, civic-asset.schema.json, civic-issue.schema.json,
│   ├── contract.schema.json, contractor-record.schema.json, correction.schema.json,
│   ├── evidence.schema.json, jurisdiction.schema.json, lifecycle-event.schema.json,
│   ├── source-provenance.schema.json, verification.schema.json, work-order.schema.json
├── config/
│   ├── issue-state-machine.json, work-state-machine.json, evidence-state-machine.json,
│   ├── verification-state-machine.json, jurisdiction-state-machine.json,
│   ├── correction-state-machine.json, duplicate-policy.json, seed-schema-map.json
├── data/demo/
│   ├── wards.json, assets.json, budgets.json, contractors.json, contracts.json,
│   ├── work-orders.json, issues.json, evidence.json, corrections.json,
│   ├── demo-journeys.json, reset-manifest.json
├── wireframes/
│   └── pages.json (12 pages covering 18 logical screen contracts)
├── traceability/
│   └── journeys.json (J1–J6 mapped to R-01..R-10, PAGE-01..12, operationIds, tests)
├── tests/e2e/
│   └── journey-1.spec.ts .. journey-6.spec.ts (@playwright/test skeletons)
├── scripts/
│   ├── validate_package.py  <-- APPLY PATCH B-01 BEFORE CAP-0!
│   ├── check-prerequisites.ps1, check-prerequisites.sh
└── audit/
    ├── CAP0_REPORT_TEMPLATE.md, CONTRADICTIONS.json, OPEN_FINDINGS.json
```

### 5.2 Complete OpenAPI 3.1 Surface (`http://localhost:8080`)
- **Security Header:** `X-Demo-Persona` (`public | citizen | authority | moderator | independent_reviewer | demo_admin`) — enforce server-side returning RFC 9457 `401`/`403` when unauthorized personas invoke `/v1/authority/*`, `/v1/corrections/{id}/decision`, or `/v1/demo/reset`.
- **Mutation Headers:** `X-Correlation-Id` (required), `Idempotency-Key` (required on mutations), optimistic concurrency via `recordVersion` (and/or `If-Match` / `ETag` returning `409`/`412`).
- **Error Envelope:** RFC 9457 `application/problem+json` (`type`, `title`, `status`, `detail`, `correlationId`).

| Method & Path | `operationId` | Journey / Purpose |
|---|---|---|
| `GET /health/live`, `GET /health/ready`, `GET /version` | `healthLive`, `healthReady`, `getVersion` | Liveness, DB/PostGIS readiness, lock version *(set `security: []` in P1)* |
| `GET /v1/map/features` | `getMapFeatures` | Map GeoJSON (`ward`, `category`, `status`, `dlpOnly`, plus restore `bbox` in P1) |
| `GET /v1/issues` | `listIssues` | 1:1 Accessible list parity (`ward`, `category`, `status`, `dlpOnly`) |
| `POST /v1/issues` | `submitIssue` | J2 citizen report / endorsement / add-evidence submission |
| `GET /v1/issues/{id}` | `getIssue` | Issue summary / detail |
| `POST /v1/issues/{id}/duplicate-candidates` | `checkDuplicates` | J2 100-pt `DEMONSTRATION_HEURISTIC_V1` scoring |
| `POST /v1/issues/{id}/evidence` | `addEvidence` | J2 / J5 attach fixture evidence metadata + hash |
| `GET /v1/kundalis/{id}` | `getKundali` | J1–J6 full Civic Issue Kundali dossier |
| `GET /v1/works/{id}` | `getWorkOrder` | J1 / J3 work order, contractor, paise expenditure & DLP window |
| `GET /v1/budget-traces/{id}` | `getBudgetTrace` | J1 budget → contract → work → street outcome trace |
| `GET /v1/authority/dashboard` | `getAuthorityDashboard` | J3 / J4 / J5 authority counts & queues |
| `POST /v1/authority/issues/{id}/jurisdiction` | `resolveJurisdiction` | J4 confirm BMC ward/central or log external agency handoff |
| `POST /v1/authority/issues/{id}/work-link` | `linkWork` | J3 link unlinked defect to active DLP work order |
| `GET /v1/authority/dlp-exceptions` | `listDlpExceptions` | J3 list potential contractor DLP warranty exceptions |
| `POST /v1/authority/issues/{id}/completion-claim` | `claimCompletion` | J5 authority completion claim + evidence + ATR |
| `POST /v1/issues/{id}/verification` | `verifyResolution` | J5 citizen physical verdict (`FIXED` / `PARTLY_FIXED` / `STILL_UNRESOLVED`) |
| `POST /v1/records/{id}/corrections` | `submitCorrection` | J6 file correction challenge with prior/proposed values |
| `POST /v1/corrections/{id}/decision` | `decideCorrection` | J6 authority accept-with-diff or reject-with-reason |
| `POST /v1/corrections/{id}/appeal` | `appealCorrection` | J6 appeal a rejected correction for independent review |
| `GET /v1/audit/{entityId}` | `getAuditTimeline` | J5 / J6 append-only hash-linked lifecycle event timeline |
| `POST /v1/demo/reset` | `resetDemo` | Deterministic reset to `CP-00` returning verified digest |

> **P1 Contract-Freeze Refinements (Do in P1 before coding handlers):** (1) Restore `bbox` query param on `GET /v1/map/features`; (2) Add `security: []` on `/health/live`, `/health/ready`, `/version`; (3) Add `401`, `403`, `404`, `412` `$ref` Problem responses; (4) Replace generic `Command.payload` / `Result.data` with domain-specific DTO schemas so `openapi-typescript` generates strictly typed frontend clients; (5) Allow `recordNature` enum (`SYNTHETIC_DEMONSTRATION`, `COMMUNITY_REFERENCE`, `OFFICIAL_RECORD`) on `schemas/source-provenance.schema.json`.

---

## 6. SIX DOMAIN STATE MACHINES & DETERMINISTIC DUPLICATE POLICY

Every transition across all 6 state machines requires `allowedRoles`, `preconditions`, `requiredEvidence`, `emittedEvent`, `idempotency: REQUIRED_FOR_MUTATION`, and `concurrency: RECORD_VERSION_REQUIRED`.

### 6.1 Verified State-Transition Summary (`config/*-state-machine.json`)
1. **`ISSUE` (`config/issue-state-machine.json`):**
   - `DRAFT_LOCAL` → `SUBMITTED_UNVERIFIED` (`citizen`) → `TRIAGED_ASSIGNED` (`authority`) → `IN_PROGRESS` (`authority`) → `CLOSURE_CLAIMED_PENDING_VERIFICATION` (`authority`, requires `evidence`)
   - From `CLOSURE_CLAIMED_PENDING_VERIFICATION`:
     - → `VERIFIED_COMPLETE` (`citizen` / `independent_reviewer`, requires `evidence`) — **TERMINAL**; recurring defects spawn a **new child issue** via `childIssueCreation` (`newChildInitialState: SUBMITTED_UNVERIFIED`, `requiredLink: parentRecurrenceId`), never mutating closed history.
     - → `DISPUTED_REOPENED` (`citizen`, requires `evidence`) → `IN_PROGRESS` (`authority`).
     - → `CLOSURE_CLAIMED_UNVERIFIED_LAPSED` (`system`, window expired) → `DISPUTED_REOPENED` (`citizen` / `authority`). **Silence NEVER reaches `VERIFIED_COMPLETE`.**
2. **`WORK` (`config/work-state-machine.json`):**
   - `BUDGETED_PROPOSED` → `TENDER_PUBLISHED` (`→ RETENDER_REQUIRED → TENDER_PUBLISHED` | `→ CANCELLED` | `→ CONTRACT_AWARDED`) → `WORK_ORDER_ISSUED` (`→ SUSPENDED` | `→ IN_EXECUTION`) → `IN_EXECUTION` (`→ SUSPENDED → IN_EXECUTION` | `→ COMPLETION_CERTIFIED_IN_DLP`) → `DEFECT_NOTIFIED` (`→ IN_EXECUTION`) | `DLP_EXPIRED_ARCHIVED`.
3. **`EVIDENCE` (`config/evidence-state-machine.json`):**
   - `UPLOADED_QUARANTINE` → `PROCESSING` → `READY_FOR_REVIEW` (`→ PUBLISHED_PUBLIC`) | `PROCESSING_FAILED` → `MANUAL_REVIEW` (`→ PUBLISHED_PUBLIC` | `→ REJECTED`).
   - Geometry-aware proximity check (`Point`: 30m, `LineString`: 25m, `Polygon`: 15m, `Asset`: 20m in metric CRS) sets confidence signals — never auto-rejects citizen uploads.
4. **`VERIFICATION` (`config/verification-state-machine.json`):**
   - `AWAITING_AUTHORITY_CLAIM` → `WINDOW_OPEN` → `CITIZEN_CONFIRMED` | `CITIZEN_PARTLY_FIXED` (`→ WINDOW_OPEN` on new claim) | `CITIZEN_DISPUTED` (`→ WINDOW_OPEN` on new claim) | `WINDOW_EXPIRED_NO_VERDICT` → `INDEPENDENT_REVIEW_PENDING` → `INDEPENDENTLY_VERIFIED` | `CITIZEN_DISPUTED`.
5. **`JURISDICTION` (`config/jurisdiction-state-machine.json`):**
   - `UNKNOWN` → `SPATIALLY_INFERRED_PROVISIONAL` (`system`) → `CONFIRMED_BMC_WARD` | `EXTERNAL_AGENCY_ASSIGNED` (`→ HANDOFF_LOGGED`) | `CONFLICT_DISPUTED` (`→ CONFIRMED_BMC_WARD` | `CONFIRMED_BMC_CENTRAL` | `EXTERNAL_AGENCY_ASSIGNED`).
6. **`CORRECTION` (`config/correction-state-machine.json`):**
   - `CHALLENGE_SUBMITTED` → `UNDER_REVIEW` → `ACCEPTED_AMENDED` (preserves prior value & diff) | `REJECTED_WITH_REASON` → `APPEAL_SUBMITTED` (`citizen`) → `UNDER_REVIEW` (`authority`, independent reviewer).

### 6.2 Deterministic Duplicate-Detection Policy (`config/duplicate-policy.json`)
- **Label:** `DEMONSTRATION_HEURISTIC_V1` (never claim AI/ML deduplication).
- **100-Point Scoring Rubric:**
  - `sameAssetOrSegment`: **40 pts**
  - `sameCategory`: **20 pts**
  - `withinConfiguredRadius`: **20 pts** (`POTHOLE`: `20m`, `WATERLOGGING`: `150m`)
  - `withinConfiguredWindow`: **10 pts** (`POTHOLE`: `720h` / 30d, `WATERLOGGING`: `12h`)
  - `keywordOverlap`: **10 pts**
- **Decision Bands:** `80–100` = **Likely Same** | `55–79` = **Possible Match** | `0–54` = **Probably Distinct**.
- **Safety Rules:** `POTHOLE` considers carriageway side (`considerCarriagewaySide: true`); resolved (`VERIFIED_COMPLETE`) matches surface as **Possible Recurrence** (spawning linked child Kundali rather than merging); `silentRejectionForbidden: true`; UI **must** present all 3 buttons: **`ENDORSE_EXISTING`**, **`ADD_EVIDENCE_TO_EXISTING`**, and **`CREATE_SEPARATE_ISSUE`**.

---

## 7. UX, WIREFRAMES & 12-PAGE COMPRESSED UI ARCHITECTURE

### 7.1 18 Logical Screen Contracts Compressed Into 12 Pages (`wireframes/pages.json`)
| Page ID | Page Name | Logical Screens Absorbed | Primary Journeys |
|---|---|---|---|
| **`PAGE-01`** | Map/List Workspace | `PUB-001` Map Home, `PUB-002` Accessible List View (+ inline `PUB-003` search & `PUB-004` preview) | J1, J2, J3 |
| **`PAGE-02`** | Kundali Dossier | `PUB-005` Civic Issue Kundali (+ inline `PUB-011` Add Evidence drawer) | J1–J6 |
| **`PAGE-03`** | Work Order / Budget Trace | `PUB-006` Work Order Detail, `PUB-007` Budget Trace (incl. honest broken-link gap) | J1, J3 |
| **`PAGE-04`** | Report Issue | `PUB-008` Report Issue (Point/Line/Polygon map + non-map landmark parity) | J2 |
| **`PAGE-05`** | Duplicate Decision | `PUB-009` Duplicate Review (100-pt score breakdown + 3-way choice) | J2 |
| **`PAGE-06`** | Submission Receipt | `PUB-010` Submission Receipt (`SYN-DEMO-KND-*` ID, post title, next action) | J2 |
| **`PAGE-07`** | Resolution Verification | `PUB-012` Verify Resolution (before/after comparison, Fixed/Partly/Unresolved) | J5 |
| **`PAGE-08`** | Authority Command Centre | `AUTH-001` Command Dashboard (+ filtered queue/verification tabs) | J3, J4, J5 |
| **`PAGE-09`** | Jurisdiction / Work Linkage | `AUTH-003` Jurisdiction Resolution, `AUTH-005` Work Linkage | J3, J4 |
| **`PAGE-10`** | Completion / DLP Operations | `AUTH-007` Completion Claim, `AUTH-009` DLP Exception View | J3, J5 |
| **`PAGE-11`** | Correction / Audit Workspace | `PUB-015` Data Correction, `AUTH-010` Source Conflicts, `AUTH-011` Audit Timeline | J6 |
| **`PAGE-12`** | Demo Control / Methodology | `AUTH-014` Demo Reset (`CP-00`), `PUB-014` Methodology/Sources, `PUB-016` Locale/A11y | All (J6) |

### 7.2 Visual Design Tokens, Responsive Rules & Accessibility (WCAG 2.2 AA)
- **Civic Palette (No protected BMC logo):** Deep Maroon `#7A1F2B` (banner/primary), Navy `#14283D` (text/header), Warm Off-White `#FAF7F2` (canvas), Restrained Saffron `#D97706` (accent), Verified Green `#167A4A`, Pending Amber `#B7791F`, Disputed Red `#B42318` (never red on individuals).
- **Mandatory Target Viewports (Zero horizontal overflow):**
  - **Mobile (`390×844`):** Single column; map bottom sheet ≤55% height initially; map/list toggle always reachable; tables collapse into labelled `<dl>` cards; min touch target **44×44px**.
  - **Tablet (`768×1024`):** Collapsible filter drawer + main content.
  - **Desktop (`1440×900`):** 320px left filters + flexible center canvas + 380px right inspector.
- **Required Page States:** `loading`, `default`, `empty`, `partial-data`, `error` (+ map offline grid fallback).
- **Accessibility Essentials (WCAG 2.2 AA — exceeds GIGW 3.0's WCAG 2.1 AA):** 1:1 map/list filter parity (`PAGE-01`), keyboard focus order, visible focus outlines, `aria-live="polite"` selection announcements, colour-independent status badges (icon + label + colour), `prefers-reduced-motion` support, Devanagari `+35%` wrap allowance (`मराठी / हिंदी / EN`), **zero** critical/serious `axe-core` violations.

---

## 8. SIX CANONICAL JOURNEYS, SYNTHETIC SEED REGISTRY & DEMO PLAYBOOK

### 8.1 Master Traceability Matrix (`traceability/journeys.json` + `data/demo/*`)
| Journey | Story & Talking Point | Reqs | Pages | API Operations | Seed Records (`CP-00`) | Playwright Spec |
|---|---|---|---|---|---|---|
| **J1** | Budget → Contract → Work Order → Physical Street Outcome | `R-01`, `R-04`, `R-07` | `PAGE-01`, `02`, `03` | `getMapFeatures`, `getKundali`, `getWorkOrder`, `getBudgetTrace` | `SYN-DEMO-BUD-2026-001` (₹25L = `250000000` paise) → `SYN-DEMO-CON-001` (`SYN-DEMO-VND-001`, ₹18L) → `SYN-DEMO-WO-KW-2026-001` → `SYN-DEMO-AST-ROAD-001` → `SYN-DEMO-KND-KW-2026-001` | `tests/e2e/journey-1.spec.ts` |
| **J2** | Citizen Report → 100-pt Deterministic Duplicate Check → 3-Way Choice | `R-02`, `R-03` | `PAGE-01`, `04`, `05`, `06`, `02` | `submitIssue`, `checkDuplicates`, `getKundali` | `SYN-DEMO-KND-KW-2026-002` (`POTHOLE`, `SUBMITTED_UNVERIFIED`, `[72.83158, 19.11974]`, on `AST-ROAD-001`) | `tests/e2e/journey-2.spec.ts` |
| **J3** | Defect Within Active DLP → Potential Warranty Warning & Work Linkage | `R-04`, `R-10` | `PAGE-01`, `02`, `03`, `08`, `09`, `10` | `getKundali`, `getWorkOrder`, `listDlpExceptions`, `linkWork` | Unlinked `SYN-DEMO-KND-KW-2026-004` (`TRIAGED_ASSIGNED`, `workOrderId: null`, on `AST-ROAD-001`) linked live to `SYN-DEMO-WO-KW-2026-001` (`COMPLETION_CERTIFIED_IN_DLP`, `dlpEndsAt: 2027-03-31`) | `tests/e2e/journey-3.spec.ts` |
| **J4** | Cross-Department / External-Agency Provisional Jurisdiction Resolution | `R-02`, `R-04` | `PAGE-02`, `08`, `09` | `getKundali`, `resolveJurisdiction` | `SYN-DEMO-KND-KW-2026-003` (`WATERLOGGING` Polygon, `TRIAGED_ASSIGNED`, on `AST-DRAIN-001`, provisional `SYN-DEMO-WARD-KW`) | `tests/e2e/journey-4.spec.ts` |
| **J5** | Authority Completion Claim vs Citizen Physical Verification & Reopening | `R-05` | `PAGE-02`, `07`, `08`, `10` | `claimCompletion`, `verifyResolution`, `getAuditTimeline` | `SYN-DEMO-KND-KW-2026-001` (`CLOSURE_CLAIMED_PENDING_VERIFICATION`) + `SYN-DEMO-EVD-001` (Authority) & `SYN-DEMO-EVD-002` (Citizen) | `tests/e2e/journey-5.spec.ts` |
| **J6** | Source Conflict, Correction, Appeal & Append-Only Audit History | `R-06`, `R-07`, `R-08` | `PAGE-02`, `11`, `12` | `submitCorrection`, `decideCorrection`, `appealCorrection`, `getAuditTimeline`, `resetDemo` | `SYN-DEMO-COR-001` on `SYN-DEMO-KND-KW-2026-003` (`/jurisdiction/status`: `CONFIRMED_BMC_WARD` → `SPATIALLY_INFERRED_PROVISIONAL`, `APPEAL_SUBMITTED`) | `tests/e2e/journey-6.spec.ts` |

### 8.2 10-Minute Executive Demo Script & Recovery
1. **Pre-Flight (0:00):** Open `PAGE-12`, click **Reset to `CP-00`**, confirm verified seed digest & green `/health/ready`. Explicitly disclose synthetic data & non-official status.
2. **J1 (1:00):** Open `PAGE-01` (show desktop + mobile/list toggle) → click `KW-2026-001` → open `PAGE-02` Kundali → open `PAGE-03` Budget/Work Trace (`₹25L → ₹18L → Street`).
3. **J2 (2:30):** Switch persona to `citizen` → `PAGE-04` Report Pothole near `[72.83158, 19.11974]` → `PAGE-05` show 100-pt `DEMONSTRATION_HEURISTIC_V1` breakdown → demonstrate Endorse / Add Evidence / Create Separate → `PAGE-06` Receipt.
4. **J3 (4:00):** Switch persona to `authority` → `PAGE-08`/`PAGE-10` DLP Exceptions → link unlinked `KW-2026-004` to DLP-active `WO-KW-2026-001` (`PAGE-09`) → highlight safe disclaimer (*"Potential DLP recovery... pending contractual verification"*).
5. **J4 (5:30):** Open `KW-2026-003` (`PAGE-09`) → show `SPATIALLY_INFERRED_PROVISIONAL` guardrail → resolve cross-agency jurisdiction & log handoff while keeping public Kundali visible.
6. **J5 (7:00):** Show `KW-2026-001` claimed closed with `EVD-001` → switch to `citizen` (`PAGE-07`) → dispute as `STILL_UNRESOLVED` → confirm Kundali reopens to `DISPUTED_REOPENED` while preserving original claim in audit history.
7. **J6 & Close (8:30):** Open `PAGE-11` → inspect `SYN-DEMO-COR-001` prior/proposed diff, adjudication/appeal, and append-only hash-linked audit timeline → close on `PAGE-12` Methodology & honest limitations. **Recovery:** On any state drift, click `POST /v1/demo/reset` (`CP-00`).

---

## 9. MANDATORY PRE-CAP-0 PATCH (`B-01`) — EXACT DROP-IN FIX

Apply this **single 2-minute patch** to the unpacked `mumbai-civic-lens-claude-desktop-v1.2.2.zip` folder **before launching Claude Desktop** so `validate_package.py` works cleanly on Windows 11, ignores `.git`/`node_modules`/`target`/`.env.local`, catches `test.skip(` properly in `--release`, and restores the prohibited-phrase scan.

### Step 9.1 — Replace `scripts/validate_package.py` with:
```python
from pathlib import Path
import hashlib
import json
import re
import sys
import yaml
from jsonschema import Draft202012Validator

r = Path(__file__).resolve().parents[1]
errors = []

SKIP_DIRS = {
    ".git", "__pycache__", "node_modules", "target", "dist",
    ".venv", "playwright-report", "test-results"
}
SKIP_FILES = {".env.local", "Cargo.lock", "pnpm-lock.yaml"}

def load(path):
    try:
        return json.loads((r / path).read_text(encoding="utf-8"))
    except Exception as e:
        errors.append(f"invalid JSON {path}: {e}")
        return None

m = load("PACKAGE_MANIFEST.json")
if m:
    physical = {
        p.relative_to(r).as_posix()
        for p in r.rglob("*")
        if p.is_file()
        and not any(part in SKIP_DIRS for part in p.parts)
        and p.name not in SKIP_FILES
        and p.suffix != ".pyc"
    }
    listed = {x["path"] for x in m["files"]}
    for x in m["files"]:
        p = r / x["path"]
        if not p.exists():
            errors.append("missing " + x["path"])
            continue
        if p.suffix == ".pyc" or "__pycache__" in p.parts:
            errors.append("generated artifact manifested " + x["path"])
        if x.get("sha256") not in (None, "SELF"):
            if hashlib.sha256(p.read_bytes()).hexdigest() != x["sha256"]:
                errors.append("hash " + x["path"])
    for extra in physical - listed:
        errors.append("unmanifested " + extra)

try:
    api = yaml.safe_load((r / "openapi/openapi.yaml").read_text(encoding="utf-8"))
    if api.get("openapi") != "3.1.0":
        errors.append("OpenAPI version")
    for path, methods in api.get("paths", {}).items():
        for method, op in methods.items():
            if method.lower() not in {"get", "post", "put", "patch", "delete"}:
                continue
            if method.lower() != "get" and "requestBody" not in op:
                errors.append("missing requestBody " + op.get("operationId", "?"))
            if not any("content" in resp or "$ref" in resp for resp in op.get("responses", {}).values()):
                errors.append("untyped responses " + op.get("operationId", "?"))
except Exception as e:
    errors.append("OpenAPI parse " + str(e))

# Schema validation of demo seeds
schema_map = load("config/seed-schema-map.json") or {}
for stem, sname in schema_map.items():
    if not sname:
        continue
    schema = load(f"schemas/{sname}.schema.json")
    records = load(f"data/demo/{stem}.json") or []
    if schema:
        v = Draft202012Validator(schema)
        for rec in records:
            for e in v.iter_errors(rec):
                errors.append(f"schema {stem}/{rec.get('id')}: {e.message}")

# Referential integrity
sets = {
    n: {x["id"] for x in (load(f"data/demo/{n}.json") or [])}
    for n in ["assets", "budgets", "contracts", "work-orders", "issues", "evidence", "corrections", "contractors"]
}
for x in load("data/demo/contracts.json") or []:
    if x["budgetId"] not in sets["budgets"] or x["vendorId"] not in sets["contractors"]:
        errors.append("contract FK " + x["id"])
for x in load("data/demo/work-orders.json") or []:
    if x["contractId"] not in sets["contracts"] or x["assetId"] not in sets["assets"]:
        errors.append("work FK " + x["id"])
for x in load("data/demo/issues.json") or []:
    if x.get("assetId") not in sets["assets"] or (x.get("workOrderId") and x["workOrderId"] not in sets["work-orders"]):
        errors.append("issue FK " + x["id"])
for fn in ["evidence", "corrections"]:
    for x in load(f"data/demo/{fn}.json") or []:
        target = x.get("issueId") or x.get("entityId")
        if target not in sets["issues"]:
            errors.append(fn + " FK " + x["id"])

# Coordinate bounds [lon, lat]
def coords(g):
    c = g.get("coordinates", [])
    if c and isinstance(c[0], (int, float)):
        yield c
    elif isinstance(c, list):
        for z in c:
            if isinstance(z, list):
                yield from coords({"coordinates": z})

for x in load("data/demo/issues.json") or []:
    for lon, lat, *_ in coords(x["geometry"]):
        if not (72.77 <= lon <= 72.99 and 18.89 <= lat <= 19.275):
            errors.append("coordinate bounds " + x["id"])

# State-machine dead-end & invariant checks
terminal = {
    "VERIFIED_COMPLETE", "PUBLISHED_PUBLIC", "REJECTED", "INDEPENDENTLY_VERIFIED",
    "HANDOFF_LOGGED", "ACCEPTED_AMENDED", "WITHDRAWN", "CANCELLED",
    "DLP_EXPIRED_ARCHIVED", "CONFIRMED_BMC_WARD", "CONFIRMED_BMC_CENTRAL", "CITIZEN_CONFIRMED"
}
for p in (r / "config").glob("*-state-machine.json"):
    sm = load(p.relative_to(r).as_posix())
    frm = {t["from"] for t in sm["transitions"]}
    to = {t["to"] for t in sm["transitions"]}
    for state in to - frm - terminal:
        errors.append(f"dead-end {p.name}:{state}")
    if any(t["from"] == "WINDOW_EXPIRED_NO_VERDICT" and t["to"] == "CITIZEN_CONFIRMED" for t in sm["transitions"]):
        errors.append("silence verifies completion")
    if any(t["from"] == "VERIFIED_COMPLETE" for t in sm["transitions"]):
        errors.append("verified complete mutates")

# Traceability page coverage
pages = {x["pageId"] for x in (load("wireframes/pages.json") or {}).get("pages", [])}
tr = load("traceability/journeys.json") or {}
covered = set()
for row in tr.get("journeys", []):
    for pid in row["pageIds"]:
        if pid not in pages:
            errors.append("unknown page " + pid)
        covered.add(pid)
if covered != pages:
    errors.append("page coverage mismatch")

# Contradictions check
for x in (load("audit/CONTRADICTIONS.json") or {}).get("findings", []):
    if x.get("severity") == "BLOCKER" and x.get("status") == "OPEN":
        errors.append("open contradiction " + x.get("id", "?"))

# Prohibited claims check
PROHIBITED = [
    "official bmc integration",
    "zero municipal repair cost",
    "authenticated evidence",
    "immutable audit",
]
for p in r.rglob("*.md"):
    if any(part in SKIP_DIRS for part in p.parts):
        continue
    if p.name in {"GUARDRAILS.md", "CLAIM_POLICY.md", "GEMINI_NARROW_CLOSURE_REVIEW_PROMPT.md"}:
        continue
    text = p.read_text(encoding="utf-8", errors="ignore").lower()
    for bad in PROHIBITED:
        if bad in text:
            errors.append(f"prohibited phrase '{bad}' in {p.relative_to(r).as_posix()}")

# Release mode placeholder/skip test guard
if "--release" in sys.argv:
    for p in r.rglob("*.spec.ts"):
        if any(part in SKIP_DIRS for part in p.parts):
            continue
        t = p.read_text(encoding="utf-8")
        if re.search(r"\b(test|it|describe)\.(skip|todo|fixme)\b|async\s*\([^)]*\)\s*=>\s*\{\s*\}", t):
            errors.append("placeholder test " + p.relative_to(r).as_posix())

if errors:
    print("PACKAGE INVALID")
    for e in sorted(set(errors)):
        print("-", e)
    sys.exit(1)
print("PACKAGE VALID")
```

### Step 9.2 — Refresh `scripts/validate_package.py` Hash in `PACKAGE_MANIFEST.json` & Verify
Run in PowerShell (from inside `mumbai-civic-lens/`):
```powershell
python -c "import hashlib,json,pathlib; m=json.loads(pathlib.Path('PACKAGE_MANIFEST.json').read_text('utf-8')); h=hashlib.sha256(pathlib.Path('scripts/validate_package.py').read_bytes()).hexdigest(); [x.update({'sha256':h}) for x in m['files'] if x['path']=='scripts/validate_package.py']; pathlib.Path('PACKAGE_MANIFEST.json').write_text(json.dumps(m,indent=2)+'\n','utf-8'); print('Updated hash:', h)"
python scripts/validate_package.py
python scripts/validate_package.py --release
```
- **Expected:** `python scripts/validate_package.py` prints **`PACKAGE VALID`** (exit `0`). `python scripts/validate_package.py --release` prints **`PACKAGE INVALID`** listing all 6 placeholder tests (exit `1`).

### Step 9.3 — Local Spot-Check of 8 AI-Studio-Filtered Files (Do Once Before CAP-0)
Confirm visually on disk:
1. `.gitignore` ignores `.env.local`, `.env.*.local`, `target/`, `node_modules/`, `dist/`, `__pycache__/`, `*.pyc`, `*.key`, `*.pem`.
2. `.env.example` sets `PORT=8080`, `VITE_API_BASE_URL=http://localhost:8080`, `POSTGRES_PASSWORD=` (placeholder only, no SQLite).
3. `migrations/0001_core.sql` enables `postgis`, creates journey tables (`wards`, `assets`, `budgets`, `contracts`, `work_orders`, `issues`, `evidence`, `jurisdictions`, `verifications`, `corrections`, `lifecycle_events`, `idempotency_keys`), `ST_IsValid` checks, raw `EPSG:4326` GIST indexes, nullable `ward_candidate_id`, `parent_recurrence_id`, and `BEFORE UPDATE OR DELETE` append-only trigger.
4. `crates/{api,application,domain,infrastructure}/src/{main,lib}.rs` and `scripts/check-prerequisites.sh` exist cleanly.

---

## 10. SECURITY, PRIVACY, LICENSING & CLAIM-SAFETY GOVERNANCE

### 10.1 Active Prototype Controls (Required Today)
- **Secret Handling:** Create `.env.local` locally from `.env.example` (set local-only `POSTGRES_PASSWORD`); verify `git check-ignore -v .env.local`; never echo `.env.local` in terminal/Claude logs.
- **Role-Based Access Control (Demo Persona):** Validate `X-Demo-Persona` server-side in Axum middleware; return RFC 9457 `401`/`403` whenever `public`/`citizen` calls `/v1/authority/*`, `/v1/corrections/{id}/decision`, or `/v1/demo/reset` (OWASP API5:2023).
- **Input & Spatial Hardening:** Strict Zod/Serde deserialization (`additionalProperties: false` / `#[serde(deny_unknown_fields)]`), `tower_http::limit::RequestBodyLimitLayer`, Mumbai coordinate bounds & `ST_IsValid`, React auto-escaping, and `Referrer-Policy: strict-origin-when-cross-origin` (required for OSM tile server compliance).
- **Media Safety:** Local pre-redacted synthetic SVG/WebP fixtures only; zero real citizen uploads or personal imagery.

### 10.2 Future Pilot Legal & Standards Alignment (Documented — Not Implemented Today)
- **DPDP Act 2023 & DPDP Rules 2025 (Notified Nov 2025):** Phased compliance — Data Protection Board active (Nov 2025), Consent Managers active (**Nov 2026**), full Data Fiduciary obligations / 72h breach reporting / verifiable parental consent / IT Act Sec 43A repeal effective **13 May 2027** (IT Act Sec 43A / SPDI Rules remain binding until May 2027). Prototype holds **zero personal data**.
- **CERT-In Directions (28 Apr 2022):** 6-hour cyber incident reporting, 180-day ICT log retention in India, NIC/NPL NTP time sync — applies to production/pilot hosting.
- **Security & Accessibility Baselines:** OWASP ASVS `5.0.0` (Level 2 target for pilot), OWASP API Security Top 10 (`2023`), WCAG `2.2 AA` (meets and exceeds GIGW `3.0` WCAG `2.1 AA`), external daily audit-hash anchoring post-demo.

---

## 11. CLAUDE DESKTOP / CLAUDE CODE AUTONOMY, MODEL ROUTING & BUDGET POLICY

### 11.1 Capability-Based Model Routing (No Speculative Model IDs in Repo Files)
Verify actual selectable models in your account via `/model` during CAP-0. Never hardcode speculative future model names or prices into controlling repo documents.

| Role / Phase | Model Capability Tier | Reasoning Effort | Allowed Autonomy | Budget Share |
|---|---|---|---|---:|
| **CAP-0 Environment Gate** | Strongest visible **Sonnet** | `medium` | Read + diagnostic commands + lockfiles only | **4%** |
| **P1 Contract Freeze & Contradiction Closure** | Strongest visible **Opus** | `high` | Edit contracts/schemas/migrations/OpenAPI only | **8%** |
| **P2–P7 Vertical Implementation (Rust/PostGIS + React/Leaflet)** | Strongest visible **Sonnet** | `high` | Autonomous within frozen contracts; stop on contradiction | **58%** |
| **Formatting, Lint & Locale Boilerplate (`mr`/`hi`)** | Fastest reliable lower-cost **Claude** model | `low` | Non-logic formatting, lint fixes, draft translations | **2%** |
| **P8A Automated Tests (Rust/Vitest/Playwright/Axe)** | Strongest visible **Sonnet** | `medium` | Real executable tests + targeted local fixes | **8%** |
| **P8B Independent Adversarial Audit (SEPARATE SESSION)** | Strongest visible **Opus** | `high` | **READ-ONLY FIRST** in fresh session; zero self-approval | **10%** |
| **P8C Targeted Blocker Remediation & Demo Rehearsal** | Strongest visible **Sonnet** (+ narrow **Opus** closure) | `high` | Fix ONLY evidence-backed `BLOCKER`/`CRITICAL` findings | **10%** |

> **Hard Budget Rules:**
> - **Reserve ≥20%** strictly for P8B (Independent Opus Audit) + P8C (Targeted Remediation).
> - Never use ultra-premium/2×-cost tiers for routine boilerplate or prototype coding.
> - Never run two models in parallel implementing the same feature.
> - Use short, phase-bounded prompts referencing repo files on disk instead of pasting full chat history.
> - Confirm billing mode in CAP-0 (ensure no stray `ANTHROPIC_API_KEY` env var accidentally double-charges outside intended credit/plan).

### 11.2 Recommended Approval Settings in Claude Code / Claude Desktop Code Tab
- **Auto-approve safely:** File reads/edits inside `mumbai-civic-lens/`, `cargo`, `pnpm`, `python scripts/validate_package.py`, `podman compose up/down/ps`, `git status/diff/add/commit`.
- **Require explicit human confirmation:** Destructive filesystem deletes outside repo, `git push --force`, system-wide package installs, printing `.env.local`.

---

## 12. SAME-DAY DELIVERY EXECUTION PLAN (20 NOVEMBER 2026)

### 12.1 Scope Partitioning
- **MUST HAVE TODAY:** `B-01` patch; CAP-0 green; P1 contract freeze (`bbox` + typed DTOs); all 12 pages (`PAGE-01`–`PAGE-12`) covering all 18 logical screen contracts; real Rust/Axum `:8080` + PostGIS spatial queries + append-only trigger + `X-Demo-Persona` RBAC; all 6 journeys (`J1`–`J6`) working end-to-end; `POST /v1/demo/reset` (`CP-00`); real `cargo test` + 6 real Playwright specs (`journey-1..6.spec.ts`) + `axe-core` WCAG 2.2 AA (0 critical/serious) + responsive checks (`390×844`, `768×1024`, `1440×900`); separate read-only Opus audit; clean demo rehearsal.
- **SHOULD HAVE TODAY:** Full Marathi (`mr`) & Hindi (`hi`) copy beyond header/banner/status badges; archived visual screenshots; JSON/CSV audit export on `PAGE-11`; print-friendly receipt on `PAGE-06`.
- **DEFER:** Production OTP/JWT; live BMC APIs/scraping; WhatsApp/SMS; video/ML; third-party street imagery; MapLibre/PMTiles; 3D twin; MinIO/Redis/Kafka/K8s; full containerized API/Web builds during dev; public cloud deployment.

### 12.2 Dependency-Ordered Phases & Git Checkpoints
| Phase | Target Time | Core Work | Mandatory Exit Gate & Git Checkpoint |
|---|---:|---|---|
| **Pre-CAP-0** | 5–10 min | Apply `B-01` (`scripts/validate_package.py` + manifest hash); spot-check 8 filtered files; `git init` + create `.env.local` | `python scripts/validate_package.py` exits `0`; `--release` exits `1`; `git commit -m "chore: v1.2.2 baseline with B-01 validator fix"` |
| **CAP-0** | 20–30 min | Run `check-prerequisites.ps1`; `podman compose up -d db` (`pg_isready` + `EPSG:32643` + pin `@sha256` digest); verify `/model`; install `@playwright/test` + `@axe-core/playwright`; `cargo check`; `pnpm build`; write `audit/CAP0_REPORT.md` | All tools + DB + builds green; `PACKAGE_LOCK.json` updated; `git commit -m "chore(cap-0): lock host toolchain, lockfiles and postgis digest"` |
| **P1** *(Opus)* | 25–35 min | Freeze OpenAPI (`bbox`, `security: []` on health, typed DTOs, `401/403/404/412`); verify `migrations/0001_core.sql` covers all 14 tables/indexes/triggers; generate TS types (`openapi-typescript`) | `validate_package.py` exits `0`; migrations apply cleanly; `git commit -m "chore(p1): freeze openapi dto contracts and postgis migrations"` |
| **P2** *(Sonnet)* | 35–45 min | App shell (`PAGE-12` locale/persona switcher, persistent maroon demo banner, responsive nav, design tokens, API client + error boundary) | `tsc -b && vite build` green; banner visible across `390/768/1440`; `git commit -m "feat(p2): responsive shell, demo banner and persona switcher"` |
| **P3** *(Sonnet)* | 50–70 min | Rust backend core (PostGIS spatial queries, `/health/*`, `/v1/map/features`, `/v1/issues`, `POST /v1/demo/reset`) + `LeafletMapAdapter` + `PAGE-01` (Map/List 1:1 parity + offline grid fallback) | `cargo test` (spatial + reset idempotency) + `pnpm build` green; `git commit -m "feat(p3): postgis spatial api, reset and map-list parity"` |
| **P4** *(Sonnet)* | 45–60 min | Backend `/v1/kundalis/{id}`, `/v1/works/{id}`, `/v1/budget-traces/{id}` + `PAGE-02` (Kundali) & `PAGE-03` (Work Order / Budget Trace in formatted INR from integer paise) | J1 works live end-to-end; `cargo test` green; `git commit -m "feat(p4): kundali dossier, work order and budget trace"` |
| **P5** *(Sonnet)* | 45–60 min | Backend 40/20/20/10/10 duplicate scorer (`DEMONSTRATION_HEURISTIC_V1`), `POST /v1/issues`, `POST /v1/issues/{id}/duplicate-candidates`, `/evidence` + `PAGE-04` (Report + landmark parity), `PAGE-05` (3-way Duplicate Decision), `PAGE-06` (Receipt) | J2 works live end-to-end; duplicate unit tests (sum=100, bands, side) green; `git commit -m "feat(p5): citizen reporting and deterministic deduplication"` |
| **P6** *(Sonnet)* | 45–60 min | Backend `X-Demo-Persona` RBAC (`401/403`), `/v1/authority/*` (dashboard, jurisdiction, work-link, dlp-exceptions) + `PAGE-08` (Command Centre), `PAGE-09` (Jurisdiction/Work Linkage), `PAGE-10` (DLP Exceptions & safe disclaimer) | J3 & J4 work live end-to-end; RBAC `403` & provisional-jurisdiction tests green; `git commit -m "feat(p6): authority command, jurisdiction handoff and dlp linkage"` |
| **P7** *(Sonnet)* | 50–65 min | Backend completion-claim, citizen verification (reopen preserving claim), correction/decision/appeal, append-only hash-linked audit log + `PAGE-07` (Verification), `PAGE-10` (Completion Claim), `PAGE-11` (Correction/Audit), `PAGE-12` (Reset UI) | J5 & J6 work live end-to-end; illegal state transition & DB append-only trigger tests green; `git commit -m "feat(p7): verification, correction appeal and append-only audit"` |
| **P8A** *(Sonnet + Fast)* | 45–60 min | Replace all 6 `tests/e2e/journey-1..6.spec.ts` placeholders with real Playwright tests + `axe-core` (0 critical/serious) + 3-viewport overflow checks + `mr`/`hi` locale polish | `cargo clippy -- -D warnings && cargo test && pnpm test && npx playwright test && python scripts/validate_package.py --release` ALL EXIT `0`; `git commit -m "test(p8): executable six-journey playwright, a11y and release validation"` |
| **P8B–C** *(Separate Opus → Sonnet)* | 60–75 min | Fresh read-only Opus audit (`audit/OPUS_ADVERSARIAL_REVIEW.md`, `audit/FINDINGS.json`) → fix ONLY `BLOCKER`/`CRITICAL` items → clean `CP-00` timed demo rehearsal | 0 open `BLOCKER`/`CRITICAL` findings; `audit/CLOSURE_REPORT.md` signed; clean demo rehearsal pass |

### 12.3 Slip-Management Cuts vs Never-Cut Invariants
- **Approved Cuts if Behind Schedule (>60 min slip):** (1) Limit Marathi/Hindi copy to banner, nav, and status badges; (2) Keep `PUB-014` Methodology as a clean section inside `PAGE-12`; (3) Skip CSV export on `PAGE-11` (retain JSON view); (4) Skip archived visual-diff PNG baselines (keep automated horizontal-overflow assertions).
- **NEVER CUT:** Persistent maroon demo banner; `SYN-DEMO-*` IDs; zero real PII/officer names/secrets; silence ≠ verified; provisional spatial jurisdiction guardrail; safe DLP wording; append-only hash-linked trigger; map/list parity (`PAGE-01`); 3-way duplicate choice; real PostGIS queries; 6 real Playwright E2E tests; separate read-only Opus audit.

---

## 13. COPY-PASTE PROMPT LIBRARY FOR CLAUDE DESKTOP / CLAUDE CODE

### Prompt A — CAP-0 Capability Gate (Run FIRST After Applying `B-01`)
```text
Open and inspect this repository (`mumbai-civic-lens/`) as the bounded implementation agent using the strongest visibly available Sonnet model.

Read in this exact order before running any command:
1. PACKAGE_MANIFEST.json
2. CLAUDE.md
3. GUARDRAILS.md
4. DECISIONS.md
5. P01-P12_IMPLEMENTATION_PLAN.md
6. audit/OPEN_FINDINGS.json
7. audit/CONTRADICTIONS.json

EXECUTE CAP-0 ONLY. Do NOT write feature code yet.

1. Run `scripts/check-prerequisites.ps1` (or `.sh`) and record exact versions of Git, Rust (`rustc -V`), Cargo, Node, pnpm, Python (+ verify `pyyaml` and `jsonschema`), Podman (confirm WSL2 machine running), and exact visibly selectable Claude models (`/model`).
2. Verify `git check-ignore -v .env.local` passes, confirm `.env.local` exists locally with a local-only `POSTGRES_PASSWORD`, and NEVER print `.env.local` or secrets.
3. Inspect `.env.example`, `.gitignore`, `migrations/0001_core.sql`, and `crates/*/src/{main,lib}.rs` and confirm they match our frozen rules (port 8080, PostGIS tables/GIST/append-only trigger, no secrets).
4. Start PostgreSQL/PostGIS via `podman compose up -d db`, verify `pg_isready` is healthy, confirm PostGIS version & `EPSG:32643`, and capture the exact pulled `docker.io/postgis/postgis:17-3.5@sha256:...` digest.
5. Run `python scripts/validate_package.py` (must exit 0) and `python scripts/validate_package.py --release` (must exit non-zero on skipped placeholder tests).
6. Run `cargo check --workspace` and `pnpm install && pnpm --filter web build` (add `@playwright/test` and `@axe-core/playwright` cleanly if absent, and update `packageManager` if `pnpm@11.28.9` hits workspace linking errors).
7. Record exact verified versions, lockfile generation (`Cargo.lock`, `pnpm-lock.yaml`), image digest, and selectable Claude models in `PACKAGE_LOCK.json` and `audit/CAP0_REPORT.md` (using `audit/CAP0_REPORT_TEMPLATE.md`). Update `audit/OPEN_FINDINGS.json` honestly.
8. Commit `chore(cap-0): verify host toolchain, lockfiles and postgis digest`.

FAIL CLOSED: If Rust, Podman/PostGIS, validator, or frontend build fails, STOP immediately and report exact failing output and bounded fix. Do not proceed to P1 until CAP-0 is green.
```

### Prompt B — Bounded Phase Implementation Prompt (Reuse for P1 through P8A)
```text
Continue bounded implementation of **Mumbai Civic Lens** starting from the committed Git checkpoint.
Obey `CLAUDE.md`, `GUARDRAILS.md`, `DECISIONS.md`, `openapi/openapi.yaml`, `schemas/*.schema.json`, `config/*-state-machine.json`, `config/duplicate-policy.json`, and `wireframes/pages.json`.

ACTIVE PHASE: [INSERT PHASE — e.g., P1 Contract Freeze (use Opus) / P2 Shell / P3 Map-List / P4 Kundali-Work-Budget / P5 Report-Dedup / P6 Authority-DLP-Jurisdiction / P7 Verification-Correction-Audit-Reset / P8A Six Playwright Journeys & Axe]

RULES:
- Implement ONLY the active phase scope in `TASKS.md` and `P01-P12_IMPLEMENTATION_PLAN.md`.
- Preserve frozen stack: React 18.3.1 + TS strict + Vite + direct Leaflet 1.9.4 behind `CivicMapAdapter` (no `react-leaflet`); Rust stable + Axum 0.8 + SQLx 0.8 runtime queries on `:8080` (no Utoipa); Podman DB-only (`db`).
- Enforce all non-negotiable guardrails: persistent maroon demo banner, `SYN-DEMO-*` IDs, `X-Demo-Persona` RBAC (`401/403`), integer paise, UTC ISO-8601, GeoJSON `[lon, lat]`, `SPATIALLY_INFERRED_PROVISIONAL`, silence != verified, safe DLP wording, append-only hash-linked audit log, 3-way duplicate choice (`DEMONSTRATION_HEURISTIC_V1`).
- On any contradiction between controlling files: log in `audit/CONTRADICTIONS.json`, STOP the affected task, and propose one bounded resolution. Never silently guess.
- Never write placeholder/skipped tests or claim pass without executing real commands.

REQUIRED EXIT EVIDENCE BEFORE STOPPING:
1. Run `python scripts/validate_package.py` (use `--release` at P8A).
2. Run `cargo clippy --workspace -- -D warnings && cargo test --workspace`.
3. Run `pnpm --filter web build && pnpm --filter web test` (plus `npx playwright test` at P8A).
4. Commit clean changes with a descriptive phase commit message and report raw pass/fail summaries only.
```

### Prompt C — Separate Fresh Read-Only Opus Adversarial Audit (Session B — After P8A)
```text
Open this repository in a FRESH, INDEPENDENT session as the **Adversarial Release Auditor** using the strongest visibly available **Opus** model.

OPERATING MODE: **READ-ONLY FIRST.** Do NOT modify application code. Do NOT accept any prior "PASS" statement without inspecting physical files, actual test outputs, and rendered UI evidence.

AUDIT SCOPE:
1. Contracts & Guardrails: Verify `openapi/openapi.yaml`, `schemas/*.schema.json`, `config/*-state-machine.json`, `config/duplicate-policy.json`, `GUARDRAILS.md`, and `audit/CONTRADICTIONS.json` (zero open BLOCKERs).
2. Backend & PostGIS: Verify real PostGIS spatial queries (`ST_Covers`/`ST_Intersects`/`ST_DWithin`), `X-Demo-Persona` RBAC (`401/403`), optimistic concurrency (`recordVersion`), `Idempotency-Key`, append-only DB trigger, integer paise, and deterministic `POST /v1/demo/reset` (`CP-00`).
3. Frontend & UX: Verify all 12 pages (`PAGE-01`–`PAGE-12`), map/list 1:1 parity, `390×844` / `768×1024` / `1440×900` zero horizontal overflow, persistent maroon demo banner, WCAG 2.2 AA (`axe-core` critical/serious = 0), and no console errors.
4. Claim Safety & Privacy: Verify zero prohibited phrases (`official BMC integration`, `₹0 municipal cost`, `authenticated evidence`, `immutable audit`, contractor culpability), zero real PII/officer names, and `.env.local` excluded from Git.
5. Test Honesty: Run `python scripts/validate_package.py --release`, `cargo test --workspace`, `pnpm --filter web test`, and `npx playwright test`; verify zero `test.skip`, `it.todo`, or empty assertions.

DELIVERABLES (Write ONLY inside `audit/`):
- `audit/OPUS_ADVERSARIAL_REVIEW.md`
- `audit/FINDINGS.json` (severities: `BLOCKER`, `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, `OBSERVATION`)
- `audit/RELEASE_BLOCKERS.md` (explicit PASS / FAIL — no pass allowed while any `BLOCKER` or `CRITICAL` remains open).
```

### Prompt D — Narrow Post-Audit Remediation & Closure
```text
Read `audit/FINDINGS.json` and `audit/RELEASE_BLOCKERS.md`.
Fix ONLY evidence-backed `BLOCKER` and `CRITICAL` findings using minimal, localized edits (never rewrite unrelated modules).
After fixing:
1. Re-run `python scripts/validate_package.py --release`, `cargo clippy --workspace -- -D warnings`, `cargo test --workspace`, `pnpm --filter web build`, `pnpm --filter web test`, and `npx playwright test`.
2. Execute `POST /v1/demo/reset` (`CP-00`) twice and confirm identical manifest/state digest.
3. Update `audit/OPEN_FINDINGS.json` and commit `fix(audit): close release blockers`.
Then run a narrow Opus verification check to issue `audit/CLOSURE_REPORT.md`.
```

---

## 14. PRE-FLIGHT GO/NO-GO & FINAL RELEASE CHECKLISTS

### 14.1 Pre-CAP-0 Go/No-Go Checklist (Execute Before Opening Claude Desktop)
- [ ] Unpacked `mumbai-civic-lens-claude-desktop-v1.2.2.zip` cleanly and initialized Git (`git init`).
- [ ] Applied **Patch `B-01`** to `scripts/validate_package.py` and updated its SHA-256 in `PACKAGE_MANIFEST.json`.
- [ ] Verified `python scripts/validate_package.py` exits **`0`** (`PACKAGE VALID`) and `python scripts/validate_package.py --release` exits **`1`** (catching all 6 `test.skip` files).
- [ ] Visually verified `.gitignore` (ignores `.env.local` & `*.pyc`), `.env.example` (port `8080`), `migrations/0001_core.sql`, and created local `.env.local`.
- [ ] Verified `podman` (WSL2 machine running), `rustc`, `cargo`, `node`, `pnpm`, `python` (`pyyaml`, `jsonschema`), and `git` are on PATH.
- [ ] Verified Claude Desktop / Claude Code billing mode and reserved **≥20% of budget** for separate read-only Opus audit + targeted remediation.

### 14.2 Final Prototype Release Gates (Before Civic Authority Demo)
- [ ] **Gate A (Contracts & Docs):** Zero `OPEN` `BLOCKER` contradictions; honest demo-vs-pilot boundary; all synthetic records `SYN-DEMO-*`.
- [ ] **Gate B (Functionality):** All 6 journeys (`J1`–`J6`) pass end-to-end twice after independent `POST /v1/demo/reset` (`CP-00`) calls.
- [ ] **Gate C (Responsive UX):** Zero horizontal overflow or clipped controls at `390×844`, `768×1024`, and `1440×900`.
- [ ] **Gate D (Accessibility):** WCAG 2.2 AA target; 1:1 map/list parity; keyboard operable; colour-independent status; `axe-core` critical/serious = **0**.
- [ ] **Gate E (Engineering & Security):** `validate_package.py --release`, `cargo clippy -- -D warnings`, `cargo test`, `pnpm build`, `vitest`, and all 6 Playwright specs exit **`0`**; zero console errors; zero committed secrets; `X-Demo-Persona` `401/403` enforced.
- [ ] **Gate F (Audit & Honesty):** Separate read-only Opus adversarial audit closed with **0 `BLOCKER` / 0 `CRITICAL`** findings; `THIRD_PARTY_NOTICES.md` populated; zero prohibited claims anywhere in UI or repo.
```