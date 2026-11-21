import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { DisclosureBanner } from "../../components/DisclosureBanner";
import { I18nProvider } from "../../i18n/I18nContext";
import { en } from "../../i18n/resources";
import { ActiveFilters } from "./FilterBar";
import { activeFilterCount, hasActiveFilters, NO_FILTERS, type WorkspaceFilters } from "./filters";
import { Inspector } from "./Inspector";
import { TileHealth } from "./map/tileHealth";
import { issueSummarySchema, type IssueSummary } from "./model";
import issuesSeed from "../../../../../data/demo/issues.json";

const wrap = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <I18nProvider>
      <MemoryRouter>{node}</MemoryRouter>
    </I18nProvider>,
  );

describe("P4A active-filter chips", () => {
  it("renders nothing, and no Clear control, while no filter is active", () => {
    expect(wrap(<ActiveFilters value={NO_FILTERS} onChange={() => undefined} />)).toBe("");
    expect(hasActiveFilters(NO_FILTERS)).toBe(false);
    expect(activeFilterCount(NO_FILTERS)).toBe(0);
  });

  it("shows one removable chip per active filter plus Clear filters, visible without opening the filter panel", () => {
    const f: WorkspaceFilters = { ward: "K/W", category: "POTHOLE", status: "", dlpOnly: true };
    const html = wrap(<ActiveFilters value={f} onChange={() => undefined} />);
    expect(activeFilterCount(f)).toBe(3);
    expect((html.match(/class="chip"/g) ?? []).length).toBe(3);
    expect(html).toContain(en["p1.filter.reset"]);
    expect(html).toContain(en["p1.filter.dlpShort"]);
    expect(html).toContain(`${en["p1.filter.remove"]}: ${en["p1.filter.category"]}: ${en["p1.category.POTHOLE"]}`);
    expect(html).toContain('role="group"');
  });
});

describe("P4A basemap retry", () => {
  it("TileHealth.reset starts a fresh bounded observation and can report unavailability again", () => {
    let reports = 0;
    const h = new TileHealth(() => (reports += 1), 2);
    h.tileFailed();
    h.tileFailed();
    h.tileFailed();
    expect(reports).toBe(1);
    expect(h.unavailable).toBe(true);
    h.reset();
    expect(h.unavailable).toBe(false);
    h.tileFailed();
    expect(reports).toBe(1); // below threshold again
    h.tileFailed();
    expect(reports).toBe(2);
  });

  it("does not report unavailable once any tile has loaded, even after a reset and failures below the threshold", () => {
    let reports = 0;
    const h = new TileHealth(() => (reports += 1), 2);
    h.tileFailed();
    h.reset();
    h.tileLoaded();
    for (let i = 0; i < 10; i += 1) h.tileFailed();
    expect(reports).toBe(0);
  });
});

describe("P4A disclosure and selected-issue action", () => {
  it("keeps one compact line and one About disclosure holding the detailed caveats", () => {
    const html = wrap(<DisclosureBanner />);
    expect((html.match(/class="demo-banner__text"/g) ?? []).length).toBe(1);
    expect((html.match(/<details/g) ?? []).length).toBe(1);
    expect(html).toContain(en["banner.text"]);
    // claim-safety meaning is preserved in the disclosure, not dropped
    expect(html).toContain("A completion claim is not a verification.");
    expect(html).toContain("not authentication or authorization");
    expect(html).toContain("OpenStreetMap community reference context");
    expect(html).not.toMatch(/role="(status|alert)"|aria-live/);
  });

  it("offers View Kundali as the primary action for a selected issue, linking a validated deep link", () => {
    const issue: IssueSummary = issueSummarySchema.parse((issuesSeed as unknown[])[0]);
    const html = wrap(<Inspector selection={{ type: "issue", issue, dlpActive: true }} />);
    expect(html).toContain('class="button-link button-link--primary" href="/page-02?id=SYN-DEMO-KND-001"');
    expect(html).toContain(">View Kundali<");
    expect(html.indexOf("View Kundali")).toBeLessThan(html.indexOf("<dl"));
  });
});
