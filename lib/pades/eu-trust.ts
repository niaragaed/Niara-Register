// European Union (eIDAS): does a signer certificate come from a qualified trust
// service provider on the EU trusted lists, and is it a qualified certificate?
//
// The CA certificates come from public/trust/eu-trusted-cas.json, built from
// the EU List of Trusted Lists by scripts/fetch-eu-trusted-lists.mjs (LOTL and
// national list signatures checked there). The file is about 1 MB gzipped, so
// the browser loads it only when a signature does not chain to ICP-Brasil.
//
// What this module decides, offline, in the browser:
//   - the certificate chains to a CA/QC service whose current status is
//     "granted" on a national trusted list;
//   - what the certificate itself declares in its QCStatements (ETSI EN 319
//     412-5): qualified (QcCompliance), key on a qualified signature creation
//     device (QcSSCD) and type (e-signature, e-seal, web).
// From that it labels the signature as a qualified electronic signature (QES),
// an advanced signature with a qualified certificate, or neither.
//
// NOT done here: the trusted-list status history, the service "qualifiers"
// that can override what a certificate declares, revocation (CRL/OCSP) and
// timestamps. The European Commission's DSS validator is the reference.
import * as pkijs from "pkijs";

export type EuUsage = "esig" | "eseal" | "web";

export type EuTrustedCa = {
  country: string;
  tsp: string;
  service: string;
  usages: EuUsage[];
  sha256: string;
  /** First 32 hex chars of SHA-256(normalizeName(subject)). */
  subjectKey: string;
  /** Subject key identifier, hex (absent on a few old CAs). */
  ski?: string;
  notAfter: string;
  der: string;
};

export type EuTrustList = {
  format: "niara-eu-trusted-cas/1";
  source: string;
  generatedAt: string;
  lotl: { sequence: number; issued: string; sha256: string; signerSha256: string };
  lists: { country: string; url: string; sequence: number; nextUpdate: string; cas: number }[];
  failures: { country: string; url: string; error: string }[];
  cas: EuTrustedCa[];
};

export const EU_DSS_VALIDATOR = "https://ec.europa.eu/digital-building-blocks/DSS/webapp-demo/validation";

const OID_QC_STATEMENTS = "1.3.6.1.5.5.7.1.3";
const OID_AKI = "2.5.29.35";
const QC = {
  compliance: "0.4.0.1862.1.1",
  sscd: "0.4.0.1862.1.4",
  type: "0.4.0.1862.1.6",
  typeEsign: "0.4.0.1862.1.6.1",
  typeEseal: "0.4.0.1862.1.6.2",
  typeWeb: "0.4.0.1862.1.6.3",
} as const;

const ab = (u: Uint8Array): ArrayBuffer => u.slice().buffer as ArrayBuffer;
const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");

/** Must match normalizeName() in scripts/fetch-eu-trusted-lists.mjs. */
export function normalizeName(rdns: pkijs.RelativeDistinguishedNames): string {
  return rdns.typesAndValues
    .map((tv) => {
      const v = (tv.value as { valueBlock: { value?: unknown } }).valueBlock.value;
      return `${tv.type}=${String(v ?? "").replace(/\s+/g, " ").trim().toLowerCase()}`;
    })
    .join(",");
}

async function nameKey(rdns: pkijs.RelativeDistinguishedNames): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalizeName(rdns)));
  return hex(new Uint8Array(digest)).slice(0, 32);
}

function authorityKeyId(cert: pkijs.Certificate): string | undefined {
  const ext = cert.extensions?.find((e) => e.extnID === OID_AKI);
  const id = (ext?.parsedValue as pkijs.AuthorityKeyIdentifier | undefined)?.keyIdentifier;
  return id ? hex(new Uint8Array(id.valueBlock.valueHexView)) : undefined;
}

export type QcDeclaration = {
  /** QcCompliance: the issuer declares this a qualified certificate. */
  qualified: boolean;
  /** QcSSCD: the private key is on a qualified signature creation device. */
  qscd: boolean;
  /** QcType values; empty means the certificate does not say (e-signature by default). */
  types: EuUsage[];
};

/** Reads the ETSI QCStatements extension of a certificate. */
export function qcDeclaration(cert: pkijs.Certificate): QcDeclaration {
  const out: QcDeclaration = { qualified: false, qscd: false, types: [] };
  const ext = cert.extensions?.find((e) => e.extnID === OID_QC_STATEMENTS);
  const statements = (ext?.parsedValue as pkijs.QCStatements | undefined)?.values ?? [];
  for (const st of statements) {
    if (st.id === QC.compliance) out.qualified = true;
    else if (st.id === QC.sscd) out.qscd = true;
    else if (st.id === QC.type) {
      const items = ((st.type as { valueBlock?: { value?: unknown[] } } | undefined)?.valueBlock?.value ?? []) as {
        valueBlock?: { toString(): string };
      }[];
      for (const item of items) {
        const oid = item.valueBlock?.toString();
        if (oid === QC.typeEsign) out.types.push("esig");
        else if (oid === QC.typeEseal) out.types.push("eseal");
        else if (oid === QC.typeWeb) out.types.push("web");
      }
    }
  }
  return out;
}

export type EuChainResult =
  | {
      status: "eu-trusted-list";
      country: string;
      tsp: string;
      service: string;
      /**
       * qes: qualified certificate for e-signatures, key on a QSCD (as declared).
       * adesqc: qualified certificate, key not declared on a QSCD (or an e-seal).
       * not-qualified: issued by a qualified provider's CA but not declared qualified.
       */
      level: "qes" | "adesqc" | "not-qualified";
      seal: boolean;
      listSequence: number;
    }
  | null;

let cached: Promise<EuTrustList | null> | null = null;

/** Browser: fetches the trust list once per page. Returns null if unavailable. */
export function loadEuTrustListFromSite(): Promise<EuTrustList | null> {
  if (!cached) {
    cached = fetch("/trust/eu-trusted-cas.json")
      .then((r) => (r.ok ? (r.json() as Promise<EuTrustList>) : null))
      .catch(() => null);
    cached.then((v) => {
      if (!v) cached = null;
    });
  }
  return cached;
}

/**
 * Checks `leaf` (with the certificates embedded in the signature) against the
 * EU trusted lists at `at`. Returns null when it does not chain to any listed
 * CA/QC service.
 */
export async function checkEuChain(
  leaf: pkijs.Certificate,
  embedded: pkijs.Certificate[],
  list: EuTrustList,
  at: Date,
): Promise<EuChainResult> {
  // Candidate anchors: listed CAs whose key id or subject matches the issuer of
  // the leaf or of any embedded certificate. Only those get parsed.
  const certs = [leaf, ...embedded.filter((c) => c !== leaf)];
  const akis = new Set(certs.map(authorityKeyId).filter((x): x is string => Boolean(x)));
  const issuers = new Set(await Promise.all(certs.map((c) => nameKey(c.issuer))));
  const candidates = list.cas.filter((ca) => (ca.ski && akis.has(ca.ski)) || issuers.has(ca.subjectKey));
  if (!candidates.length) return null;

  const anchors = candidates.map((ca) => ({
    ca,
    cert: pkijs.Certificate.fromBER(ab(Uint8Array.from(atob(ca.der), (c) => c.charCodeAt(0)))),
  }));
  const engine = new pkijs.CertificateChainValidationEngine({
    trustedCerts: anchors.map((a) => a.cert),
    certs: [...embedded.filter((c) => c !== leaf), leaf],
    checkDate: at,
  });
  const result = await engine.verify();
  if (!result.result) return null;

  const path = result.certificatePath ?? [];
  const top = path[path.length - 1];
  const sameTbs = (a: pkijs.Certificate, b: pkijs.Certificate) => hex(new Uint8Array(a.tbsView)) === hex(new Uint8Array(b.tbsView));
  const anchor = anchors.find((a) => top && (a.cert === top || sameTbs(a.cert, top))) ?? anchors[0];

  const qc = qcDeclaration(leaf);
  const seal = qc.types.includes("eseal") && !qc.types.includes("esig");
  const serviceFits = seal ? anchor.ca.usages.includes("eseal") : anchor.ca.usages.includes("esig");
  const level = qc.qualified && serviceFits ? (qc.qscd ? "qes" : "adesqc") : "not-qualified";
  return {
    status: "eu-trusted-list",
    country: anchor.ca.country,
    tsp: anchor.ca.tsp,
    service: anchor.ca.service,
    level,
    seal,
    listSequence: list.lotl.sequence,
  };
}
