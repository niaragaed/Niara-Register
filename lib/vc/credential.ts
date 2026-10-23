// W3C Verifiable Credentials 2.0 for Niara Register records.
//
// The credential is secured as VC-JOSE (W3C "Securing Verifiable Credentials
// using JOSE and COSE"): a compact JWS whose payload IS the credential JSON,
// with protected header typ "vc+jwt" and cty "vc". The issuer is Niara,
// identified as did:web:<domain>, whose public keys are published at
// /.well-known/did.json. When Niara has an ICP-Brasil e-CNPJ, its chain goes
// in the JWS "x5c" header, so the credential is also anchored to ICP-Brasil.
//
// What Niara attests: that the record exists on-chain with these values, and
// that the off-chain values the holder sent (file hash, salt, name, type)
// match the on-chain commitments. Niara does not keep any of it.
import type { RegisterNetwork } from "../networks";

export const VC_CONTEXT_V2 = "https://www.w3.org/ns/credentials/v2";

export type DocumentRegistrationSubject = {
  /** did:pkh of the wallet that registered the document. */
  id: string;
  document: {
    recordHash: string;
    hashScheme: "signed-pdf-sha256" | "salted-sha256";
    /** SHA-256 of the file itself (equals recordHash for signed PDFs). */
    fileSha256?: string;
    /** 32-byte salt, hex. Needed to re-verify a salted record or the metadata. */
    salt?: string;
    /** Public type from the fixed list (on-chain code + English label). */
    documentType: { code: number; label: string };
    metadataCommitment: string;
    name?: string;
    type?: string;
  };
  registration: {
    network: RegisterNetwork;
    chainId: string;
    /** Contract address (EVM) or program id (Solana). */
    registry: string;
    registeredAt: string;
    receipt: {
      standard: "ERC-721 + ERC-5192 (soulbound)" | "Metaplex Bubblegum v2 cNFT (frozen collection)";
      /** EVM: token id (= record hash). Solana: asset id. */
      id: string;
    };
  };
};

export type DocumentRegistrationCredential = {
  "@context": [typeof VC_CONTEXT_V2];
  type: ["VerifiableCredential", "DocumentRegistrationCredential"];
  issuer: { id: string; name: string };
  validFrom: string;
  credentialSubject: DocumentRegistrationSubject;
};

export function issuerDid(domain: string): string {
  return `did:web:${domain.replace(/:/g, "%3A")}`;
}

export function buildCredential(
  issuer: string,
  subject: DocumentRegistrationSubject,
  now = new Date(),
): DocumentRegistrationCredential {
  return {
    "@context": [VC_CONTEXT_V2],
    type: ["VerifiableCredential", "DocumentRegistrationCredential"],
    issuer: { id: issuer, name: "Niara Register" },
    validFrom: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
    credentialSubject: subject,
  };
}

/** Presentation wrapping a VC-JOSE credential (EnvelopedVerifiableCredential). */
export function buildPresentation(holder: string, vcJwt: string) {
  return {
    "@context": [VC_CONTEXT_V2],
    type: ["VerifiablePresentation"],
    holder,
    verifiableCredential: [
      {
        "@context": [VC_CONTEXT_V2],
        id: `data:application/vc+jwt,${vcJwt}`,
        type: "EnvelopedVerifiableCredential",
      },
    ],
  };
}

// --- base64url --------------------------------------------------------------

export function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(text: string): Uint8Array {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export function decodeJwsPart<T>(part: string): T {
  return JSON.parse(new TextDecoder().decode(b64urlDecode(part))) as T;
}
