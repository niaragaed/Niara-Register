// POST /api/credentials — issues a W3C VC 2.0 (VC-JOSE) for a v2 record.
//
// The server reads the record from the chain itself, checks the holder's
// off-chain values (file hash, salt, name, type) against the on-chain
// commitments, signs, and returns the credential. Nothing is stored or
// logged: the request body (which may contain the salt and the document
// name) is used once and dropped.
import { NextResponse } from "next/server";
import {
  fromHex,
  isHash32,
  metadataCommitment,
  saltedRecordHash,
  SCHEME_SALTED,
  SCHEME_SIGNED_PDF,
} from "@/lib/commitments";
import { buildCredential, type DocumentRegistrationSubject } from "@/lib/vc/credential";
import { IssuerNotConfigured, issuerConfig, signCredential } from "@/lib/vc/issuer";
import { documentTypeBySlug, documentTypeName } from "@/lib/document-types";
import { caip2, didPkh, isEvm, isRegisterNetwork } from "@/lib/networks";
import { NotDeployed, readRecordV2 } from "@/lib/v2-reader";

export const dynamic = "force-dynamic";

type Body = {
  network?: string;
  recordHash?: string;
  fileSha256?: string;
  salt?: string;
  metadata?: { name?: string; type?: string } | null;
  /** Wallet whose record this is (v3: one record per hash and signer). */
  signer?: string;
};

const bad = (status: number, error: string) => NextResponse.json({ error }, { status });
const clean = (h: string) => (h.startsWith("0x") ? h.slice(2) : h).toLowerCase();

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return bad(400, "invalid_json");
  }

  const { network } = body;
  if (!network || !isRegisterNetwork(network)) return bad(400, "unknown_network");
  if (!body.recordHash || !isHash32(body.recordHash)) return bad(400, "invalid_record_hash");
  const recordHash = clean(body.recordHash);
  const fileSha256 = body.fileSha256 && isHash32(body.fileSha256) ? clean(body.fileSha256) : undefined;
  const salt = body.salt && /^(0x)?[0-9a-fA-F]{64}$/.test(body.salt) ? clean(body.salt) : undefined;
  const name = body.metadata?.name?.trim() ?? "";
  const type = body.metadata?.type?.trim() ?? "";
  if (name.length > 200 || type.length > 64) return bad(400, "metadata_too_long");

  try {
    issuerConfig();
  } catch (e) {
    if (e instanceof IssuerNotConfigured) {
      return NextResponse.json({ error: "issuer_not_configured", reason: e.reason }, { status: 503 });
    }
    throw e;
  }

  let record;
  try {
    // v3 records are one per (hash, signer): the holder says which one is theirs.
    const signer = typeof body.signer === "string" && body.signer.length <= 64 ? body.signer : undefined;
    record = await readRecordV2(network, recordHash, signer);
  } catch (e) {
    if (e instanceof NotDeployed) return bad(409, "v2_not_deployed");
    return bad(502, "chain_unavailable");
  }
  if (!record) return bad(404, "record_not_found");

  // Everything the holder claims must match what is on-chain.
  if (record.scheme === SCHEME_SIGNED_PDF) {
    if (fileSha256 && fileSha256 !== recordHash) return bad(422, "file_hash_mismatch");
  } else if (record.scheme === SCHEME_SALTED) {
    if (!fileSha256 || !salt) return bad(422, "salt_and_file_hash_required");
    if ((await saltedRecordHash(fileSha256, fromHex(salt))) !== recordHash) return bad(422, "file_hash_mismatch");
  }
  const hasMetadata = name !== "" || type !== "";
  // The committed type slug must be the one whose code is on-chain.
  if (type !== "" && documentTypeBySlug(type)?.code !== record.documentType) return bad(422, "document_type_mismatch");
  if (hasMetadata) {
    if (!salt) return bad(422, "salt_required_for_metadata");
    if ((await metadataCommitment({ name, type }, fromHex(salt))) !== record.metadataCommitment) {
      return bad(422, "metadata_mismatch");
    }
  }
  // Metadata committed on-chain but not sent: the credential is issued without
  // it (the commitment itself is still in the credential).

  const subject: DocumentRegistrationSubject = {
    id: didPkh(network, record.signer),
    document: {
      recordHash,
      hashScheme: record.scheme === SCHEME_SIGNED_PDF ? "signed-pdf-sha256" : "salted-sha256",
      ...(fileSha256 || record.scheme === SCHEME_SIGNED_PDF ? { fileSha256: fileSha256 ?? recordHash } : {}),
      ...(salt ? { salt } : {}),
      documentType: { code: record.documentType, label: documentTypeName(record.documentType, "en") },
      metadataCommitment: record.metadataCommitment,
      ...(hasMetadata ? { name, type } : {}),
    },
    registration: {
      network,
      chainId: caip2(network),
      registry: record.registry,
      registeredAt: new Date(record.timestamp * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"),
      receipt: {
        standard: isEvm(network)
          ? "ERC-721 + ERC-5192 (soulbound)"
          : "Metaplex Bubblegum v2 cNFT (frozen collection)",
        id: record.receiptId,
      },
    },
  };

  const { did } = issuerConfig();
  const credential = buildCredential(did, subject);
  const jwt = await signCredential(credential);
  return NextResponse.json({ credential, jwt }, { headers: { "Cache-Control": "no-store" } });
}
