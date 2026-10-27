// Commit-reveal for v3 registrations (SignatureRegistryV3 on EVM, register_v3
// on Solana). Registering takes two transactions: first a commitment that says
// nothing about the document, then, in a later block/slot, the registration
// with the nonce. Someone copying the second transaction from the mempool has
// no commitment of their own from an earlier block, so they cannot take the
// record.
//
// The recipes MUST match the contracts:
// - EVM:    keccak256(abi.encode(uint256 chainId, address registry, address signer,
//           bytes32 recordHash, bytes32 nonce))  — SignatureRegistryV3.commitmentOf
// - Solana: SHA-256("niara-commit-v1" || programId || signer || recordHash || nonce)
//           — instructions/commit.rs commitment_of
// Cross-implementation vectors: tests/commit-reveal.test.ts.
import { AbiCoder, keccak256 } from "ethers";
import type { PublicKey } from "@solana/web3.js";
import { concatBytes, fromHex, sha256, toHex } from "./commitments";

const COMMIT_DOMAIN = new TextEncoder().encode("niara-commit-v1");

/** 32 random bytes, kept in memory until the reveal. Not part of the proof package. */
export function newNonce(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

const strip0x = (h: string) => (h.startsWith("0x") ? h.slice(2) : h).toLowerCase();

export function evmCommitment(
  chainId: number | bigint,
  registry: string,
  signer: string,
  recordHashHex: string,
  nonceHex: string,
): string {
  const encoded = AbiCoder.defaultAbiCoder().encode(
    ["uint256", "address", "address", "bytes32", "bytes32"],
    [chainId, registry, signer, `0x${strip0x(recordHashHex)}`, `0x${strip0x(nonceHex)}`],
  );
  return strip0x(keccak256(encoded));
}

export async function solanaCommitment(
  programId: PublicKey,
  signer: PublicKey,
  recordHashHex: string,
  nonceHex: string,
): Promise<string> {
  return toHex(
    await sha256(
      concatBytes(COMMIT_DOMAIN, programId.toBytes(), signer.toBytes(), fromHex(recordHashHex), fromHex(nonceHex)),
    ),
  );
}
