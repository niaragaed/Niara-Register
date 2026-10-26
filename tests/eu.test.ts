/**
 * eIDAS (European Union), offline:
 *   - a PDF signed with the "eu-eidas" framework is a PAdES baseline B-B
 *     signature: /Filter /Adobe.PPKLite, /SubFilter /ETSI.CAdES.detached,
 *     signed attributes contentType + messageDigest + signingCertificateV2
 *     only (no policy, no signingTime);
 *   - ECDSA P-256 and RSA certificate files both sign;
 *   - with a trust list that has the test CA as a CA/QC service, the QES
 *     signer is reported as a qualified electronic signature and the software
 *     certificate as an advanced signature with a qualified certificate;
 *     without it, neither chains;
 *   - an ICP-Brasil-framework signature still carries the AD-RB policy;
 *   - the trust-list builder's XML signature check accepts a valid enveloped
 *     signature (RSA and ECDSA) and rejects a changed document or a signer
 *     that is not allowed;
 *   - the committed public/trust/eu-trusted-cas.json is well formed and its
 *     lookup keys match what the browser computes.
 * Run: npm test
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, createHash, X509Certificate, sign as cryptoSign } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import * as pkijs from "pkijs";
import { SignedXml } from "xml-crypto";
import { openPfx } from "../lib/pades/signers";
import { signPdf } from "../lib/pades/sign";
import { inspectPdfSignatures } from "../lib/pades/inspect";
import { signedBytes } from "../lib/pades/pdf-incremental";
import { OID } from "../lib/pades/cms";
import { normalizeName, qcDeclaration, type EuTrustList } from "../lib/pades/eu-trust";

const fixtures = join(__dirname, "fixtures");
const work = mkdtempSync(join(tmpdir(), "eu-"));

const pemToDer = (pem: string) => Buffer.from(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""), "base64");
const hex = (u: Uint8Array) => Buffer.from(u).toString("hex");

function opensslAvailable(): boolean {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function makePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([595, 842]).drawText("Vertrag - Testdokument", { x: 50, y: 780, size: 14, font });
  return doc.save({ useObjectStreams: false });
}

function trustListWith(caPem: string, usages: ("esig" | "eseal" | "web")[]): EuTrustList {
  const der = pemToDer(caPem);
  const cert = pkijs.Certificate.fromBER(new Uint8Array(der).buffer);
  const skiExt = cert.extensions?.find((e) => e.extnID === "2.5.29.14");
  const ski = skiExt ? hex((skiExt.parsedValue as { valueBlock: { valueHexView: Uint8Array } }).valueBlock.valueHexView) : undefined;
  return {
    format: "niara-eu-trusted-cas/1",
    source: "test",
    generatedAt: new Date().toISOString(),
    lotl: { sequence: 1, issued: "", sha256: "", signerSha256: "" },
    lists: [],
    failures: [],
    cas: [
      {
        country: "LU",
        tsp: "Test TSP",
        service: "Test Qualified CA for Signatures",
        usages,
        sha256: createHash("sha256").update(der).digest("hex"),
        subjectKey: createHash("sha256").update(normalizeName(cert.subject)).digest("hex").slice(0, 32),
        ski,
        notAfter: cert.notAfter.value.toISOString().slice(0, 10),
        der: der.toString("base64"),
      },
    ],
  };
}

async function signatureAttributes(pdf: Uint8Array, byteRange: number[]) {
  const [, b, c] = byteRange;
  const h = new TextDecoder("latin1").decode(pdf.subarray(b + 1, c - 1)).replace(/0+$/, "");
  const der = Uint8Array.from((h.length % 2 ? h + "0" : h).match(/../g)!.map((x) => parseInt(x, 16)));
  const sd = new pkijs.SignedData({ schema: pkijs.ContentInfo.fromBER(der.buffer).content });
  return (sd.signerInfos[0].signedAttrs?.attributes ?? []).map((a) => a.type).sort();
}

async function pdfAndCms() {
  const qes = await openPfx(readFileSync(join(fixtures, "eu-signer-qes.p12")), "teste123");
  const adesqc = await openPfx(readFileSync(join(fixtures, "eu-signer-adesqc.p12")), "teste123");
  assert.equal(qes.summary.subject, "ERIKA MUSTERMANN", "EC certificate file opens");
  assert.equal(qes.chain.length, 1, "EC file: issuing CA kept as chain");
  assert.equal(adesqc.summary.subject, "JUAN ESPANOL");
  await assert.rejects(() => openPfx(readFileSync(join(fixtures, "eu-signer-qes.p12")), "wrong"));

  const q = qcDeclaration(pkijs.Certificate.fromBER(qes.certificate.slice().buffer));
  assert.deepEqual(q, { qualified: true, qscd: true, types: ["esig"] }, "QCStatements of the QES signer");

  const original = await makePdf();
  const once = await signPdf(original, qes, { signerName: "Erika Mustermann" }, "eu-eidas");
  const twice = await signPdf(once, adesqc, { signerName: "Juan Espanol" }, "eu-eidas");
  assert.deepEqual(twice.subarray(0, once.length), once, "incremental update keeps the first signature");
  return { qes, adesqc, twice };
}

async function main() {
  const caPem = readFileSync(join(fixtures, "eu-test-ca.crt"), "utf8");
  const { twice } = await pdfAndCms();

  // 1. Signature structure: PAdES baseline B-B.
  const trusted = await inspectPdfSignatures(twice, { euTrustList: async () => trustListWith(caPem, ["esig"]) });
  assert.equal(trusted.length, 2);
  for (const r of trusted) {
    assert.ok(r.digestMatches && r.signatureValid, "both signatures valid");
    assert.equal(r.filter, "Adobe.PPKLite");
    assert.equal(r.subFilter, "ETSI.CAdES.detached");
    assert.equal(r.padesBaseline, true);
    assert.equal(r.policyOid, undefined, "no signature policy");
    assert.deepEqual(
      await signatureAttributes(twice, r.byteRange),
      [OID.contentType, OID.messageDigest, OID.signingCertificateV2].sort(),
      "exactly the B-B signed attributes",
    );
  }

  // 2. Trust: QES, then AdES with a qualified certificate.
  const [first, second] = trusted;
  assert.equal(first.chain.status, "eu-trusted-list");
  assert.equal(second.chain.status, "eu-trusted-list");
  if (first.chain.status === "eu-trusted-list" && second.chain.status === "eu-trusted-list") {
    assert.equal(first.chain.level, "qes");
    assert.equal(first.chain.country, "LU");
    assert.equal(first.chain.tsp, "Test TSP");
    assert.equal(second.chain.level, "adesqc");
  }

  // A CA listed only for e-seals does not make a signature certificate qualified.
  const sealOnly = await inspectPdfSignatures(twice, { euTrustList: async () => trustListWith(caPem, ["eseal"]) });
  assert.ok(sealOnly.every((r) => r.chain.status === "eu-trusted-list" && r.chain.level === "not-qualified"));

  // Without the CA on the list: not trusted.
  const empty = await inspectPdfSignatures(twice, { euTrustList: async () => ({ ...trustListWith(caPem, ["esig"]), cas: [] }) });
  assert.ok(empty.every((r) => r.chain.status === "untrusted"), "not on the list: untrusted");
  const skipped = await inspectPdfSignatures(twice, { euTrustList: null });
  assert.ok(skipped.every((r) => r.chain.status === "untrusted"));
  console.log("ok - eu: PAdES baseline B-B, QES and AdES-QC against a trust list");

  // 3. The ICP-Brasil framework is unchanged (policy present).
  const pf = await openPfx(readFileSync(join(fixtures, "signer-pf.p12")), "teste123");
  const icp = await signPdf(await makePdf(), pf, {}, "br-icp");
  const [icpReport] = await inspectPdfSignatures(icp, { euTrustList: null });
  assert.equal(icpReport.subFilter, "PBAD.PAdES");
  assert.equal(icpReport.policyName, "PAdES AD-RB v1.3");
  assert.equal(icpReport.padesBaseline, false);
  console.log("ok - eu: ICP-Brasil framework unchanged");

  // 4. OpenSSL agrees with the CMS and the chain.
  if (opensslAvailable()) {
    writeFileSync(join(work, "ca.pem"), caPem);
    writeFileSync(join(work, "root.pem"), readFileSync(join(fixtures, "eu-test-root.crt")));
    for (const [i, r] of trusted.entries()) {
      const [, b, c] = r.byteRange;
      writeFileSync(join(work, `sig${i}.der`), Buffer.from(new TextDecoder("latin1").decode(twice.subarray(b + 1, c - 1)), "hex"));
      writeFileSync(join(work, `content${i}.bin`), signedBytes(twice, r.byteRange));
      execFileSync("openssl", [
        "cms", "-verify", "-binary", "-inform", "DER",
        "-in", join(work, `sig${i}.der`),
        "-content", join(work, `content${i}.bin`),
        "-CAfile", join(work, "root.pem"),
        "-purpose", "any",
        "-out", "/dev/null",
      ], { stdio: "pipe" });
    }
    console.log("ok - eu: OpenSSL verifies both CMS signatures to the test root");
  }

  // 5. Trust-list builder: XML signature check.
  const { verifyXmlSignature } = (await import("../scripts/fetch-eu-trusted-lists.mjs")) as {
    verifyXmlSignature: (xml: string, allowed: Uint8Array[]) => unknown;
  };
  for (const kind of ["rsa", "ec"] as const) {
    const { privateKey } =
      kind === "rsa" ? generateKeyPairSync("rsa", { modulusLength: 2048 }) : generateKeyPairSync("ec", { namedCurve: "P-256" });
    // Self-signed certificate for the key, made with OpenSSL (skip if missing).
    if (!opensslAvailable()) break;
    const keyFile = join(work, `xml-${kind}.key`);
    writeFileSync(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }));
    const certPem = execFileSync("openssl", ["req", "-x509", "-new", "-key", keyFile, "-subj", "/CN=TL test signer", "-days", "2"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const certDer = new Uint8Array(new X509Certificate(certPem).raw);
    const algo =
      kind === "rsa" ? "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256" : "http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256";
    const doc = `<TrustServiceStatusList xmlns="http://uri.etsi.org/02231/v2#" Id="tsl"><SchemeInformation><TSLSequenceNumber>7</TSLSequenceNumber></SchemeInformation></TrustServiceStatusList>`;
    const signer = new SignedXml({
      privateKey: privateKey.export({ type: "pkcs8", format: "pem" }),
      publicCert: certPem,
      signatureAlgorithm: algo,
      canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#",
    });
    if (kind === "ec") {
      // xml-crypto has no ECDSA signer; XMLDSig ECDSA values are raw r||s.
      class EcdsaSha256 {
        getAlgorithmName = () => algo;
        getSignature = (signedInfo: string, key: string) =>
          cryptoSign("sha256", Buffer.from(signedInfo), { key, dsaEncoding: "ieee-p1363" }).toString("base64");
        verifySignature = () => true;
      }
      (signer.SignatureAlgorithms as Record<string, unknown>)[algo] = EcdsaSha256;
    }
    signer.addReference({
      xpath: "/*",
      transforms: ["http://www.w3.org/2000/09/xmldsig#enveloped-signature", "http://www.w3.org/2001/10/xml-exc-c14n#"],
      digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
    });
    signer.computeSignature(doc, { location: { reference: "/*", action: "append" } });
    const signed = signer.getSignedXml();
    assert.doesNotThrow(() => verifyXmlSignature(signed, [certDer]), `${kind}: valid trusted-list signature accepted`);
    assert.throws(() => verifyXmlSignature(signed.replace("<TSLSequenceNumber>7", "<TSLSequenceNumber>8"), [certDer]), `${kind}: changed list rejected`);
    const other = execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "/dev/null", "-subj", "/CN=other", "-days", "2"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    assert.throws(() => verifyXmlSignature(signed, [new Uint8Array(new X509Certificate(other).raw)]), `${kind}: signer not allowed`);
  }
  console.log("ok - eu: trusted-list XML signature check");

  // 6. The committed EU trust list.
  const listFile = join(__dirname, "..", "public", "trust", "eu-trusted-cas.json");
  if (existsSync(listFile)) {
    const list = JSON.parse(readFileSync(listFile, "utf8")) as EuTrustList;
    assert.equal(list.format, "niara-eu-trusted-cas/1");
    assert.ok(list.cas.length > 500, "hundreds of qualified CAs");
    assert.ok(new Set(list.lists.map((l) => l.country)).size >= 27, "lists from every EU/EEA country");
    for (const ca of list.cas) {
      const der = Buffer.from(ca.der, "base64");
      assert.equal(createHash("sha256").update(der).digest("hex"), ca.sha256, "fingerprint");
      const cert = pkijs.Certificate.fromBER(new Uint8Array(der).buffer);
      const key = createHash("sha256").update(normalizeName(cert.subject)).digest("hex").slice(0, 32);
      assert.equal(key, ca.subjectKey, `subject key of ${ca.service}`);
      assert.ok(ca.usages.length > 0);
    }
    console.log(`ok - eu: committed trust list (LOTL #${list.lotl.sequence}, ${list.cas.length} CAs, ${list.lists.length} lists)`);
  }
  console.log("ok - eu");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
