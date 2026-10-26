/**
 * Commitment recipes must match the contracts byte for byte.
 * - EVM vector: niara-contracts-Register test_CommitmentVector (computed with `cast`).
 * - Solana vector: niara-register-solana commit.rs unit test (computed with Python's hashlib).
 * Run: npm test
 */
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import { evmCommitment, newNonce, solanaCommitment } from "../lib/commit-reveal";
import { DISC_V3, ACCOUNT_DISC_V3 } from "../lib/register-v2-solana";
import { createHash } from "node:crypto";

const FILE = "0b8f9601ddc97b9b8001400ae6db7375758265717411c37a0da22464297c560d";

async function main() {
  // EVM: chain 11155111, registry 0x1111…, signer 0x…A11cE, nonce 0x…4e4f4e4345 ("NONCE").
  assert.equal(
    evmCommitment(
      11155111,
      "0x1111111111111111111111111111111111111111",
      "0x00000000000000000000000000000000000A11cE",
      FILE,
      "0000000000000000000000000000000000000000000000000000004e4f4e4345",
    ),
    "62b38dd5b4af7624c09d1cbdd4ddd77eb508a8411f8cea746c408211570ffd8a",
  );

  // Solana: program 9RPH…, signer Ed25519SigVerify111…, nonce 0x…07.
  assert.equal(
    await solanaCommitment(
      new PublicKey("9RPHqLouFjoUbPdcmA1GyHMeDoWvjZMuCyYFPBWLmTcR"),
      new PublicKey("Ed25519SigVerify111111111111111111111111111"),
      FILE,
      "00".repeat(31) + "07",
    ),
    "3a22bcde8920bf427f5bc55f80e19863944009f9b189f953777dbb00b20dcc19",
  );

  // Anchor discriminators = first 8 bytes of SHA-256("global:<ix>" / "account:<Name>").
  const disc = (s: string) => Array.from(createHash("sha256").update(s).digest().subarray(0, 8));
  assert.deepEqual([...DISC_V3.commit], disc("global:commit"));
  assert.deepEqual([...DISC_V3.registerV3], disc("global:register_v3"));
  assert.deepEqual([...DISC_V3.cancelCommitment], disc("global:cancel_commitment"));
  assert.deepEqual([...ACCOUNT_DISC_V3.recordV3], disc("account:RecordV3"));
  assert.deepEqual([...ACCOUNT_DISC_V3.commitment], disc("account:Commitment"));

  const a = newNonce();
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, newNonce());
  console.log("commit-reveal: ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
