/**
 * Fixture-reference evidence helpers. The committed contract carries evidence as metadata only: a `mediaRef` of the form
 * `fixtures/evidence/SYN-DEMO-*.svg` and the SHA-256 of that reference STRING (`hashBasis = FIXTURE_REFERENCE_STRING`). No
 * photo, file, camera, EXIF, GPS or image is read, uploaded or analysed, and the hash is not proof that anything is authentic.
 */
type CryptoLike = {
  getRandomValues?: (a: Uint8Array) => Uint8Array;
  subtle?: { digest: (alg: string, data: BufferSource) => Promise<ArrayBuffer> };
};

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** `fixtures/evidence/SYN-DEMO-EVD-CITIZEN-<12 upper-case hex>.svg`: matches the contract pattern, unique per submission. */
export function newFixtureRef(source: CryptoLike | undefined = globalThis.crypto): string {
  if (!source?.getRandomValues) throw new Error("No cryptographic random source available for a fixture reference");
  const id = hex(source.getRandomValues(new Uint8Array(6))).toUpperCase();
  return `fixtures/evidence/SYN-DEMO-EVD-CITIZEN-${id}.svg`;
}

export const FIXTURE_REF_PATTERN = /^fixtures\/evidence\/SYN-DEMO-[A-Z0-9-]+\.svg$/;

export async function sha256Hex(text: string, source: CryptoLike | undefined = globalThis.crypto): Promise<string> {
  if (!source?.subtle) throw new Error("SubtleCrypto is unavailable (a secure context such as http://localhost is required)");
  const d = await source.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return hex(new Uint8Array(d));
}
