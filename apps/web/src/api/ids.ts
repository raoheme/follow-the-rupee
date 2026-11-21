type CryptoLike = {
  randomUUID?: () => string;
  getRandomValues?: (array: Uint8Array) => Uint8Array;
};

/**
 * Operational identifier for X-Correlation-Id and Idempotency-Key (contract: 8-128 characters). Not a security token.
 * Uses crypto.randomUUID() when present. randomUUID is only exposed in secure contexts, so a RFC 4122 v4 fallback
 * built from crypto.getRandomValues covers plain-http hosts. Math.random is never used; with no crypto source at all
 * this throws rather than inventing weak identifiers.
 */
export function newOperationalId(source: CryptoLike | undefined = globalThis.crypto): string {
  if (source?.randomUUID) return source.randomUUID();
  if (source?.getRandomValues) {
    const b = source.getRandomValues(new Uint8Array(16));
    b[6] = (b[6]! & 0x0f) | 0x40;
    b[8] = (b[8]! & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  throw new Error("No cryptographic random source available for operational identifiers");
}
