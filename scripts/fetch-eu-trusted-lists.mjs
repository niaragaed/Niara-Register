// Builds public/trust/eu-trusted-cas.json from the EU List of Trusted Lists
// (LOTL, eIDAS Regulation (EU) No 910/2014, art. 22).
//
//   node scripts/fetch-eu-trusted-lists.mjs
//
// What it does:
//   1. Downloads the LOTL and checks its XML signature. The signing certificate
//      must be one of LOTL_SIGNER_SHA256 below: the LOTL signing certificates
//      the European Commission publishes in the Official Journal of the EU
//      ("Information related to data on Member States' trusted lists"). Check
//      the fingerprints against the latest notice before trusting a new list.
//   2. Downloads every national trusted list the LOTL points to (XML only) and
//      checks its XML signature against the signing certificates the LOTL lists
//      for that country. A list that fails is left out and reported.
//   3. Keeps the trust services of type CA/QC (CAs issuing qualified
//      certificates) whose CURRENT status is "granted", and writes their
//      certificates with the country, the provider and what they are qualified
//      for (e-signatures, e-seals, website authentication).
//
// Simplifications, stated in the UI as well: the status history is not used
// (a CA whose status is no longer "granted" is left out, even for certificates
// it issued while granted), the per-service "qualifiers" are not applied, and
// revocation is not checked. The European Commission's DSS validator is the
// reference for a full eIDAS validation.
import { createHash, createPublicKey, verify as cryptoVerify, createVerify, constants, X509Certificate } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DOMParser } from "@xmldom/xmldom";
import { SignedXml } from "xml-crypto";
import * as pkijs from "pkijs";
import { PINNED_LOTL_SIGNERS } from "./eu-lotl-signers.mjs";

const LOTL_URL = "https://ec.europa.eu/tools/lotl/eu-lotl.xml";

// SHA-256 of the certificates allowed to sign the LOTL (DER). See the file
// for where they come from and how to check them.
const LOTL_SIGNER_SHA256 = new Set(PINNED_LOTL_SIGNERS.map((s) => s.sha256.toLowerCase()));

const TSL = "http://uri.etsi.org/02231/v2#";
const DS = "http://www.w3.org/2000/09/xmldsig#";
const SVC_CA_QC = "http://uri.etsi.org/TrstSvc/Svctype/CA/QC";
const STATUS_GRANTED = "http://uri.etsi.org/TrstSvc/TrustedList/Svcstatus/granted";
const USAGE = {
  "http://uri.etsi.org/TrstSvc/TrustedList/SvcInfoExt/ForeSignatures": "esig",
  "http://uri.etsi.org/TrstSvc/TrustedList/SvcInfoExt/ForeSeals": "eseal",
  "http://uri.etsi.org/TrstSvc/TrustedList/SvcInfoExt/ForWebSiteAuthentication": "web",
};
// The old UK list stays in the LOTL for history only (the UK left in 2020).
const SKIP_URLS = new Set(["https://ec.europa.eu/tools/lotl/Final_EU_TSL-UKsigned.xml"]);

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "trust", "eu-trusted-cas.json");

// --- XML signature algorithms xml-crypto does not ship -----------------------

const b64 = (s) => Buffer.from(s, "base64");

function rsaAlgo(uri, hash, pss = false) {
  return class {
    getAlgorithmName = () => uri;
    getSignature = () => {
      throw new Error("verify only");
    };
    verifySignature = (material, key, signatureValue) => {
      const v = createVerify(hash);
      v.update(material);
      return pss
        ? v.verify({ key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: constants.RSA_PSS_SALTLEN_AUTO }, b64(signatureValue))
        : v.verify(key, b64(signatureValue));
    };
  };
}

function ecdsaAlgo(uri, hash) {
  return class {
    getAlgorithmName = () => uri;
    getSignature = () => {
      throw new Error("verify only");
    };
    // XMLDSig ECDSA signatures are raw r||s (RFC 4050 / RFC 6931).
    verifySignature = (material, key, signatureValue) =>
      cryptoVerify(hash, Buffer.from(material), { key: createPublicKey(key), dsaEncoding: "ieee-p1363" }, b64(signatureValue));
  };
}

class Sha384 {
  getHash = (xml) => createHash("sha384").update(xml, "utf8").digest("base64");
  getAlgorithmName = () => "http://www.w3.org/2001/04/xmldsig-more#sha384";
}

export function verifyXmlSignature(xml, allowedCertsDer) {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const sigs = doc.getElementsByTagNameNS(DS, "Signature");
  // The trusted-list signature is the direct child of the root element.
  let sigNode = null;
  for (let i = 0; i < sigs.length; i++) if (sigs[i].parentNode === doc.documentElement) sigNode = sigs[i];
  if (!sigNode) throw new Error("no enveloped signature");

  const embedded = [];
  const x509 = sigNode.getElementsByTagNameNS(DS, "X509Certificate");
  for (let i = 0; i < x509.length; i++) embedded.push(b64(x509[i].textContent.replace(/\s+/g, "")));

  // The signing certificate must be one of the allowed ones; if KeyInfo carries
  // none, try each allowed certificate.
  const allowed = allowedCertsDer.map((d) => Buffer.from(d));
  const candidates = embedded.length
    ? embedded.filter((e) => allowed.some((a) => a.equals(e)))
    : allowed;
  if (!candidates.length) throw new Error("signed by a certificate that is not on the allowed list");

  for (const der of candidates) {
    const pem = new X509Certificate(der).toString();
    const sx = new SignedXml({ publicCert: pem, getCertFromKeyInfo: () => null });
    Object.assign(sx.SignatureAlgorithms, {
      "http://www.w3.org/2001/04/xmldsig-more#rsa-sha384": rsaAlgo("http://www.w3.org/2001/04/xmldsig-more#rsa-sha384", "sha384"),
      "http://www.w3.org/2007/05/xmldsig-more#sha384-rsa-MGF1": rsaAlgo("http://www.w3.org/2007/05/xmldsig-more#sha384-rsa-MGF1", "sha384", true),
      "http://www.w3.org/2007/05/xmldsig-more#sha512-rsa-MGF1": rsaAlgo("http://www.w3.org/2007/05/xmldsig-more#sha512-rsa-MGF1", "sha512", true),
      "http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256": ecdsaAlgo("http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256", "sha256"),
      "http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha384": ecdsaAlgo("http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha384", "sha384"),
      "http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha512": ecdsaAlgo("http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha512", "sha512"),
    });
    sx.HashAlgorithms["http://www.w3.org/2001/04/xmldsig-more#sha384"] = Sha384;
    try {
      sx.loadSignature(sigNode);
      if (sx.checkSignature(xml)) return { doc, signer: der };
    } catch {
      // try the next candidate
    }
  }
  throw new Error("XML signature does not verify");
}

// --- small DOM helpers ---------------------------------------------------------

const children = (node, ns, name) => {
  const r = [];
  for (let c = node?.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && c.namespaceURI === ns && c.localName === name) r.push(c);
  return r;
};
const child = (node, ns, name) => children(node, ns, name)[0] ?? null;
const text = (node) => (node?.textContent ?? "").trim();
const descendantsByLocalName = (node, name) => {
  const r = [];
  const walk = (n) => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue;
      if (c.localName === name) r.push(c);
      walk(c);
    }
  };
  walk(node);
  return r;
};

/** English name if present, otherwise the first one. */
function multilang(node) {
  if (!node) return "";
  const names = children(node, TSL, "Name");
  const en = names.find((n) => n.getAttribute("xml:lang") === "en");
  return text(en ?? names[0]);
}

// --- certificate keys shared with lib/pades/eu-trust.ts ------------------------

/** Lower-cased, whitespace-collapsed "oid=value" list of a distinguished name. */
export function normalizeName(rdns) {
  return rdns.typesAndValues
    .map((tv) => `${tv.type}=${String(tv.value.valueBlock.value ?? "").replace(/\s+/g, " ").trim().toLowerCase()}`)
    .join(",");
}

const hex = (buf) => Buffer.from(buf).toString("hex");

function certEntry(der) {
  const cert = pkijs.Certificate.fromBER(new Uint8Array(der).buffer);
  const skiExt = cert.extensions?.find((e) => e.extnID === "2.5.29.14");
  const ski = skiExt?.parsedValue ? hex(skiExt.parsedValue.valueBlock.valueHexView) : undefined;
  return {
    sha256: createHash("sha256").update(der).digest("hex"),
    subjectKey: createHash("sha256").update(normalizeName(cert.subject)).digest("hex").slice(0, 32),
    ski,
    notAfter: cert.notAfter.value.toISOString().slice(0, 10),
    der: Buffer.from(der).toString("base64"),
  };
}

// --- main ----------------------------------------------------------------------

async function fetchText(url) {
  const res = await fetch(url, { headers: { "user-agent": "niara-register-trust-list-builder" }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function main() {
  if (LOTL_SIGNER_SHA256.size === 0) throw new Error("No pinned LOTL signer certificates.");
  const lotlXml = await fetchText(LOTL_URL);
  const lotlCandidates = [];
  {
    const doc = new DOMParser().parseFromString(lotlXml, "text/xml");
    const sig = [...Array.from(doc.getElementsByTagNameNS(DS, "Signature"))].find((s) => s.parentNode === doc.documentElement);
    for (const x of Array.from(sig?.getElementsByTagNameNS(DS, "X509Certificate") ?? [])) {
      const der = b64(x.textContent.replace(/\s+/g, ""));
      if (LOTL_SIGNER_SHA256.has(createHash("sha256").update(der).digest("hex"))) lotlCandidates.push(der);
    }
  }
  if (!lotlCandidates.length) throw new Error("The LOTL is not signed by a pinned certificate. Check the Official Journal notice.");
  const { doc: lotl, signer: lotlSigner } = verifyXmlSignature(lotlXml, lotlCandidates);
  const scheme = child(lotl.documentElement, TSL, "SchemeInformation");
  const lotlSequence = Number(text(child(scheme, TSL, "TSLSequenceNumber")));
  const lotlIssued = text(child(scheme, TSL, "ListIssueDateTime"));
  console.log(`LOTL #${lotlSequence} (${lotlIssued}) signature ok`);

  const pointers = descendantsByLocalName(lotl.documentElement, "OtherTSLPointer").map((p) => {
    const territory = text(descendantsByLocalName(p, "SchemeTerritory")[0]);
    const mime = text(descendantsByLocalName(p, "MimeType")[0]);
    const certs = descendantsByLocalName(p, "X509Certificate").map((x) => b64(text(x).replace(/\s+/g, "")));
    return { url: text(child(p, TSL, "TSLLocation")), territory, mime, certs };
  });

  const lists = [];
  const failures = [];
  const byFingerprint = new Map();
  for (const p of pointers) {
    if (p.url === LOTL_URL || SKIP_URLS.has(p.url) || !/xml/.test(p.mime) || p.territory === "EU") continue;
    try {
      const xml = await fetchText(p.url);
      const { doc } = verifyXmlSignature(xml, p.certs);
      const info = child(doc.documentElement, TSL, "SchemeInformation");
      const seq = Number(text(child(info, TSL, "TSLSequenceNumber")));
      const nextUpdate = text(descendantsByLocalName(info, "dateTime")[0]);
      let count = 0;
      for (const tsp of descendantsByLocalName(doc.documentElement, "TrustServiceProvider")) {
        const tspName = multilang(child(child(tsp, TSL, "TSPInformation"), TSL, "TSPName"));
        for (const svc of descendantsByLocalName(tsp, "TSPService")) {
          const si = child(svc, TSL, "ServiceInformation");
          if (text(child(si, TSL, "ServiceTypeIdentifier")) !== SVC_CA_QC) continue;
          if (text(child(si, TSL, "ServiceStatus")) !== STATUS_GRANTED) continue;
          const usages = new Set();
          for (const asi of descendantsByLocalName(si, "AdditionalServiceInformation")) {
            const u = USAGE[text(child(asi, TSL, "URI"))];
            if (u) usages.add(u);
          }
          const serviceName = multilang(child(si, TSL, "ServiceName"));
          const sdi = child(si, TSL, "ServiceDigitalIdentity");
          for (const x of descendantsByLocalName(sdi, "X509Certificate")) {
            let entry;
            try {
              entry = certEntry(b64(text(x).replace(/\s+/g, "")));
            } catch {
              continue; // malformed certificate in a list: skip it
            }
            const prev = byFingerprint.get(entry.sha256);
            if (prev) {
              for (const u of usages) if (!prev.usages.includes(u)) prev.usages.push(u);
              continue;
            }
            byFingerprint.set(entry.sha256, {
              country: p.territory,
              tsp: tspName,
              service: serviceName,
              // No AdditionalServiceInformation means the service is not
              // restricted to one use.
              usages: usages.size ? [...usages].sort() : ["esig", "eseal", "web"],
              ...entry,
            });
            count++;
          }
        }
      }
      lists.push({ country: p.territory, url: p.url, sequence: seq, nextUpdate, cas: count });
      console.log(`${p.territory}: #${seq}, ${count} CA/QC certificates`);
    } catch (error) {
      failures.push({ country: p.territory, url: p.url, error: error.message });
      console.warn(`${p.territory}: SKIPPED (${error.message})`);
    }
  }

  for (const ca of byFingerprint.values()) ca.usages.sort();
  const cas = [...byFingerprint.values()].sort((a, b) => a.country.localeCompare(b.country) || a.tsp.localeCompare(b.tsp) || a.sha256.localeCompare(b.sha256));
  const result = {
    format: "niara-eu-trusted-cas/1",
    source: LOTL_URL,
    generatedAt: new Date().toISOString(),
    lotl: { sequence: lotlSequence, issued: lotlIssued, sha256: createHash("sha256").update(lotlXml).digest("hex"), signerSha256: createHash("sha256").update(lotlSigner).digest("hex") },
    lists,
    failures,
    cas,
  };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(result));
  console.log(`\n${cas.length} certificates from ${lists.length} lists (${failures.length} skipped) → ${out}`);
}

// Run only when executed directly (tests import verifyXmlSignature).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
