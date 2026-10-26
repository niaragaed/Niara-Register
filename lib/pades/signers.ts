// Ways to reach a signing key from the browser (ICP-Brasil, or an EU
// certificate). In both cases the key stays on the user's machine; Niara never
// receives it.
//
// - Certificate file (.pfx/.p12, "A1" in ICP-Brasil): opened here with the
//   password the user types, the key is imported into WebCrypto as
//   NON-extractable and the parsed copy is dropped. RSA (all current ICP-Brasil
//   A1 certificates) and ECDSA P-256/P-384/P-521 (common in EU certificates).
// - A3 (token or smart card) and A1 installed in the operating system: through
//   the Lacuna Web PKI browser component, which signs a precomputed hash with
//   the key inside the device. Web PKI is free on localhost; on any other
//   domain it needs a paid license (NEXT_PUBLIC_WEBPKI_LICENSE).
import forge from "node-forge";
import type { CmsSigner } from "./cms";

export type CertificateSummary = {
  subject: string;
  issuer: string;
  validTo: Date;
};

export type BrowserSigner = CmsSigner & { summary: CertificateSummary };

const toBinaryString = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return s;
};
const fromBinaryString = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const fromBase64 = (b64: string) => fromBinaryString(atob(b64));
const toBase64 = (bytes: Uint8Array) => btoa(toBinaryString(bytes));

function certDer(cert: forge.pki.Certificate): Uint8Array {
  return fromBinaryString(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes());
}

function cn(attrs: forge.pki.CertificateField[]): string {
  return String(attrs.find((a) => a.shortName === "CN")?.value ?? "");
}

// ---------------------------------------------------------------------------
// A1: PKCS#12 file
// ---------------------------------------------------------------------------

export class WrongPasswordError extends Error {}

export async function openPfx(file: Uint8Array, password: string): Promise<BrowserSigner> {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(toBinaryString(file));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/password|MAC|decrypt|Invalid/i.test(message)) throw new WrongPasswordError(message);
    throw new Error(`Could not open the certificate file: ${message}`);
  }

  const keyBags = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
  ];
  const rsaKey = keyBags.find((b) => b.key)?.key as forge.pki.rsa.PrivateKey | undefined;
  // node-forge only turns RSA keys into objects; for EC keys it leaves the
  // decrypted PKCS#8 PrivateKeyInfo in `asn1`.
  const ecInfo = rsaKey ? undefined : keyBags.find((b) => !b.key && b.asn1)?.asn1;
  if (!rsaKey && !ecInfo) throw new Error("No private key in the file.");

  const certs = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [])
    .map((b) => b.cert)
    .filter((c): c is forge.pki.Certificate => Boolean(c));
  // node-forge cannot parse certificates with EC keys either: it leaves them
  // as raw ASN.1 in `asn1`. Keep every certificate as DER so none is lost.
  const rawCerts = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [])
    .map((b) => (b.cert ? certDer(b.cert) : b.asn1 ? fromBinaryString(forge.asn1.toDer(b.asn1).getBytes()) : null))
    .filter((d): d is Uint8Array => Boolean(d));

  if (rsaKey) {
    const leaf = certs.find((c) => {
      const pub = c.publicKey as forge.pki.rsa.PublicKey;
      return pub.n && pub.n.equals(rsaKey.n) && pub.e.equals(rsaKey.e);
    });
    if (!leaf) throw new Error("The file has a private key but not its certificate.");
    const leafDer = certDer(leaf);
    const pkcs8 = forge.asn1.toDer(forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(rsaKey))).getBytes();
    const cryptoKey = await crypto.subtle.importKey(
      "pkcs8",
      fromBinaryString(pkcs8) as BufferSource,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
    return {
      certificate: leafDer,
      chain: rawCerts.filter((d) => !sameBytes(d, leafDer)),
      summary: { subject: cn(leaf.subject.attributes), issuer: cn(leaf.issuer.attributes), validTo: leaf.validity.notAfter },
      async sign(toBeSigned) {
        return new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, toBeSigned as BufferSource));
      },
    };
  }
  return openEcKey(fromBinaryString(forge.asn1.toDer(ecInfo!).getBytes()), rawCerts);
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

const EC_CURVES: Record<string, { curve: "P-256" | "P-384" | "P-521"; size: number }> = {
  "1.2.840.10045.3.1.7": { curve: "P-256", size: 32 },
  "1.3.132.0.34": { curve: "P-384", size: 48 },
  "1.3.132.0.35": { curve: "P-521", size: 66 },
};

const b64urlToBytes = (s: string) => fromBase64(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));

/** EC key from a PKCS#8 PrivateKeyInfo; the certificate is found by its public point. */
async function openEcKey(pkcs8: Uint8Array, certsDer: Uint8Array[]): Promise<BrowserSigner> {
  const pkijs = await import("pkijs");
  const info = pkijs.PrivateKeyInfo.fromBER(pkcs8.slice().buffer as ArrayBuffer);
  const params = info.privateKeyAlgorithm.algorithmParams as { valueBlock?: { toString(): string } } | undefined;
  const curveOid = params?.valueBlock?.toString() ?? "";
  const curve = EC_CURVES[curveOid];
  if (info.privateKeyAlgorithm.algorithmId !== "1.2.840.10045.2.1" || !curve) {
    throw new Error("Unsupported key type in the certificate file (expected RSA or ECDSA P-256/P-384/P-521).");
  }
  // Import once as extractable only to read the public point, then again as
  // non-extractable for signing; the extractable handle is dropped.
  const algo = { name: "ECDSA", namedCurve: curve.curve } as const;
  const probe = await crypto.subtle.importKey("pkcs8", pkcs8 as BufferSource, algo, true, ["sign"]);
  const jwk = await crypto.subtle.exportKey("jwk", probe);
  const point = new Uint8Array([4, ...b64urlToBytes(jwk.x!), ...b64urlToBytes(jwk.y!)]);

  let leafDer: Uint8Array | null = null;
  let leaf: import("pkijs").Certificate | null = null;
  for (const der of certsDer) {
    const c = pkijs.Certificate.fromBER(der.slice().buffer as ArrayBuffer);
    const spk = new Uint8Array(c.subjectPublicKeyInfo.subjectPublicKey.valueBlock.valueHexView);
    if (sameBytes(spk, point)) {
      leaf = c;
      leafDer = der;
      break;
    }
  }
  if (!leaf || !leafDer) throw new Error("The file has a private key but not its certificate.");
  const cryptoKey = await crypto.subtle.importKey("pkcs8", pkcs8 as BufferSource, algo, false, ["sign"]);
  const rdnCn = (n: import("pkijs").RelativeDistinguishedNames) =>
    String((n.typesAndValues.find((t) => t.type === "2.5.4.3")?.value as { valueBlock?: { value?: string } } | undefined)?.valueBlock?.value ?? "");
  return {
    certificate: leafDer,
    chain: certsDer.filter((d) => d !== leafDer),
    summary: { subject: rdnCn(leaf.subject), issuer: rdnCn(leaf.issuer), validTo: leaf.notAfter.value },
    async sign(toBeSigned) {
      // Raw r||s; buildPadesCms converts it to DER.
      return new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, cryptoKey, toBeSigned as BufferSource));
    },
  };
}
// ---------------------------------------------------------------------------
// A3 (and OS-installed A1) through Lacuna Web PKI
// ---------------------------------------------------------------------------

export type WebPkiCertificate = {
  thumbprint: string;
  subjectName: string;
  issuerName: string;
  validityEnd: Date;
  isIcpBrasil: boolean;
  /** CPF/CNPJ as reported by Web PKI (ICP-Brasil fields), when present. */
  cpf?: string;
  cnpj?: string;
};

type WebPkiPromise<T> = { success(cb: (v: T) => void): WebPkiPromise<T>; fail(cb: (e: unknown) => void): WebPkiPromise<T> };
type WebPkiInstance = {
  init(args: { ready: () => void; license?: string; notInstalled?: (status: unknown, message: string) => void; defaultFail?: (e: unknown) => void }): void;
  listCertificates(): WebPkiPromise<
    Array<{
      thumbprint: string;
      subjectName: string;
      issuerName: string;
      validityEnd: Date;
      keyUsage?: { digitalSignature?: boolean; nonRepudiation?: boolean };
      pkiBrazil?: { cpf?: string | null; cnpj?: string | null; certificateType?: string | null } | null;
    }>
  >;
  readCertificate(args: { thumbprint: string }): WebPkiPromise<string>;
  signHash(args: { thumbprint: string; hash: string; digestAlgorithm: string }): WebPkiPromise<string>;
  redirectToInstallPage(): void;
};

const settle = <T,>(p: WebPkiPromise<T>) =>
  new Promise<T>((resolve, reject) => {
    p.success(resolve).fail((e) => reject(new Error(typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e))));
  });

export class WebPkiNotInstalledError extends Error {
  constructor(message: string, readonly install: () => void) {
    super(message);
  }
}

let webPki: Promise<WebPkiInstance> | null = null;

/** Loads and initializes Web PKI once per page. */
export function loadWebPki(): Promise<WebPkiInstance> {
  if (webPki) return webPki;
  webPki = (async () => {
    const mod = await import("web-pki");
    const LacunaWebPKI = (mod as unknown as { default: new (license?: string) => WebPkiInstance }).default;
    const license = process.env.NEXT_PUBLIC_WEBPKI_LICENSE || undefined;
    const pki = new LacunaWebPKI(license);
    await new Promise<void>((resolve, reject) => {
      pki.init({
        license,
        ready: resolve,
        notInstalled: (_status, message) =>
          reject(new WebPkiNotInstalledError(message, () => pki.redirectToInstallPage())),
        defaultFail: (e) => reject(e instanceof Error ? e : new Error(String(e))),
      });
    });
    return pki;
  })();
  webPki.catch(() => {
    webPki = null;
  });
  return webPki;
}

export async function listWebPkiCertificates(): Promise<WebPkiCertificate[]> {
  const pki = await loadWebPki();
  const certs = await settle(pki.listCertificates());
  return certs
    .filter((c) => c.keyUsage?.digitalSignature !== false || c.keyUsage?.nonRepudiation)
    .map((c) => ({
      thumbprint: c.thumbprint,
      subjectName: c.subjectName,
      issuerName: c.issuerName,
      validityEnd: new Date(c.validityEnd),
      isIcpBrasil: Boolean(c.pkiBrazil && (c.pkiBrazil.cpf || c.pkiBrazil.cnpj || c.pkiBrazil.certificateType)),
      cpf: c.pkiBrazil?.cpf ?? undefined,
      cnpj: c.pkiBrazil?.cnpj ?? undefined,
    }));
}

export async function webPkiSigner(cert: WebPkiCertificate): Promise<BrowserSigner> {
  const pki = await loadWebPki();
  const der = fromBase64(await settle(pki.readCertificate({ thumbprint: cert.thumbprint })));
  return {
    certificate: der,
    // Web PKI returns only the end-entity certificate; validators fetch the
    // intermediates through the certificate's AIA extension.
    chain: [],
    summary: { subject: cert.subjectName, issuer: cert.issuerName, validTo: cert.validityEnd },
    async sign(toBeSigned) {
      const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", toBeSigned as BufferSource));
      const signature = await settle(
        pki.signHash({ thumbprint: cert.thumbprint, hash: toBase64(hash), digestAlgorithm: "SHA-256" }),
      );
      return fromBase64(signature);
    },
  };
}
