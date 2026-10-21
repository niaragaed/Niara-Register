// Metadata JSON of a Solana cNFT receipt (its on-chain URI points here).
import { NextResponse } from "next/server";
import { isHash32 } from "@/lib/commitments";
import { receiptJson } from "@/lib/receipt-metadata";
import { readRecordV2 } from "@/lib/v2-reader";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params;
  if (!isHash32(hash)) return NextResponse.json({ error: "invalid_hash" }, { status: 400 });
  const hex = hash.replace(/^0x/, "").toLowerCase();
  const origin = new URL(request.url).origin;

  // The record adds the scheme and date; if the RPC is down, the receipt still resolves.
  const record = await readRecordV2("solana-devnet", hex).catch(() => null);
  return NextResponse.json(
    receiptJson({
      hashHex: hex,
      verifyUrl: `${origin}/verify/solana-devnet/0x${hex}`,
      imageUrl: `${origin}/api/receipts/solana/${hex}/image`,
      scheme: record?.scheme,
      timestamp: record?.timestamp,
    }),
    { headers: { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" } },
  );
}
