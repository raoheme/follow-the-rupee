import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../../i18n/I18nContext";
import { MonsoonApp } from "../../MonsoonApp";
import { RoadCard } from "./RoadCard";
import { KundaliView } from "./KundaliView";
import { STRIP_TEXT } from "./copy";

function render(path: string): string {
  return renderToStaticMarkup(
    <I18nProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <StaticRouter location={path}>
          <MonsoonApp />
        </StaticRouter>
      </QueryClientProvider>
    </I18nProvider>,
  );
}

describe("monsoon shell", () => {
  it("renders the slim strip and exactly five destinations (no bot)", () => {
    const html = render("/");
    expect(html).toContain(STRIP_TEXT);
    for (const name of ["Map Triage", "Repair Auditor", "Scorecards &amp; Wards", "Next-Rupee Planner", "Trail Kundali"]) expect(html).toContain(name);
    expect(html).not.toContain("Citizen Bot");
    expect(html).toContain("Methodology &amp; AI Disclosure");
  });
  it.each(["/", "/page-01", "/auditor", "/page-08", "/scorecards", "/page-03", "/planner", "/page-09", "/kundali", "/page-02"])("serves %s", (p) => {
    const html = render(p);
    expect(html).toContain('id="page-heading"');
    expect(html).toContain('id="main"');
  });
});

describe("shared components", () => {
  const road = {
    road_id: "RD0220",
    road_name: "Kurla Andheri Road",
    ward_code: "L",
    lane: "DLP_REVIEW_FIRST_LANE",
    under_dlp: "Y",
    risk_score: 82.23,
    evidence_coverage_pct: 55,
    ward_rank: 1,
    citywide_lane_rank: 1,
    top10_profile_count: 4,
    dominant_issue_type: null,
  };
  it("shows both ranks, the DLP deferral and never a zero-rupee claim", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <RoadCard road={road} />
      </I18nProvider>,
    );
    expect(html).toContain("#1 in Ward L");
    expect(html).toContain("#1 in Mumbai");
    expect(html).toContain("Top-10 in 4/4 profiles");
    expect(html).toContain("Defer new municipal repair allocation pending DLP scope review");
    expect(html).toContain("Engineering review required");
    expect(html).toContain("Top-3 excluded");
    expect(html).toContain("not quantified");
    expect(html).not.toContain("₹0");
  });
  it("renders engineer remark as zero-weight context", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <KundaliView data={{ id: "WO25-1", kind: "work_order", work_orders: [{ work_order_id: "WO25-1", cost_inr: 2290000, expected_cost_inr: 1000000, cost_ratio: 2.29, engineer_remark: "ok", engineer_remark_audit_weight: 0, flags: [] }] }} />
      </I18nProvider>,
    );
    expect(html).toContain("₹22.90 lakh");
    expect(html).toContain("audit weight 0");
  });
});
