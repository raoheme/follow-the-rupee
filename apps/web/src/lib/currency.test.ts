import { describe, expect, it } from "vitest";
import { MAX_PAISE, formatInr } from "./currency";

describe("formatInr (integer paise only)", () => {
  it("formats the frozen demonstration amounts", () => {
    expect(formatInr(250_000_000)).toBe("₹25 lakh");
    expect(formatInr(180_000_000)).toBe("₹18 lakh");
    expect(formatInr(1_800_000_000)).toBe("₹1.80 Cr");
  });

  it("keeps lakh/crore transitions truthful at the boundaries", () => {
    expect(formatInr(0)).toBe("₹0");
    expect(formatInr(9_999_999)).toBe("₹99,999.99"); // one paise below 1 lakh
    expect(formatInr(10_000_000)).toBe("₹1 lakh");
    expect(formatInr(999_999_999)).toBe("₹99.99 lakh"); // truncated, never rounded up to ₹1 Cr
    expect(formatInr(1_000_000_000)).toBe("₹1.00 Cr");
    expect(formatInr(1_000_000_001)).toBe("₹1.00 Cr");
  });

  it("trims lakh decimals and groups small rupee amounts the Indian way", () => {
    expect(formatInr(185_000_000)).toBe("₹18.5 lakh");
    expect(formatInr(182_500_000)).toBe("₹18.25 lakh");
    expect(formatInr(1_200_000)).toBe("₹12,000");
    expect(formatInr(12_345_600)).toBe("₹1.23 lakh");
    expect(formatInr(5)).toBe("₹0.05");
  });

  it("accepts bigint and the largest safe value without float error", () => {
    expect(formatInr(180_000_000n)).toBe("₹18 lakh");
    expect(formatInr(MAX_PAISE)).toBe("₹9007199.25 Cr"); // 2^53-1 paise, same text as the Rust formatter
  });

  it("rejects negative, fractional, non-finite and out-of-range input", () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, MAX_PAISE + 2]) {
      expect(() => formatInr(bad)).toThrow(RangeError);
    }
    expect(() => formatInr(-1n)).toThrow(RangeError);
    expect(() => formatInr(BigInt(MAX_PAISE) + 1n)).toThrow(RangeError);
  });
});
