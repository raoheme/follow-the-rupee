import { describe, expect, it } from "vitest";
import { formatInr, groupIndian, indianiseUnits } from "./format";

describe("formatInr (whole rupees, Indian units)", () => {
  it.each([
    [134328183, "₹13.43 Cr"],
    [21771311, "₹2.18 Cr"],
    [8729314, "₹87.29 lakh"],
    [6066314, "₹60.66 lakh"],
    [2590652, "₹25.91 lakh"],
    [16120, "₹16,120"],
    [20800, "₹20,800"],
    [0, "₹0"],
  ])("%d -> %s", (n, s) => expect(formatInr(n)).toBe(s));
  it("never divides by 100 and never uses millions", () => {
    expect(formatInr(134328183)).not.toMatch(/M|\$/);
  });
  it("handles null and negatives", () => {
    expect(formatInr(null)).toBe("—");
    expect(formatInr(-8729314)).toBe("-₹87.29 lakh");
  });
  it("rewrites compact millions in narratives into Indian units", () => {
    expect(indianiseUnits("₹8.03M spent against ₹9.8M")).toBe("₹80.30 lakh spent against ₹98.00 lakh");
  });
  it("scales compact units without ever inflating them", () => {
    expect(indianiseUnits("₹13.43M")).toBe("₹1.34 Cr");
    expect(indianiseUnits("₹17.21M in this record")).toBe("₹1.72 Cr in this record");
    expect(indianiseUnits("(₹0.69M)")).toBe("(₹6.90 lakh)");
    expect(indianiseUnits("₹8.03M")).not.toMatch(/Cr/);
  });
  it("groups digits the Indian way", () => {
    expect(groupIndian(1234567)).toBe("12,34,567");
    expect(groupIndian(99999)).toBe("99,999");
  });
});
