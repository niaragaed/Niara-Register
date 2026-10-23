// Verifiable Presentations signed by the HOLDER's own wallet, wrapping the
// credential Niara issued. They prove that whoever presents the credential
// controls the wallet that registered the document.
//
// - Solana: VP-JWT (VC-JOSE), alg EdDSA. The wallet's signMessage signs the
//   JWS signing input directly, so this is a standard Ed25519 JWS. The key is
//   the did:pkh account itself.
// - EVM: wallets cannot produce a raw ES256K JWS, so the presentation is
//   signed with EIP-712 typed data and carried as an
//   "EthereumEip712Signature2021" proof. That proof type is a W3C CCG draft,
//   NOT a W3C Recommendation: generic VC verifiers may not accept it. The
//   Niara verify page does.
import { ethers } from "ethers";
import { ed25519 } from "@noble/curves/ed25519";
import { PublicKey } from "@solana/web3.js";
import { b64urlDecode, b64urlEncode, buildPresentation, decodeJwsPart } from "./credential";

export const EIP712_TYPES = {
  Presentation: [
    { name: "holder", type: "string" },
    { name: "credentialSha256", type: "bytes32" },
    { name: "issuedAt", type: "string" },
    { name: "statement", type: "string" },
  ],
};
export const EIP712_STATEMENT = "I hold this Niara Register credential and control this wallet.";

export function eip712Domain(chainId: number) {
  return { name: "Niara Register", version: "1", chainId };
}

async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return "0x" + Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

// --- creation (browser) -------------------------------------------------------

export async function createSolanaPresentation(
  signMessage: (message: Uint8Array) => Promise<Uint8Array>,
  holderDid: string,
  vcJwt: string,
): Promise<string> {
  const header = { alg: "EdDSA", kid: `${holderDid}#controller`, typ: "vp+jwt", cty: "vp" };
  const payload = { ...buildPresentation(holderDid, vcJwt), validFrom: new Date().toISOString() };
  const input =
    b64urlEncode(new TextEncoder().encode(JSON.stringify(header))) +
    "." +
    b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await signMessage(new TextEncoder().encode(input));
  return `${input}.${b64urlEncode(signature)}`;
}

export async function createEvmPresentation(
  signer: ethers.Signer,
  chainId: number,
  holderDid: string,
  vcJwt: string,
) {
  const message = {
    holder: holderDid,
    credentialSha256: await sha256Hex(vcJwt),
    issuedAt: new Date().toISOString(),
    statement: EIP712_STATEMENT,
  };
  const domain = eip712Domain(chainId);
  const proofValue = await signer.signTypedData(domain, EIP712_TYPES, message);
  return {
    ...buildPresentation(holderDid, vcJwt),
    proof: {
      type: "EthereumEip712Signature2021",
      created: message.issuedAt,
      proofPurpose: "authentication",
      verificationMethod: `${holderDid}#blockchainAccountId`,
      proofValue,
      eip712: { domain, types: EIP712_TYPES, primaryType: "Presentation", message },
    },
  };
}

// --- verification (browser or server) -------------------------------------------

export type PresentationCheck = {
  valid: boolean;
  holder: string;
  vcJwt: string | null;
  format: "vp+jwt (EdDSA)" | "EIP-712";
  reason?: string;
};

function envelopedJwt(vp: { verifiableCredential?: { id?: string }[] }): string | null {
  const id = vp.verifiableCredential?.[0]?.id ?? "";
  return id.startsWith("data:application/vc+jwt,") ? id.slice("data:application/vc+jwt,".length) : null;
}

export async function verifyPresentation(input: string | Record<string, unknown>): Promise<PresentationCheck> {
  if (typeof input === "string") {
    const parts = input.trim().split(".");
    if (parts.length !== 3) return { valid: false, holder: "", vcJwt: null, format: "vp+jwt (EdDSA)", reason: "not a JWS" };
    const header = decodeJwsPart<{ alg?: string; kid?: string }>(parts[0]);
    const payload = decodeJwsPart<{ holder: string; verifiableCredential?: { id?: string }[] }>(parts[1]);
    const holder = payload.holder ?? "";
    const vcJwt = envelopedJwt(payload);
    if (header.alg !== "EdDSA" || !holder.startsWith("did:pkh:solana:") || header.kid !== `${holder}#controller`) {
      return { valid: false, holder, vcJwt, format: "vp+jwt (EdDSA)", reason: "unexpected header or holder" };
    }
    const account = holder.split(":").pop()!;
    let ok = false;
    try {
      ok = ed25519.verify(
        b64urlDecode(parts[2]),
        new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
        new PublicKey(account).toBytes(),
      );
    } catch {
      ok = false;
    }
    return { valid: ok, holder, vcJwt, format: "vp+jwt (EdDSA)", reason: ok ? undefined : "bad signature" };
  }

  const vp = input as {
    holder?: string;
    verifiableCredential?: { id?: string }[];
    proof?: {
      type?: string;
      proofValue?: string;
      eip712?: { domain: ethers.TypedDataDomain; message: Record<string, string> };
    };
  };
  const holder = vp.holder ?? "";
  const vcJwt = envelopedJwt(vp);
  const proof = vp.proof;
  if (proof?.type !== "EthereumEip712Signature2021" || !proof.eip712 || !proof.proofValue || !vcJwt) {
    return { valid: false, holder, vcJwt, format: "EIP-712", reason: "missing proof" };
  }
  const { domain, message } = proof.eip712;
  if (message.holder !== holder || message.credentialSha256 !== (await sha256Hex(vcJwt))) {
    return { valid: false, holder, vcJwt, format: "EIP-712", reason: "proof does not match the presentation" };
  }
  if (domain.name !== "Niara Register" || domain.version !== "1") {
    return { valid: false, holder, vcJwt, format: "EIP-712", reason: "unexpected domain" };
  }
  const expected = holder.split(":").pop()!.toLowerCase();
  let recovered = "";
  try {
    recovered = ethers.verifyTypedData(domain, EIP712_TYPES, message, proof.proofValue).toLowerCase();
  } catch {
    recovered = "";
  }
  const chainMatches = holder.startsWith(`did:pkh:eip155:${Number(domain.chainId)}:`);
  const ok = recovered === expected && chainMatches;
  return { valid: ok, holder, vcJwt, format: "EIP-712", reason: ok ? undefined : "bad signature" };
}
