// CMS (CAdES) signature for PAdES.
//
// With the ICP-Brasil policy PA_PAdES_AD_RB_v1_3 ("Assinatura Digital com
// Referência Básica", http://politicas.icpbrasil.gov.br/PA_PAdES_AD_RB_v1_3.der,
// listed in LPA_PAdES.der) the signed attributes are exactly:
//   contentType, messageDigest, signingCertificateV2, sigPolicyId.
// Without a policy (PAdES baseline B-B, ETSI EN 319 142-1, used for eIDAS)
// they are contentType, messageDigest, signingCertificateV2.
// Never signingTime: in PAdES the signing time is the /M entry of the
// signature dictionary.
//
// The private key never reaches this module: it receives a `sign` function
// (WebCrypto key from an A1 file, or the Web PKI component for A3 tokens).
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";

export const OID = {
  data: "1.2.840.113549.1.7.1",
  signedData: "1.2.840.113549.1.7.2",
  contentType: "1.2.840.113549.1.9.3",
  messageDigest: "1.2.840.113549.1.9.4",
  signingTime: "1.2.840.113549.1.9.5",
  signingCertificateV2: "1.2.840.113549.1.9.16.2.47",
  sigPolicyId: "1.2.840.113549.1.9.16.2.15",
  spqEtsUri: "1.2.840.113549.1.9.16.5.1",
  sha256: "2.16.840.1.101.3.4.2.1",
  rsaEncryption: "1.2.840.113549.1.1.1",
  sha256WithRSA: "1.2.840.113549.1.1.11",
  ecPublicKey: "1.2.840.10045.2.1",
  ecdsaWithSHA256: "1.2.840.10045.4.3.2",
} as const;

/** ICP-Brasil PAdES AD-RB v1.3, from LPA_PAdES.der (valid 2025-07-23 to 2037-10-22). */
export const ICP_BRASIL_PADES_AD_RB_V1_3 = {
  oid: "2.16.76.1.7.1.11.1.3",
  uri: "http://politicas.icpbrasil.gov.br/PA_PAdES_AD_RB_v1_3.der",
  sha256Hex: "23da544aef71f7a75dc85fa6e17a83875741e4baef41ec178258a5c86ace54dd",
} as const;

/** Known ICP-Brasil PAdES policy OIDs, for display when verifying. */
export const ICP_BRASIL_PADES_POLICIES: Record<string, string> = {
  "2.16.76.1.7.1.11.1": "PAdES AD-RB v1.0",
  "2.16.76.1.7.1.11.1.1": "PAdES AD-RB v1.1",
  "2.16.76.1.7.1.11.1.2": "PAdES AD-RB v1.2",
  "2.16.76.1.7.1.11.1.3": "PAdES AD-RB v1.3",
  "2.16.76.1.7.1.12.1": "PAdES AD-RT v1.0",
  "2.16.76.1.7.1.12.1.1": "PAdES AD-RT v1.1",
  "2.16.76.1.7.1.13.1": "PAdES AD-RC v1.0",
  "2.16.76.1.7.1.13.1.1": "PAdES AD-RC v1.1",
  "2.16.76.1.7.1.13.1.2": "PAdES AD-RC v1.2",
  "2.16.76.1.7.1.14.1": "PAdES AD-RA v1.0",
  "2.16.76.1.7.1.14.1.1": "PAdES AD-RA v1.1",
  "2.16.76.1.7.1.14.1.2": "PAdES AD-RA v1.2",
};

export type KeyKind = "RSA" | "EC";

export type CmsSigner = {
  /** DER of the signer's certificate. */
  certificate: Uint8Array;
  /** DER of intermediate certificates to embed (optional, recommended). */
  chain: Uint8Array[];
  /**
   * Signs the DER of the signed attributes with SHA-256. RSA: PKCS#1 v1.5.
   * EC: DER-encoded ECDSA signature or raw r||s (both accepted).
   */
  sign(toBeSigned: Uint8Array): Promise<Uint8Array>;
};

const ab = (u: Uint8Array): ArrayBuffer => u.slice().buffer as ArrayBuffer;

export function parseCertificate(der: Uint8Array): pkijs.Certificate {
  return pkijs.Certificate.fromBER(ab(der));
}

export function keyKindOf(cert: pkijs.Certificate): KeyKind {
  const alg = cert.subjectPublicKeyInfo.algorithm.algorithmId;
  if (alg === OID.rsaEncryption) return "RSA";
  if (alg === OID.ecPublicKey) return "EC";
  throw new Error(`Unsupported key algorithm ${alg}.`);
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data as BufferSource));
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

/** ECDSA raw r||s → DER SEQUENCE { r INTEGER, s INTEGER }; DER input passes through. */
function ecdsaToDer(sig: Uint8Array): Uint8Array {
  if (sig[0] === 0x30 && sig.length === sig[1] + 2) return sig;
  if (sig.length % 2 !== 0) throw new Error("Unexpected ECDSA signature length.");
  const half = sig.length / 2;
  const int = (bytes: Uint8Array) => {
    let i = 0;
    while (i < bytes.length - 1 && bytes[i] === 0) i++;
    let v = bytes.slice(i);
    if (v[0] & 0x80) v = Uint8Array.from([0, ...v]);
    return new asn1js.Integer({ valueHex: ab(v) });
  };
  const seq = new asn1js.Sequence({ value: [int(sig.slice(0, half)), int(sig.slice(half))] });
  return new Uint8Array(seq.toBER());
}

function signingCertificateV2(cert: pkijs.Certificate, certHash: Uint8Array): pkijs.Attribute {
  // ESSCertIDv2 with the default hash algorithm (SHA-256), which DER requires
  // to be omitted, plus issuerSerial.
  const issuerSerial = new asn1js.Sequence({
    value: [
      new asn1js.Sequence({
        value: [
          new asn1js.Constructed({
            idBlock: { tagClass: 3, tagNumber: 4 }, // [4] directoryName (EXPLICIT)
            value: [cert.issuer.toSchema()],
          }),
        ],
      }),
      cert.serialNumber,
    ],
  });
  const essCertIdV2 = new asn1js.Sequence({
    value: [new asn1js.OctetString({ valueHex: ab(certHash) }), issuerSerial],
  });
  return new pkijs.Attribute({
    type: OID.signingCertificateV2,
    values: [new asn1js.Sequence({ value: [new asn1js.Sequence({ value: [essCertIdV2] })] })],
  });
}

function signaturePolicyId(policy: { oid: string; uri: string; sha256Hex: string }): pkijs.Attribute {
  const hash = Uint8Array.from(policy.sha256Hex.match(/../g)!.map((h) => parseInt(h, 16)));
  return new pkijs.Attribute({
    type: OID.sigPolicyId,
    values: [
      new asn1js.Sequence({
        value: [
          new asn1js.ObjectIdentifier({ value: policy.oid }),
          new asn1js.Sequence({
            value: [
              new pkijs.AlgorithmIdentifier({ algorithmId: OID.sha256 }).toSchema(),
              new asn1js.OctetString({ valueHex: ab(hash) }),
            ],
          }),
          new asn1js.Sequence({
            value: [
              new asn1js.Sequence({
                value: [
                  new asn1js.ObjectIdentifier({ value: OID.spqEtsUri }),
                  new asn1js.IA5String({ value: policy.uri }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

/**
 * Builds a detached CMS SignedData over `contentDigest` (the SHA-256 of the
 * PDF /ByteRange bytes). `policy` adds the sigPolicyId attribute (default:
 * ICP-Brasil AD-RB v1.3); pass null for a PAdES baseline signature without
 * an explicit policy.
 */
export async function buildPadesCms(
  contentDigest: Uint8Array,
  signer: CmsSigner,
  policy: { oid: string; uri: string; sha256Hex: string } | null = ICP_BRASIL_PADES_AD_RB_V1_3,
): Promise<Uint8Array> {
  const cert = parseCertificate(signer.certificate);
  const kind = keyKindOf(cert);
  const certHash = await sha256(signer.certificate);

  const attributes = [
    new pkijs.Attribute({
      type: OID.contentType,
      values: [new asn1js.ObjectIdentifier({ value: OID.data })],
    }),
    new pkijs.Attribute({
      type: OID.messageDigest,
      values: [new asn1js.OctetString({ valueHex: ab(contentDigest) })],
    }),
    signingCertificateV2(cert, certHash),
    ...(policy ? [signaturePolicyId(policy)] : []),
  ];

  // DER: a SET OF is sorted by the encodings of its elements. The bytes that
  // get signed are the attributes encoded as a SET (tag 0x31); in the
  // SignerInfo they appear with the [0] IMPLICIT tag in the same order.
  const encoded = attributes.map((a) => ({ a, der: new Uint8Array(a.toSchema().toBER()) }));
  encoded.sort((x, y) => compareBytes(x.der, y.der));
  const sorted = encoded.map((e) => e.a);
  const toBeSigned = new Uint8Array(new asn1js.Set({ value: sorted.map((a) => a.toSchema()) }).toBER());

  let signature = await signer.sign(toBeSigned);
  if (kind === "EC") signature = ecdsaToDer(signature);

  const signerInfo = new pkijs.SignerInfo({
    version: 1,
    sid: new pkijs.IssuerAndSerialNumber({ issuer: cert.issuer, serialNumber: cert.serialNumber }),
    digestAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: OID.sha256 }),
    signedAttrs: new pkijs.SignedAndUnsignedAttributes({ type: 0, attributes: sorted }),
    signatureAlgorithm:
      kind === "RSA"
        ? new pkijs.AlgorithmIdentifier({ algorithmId: OID.sha256WithRSA, algorithmParams: new asn1js.Null() })
        : new pkijs.AlgorithmIdentifier({ algorithmId: OID.ecdsaWithSHA256 }),
    signature: new asn1js.OctetString({ valueHex: ab(signature) }),
  });

  const certificates = [cert, ...signer.chain.map(parseCertificate)];
  const signedData = new pkijs.SignedData({
    version: 1,
    digestAlgorithms: [new pkijs.AlgorithmIdentifier({ algorithmId: OID.sha256 })],
    encapContentInfo: new pkijs.EncapsulatedContentInfo({ eContentType: OID.data }),
    certificates,
    signerInfos: [signerInfo],
  });

  const contentInfo = new pkijs.ContentInfo({
    contentType: OID.signedData,
    content: signedData.toSchema(true),
  });
  return new Uint8Array(contentInfo.toSchema().toBER());
}
