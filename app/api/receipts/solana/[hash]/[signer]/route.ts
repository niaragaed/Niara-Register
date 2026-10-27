// Metadata JSON of a v3 Solana cNFT receipt. v3 records are one per
// (hash, signer), so the on-chain URI is .../<hash>/<signer>.
import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { isHash32 } from "@/lib/commitments";
import { receiptJson } from "@/lib/receipt-metadata";
import { readRecordV2 } from "@/lib/v2-reader";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ hash: string; signer: string }> }) {
  const { hash, signer } = await params;
  if (!isHash32(hash)) return NextResponse.json({ error: "invalid_hash" }, { status: 400 });
  try {
    new PublicKey(signer);
  } catch {
    return NextResponse.json({ error: "invalid_signer" }, { status: 400 });
  }
  const hex = hash.replace(/^0x/, "").toLowerCase();
  const origin = new URL(request.url).origin;

  // The record adds the scheme, type, date and ORB flag; if the RPC is down, the receipt still resolves.
  const record = await readRecordV2("solana-devnet", hex, signer).catch(() => null);
  return NextResponse.json(
    receiptJson({
      hashHex: hex,
      verifyUrl: `${origin}/verify/solana-devnet/0x${hex}?signer=${signer}`,
      imageUrl: `${origin}/api/receipts/solana/${hex}/image`,
      scheme: record?.scheme,
      documentType: record?.documentType,
      timestamp: record?.timestamp,
      orbAnalysed: record?.version === 3 ? record.orbReportHash !== null : undefined,
      signer: record?.version === 3 ? record.signer : undefined,
    }),
    { headers: { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" } },
  );
}
