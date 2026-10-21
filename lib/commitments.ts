// Hash recipes shared by the site, SignatureRegistryV2.sol (EVM) and
// register_v2 (Solana). They MUST stay byte-identical to the tests in
// niara-contracts-Register (test/SignatureRegistryV2.t.sol) and
// niara-register-solana: change one, change all.
//
// - Scheme 0 (signedPdf): record hash = SHA-256 of the final PAdES-signed PDF.
//   No salt needed: the file contains the signer's signature, so nobody can
//   rebuild it from a public template.
// - Scheme 1 (salted): record hash = SHA-256("niara-record-v1" || salt || SHA-256(file)).
//   For anything that is not an ICP-Brasil-signed PDF.
// - Metadata commitment = SHA-256("niara-meta-v1" || salt || JSON) where JSON is
//   {"name":...,"type":...} in that key order, or 32 zero bytes when there is no
//   metadata. Name and type never go on-chain.
//
// The salt is 32 random bytes generated in the browser. It lives only in the
// holder's credential (the downloaded VC); without it a salted record cannot
// be re-verified, so the UI makes the holder save it.
//
// Works in the browser and in Node (both expose WebCrypto as globalThis.crypto).

export const SCHEME_SIGNED_PDF = 0 as const;
export const SCHEME_SALTED = 1 as const;
export type HashScheme = typeof SCHEME_SIGNED_PDF | typeof SCHEME_SALTED;

const RECORD_DOMAIN = new TextEncoder().encode("niara-record-v1");
const META_DOMAIN = new TextEncoder().encode("niara-meta-v1");
export const ZERO_HASH = "0".repeat(64);

export type DocumentMetadata = { name: string; type: string };

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) {
    throw new Error("Invalid hex string.");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function isHash32(hex: string): boolean {
  return /^(0x)?[0-9a-fA-F]{64}$/.test(hex);
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data as BufferSource));
}

export function newSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

/** Exactly {"name":...,"type":...}: key order and no whitespace are part of the recipe. */
export function canonicalMetadata(meta: DocumentMetadata): string {
  return JSON.stringify({ name: meta.name.trim(), type: meta.type.trim() });
}

/** Record hash for scheme 1, from the file's own SHA-256 (hex) and the salt. */
export async function saltedRecordHash(fileSha256Hex: string, salt: Uint8Array): Promise<string> {
  if (salt.length !== 32) throw new Error("The salt must be 32 bytes.");
  return toHex(await sha256(concatBytes(RECORD_DOMAIN, salt, fromHex(fileSha256Hex))));
}

/** Metadata commitment, or the zero hash when there is no name and no type. */
export async function metadataCommitment(
  meta: DocumentMetadata | null,
  salt: Uint8Array,
): Promise<string> {
  if (!meta || (meta.name.trim() === "" && meta.type.trim() === "")) return ZERO_HASH;
  if (salt.length !== 32) throw new Error("The salt must be 32 bytes.");
  const json = new TextEncoder().encode(canonicalMetadata(meta));
  return toHex(await sha256(concatBytes(META_DOMAIN, salt, json)));
}

/** Record hash for either scheme. */
export async function recordHashFor(
  scheme: HashScheme,
  fileSha256Hex: string,
  salt: Uint8Array,
): Promise<string> {
  return scheme === SCHEME_SIGNED_PDF ? fileSha256Hex.toLowerCase() : saltedRecordHash(fileSha256Hex, salt);
}
