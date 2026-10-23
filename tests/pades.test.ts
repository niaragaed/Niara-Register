/**
 * PAdES end to end, offline: build PDFs (classic xref table and xref stream),
 * sign them twice in a row with throwaway certificates (tests/fixtures), and
 * check that
 *   - both signatures verify and the first stays valid after the second
 *     (incremental update),
 *   - the CMS carries the ICP-Brasil AD-RB v1.3 attributes,
 *   - signer identity (CN, masked CPF, CNPJ) is read from the certificate,
 *   - a changed byte is detected,
 *   - OpenSSL agrees the CMS is valid and chains to the test root, and qpdf
 *     finds no structural problem (both skipped if the tool is missing).
 * Run: npm test
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { openPfx } from "../lib/pades/signers";
import { signPdf } from "../lib/pades/sign";
import { inspectPdfSignatures } from "../lib/pades/inspect";
import { signedBytes } from "../lib/pades/pdf-incremental";
import { ICP_BRASIL_PADES_AD_RB_V1_3, OID } from "../lib/pades/cms";

const fixtures = join(__dirname, "fixtures");
const work = mkdtempSync(join(tmpdir(), "pades-"));

function has(tool: string): boolean {
  try {
    execFileSync(tool, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function makePdf(useObjectStreams: boolean): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 2; i++) {
    const page = doc.addPage([595, 842]);
    page.drawText(`Contrato de teste - pagina ${i + 1}`, { x: 50, y: 780, size: 14, font });
  }
  return doc.save({ useObjectStreams });
}

async function main() {
  const pf = await openPfx(readFileSync(join(fixtures, "signer-pf.p12")), "teste123");
  const pj = await openPfx(readFileSync(join(fixtures, "signer-pj.p12")), "teste123");
  assert.equal(pf.summary.subject, "MARIA TESTE:12345678901");
  assert.equal(pf.chain.length, 1);

  await assert.rejects(() => openPfx(readFileSync(join(fixtures, "signer-pf.p12")), "wrong"));

  for (const useObjectStreams of [false, true]) {
    const label = useObjectStreams ? "xref stream" : "xref table";
    const original = await makePdf(useObjectStreams);
    const once = await signPdf(original, pf, { signerName: "Maria Teste", reason: "Assinatura do contrato" });
    const twice = await signPdf(once, pj, { signerName: "Empresa Teste" });

    // The original bytes are a prefix of every signed version (incremental update).
    assert.deepEqual(once.subarray(0, original.length), original, `${label}: original kept`);
    assert.deepEqual(twice.subarray(0, once.length), once, `${label}: first signed version kept`);

    const reports = await inspectPdfSignatures(twice);
    assert.equal(reports.length, 2, `${label}: two signatures`);
    const [first, second] = reports;
    for (const r of reports) {
      assert.ok(r.digestMatches, `${label}: digest`);
      assert.ok(r.signatureValid, `${label}: signature`);
      assert.equal(r.policyOid, ICP_BRASIL_PADES_AD_RB_V1_3.oid);
      assert.equal(r.policyName, "PAdES AD-RB v1.3");
      assert.equal(r.filter, "PBAD_PAdES");
      assert.equal(r.subFilter, "PBAD.PAdES");
      assert.match(r.pdfSigningTime ?? "", /^D:\d{14}\+00'00'$/);
      // Test chain: not ICP-Brasil, but the intermediate is embedded.
      assert.equal(r.chain.status, "untrusted");
    }
    assert.equal(first.coversWholeFile, false, `${label}: first signature does not cover the second`);
    assert.equal(second.coversWholeFile, true, `${label}: last signature covers the file`);
    assert.equal(first.signer?.commonName, "MARIA TESTE:12345678901");
    assert.equal(first.signer?.cpfMasked, "***.456.789-**");
    assert.equal(second.signer?.cnpj, "12345678000199");
    assert.equal(second.signer?.cpfMasked, "***.654.321-**"); // responsible person, 2.16.76.1.3.4

    // Signed attributes: exactly the four the policy requires, no signingTime.
    const [, b, c] = second.byteRange;
    const hex = new TextDecoder("latin1").decode(twice.subarray(b + 1, c - 1)).replace(/0+$/, "");
    const der = Uint8Array.from((hex.length % 2 ? hex + "0" : hex).match(/../g)!.map((h) => parseInt(h, 16)));
    const info = pkijs.ContentInfo.fromBER(der.buffer);
    const sd = new pkijs.SignedData({ schema: info.content });
    const types = (sd.signerInfos[0].signedAttrs?.attributes ?? []).map((a) => a.type).sort();
    assert.deepEqual(types, [OID.contentType, OID.messageDigest, OID.sigPolicyId, OID.signingCertificateV2].sort());
    const policyHash = (
      ((sd.signerInfos[0].signedAttrs!.attributes.find((a) => a.type === OID.sigPolicyId)!.values[0] as asn1js.Sequence)
        .valueBlock.value[1] as asn1js.Sequence).valueBlock.value[1] as asn1js.OctetString
    ).valueBlock.valueHexView;
    assert.equal(Buffer.from(policyHash).toString("hex"), ICP_BRASIL_PADES_AD_RB_V1_3.sha256Hex);

    // Tampering with a signed byte is detected.
    const tampered = twice.slice();
    const pos = 200;
    tampered[pos] = tampered[pos] === 0x41 ? 0x42 : 0x41;
    const bad = await inspectPdfSignatures(tampered);
    assert.ok(bad.every((r) => !r.digestMatches), `${label}: tampering detected`);

    // External tools.
    const file = join(work, `signed-${useObjectStreams ? "stream" : "table"}.pdf`);
    writeFileSync(file, twice);
    if (has("qpdf")) {
      const out = execFileSync("qpdf", ["--check", file], { encoding: "utf8" });
      assert.match(out, /No syntax or stream encoding errors found/, `${label}: qpdf`);
    }
    if (has("openssl")) {
      for (const [i, r] of reports.entries()) {
        const [, rb, rc] = r.byteRange;
        const h = new TextDecoder("latin1").decode(twice.subarray(rb + 1, rc - 1));
        const cms = Buffer.from(h, "hex");
        writeFileSync(join(work, `sig${i}.der`), cms);
        writeFileSync(join(work, `content${i}.bin`), signedBytes(twice, r.byteRange));
        execFileSync("openssl", [
          "cms", "-verify", "-binary", "-inform", "DER",
          "-in", join(work, `sig${i}.der`),
          "-content", join(work, `content${i}.bin`),
          "-CAfile", join(fixtures, "test-root.pem"),
          "-purpose", "any",
          "-out", "/dev/null",
        ], { stdio: "pipe" });
      }
    }
    console.log(`ok - ${label}: two incremental PAdES signatures`);
  }
  console.log("ok - pades");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
