import { describe, expect, it } from "vitest";
import css from "./monsoon.css.rawfile";

const raw = import.meta.glob("./*.{ts,tsx}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const sources: Array<readonly [string, string]> = Object.entries(raw)
  .filter(([f]) => !/\.test\./.test(f))
  .map(([f, t]) => [f.replace("./", ""), t] as const)
  .concat([["monsoon.css", css]]);

// Retired or accusatory wording. Assembled from fragments so this test file never contains a literal for the scan to trip on.
const j = (...p: string[]) => p.join("");
const FORBIDDEN = [
  j("over", "billed"),
  j("over", "billing"),
  j("over", "charged"),
  j("fr", "aud"),
  j("corrup", "tion"),
  j("ghost work", " order"),
  j("duplicate billing", " confirmed"),
  j("wasted", " money"),
  j("contractor", " failure"),
  j("poor", " contractor"),
  j("defective work", " proved"),
  j("cash cost", " ₹0"),
  j("effective durable", " cost"),
  j("cost per", " durable"),
  j("2,570", " anomalies"),
  j("433 anomalous", " work orders"),
  j("16,900", ",231"),
  j("16,900", "231"),
  j("16.90", "M"),
  j("at", " risk"),
  j("confirmed", " loss"),
];

describe("claim-safe wording across all monsoon UI source", () => {
  it("has source files to scan", () => expect(sources.length).toBeGreaterThan(8));
  it.each(FORBIDDEN)("never contains %s", (w) => {
    for (const [f, text] of sources) {
      const lower = text.toLowerCase().replace(/are not an estimate of confirmed loss/g, "");
      expect(lower.includes(w.toLowerCase()), `${f} contains "${w}"`).toBe(false);
    }
  });
  it("has no A-D letter grades for contractors", () => {
    for (const [f, text] of sources) {
      expect(/\b(grade|band)\s+[A-D]\b/i.test(text), `${f} has a letter grade`).toBe(false);
      expect(/\bfair score\b/i.test(text), `${f} mentions a fair score`).toBe(false);
    }
  });
  it("never shows dollar or million units", () => {
    for (const [f, text] of sources) expect(/\$M|₹[\d.]+M/.test(text), `${f} has million units`).toBe(false);
  });
});
