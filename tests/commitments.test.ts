/**
 * The hash recipes must be byte-identical across the site, the EVM contract
 * tests (niara-contracts-Register/test/SignatureRegistryV2.t.sol) and the
 * Solana program. These reference values were computed independently with
 * Python's hashlib and are asserted in the Solidity test too.
 * Run: npm test
 */
import assert from "node:assert/strict";
import {
  canonicalMetadata,
  fromHex,
  metadataCommitment,
  recordHashFor,
  saltedRecordHash,
  sha256,
  toHex,
  ZERO_HASH,
  SCHEME_SALTED,
  SCHEME_SIGNED_PDF,
} from "../lib/commitments";

const FILE = "0b8f9601ddc97b9b8001400ae6db7375758265717411c37a0da22464297c560d";
const SALT = fromHex("0000000000000000000000000000000000000000000000000000000000005a17");
const SALTED = "82bf02f65a53f5e58f8fb1cee8d6755b510fea33c837c7ac2254b3dfaea02f85";
const META = "6719dec3650b0ad2995639450d375883cd14c9843dea430239a5557dd51f3647";

async function main() {
  assert.equal(toHex(await sha256(new TextEncoder().encode("signed pdf bytes"))), FILE);
  assert.equal(await saltedRecordHash(FILE, SALT), SALTED);
  assert.equal(await recordHashFor(SCHEME_SALTED, FILE, SALT), SALTED);
  assert.equal(await recordHashFor(SCHEME_SIGNED_PDF, FILE.toUpperCase(), SALT), FILE);
  assert.equal(canonicalMetadata({ name: " Lease ", type: "contract" }), '{"name":"Lease","type":"contract"}');
  assert.equal(await metadataCommitment({ name: "Lease", type: "contract" }, SALT), META);
  assert.equal(await metadataCommitment({ name: "  ", type: "" }, SALT), ZERO_HASH);
  assert.equal(await metadataCommitment(null, SALT), ZERO_HASH);
  await assert.rejects(() => saltedRecordHash(FILE, new Uint8Array(16)));
  console.log("ok - commitments");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
