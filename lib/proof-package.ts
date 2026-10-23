// The holder's proof package: everything needed to prove a v2 record later,
// in one JSON file the user keeps next to the document. Niara keeps no copy.
import type { RegisterNetwork } from "./networks";

export const PROOF_PACKAGE_FORMAT = "niara-register-proof/1";

export type ProofPackage = {
  format: typeof PROOF_PACKAGE_FORMAT;
  network: RegisterNetwork;
  recordHash: string;
  scheme: 0 | 1;
  /** Public type code (lib/document-types.ts). */
  documentType: number;
  fileName?: string;
  fileSha256: string;
  /** Hex; present for every v2 record (it also commits the name). */
  salt: string;
  /** type = the type slug, committed together with the name. */
  metadata?: { name: string; type: string };
  metadataCommitment: string;
  txHash?: string;
  receiptId?: string;
  /** VC-JOSE compact JWS issued by Niara. */
  credential?: string;
  /** Holder presentation: VP-JWT (Solana) or JSON with an EIP-712 proof (EVM). */
  presentation?: string | Record<string, unknown>;
  createdAt: string;
};

export function isProofPackage(value: unknown): value is ProofPackage {
  const v = value as Partial<ProofPackage>;
  return Boolean(v && v.format === PROOF_PACKAGE_FORMAT && typeof v.recordHash === "string" && typeof v.salt === "string");
}
