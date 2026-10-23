// did:web document of Niara's credential issuer (public keys only).
import { NextResponse } from "next/server";
import { IssuerNotConfigured, didDocument } from "@/lib/vc/issuer";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(didDocument(), {
      headers: { "Content-Type": "application/did+json", "Access-Control-Allow-Origin": "*" },
    });
  } catch (e) {
    if (e instanceof IssuerNotConfigured) {
      return NextResponse.json({ error: "issuer_not_configured" }, { status: 503 });
    }
    throw e;
  }
}
