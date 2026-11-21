import { describe, expect, it } from "vitest";
import css from "./styles.css.rawfile";

/**
 * Static accessibility checks on the design tokens. These are not a substitute for a browser axe run (not installed in
 * P2) and do not establish WCAG conformance; they pin the token contrast, target size and media-query support.
 */
function token(name: string): string {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`token --${name} not found`);
  return m[1]!;
}

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe("design token contrast (WCAG 2.x AA text, 4.5:1)", () => {
  const navy = () => token("color-navy");
  const pairs: Array<[string, () => string, () => string]> = [
    ["navy on canvas", navy, () => token("color-canvas")],
    ["navy on surface", navy, () => token("color-surface")],
    ["white on maroon banner", () => "#ffffff", () => token("color-maroon")],
    ["navy on neutral tint", navy, () => token("tint-neutral")],
    ["navy on amber tint", navy, () => token("tint-amber")],
    ["navy on green tint", navy, () => token("tint-green")],
    ["navy on red tint", navy, () => token("tint-red")],
    ["navy on active tint", navy, () => token("tint-active")],
  ];
  it.each(pairs)("%s", (_n, fg, bg) => {
    expect(contrast(fg(), bg())).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps status border colours at 3:1 non-text contrast against their tint", () => {
    expect(contrast(token("color-green"), token("tint-green"))).toBeGreaterThanOrEqual(3);
    expect(contrast(token("color-red"), token("tint-red"))).toBeGreaterThanOrEqual(3);
    expect(contrast(token("color-amber"), token("tint-amber"))).toBeGreaterThanOrEqual(3);
  });

  it("uses the candidate civic palette (no official identity colours claimed)", () => {
    expect(token("color-maroon").toLowerCase()).toBe("#7a1f2b");
    expect(token("color-navy").toLowerCase()).toBe("#14283d");
    expect(token("color-canvas").toLowerCase()).toBe("#faf7f2");
    expect(token("color-saffron").toLowerCase()).toBe("#d97706");
  });
});

describe("interaction and motion support in CSS", () => {
  it("defines a 44px minimum touch target applied to buttons, selects and links", () => {
    expect(css).toMatch(/--target:\s*44px/);
    expect(css).toMatch(/button,\s*select,\s*\.button-link\s*\{[^}]*min-height:\s*var\(--target\)/);
    expect(css).toMatch(/\.nav__link\s*\{[^}]*min-height:\s*var\(--target\)/);
  });

  it("has a visible keyboard focus style", () => {
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:\s*3px/);
  });

  it("honours prefers-reduced-motion and forced-colors", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(css).toMatch(/@media \(forced-colors: active\)/);
  });

  it("differentiates status by border style as well as colour", () => {
    expect(css).toMatch(/data-tone="pending"\][^}]*border-style:\s*dashed/);
    expect(css).toMatch(/data-tone="disputed"\][^}]*border-style:\s*double/);
  });
});
