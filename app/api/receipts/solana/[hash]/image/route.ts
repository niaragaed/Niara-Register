import { isHash32 } from "@/lib/commitments";
import { receiptSvg } from "@/lib/receipt-metadata";

export async function GET(_request: Request, { params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params;
  if (!isHash32(hash)) return new Response("invalid hash", { status: 400 });
  return new Response(receiptSvg(hash.replace(/^0x/, "").toLowerCase()), {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
