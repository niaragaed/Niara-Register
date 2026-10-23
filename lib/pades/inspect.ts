// Reads the signatures of a PDF and checks what can be checked offline, in
// the browser:
//   - the CMS signature is mathematically valid over the /ByteRange bytes;
//   - whether the last signature covers the whole file (nothing appended after);
//   - who signed (certificate CN; CPF/CNPJ from the ICP-Brasil SAN fields);
//   - which signature policy it declares;
//   - whether the certificate chains to an ICP-Brasil root.
// NOT checked here: revocation (CRL/OCSP) and the full policy rules. The ITI
// verifier (https://validar.iti.gov.br) is the reference for those, and the
// UI says so.
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { ICP_BRASIL_PADES_POLICIES, OID } from "./cms";
import { ICP_BRASIL_ROOTS } from "./icp-roots";

export type ChainStatus =
  | { status: "icp-brasil"; root: string }
  | { status: "incomplete"; detail: string }
  | { status: "untrusted"; detail: string };

export type SignerIdentity = {
  commonName: string;
  issuerCommonName: string;
  serialHex: string;
  validFrom: Date;
  validTo: Date;
  /** Masked, e.g. ***.456.789-** (ICP-Brasil OID 2.16.76.1.3.1 / .3.4). */
  cpfMasked?: string;
  /** ICP-Brasil OID 2.16.76.1.3.3. */
  cnpj?: string;
};

export type PadesSignatureReport = {
  byteRange: [number, number, number, number];
  coversWholeFile: boolean;
  digestMatches: boolean;
  signatureValid: boolean;
  signer: SignerIdentity | null;
  policyOid?: string;
  policyName?: string;
  filter?: string;
  subFilter?: string;
  /** Raw /M value of the signature dictionary, e.g. D:20261021143000+00'00'. */
  pdfSigningTime?: string;
  chain: ChainStatus;
  error?: string;
};

const ab = (u: Uint8Array): ArrayBuffer => u.slice().buffer as ArrayBuffer;

const latin1 = (bytes: Uint8Array, from: number, to: number) => {
  let s = "";
  for (let i = from; i < to; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, Math.min(i + 0x8000, to)));
  }
  return s;
};

function fromHex(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, "");
  const out = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Trims the zero padding after the outer DER element. */
function trimDer(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 2 || bytes[0] !== 0x30) return bytes;
  const lenByte = bytes[1];
  if (lenByte < 0x80) return bytes.slice(0, 2 + lenByte);
  const n = lenByte & 0x7f;
  let len = 0;
  for (let i = 0; i < n; i++) len = len * 256 + bytes[2 + i];
  return bytes.slice(0, 2 + n + len);
}

function rdnValue(name: pkijs.RelativeDistinguishedNames, oid: string): string {
  const tv = name.typesAndValues.find((t) => t.type === oid);
  return tv ? String((tv.value as { valueBlock: { value: string } }).valueBlock.value) : "";
}

function hexOf(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

function maskCpf(cpf: string): string {
  return `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**`;
}

/** ICP-Brasil "otherName" fields in the Subject Alternative Name. */
function icpBrasilFields(cert: pkijs.Certificate): { cpf?: string; cnpj?: string } {
  const ext = cert.extensions?.find((e) => e.extnID === "2.5.29.17");
  if (!ext?.parsedValue) return {};
  const out: { cpf?: string; cnpj?: string } = {};
  for (const gn of (ext.parsedValue as pkijs.AltName).altNames) {
    if (gn.type !== 0) continue; // otherName
    const seq = gn.value as asn1js.Sequence;
    const items = (seq?.valueBlock?.value ?? []) as asn1js.AsnType[];
    const oid = (items[0] as asn1js.ObjectIdentifier | undefined)?.valueBlock?.toString();
    const tagged = items[1] as asn1js.Constructed | undefined;
    const inner = tagged?.valueBlock?.value?.[0] as
      | (asn1js.AsnType & { valueBlock: { valueHexView?: Uint8Array; value?: string } })
      | undefined;
    if (!oid || !inner) continue;
    const text =
      typeof inner.valueBlock.value === "string"
        ? inner.valueBlock.value
        : new TextDecoder("latin1").decode(inner.valueBlock.valueHexView ?? new Uint8Array());
    const digits = text.replace(/\D/g, "");
    if ((oid === "2.16.76.1.3.1" || oid === "2.16.76.1.3.4") && digits.length >= 19) {
      const cpf = digits.slice(8, 19);
      if (/^\d{11}$/.test(cpf) && !/^0+$/.test(cpf)) out.cpf = cpf;
    } else if (oid === "2.16.76.1.3.3" && digits.length >= 14) {
      out.cnpj = digits.slice(0, 14);
    }
  }
  return out;
}

function identity(cert: pkijs.Certificate): SignerIdentity {
  const { cpf, cnpj } = icpBrasilFields(cert);
  return {
    commonName: rdnValue(cert.subject, "2.5.4.3"),
    issuerCommonName: rdnValue(cert.issuer, "2.5.4.3"),
    serialHex: hexOf(cert.serialNumber.valueBlock.valueHexView.slice().buffer as ArrayBuffer),
    validFrom: cert.notBefore.value,
    validTo: cert.notAfter.value,
    cpfMasked: cpf ? maskCpf(cpf) : undefined,
    cnpj,
  };
}

let rootCache: pkijs.Certificate[] | null = null;
function roots(): pkijs.Certificate[] {
  if (!rootCache) {
    rootCache = ICP_BRASIL_ROOTS.map((r) =>
      pkijs.Certificate.fromBER(ab(Uint8Array.from(atob(r.der), (c) => c.charCodeAt(0)))),
    );
  }
  return rootCache;
}

async function checkChain(
  leaf: pkijs.Certificate,
  embedded: pkijs.Certificate[],
  at: Date,
): Promise<ChainStatus> {
  const trusted = roots();
  const engine = new pkijs.CertificateChainValidationEngine({
    trustedCerts: trusted,
    certs: [...embedded.filter((c) => c !== leaf), leaf],
    checkDate: at,
  });
  const result = await engine.verify();
  if (result.result) {
    const path = result.certificatePath ?? [];
    const top = path[path.length - 1];
    const idx = top ? trusted.findIndex((r) => r === top || hexOf(r.tbsView.slice().buffer as ArrayBuffer) === hexOf(top.tbsView.slice().buffer as ArrayBuffer)) : -1;
    return { status: "icp-brasil", root: idx >= 0 ? ICP_BRASIL_ROOTS[idx].name : "ICP-Brasil" };
  }
  const issuerKnown = embedded.some(
    (c) => c !== leaf && rdnValue(c.subject, "2.5.4.3") === rdnValue(leaf.issuer, "2.5.4.3"),
  );
  return issuerKnown
    ? { status: "untrusted", detail: result.resultMessage }
    : { status: "incomplete", detail: result.resultMessage };
}

/** A name (/X) or literal string ((x)) value of a key in a dictionary text. */
function dictField(text: string, key: string): string | undefined {
  const m = text.match(new RegExp(`/${key}\\s*(\\((?:[^()\\\\]|\\\\.)*\\)|/[^\\s/<>\\[\\]()]+)`));
  if (!m) return undefined;
  const v = m[1];
  return v.startsWith("(") ? v.slice(1, -1) : v.slice(1);
}

export async function inspectPdfSignatures(pdf: Uint8Array): Promise<PadesSignatureReport[]> {
  const text = latin1(pdf, 0, pdf.length);
  const seen = new Set<string>();
  const reports: PadesSignatureReport[] = [];
  const re = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g;

  for (let m = re.exec(text); m; m = re.exec(text)) {
    const byteRange = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] as [number, number, number, number];
    const key = byteRange.join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    const [a, b, c, d] = byteRange;
    if (a !== 0 || b <= 0 || c <= b || c + d > pdf.length) continue;

    // The /Contents hex string sits exactly in the gap [b, c). The rest of the
    // signature dictionary is read from its own object ("N G obj" … "endobj"),
    // with the hex string cut out so it cannot be mistaken for a key.
    const objStart = Math.max(text.lastIndexOf(" obj", m.index), 0);
    const objEnd = text.indexOf("endobj", c);
    const sigObject =
      text.slice(objStart, b) + text.slice(c, objEnd > 0 ? objEnd : Math.min(text.length, c + 4096));
    const base: Omit<PadesSignatureReport, "digestMatches" | "signatureValid" | "signer" | "chain"> = {
      byteRange,
      coversWholeFile: c + d === pdf.length,
      filter: dictField(sigObject, "Filter"),
      subFilter: dictField(sigObject, "SubFilter"),
      pdfSigningTime: dictField(sigObject, "M"),
    };

    try {
      const contents = trimDer(fromHex(text.slice(b + 1, c - 1)));
      const signed = new Uint8Array(b + d);
      signed.set(pdf.subarray(0, b), 0);
      signed.set(pdf.subarray(c, c + d), b);

      const info = pkijs.ContentInfo.fromBER(ab(contents));
      if (info.contentType !== OID.signedData) throw new Error("Not a CMS SignedData.");
      const sd = new pkijs.SignedData({ schema: info.content });
      const si = sd.signerInfos[0];
      const certs = (sd.certificates ?? []).filter((x): x is pkijs.Certificate => x instanceof pkijs.Certificate);

      const sid = si.sid as pkijs.IssuerAndSerialNumber;
      const leaf =
        certs.find(
          (x) =>
            x.serialNumber.isEqual(sid.serialNumber) && x.issuer.isEqual(sid.issuer),
        ) ?? null;

      const attrs = si.signedAttrs?.attributes ?? [];
      const md = attrs.find((x) => x.type === OID.messageDigest);
      const policyAttr = attrs.find((x) => x.type === OID.sigPolicyId);
      const policyOid = policyAttr
        ? ((policyAttr.values[0] as asn1js.Sequence).valueBlock.value[0] as asn1js.ObjectIdentifier).valueBlock.toString()
        : undefined;

      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", signed as BufferSource));
      const mdBytes = md ? new Uint8Array((md.values[0] as asn1js.OctetString).valueBlock.valueHexView) : null;
      const digestMatches = Boolean(mdBytes && mdBytes.length === digest.length && mdBytes.every((v, i) => v === digest[i]));

      let signatureValid = false;
      try {
        const v = await sd.verify({ signer: 0, data: ab(signed), checkChain: false, extendedMode: true });
        signatureValid = Boolean((v as { signatureVerified?: boolean }).signatureVerified);
      } catch {
        signatureValid = false;
      }

      reports.push({
        ...base,
        digestMatches,
        signatureValid,
        signer: leaf ? identity(leaf) : null,
        policyOid,
        policyName: policyOid ? ICP_BRASIL_PADES_POLICIES[policyOid] : undefined,
        chain: leaf ? await checkChain(leaf, certs, new Date()) : { status: "incomplete", detail: "Signer certificate not embedded." },
      });
    } catch (error) {
      reports.push({
        ...base,
        digestMatches: false,
        signatureValid: false,
        signer: null,
        chain: { status: "incomplete", detail: "Could not read the signature." },
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return reports;
}
