/**
 * Display text derived from integer paise only. The Rust domain (crates/domain/src/money.rs) and the database
 * remain the data authority; formatted text is never parsed back or persisted.
 *
 * Rules (identical to Rust `format_inr`): crore with two decimals from 1 crore (10,000,000 rupees), lakh with up to two
 * decimals (trailing zeros trimmed) from 1 lakh (100,000 rupees), otherwise rupees with Indian digit grouping and
 * paise only when non-zero. Values are truncated, never rounded, so 9,999,999.99 rupees reads "₹99.99 lakh" and cannot
 * round up into a misleading "₹1.00 Cr". Negative or non-integer inputs are rejected (Paise is non-negative).
 */
export const MAX_PAISE = Number.MAX_SAFE_INTEGER; // 2^53 - 1, same bound as the Rust Paise type

function groupIndian(n: bigint): string {
  if (n < 1000n) return n.toString();
  const last3 = (n % 1000n).toString().padStart(3, "0");
  let rest = n / 1000n;
  const parts = [last3];
  while (rest >= 100n) {
    parts.push((rest % 100n).toString().padStart(2, "0"));
    rest /= 100n;
  }
  parts.push(rest.toString());
  return parts.reverse().join(",");
}

export function formatInr(amountPaise: number | bigint): string {
  let p: bigint;
  if (typeof amountPaise === "bigint") {
    p = amountPaise;
  } else {
    if (!Number.isSafeInteger(amountPaise)) throw new RangeError(`paise must be a safe integer: ${amountPaise}`);
    p = BigInt(amountPaise);
  }
  if (p < 0n || p > BigInt(MAX_PAISE)) throw new RangeError(`paise out of range: ${p}`);

  const rupees = p / 100n;
  if (rupees >= 10_000_000n) {
    const hundredths = p / 10_000_000n;
    return `₹${hundredths / 100n}.${(hundredths % 100n).toString().padStart(2, "0")} Cr`;
  }
  if (rupees >= 100_000n) {
    const hundredths = p / 100_000n;
    const whole = hundredths / 100n;
    const frac = hundredths % 100n;
    if (frac === 0n) return `₹${whole} lakh`;
    if (frac % 10n === 0n) return `₹${whole}.${frac / 10n} lakh`;
    return `₹${whole}.${frac.toString().padStart(2, "0")} lakh`;
  }
  const remainder = p % 100n;
  return remainder === 0n
    ? `₹${groupIndian(rupees)}`
    : `₹${groupIndian(rupees)}.${remainder.toString().padStart(2, "0")}`;
}
