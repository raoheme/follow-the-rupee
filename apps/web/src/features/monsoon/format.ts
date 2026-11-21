/** Indian-rupee formatting. `civic_lens_monsoon` stores whole rupees (`*_inr`), never paise: nothing here divides by 100. */
const CRORE = 10_000_000;
const LAKH = 100_000;

/** Indian digit grouping (12,34,567) for an integer magnitude. */
export function groupIndian(n: number): string {
  const s = String(Math.round(Math.abs(n)));
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  let rest = s.slice(0, -3);
  const parts: string[] = [];
  while (rest.length > 2) {
    parts.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest) parts.unshift(rest);
  return `${parts.join(",")},${last3}`;
}

export function formatInr(rupees: number | null | undefined): string {
  if (rupees === null || rupees === undefined || Number.isNaN(rupees)) return "—";
  const sign = rupees < 0 ? "-" : "";
  const a = Math.abs(rupees);
  if (a >= CRORE) return `${sign}₹${(a / CRORE).toFixed(2)} Cr`;
  if (a >= LAKH) return `${sign}₹${(a / LAKH).toFixed(2)} lakh`;
  return `${sign}₹${groupIndian(a)}`;
}

export function formatInt(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return (n < 0 ? "-" : "") + groupIndian(n);
}

export function formatPct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

export function formatRatio(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${n.toFixed(2)}×`;
}

export function signed(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}`;
}

/** Narrative text may carry compact units (rupee sign, number, then M or K); show them in Indian units instead. */
export function indianiseUnits(text: string | null | undefined): string {
  if (!text) return "";
  return text.replace(/₹\s?(\d+(?:\.\d+)?)\s?(M|K)(?![A-Za-z])/g, (_m, n: string, u: string) => formatInr(Number(n) * (u === "M" ? 1_000_000 : 1_000)));
}
