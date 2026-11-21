# P2 report: responsive shell, design system, persona lens, i18n shell and client foundation (v1.2.3)

Date: 2026-11-20 (IST). Operator: Claude Sonnet 5.5, High effort. Opus and Haiku not invoked. No remote push. This is implementation evidence, not release approval: P-13 and P-14 remain OPEN, as do CAP0-F05 and CAP0-F08.

Baseline checked first: clean tree on `main`, HEAD `3f0f8e8`, `python scripts/validate_package.py` exit 0, `pnpm --filter web build` exit 0.

## 1. Authoritative scope versus deferred candidates

The controlling files are thin on P2. `P01-P12_IMPLEMENTATION_PLAN.md` and `TASKS.md` give only "P2 shell/design/personas"; `WIREFRAME.md`/`wireframes/pages.json` fix the twelve pages, viewports, states and the "persistent synthetic banner"; `TESTING.md` fixes the Vitest/axe/viewport gates. The per-phase detail (locale/persona switcher, banner, responsive nav, tokens, API client, error boundary) comes only from the supplementary, non-controlling v1.2.2 reference guide, so it is used as a planning aid, not as authority.

| Candidate | Decision | Basis |
|---|---|---|
| Design tokens, responsive shell, persistent disclosure banner | Implemented | "shell/design" in the plan; `pages.json` `disclosure` on every page |
| 12-route inventory with honest placeholders | Implemented | `pages.json` PAGE-01..12; no operational data shown |
| Simulated persona presentation lens | Implemented | "personas" in the plan; wording from `openapi.yaml` |
| i18n shell (en complete, hi/mr bounded starter) | Implemented | guide P2 row (locale switcher); `i18next` 25.6.2 was already a frozen dependency |
| Integer-paise formatter (frontend) | Implemented | listed in the P2 brief and Vitest gate; mirrors `crates/domain/src/money.rs`; no data-authority change |
| API client foundation + error boundary | Implemented (exercised by unit tests only) | guide P2 row; `zod` already a dependency |
| `CivicMapAdapter` interface | **Deferred to P3** | not assigned to P2 by any controlling file; the guide places `LeafletMapAdapter` and PAGE-01 in P3, and no P3 need is confirmed yet |
| Leaflet implementation, `react-leaflet` | Deferred / prohibited | P3; `react-leaflet` is excluded by DECISIONS.md |
| TanStack Query hooks and live API probe | Deferred to P3 | first consumer is P3; the Rust API is still a `/health/live` stub, and a live probe would add console errors that P8 forbids |
| OpenAPI type generation (`openapi-typescript`) | Not added | no controlling file requires a generator; instead header names, persona roles, statuses and Problem fields are asserted against the frozen files in `contract.test.ts` |
| Playwright journeys, axe, 6 e2e specs | Untouched / P8 | `tests/e2e/journey-1..6.spec.ts` stay placeholders (P-13) |

New dependencies: **none** (`package.json` and `pnpm-lock.yaml` unchanged). Test tooling is Vitest plus `react-dom/server`, so no jsdom or Testing Library was added.

## 2. What was built (`apps/web/src/`)

- **Tokens and shell** (`styles.css`, `components/AppShell|DisclosureBanner|NavMenu|ControlBar`): palette `#7A1F2B/#14283D/#FAF7F2/#D97706/#167A4A/#B7791F/#B42318` as proposed (the existing CSS already used maroon, navy and canvas); no BMC logo, seal or insignia. Skip link, one `<main>`, named nav, 44px targets, visible `:focus-visible`, `prefers-reduced-motion`, `forced-colors` rules.
- **Disclosure**: a named static region (`<section aria-label>`, not `role="status"`, not a live region) rendered by the shell outside `<main>`, so it is on every route including not-found and error states and is not re-announced on navigation. Text: "DEMONSTRATION · SYNTHETIC DATA · NOT AN OFFICIAL BMC PORTAL" plus the `SYN-DEMO-*` note.
- **Routes** (`routes.ts`, `App.tsx`): `/page-01` to `/page-12`, one per `pages.json` entry, in order; `/` redirects to `/page-01`; unknown paths show a not-found page inside the shell. Paths are derived from page ids, never titles (see P2-F02). Each page shows its name, `Not implemented in this phase`, the page id and the planned phase.
- **Status and state vocabulary** (`components/status.ts`, `StatusBadge`, `StateNotice`): the seven `IssueStatus` values each get a unique icon plus full text; dashed (pending) and double (disputed) borders keep them distinct without colour; red tone is used only for `DISPUTED_REOPENED` and for failed/unavailable states; a closure claim renders as pending, never verified. Five distinct data states: loading, empty, partial, unavailable, not-implemented.
- **Persona lens** (`state/personas.ts`, `PersonaContext.tsx`, `ControlBar`): wire values `public, citizen, authority, moderator, independent_reviewer, demo_admin` (the non-`system` values of `LifecycleEvent.actorRole`; see P2-F01) are the `<option value>`; translated labels are separate i18n keys. Disclaimer text equals the OpenAPI wording. In-memory only; invalid input falls back to `public`. No storage API is used (a test pins this).
- **i18n** (`i18n/*`): flat keys, fallback to English, `returnEmptyString:false`, synchronous init, isolated instance per provider. `en` complete for the shell; `hi` and `mr` are starter bundles for banner, nav, persona lens, language names, status badges and page names (see P2-F05).
- **Formatter** (`lib/currency.ts`): BigInt-based, truncating, rejects negative, fractional and out-of-range input; reproduces every `assert_eq!(f(N), "text")` vector parsed from `money.rs`.
- **API client** (`api/*`): base URL `import.meta.env.VITE_API_BASE_URL || "http://localhost:8080"`; `X-Correlation-Id` on every request and `Idempotency-Key` on commands via `crypto.randomUUID()` with a `getRandomValues` v4 fallback (throws if no crypto source; never `Math.random`); commands send `{recordVersion, payload}` and, when asked, `If-Match` derived as `"{recordVersion}"` from the same number; `X-Demo-Persona` is sent only by this client, read through a stable getter; RFC 9457 parsed into a typed `ProblemDetails` (unknown members kept in `extensions`), 409 exposed as `isStaleWrite`; network failure, timeout, caller abort, non-JSON errors, malformed problem bodies and unreadable success bodies map to distinct errors with no invented Problem.

## 3. Evidence

| Check | Result |
|---|---|
| `pnpm --filter web build` (`tsc -b && vite build`) | exit 0; 61 modules; JS 285.02 kB (86.97 kB gzip), CSS 5.95 kB |
| `pnpm --filter web test` (`vitest run`) | exit 0; 7 files, 123 tests passed: a11y-static 14, personas 12, currency 5, i18n 9, api client 25, contract drift 13, shell/components 45 |
| `CARGO_REGISTRIES_CRATES_IO_PROTOCOL=git cargo check --workspace --locked` | exit 0 |
| `python scripts/validate_package.py` | exit 0 after manifest sync (see commit); `--release` not run and expected to fail on the six placeholder specs |
| P1 artifacts | `git diff HEAD` on `openapi schemas migrations data config crates tests/p1` is empty. P1 Python tests were not re-run: the venv with `openapi-spec-validator` from P1 is not on this host's global Python (import error), and no P1 file changed. `validate_package.py` still validates the OpenAPI, schemas and seeds. |

### Responsive and keyboard evidence (hand-run, built-in browser, `vite preview` of the production build)
Run once against `http://localhost:4173`, with the viewport emulated by the browser pane and checked via `document.documentElement.scrollWidth > clientWidth` and `getBoundingClientRect()`.

| Viewport | Result |
|---|---|
| 390x844 | no horizontal overflow on any of the 12 pages, in each of en, hi, mr (36 page views); banner visible; nav is a disclosure (`aria-expanded` toggles, closes after navigation); 0 interactive elements under 44x44 |
| 768x1024 | no horizontal overflow on 12 pages; disclosure nav; 0 targets under 44px |
| 1440x900 | no horizontal overflow on 12 pages; permanent 16rem nav rail; every nav link 44px tall; 0 targets under 44px |
| Keyboard and behaviour | first Tab lands on the visible skip link; client navigation updates `document.title` and moves focus to the page `<h1>`; persona stays `authority` across navigation and language switches; `<html lang>` follows the language; no console errors |

Caveats (also P2-F04): these are manual single-run checks, not repeatable automated tests, and they do not satisfy P-13. Forced-colours was not rendered in a browser; only the CSS rules exist and are asserted statically. No axe run was made (axe is not installed; it is a P8 gate), and nothing here claims WCAG conformance. Token contrast is computed in a test (text pairs at least 4.5:1, status borders at least 3:1).

## 4. Changes to P1 artifacts
None. No P1 contract, schema, migration, seed, domain or reset file was modified or regenerated.

## 5. Open items carried forward
CAP0-F05, CAP0-F08, P-13 and P-14 stay OPEN and unchanged. New P2 findings, all OPEN: P2-F01 (persona enum is only implicit in the contract), P2-F02 (route paths are not defined by any controlling file), P2-F03 (no reload persistence), P2-F04 (limited a11y/responsive tooling), P2-F05 (hi/mr starter bundles unreviewed). See `audit/OPEN_FINDINGS.json`.
