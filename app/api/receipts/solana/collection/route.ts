// Metadata of the MPL-Core collection that holds every Solana receipt.
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  return NextResponse.json(
    {
      name: "Niara Register receipts",
      symbol: "NIARA-R",
      description:
        "Non-transferable receipts of documents registered on Niara Register. Each receipt carries only the document fingerprint and a link to verify it.",
      external_url: `${origin}/signatures`,
      image: `${origin}/api/receipts/solana/${"0".repeat(64)}/image`,
    },
    { headers: { "Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*" } },
  );
}
