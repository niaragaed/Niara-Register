// Niara's credential issuer key. Server only: never import from a client component.
//
// Configuration (environment):
//   NIARA_VC_PRIVATE_JWK  private key as a JWK (EC P-256, Ed25519 or RSA).
//                         Generate one with: node scripts/generate-vc-key.mjs
//   NIARA_DID_DOMAIN      domain of the did:web (default niara-register.vercel.app).
//   NIARA_VC_X5C          optional: the ICP-Brasil e-CNPJ certificate chain for
//                         that SAME key, as comma-separated base64 DER (leaf first).
//                         When set, every credential carries it in the "x5c"
//                         JWS header and the DID document lists it.
import "server-only";
import { CompactSign, importJWK, type JWK } from "jose";
import { issuerDid, type DocumentRegistrationCredential } from "./credential";

/** Why the issuer is unavailable. The reason is safe to show: it never contains the key. */
export type IssuerProblem = "missing" | "invalid_json" | "not_a_private_key" | "unsupported_key";

/**
 * Shape of a value that is not JSON, to tell what went wrong when pasting it.
 * Only structural facts: never a character of the key material itself.
 */
export type ValueShape = {
  length: number;
  lines: number;
  startsWith: string;
  endsWith: string;
  hasNameAssignment: boolean;
  hasNulBytes: boolean;
  hasSmartQuotes: boolean;
};

export class IssuerNotConfigured extends Error {
  constructor(
    message: string,
    readonly reason: IssuerProblem,
    readonly shape?: ValueShape,
  ) {
    super(message);
  }
}

const charClass = (c: string | undefined) =>
  c === undefined ? "nothing" : /[{}[\]"'`=]/.test(c) ? c : /\s/.test(c) ? "space" : /[A-Za-z0-9_-]/.test(c) ? "letter-or-digit" : "other";

export function valueShape(raw: string): ValueShape {
  const t = raw.trim();
  return {
    length: raw.length,
    lines: raw.split(/\r?\n/).length,
    startsWith: charClass(t[0]),
    endsWith: charClass(t[t.length - 1]),
    hasNameAssignment: /^\s*(export\s+)?[A-Z_][A-Z0-9_]*\s*=/.test(raw),
    hasNulBytes: raw.includes("\u0000"),
    hasSmartQuotes: /[\u201C\u201D\u2018\u2019]/.test(raw),
  };
}

/**
 * Parses the env value, forgiving the usual copy-paste damage: a BOM, NUL bytes
 * from a UTF-16 file, outer whitespace, a NAME= prefix (a line copied from a
 * .env file), outer single quotes or backticks, typographic quotes, or the
 * whole JSON pasted as a quoted string.
 */
function parseJwk(raw: string): JWK | null {
  let text = raw
    .replace(/\u0000/g, "")
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/^(export\s+)?[A-Z_][A-Z0-9_]*\s*=\s*/, "")
    .replace(/[\u201C\u201D]/g, '"')
    .trim();
  if (text.length > 1 && (text[0] === "'" || text[0] === "`") && text[text.length - 1] === text[0]) text = text.slice(1, -1).trim();
  for (let i = 0; i < 2; i++) {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return null;
    }
    if (typeof value === "string") {
      text = value.trim();
      continue;
    }
    return value && typeof value === "object" ? (value as JWK) : null;
  }
  return null;
}

const PRIVATE_MEMBERS = ["d", "p", "q", "dp", "dq", "qi", "oth", "k"] as const;

function algFor(jwk: JWK): string {
  if (jwk.alg) return jwk.alg;
  if (jwk.kty === "EC" && jwk.crv === "P-256") return "ES256";
  if (jwk.kty === "EC" && jwk.crv === "P-384") return "ES384";
  if (jwk.kty === "OKP" && jwk.crv === "Ed25519") return "EdDSA";
  if (jwk.kty === "RSA") return "RS256";
  throw new IssuerNotConfigured(`Unsupported issuer key type ${jwk.kty}/${jwk.crv ?? ""}.`, "unsupported_key");
}

export function issuerConfig() {
  const raw = process.env.NIARA_VC_PRIVATE_JWK;
  if (!raw || !raw.trim()) throw new IssuerNotConfigured("NIARA_VC_PRIVATE_JWK is not set.", "missing");
  const jwk = parseJwk(raw);
  if (!jwk) throw new IssuerNotConfigured("NIARA_VC_PRIVATE_JWK is not valid JSON.", "invalid_json", valueShape(raw));
  if (typeof jwk.d !== "string") {
    throw new IssuerNotConfigured("NIARA_VC_PRIVATE_JWK has no private part (d).", "not_a_private_key");
  }
  const domain = process.env.NIARA_DID_DOMAIN || "niara-register.vercel.app";
  const did = issuerDid(domain);
  const kid = `${did}#key-1`;
  const alg = algFor(jwk);
  const x5c = (process.env.NIARA_VC_X5C ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const publicJwk: JWK = { ...jwk, alg, kid };
  for (const m of PRIVATE_MEMBERS) delete (publicJwk as Record<string, unknown>)[m];
  if (x5c.length) publicJwk.x5c = x5c;

  return { jwk, did, kid, alg, x5c, publicJwk, domain };
}

export async function signCredential(credential: DocumentRegistrationCredential): Promise<string> {
  const cfg = issuerConfig();
  const key = await importJWK(cfg.jwk, cfg.alg);
  const header: Record<string, unknown> = { alg: cfg.alg, kid: cfg.kid, typ: "vc+jwt", cty: "vc" };
  if (cfg.x5c.length) header.x5c = cfg.x5c;
  return new CompactSign(new TextEncoder().encode(JSON.stringify(credential)))
    .setProtectedHeader(header as { alg: string })
    .sign(key);
}

/** The did:web document served at /.well-known/did.json. */
export function didDocument() {
  const cfg = issuerConfig();
  return {
    "@context": ["https://www.w3.org/ns/did/v1", "https://w3id.org/security/suites/jws-2020/v1"],
    id: cfg.did,
    verificationMethod: [
      {
        id: cfg.kid,
        type: "JsonWebKey2020",
        controller: cfg.did,
        publicKeyJwk: cfg.publicJwk,
      },
    ],
    assertionMethod: [cfg.kid],
  };
}
