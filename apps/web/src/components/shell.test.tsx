import { QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import { describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { ApiClientProvider, useApiClient } from "../api/ApiClientContext";
import { ApiClient } from "../api/client";
import { I18nProvider } from "../i18n/I18nContext";
import { createQueryClient } from "../features/map-list/queries";
import { en, hi, mr, type Language } from "../i18n/resources";
import { HOME_PATH, PAGE_ROUTES } from "../routes";
import { PersonaProvider } from "../state/PersonaContext";
import { DEMO_PERSONAS } from "../state/personas";
import { ErrorBoundary, ErrorFallback } from "./ErrorBoundary";
import { StateNotice, STATE_KINDS } from "./StateNotice";
import { StatusBadge } from "./StatusBadge";
import { ISSUE_STATUSES, STATUS_PRESENTATION } from "./status";

function render(path: string, opts: { language?: Language; persona?: unknown } = {}): string {
  return renderToStaticMarkup(
    <I18nProvider initialLanguage={opts.language ?? "en"}>
      <PersonaProvider initial={opts.persona}>
        <ApiClientProvider>
          <QueryClientProvider client={createQueryClient()}>
            <StaticRouter location={path}>
              <App />
            </StaticRouter>
          </QueryClientProvider>
        </ApiClientProvider>
      </PersonaProvider>
    </I18nProvider>,
  );
}

const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

describe("persistent disclosure banner", () => {
  const paths = [...PAGE_ROUTES.map((r) => r.path), "/not-a-page"];

  it.each(paths)("is rendered on %s as a named, static landmark outside <main>", (path) => {
    const html = render(path);
    expect(html).toContain('data-testid="disclosure-banner"');
    expect(html).toContain("Mumbai Civic Lens • Demonstration environment • Not an official BMC service");
    // exactly one global disclosure strip and exactly one "About this demo" disclosure; detail lives only in the latter
    expect(count(html, /class="demo-banner"/g)).toBe(1);
    expect(count(html, /<summary>About this demo<\/summary>/g)).toBe(1);
    expect(html).toContain("SYN-DEMO-*");
    expect(html).toMatch(/<section class="demo-banner" aria-label="Demonstration notice"/);
    // not a live region: a static notice must not be re-announced on every navigation
    const banner = html.slice(html.indexOf('<section class="demo-banner"'), html.indexOf("</section>") + 10);
    expect(banner).not.toMatch(/role="(status|alert)"|aria-live/);
    expect(html.indexOf("demo-banner")).toBeLessThan(html.indexOf("<main"));
    // routine page content does not repeat the demonstration caveat
    const main = html.slice(html.indexOf("<main"), html.indexOf("</main>"));
    expect(main).not.toMatch(/synthetic demonstration|DEMONSTRATION · SYNTHETIC/i);
  });

  it("is translated in hi and mr while keeping the SYN-DEMO-* identifier", () => {
    for (const [lang, bundle] of [["hi", hi], ["mr", mr]] as const) {
      const html = render("/page-01", { language: lang });
      expect(html).toContain(bundle["banner.text"]);
      expect(html).toContain("SYN-DEMO-*");
    }
  });
});

describe("authoritative route shell (PAGE-01..PAGE-12)", () => {
  it.each(PAGE_ROUTES.map((r) => [r.pageId, r.path, r.englishName] as const))("%s at %s", (pageId, path, name) => {
    const html = render(path);
    expect(count(html, /<h1[ >]/g)).toBe(1);
    expect(html).toMatch(new RegExp(`<h1 id="page-heading" tabindex="-1">${name.replace("/", "\/")}</h1>`));
    expect(count(html, /<main[ >]/g)).toBe(1);
    expect(html).toContain('id="main"');
    // no operational record or money is ever rendered before a live response exists
    expect(html).not.toContain("₹");
    // PAGE-03 offers the two committed demonstration traces as links; no other record id appears before a live response
    expect(html.replace(/SYN-DEMO-BUD-00[12]|SYN-DEMO-WO-001/g, "")).not.toMatch(/SYN-DEMO-(KND|BUD|WO|COR|AST)/);
    if (pageId === "PAGE-02" || pageId === "PAGE-03") {
      // implemented in P4: live pages, never the placeholder
      expect(html).not.toContain("Not implemented in this phase");
      expect(html).toContain('class="dossier"');
    } else if (pageId === "PAGE-04" || pageId === "PAGE-05" || pageId === "PAGE-06") {
      // implemented in P5: live reporting pages, never the placeholder
      expect(html).not.toContain("Not implemented in this phase");
      expect(html).toContain(pageId === "PAGE-04" ? 'class="report"' : pageId === "PAGE-05" ? 'class="duplicate"' : 'class="receipt"');
    } else if (pageId === "PAGE-08" || pageId === "PAGE-09" || pageId === "PAGE-10") {
      // implemented in P6: authority pages, gated by the simulated persona; never the placeholder and no record before a live response
      expect(html).not.toContain("Not implemented in this phase");
      expect(html).toContain(pageId === "PAGE-08" ? 'class="authority"' : pageId === "PAGE-09" ? 'class="juris"' : 'class="dlp"');
      expect(html).toContain('data-testid="persona-gate"');
    } else if (pageId === "PAGE-01") {
      // implemented in P3: a live workspace, shown as loading until the real API answers
      expect(html).not.toContain("Not implemented in this phase");
      expect(html).toContain('class="workspace"');
      expect(html).toContain('data-state="loading"');
    } else {
      expect(html).toContain("Not implemented in this phase");
      expect(html).toContain(`<dd>${pageId}</dd>`);
    }
  });

  it("has a skip link as the first focusable element, then the banner, then the page", () => {
    const html = render("/page-03");
    expect(html.indexOf('class="skip-link"')).toBeLessThan(html.indexOf("demo-banner"));
    expect(html).toContain('<a class="skip-link" href="#main">Skip to main content</a>');
  });

  it("links all twelve pages from a labelled nav whose toggle exposes expanded state", () => {
    const html = render("/page-01");
    expect(html).toContain('<nav class="nav" aria-label="Pages">');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="nav-list"');
    for (const r of PAGE_ROUTES) expect(html).toContain(`href="${r.path}"`);
    expect(count(html, /class="nav__link/g)).toBe(12);
    expect(html).toMatch(/aria-current="page"[^>]*>/);
  });

  it("marks only the current page with aria-current", () => {
    expect(count(render("/page-07"), /aria-current="page"/g)).toBe(1);
  });

  it("shows a not-found page inside the same shell for unknown paths", () => {
    const html = render("/page-13");
    expect(html).toContain("Page not found");
    expect(html).toContain("demo-banner");
    expect(html).toContain(`href="${HOME_PATH}"`);
  });

  it("starts at PAGE-01 for the index route", () => {
    expect(HOME_PATH).toBe(PAGE_ROUTES[0]!.path);
  });

  it("translates navigation names in hi/mr and falls back to English for placeholder prose", () => {
    const html = render("/page-02", { language: "hi" });
    expect(html).toContain(hi["page.PAGE-02.name"]);
    // P4 page prose is English until a reviewed translation exists: deterministic fallback, never a raw key
    expect(html).toContain(en["p4.selector.title"]);
    expect(html).not.toMatch(/p4\.[a-z]+\./);
    const ph = render("/page-07", { language: "hi" });
    expect(ph).toContain(en["state.notImplemented.title"]); // placeholder pages keep the English fallback
  });
});

describe("simulated persona lens", () => {
  it("offers exactly the contract personas as option values, with separate human-readable labels", () => {
    const html = render("/page-01");
    const values = [...html.matchAll(/<option value="([a-z_]+)"[^>]*>([^<]+)<\/option>/g)].filter((m) =>
      (DEMO_PERSONAS as readonly string[]).includes(m[1]!),
    );
    expect(values.map((m) => m[1])).toEqual([...DEMO_PERSONAS]);
    expect(values.map((m) => m[2])).toEqual(
      DEMO_PERSONAS.map((p) => en[`persona.option.${p}`]),
    );
    expect(html).not.toContain("independent_reviewer</option>"); // wire value is never the visible label
  });

  it("labels it as a presentation lens, not authentication or authorization", () => {
    const html = render("/page-01");
    expect(html).toContain("Simulated demonstration persona, not authentication or authorization.");
    expect(html).toContain('<label for="persona-select">Demonstration persona</label>');
    expect(html).toContain('aria-describedby="persona-disclaimer"');
  });

  it("defaults to public, accepts a valid initial persona and ignores invalid ones", () => {
    expect(render("/page-01")).toMatch(/<option value="public" selected/);
    expect(render("/page-01", { persona: "authority" })).toMatch(/<option value="authority" selected/);
    expect(render("/page-01", { persona: "admin" })).toMatch(/<option value="public" selected/);
    expect(render("/page-01", { persona: "system" })).toMatch(/<option value="public" selected/);
  });

  it("feeds the API client the current persona wire value", async () => {
    let captured: ApiClient | undefined;
    function Probe() {
      captured = useApiClient();
      return null;
    }
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchSpy);
    try {
      renderToStaticMarkup(
        <PersonaProvider initial="moderator">
          <ApiClientProvider>
            <Probe />
          </ApiClientProvider>
        </PersonaProvider>,
      );
      await captured!.get("/health/live");
      const init = (fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1];
      expect((init.headers as Record<string, string>)["X-Demo-Persona"]).toBe("moderator");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("language selector", () => {
  it("lists en, hi and mr with native names", () => {
    const html = render("/page-01");
    for (const [l, n] of [["en", "English"], ["hi", "हिन्दी"], ["mr", "मराठी"]] as const) {
      expect(html).toContain(`<option value="${l}" lang="${l}"`);
      expect(html).toContain(n);
    }
  });
});

describe("colour-independent status presentation", () => {
  const badge = (s: (typeof ISSUE_STATUSES)[number], lang: Language = "en") =>
    renderToStaticMarkup(
      <I18nProvider initialLanguage={lang}>
        <StatusBadge status={s} />
      </I18nProvider>,
    );

  it("gives every status a visible text label and a hidden decorative icon", () => {
    for (const s of ISSUE_STATUSES) {
      const html = badge(s);
      expect(html).toContain(`>${en[`status.${s}`]}<`);
      expect(html).toContain(`aria-hidden="true">${STATUS_PRESENTATION[s].icon}<`);
    }
  });

  it("uses a unique icon and a unique label per status", () => {
    expect(new Set(ISSUE_STATUSES.map((s) => STATUS_PRESENTATION[s].icon)).size).toBe(ISSUE_STATUSES.length);
    expect(new Set(ISSUE_STATUSES.map((s) => en[`status.${s}`])).size).toBe(ISSUE_STATUSES.length);
  });

  it("never presents a closure claim as verified", () => {
    const claimed = STATUS_PRESENTATION.CLOSURE_CLAIMED_PENDING_VERIFICATION;
    const verified = STATUS_PRESENTATION.VERIFIED_COMPLETE;
    expect(claimed.tone).toBe("pending");
    expect(claimed.icon).not.toBe(verified.icon);
    expect(en["status.CLOSURE_CLAIMED_PENDING_VERIFICATION"]).toMatch(/pending verification/i);
  });

  it("uses the disputed (red) tone only for the disputed/reopened state", () => {
    const disputed = ISSUE_STATUSES.filter((s) => STATUS_PRESENTATION[s].tone === "disputed");
    expect(disputed).toEqual(["DISPUTED_REOPENED"]);
  });

  it("renders translated labels in hi and mr", () => {
    expect(badge("VERIFIED_COMPLETE", "hi")).toContain(hi["status.VERIFIED_COMPLETE"]);
    expect(badge("DISPUTED_REOPENED", "mr")).toContain(mr["status.DISPUTED_REOPENED"]);
  });
});

describe("shared data-state notices", () => {
  const notice = (k: (typeof STATE_KINDS)[number]) =>
    renderToStaticMarkup(
      <I18nProvider>
        <StateNotice kind={k} />
      </I18nProvider>,
    );

  it("distinguishes loading, empty, partial, unavailable and not-implemented with text and icon", () => {
    const titles = STATE_KINDS.map((k) => {
      const html = notice(k);
      expect(html).toContain(`data-state="${k}"`);
      expect(html).toContain('aria-hidden="true"');
      return en[`state.${k}.title`];
    });
    expect(new Set(titles).size).toBe(STATE_KINDS.length);
    expect(notice("unavailable")).toContain("No data is shown");
    expect(notice("notImplemented")).toContain("No operational data is shown or implied");
  });
});

describe("error boundary", () => {
  it("switches to the fallback state on a render error and clears when the route changes", () => {
    expect(ErrorBoundary.getDerivedStateFromError()).toEqual({ failed: true });
  });

  it("renders an alert with a retry control", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <ErrorFallback onRetry={() => undefined} />
      </I18nProvider>,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("Something went wrong on this page");
    expect(html).toContain("<button");
  });
});
