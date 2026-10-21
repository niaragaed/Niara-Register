// Verifies a Niara VC-JOSE credential against the issuer's did:web document.
// Works in the browser and on the server.
import { compactVerify, importJWK, type JWK } from "jose";
import { decodeJwsPart, type DocumentRegistrationCredential } from "./credential";

export type CredentialCheck = {
  valid: boolean;
  credential: DocumentRegistrationCredential | null;
  issuer: string;
  /** The issuer attached a certificate chain (x5c), e.g. an ICP-Brasil e-CNPJ. */
  x5cPresent: boolean;
  reason?: string;
};

type Header = { alg?: string; kid?: string; typ?: string; x5c?: string[] };
type DidDoc = { id: string; verificationMethod?: { id: string; publicKeyJwk?: JWK }[]; assertionMethod?: string[] };

export function didWebUrl(did: string): string {
  const rest = did.slice("did:web:".length);
  const [host, ...path] = rest.split(":").map(decodeURIComponent);
  return path.length ? `https://${host}/${path.join("/")}/did.json` : `https://${host}/.well-known/did.json`;
}

export async function verifyCredentialJwt(
  jwt: string,
  resolve: (did: string) => Promise<DidDoc> = async (did) => {
    const res = await fetch(didWebUrl(did), { cache: "no-store" });
    if (!res.ok) throw new Error(`DID document not available (${res.status}).`);
    return (await res.json()) as DidDoc;
  },
): Promise<CredentialCheck> {
  const parts = jwt.trim().split(".");
  if (parts.length !== 3) return { valid: false, credential: null, issuer: "", x5cPresent: false, reason: "not a JWS" };
  let header: Header;
  let credential: DocumentRegistrationCredential;
  try {
    header = decodeJwsPart<Header>(parts[0]);
    credential = decodeJwsPart<DocumentRegistrationCredential>(parts[1]);
  } catch {
    return { valid: false, credential: null, issuer: "", x5cPresent: false, reason: "malformed" };
  }
  const issuer = typeof credential.issuer === "string" ? credential.issuer : credential.issuer?.id ?? "";
  const base = { credential, issuer, x5cPresent: Boolean(header.x5c?.length) };

  if (header.typ !== "vc+jwt") return { ...base, valid: false, reason: "typ is not vc+jwt" };
  if (!issuer.startsWith("did:web:") || !header.kid?.startsWith(`${issuer}#`)) {
    return { ...base, valid: false, reason: "kid does not belong to the issuer" };
  }
  try {
    const doc = await resolve(issuer);
    if (doc.id !== issuer) return { ...base, valid: false, reason: "DID document id mismatch" };
    const vm = doc.verificationMethod?.find((m) => m.id === header.kid);
    if (!vm?.publicKeyJwk || !(doc.assertionMethod ?? []).includes(vm.id)) {
      return { ...base, valid: false, reason: "key not found in the DID document" };
    }
    const key = await importJWK(vm.publicKeyJwk, header.alg);
    await compactVerify(jwt.trim(), key);
    return { ...base, valid: true };
  } catch (e) {
    return { ...base, valid: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
