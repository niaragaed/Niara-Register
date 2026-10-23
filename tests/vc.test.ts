/**
 * Credentials and presentations, offline: issue a VC-JOSE credential with a
 * throwaway key, verify it against an in-memory DID document, then build and
 * verify holder presentations for both wallet families (Ed25519 for Solana,
 * EIP-712 for EVM), and check that tampering is caught.
 * Run with the react-server condition (lib/vc/issuer.ts is server-only):
 *   npx tsx --conditions=react-server tests/vc.test.ts
 */
import assert from "node:assert/strict";
import { exportJWK, generateKeyPair } from "jose";
import { ethers } from "ethers";
import { Keypair } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519";
import { buildCredential } from "../lib/vc/credential";
import { didDocument, issuerConfig, IssuerNotConfigured, signCredential } from "../lib/vc/issuer";
import { verifyCredentialJwt, didWebUrl } from "../lib/vc/verify-credential";
import { createEvmPresentation, createSolanaPresentation, verifyPresentation } from "../lib/vc/presentation";
import { didPkh } from "../lib/networks";

async function main() {
  const { privateKey } = await generateKeyPair("ES256", { extractable: true });
  process.env.NIARA_VC_PRIVATE_JWK = JSON.stringify(await exportJWK(privateKey));
  process.env.NIARA_DID_DOMAIN = "niara-register.example";
  const doc = didDocument();
  assert.equal(doc.id, "did:web:niara-register.example");
  assert.equal((doc.verificationMethod[0].publicKeyJwk as Record<string, unknown>).d, undefined, "no private key in the DID doc");
  assert.equal(didWebUrl(doc.id), "https://niara-register.example/.well-known/did.json");

  const evmWallet = ethers.Wallet.createRandom();
  const holderEvm = didPkh("sepolia", evmWallet.address);
  const credential = buildCredential(doc.id, {
    id: holderEvm,
    document: { recordHash: "ab".repeat(32), hashScheme: "signed-pdf-sha256", documentType: { code: 1, label: "Contract" }, metadataCommitment: "0".repeat(64) },
    registration: {
      network: "sepolia",
      chainId: "eip155:11155111",
      registry: "0x0000000000000000000000000000000000000001",
      registeredAt: "2026-10-21T12:00:00Z",
      receipt: { standard: "ERC-721 + ERC-5192 (soulbound)", id: "1" },
    },
  });
  const jwt = await signCredential(credential);
  const resolve = async () => doc as never;

  const ok = await verifyCredentialJwt(jwt, resolve);
  assert.ok(ok.valid, ok.reason);
  assert.equal(ok.credential?.credentialSubject.id, holderEvm);

  const [h, p, s] = jwt.split(".");
  const forged = Buffer.from(p, "base64url").toString().replace("signed-pdf-sha256", "salted-sha256");
  const bad = await verifyCredentialJwt(`${h}.${Buffer.from(forged).toString("base64url")}.${s}`, resolve);
  assert.equal(bad.valid, false, "tampered credential rejected");

  // EVM holder presentation (EIP-712).
  const vpEvm = await createEvmPresentation(evmWallet, 11155111, holderEvm, jwt);
  const vEvm = await verifyPresentation(vpEvm as never);
  assert.ok(vEvm.valid, vEvm.reason);
  assert.equal(vEvm.vcJwt, jwt);
  const other = ethers.Wallet.createRandom();
  const vpWrong = await createEvmPresentation(other, 11155111, holderEvm, jwt);
  assert.equal((await verifyPresentation(vpWrong as never)).valid, false, "signature by another wallet rejected");

  // Solana holder presentation (EdDSA JWS).
  const kp = Keypair.generate();
  const holderSol = didPkh("solana-devnet", kp.publicKey.toBase58());
  const vpSol = await createSolanaPresentation(async (m) => ed25519.sign(m, kp.secretKey.slice(0, 32)), holderSol, jwt);
  const vSol = await verifyPresentation(vpSol);
  assert.ok(vSol.valid, vSol.reason);
  const [vh, vp, vs] = vpSol.split(".");
  const swapped = Buffer.from(vp, "base64url").toString().replace(holderSol, didPkh("solana-devnet", Keypair.generate().publicKey.toBase58()));
  assert.equal((await verifyPresentation(`${vh}.${Buffer.from(swapped).toString("base64url")}.${vs}`)).valid, false);

  // Issuer configuration: copy-paste damage is forgiven; anything else gives a reason, never the key.
  const good = process.env.NIARA_VC_PRIVATE_JWK!;
  const reasonFor = (value: string | undefined) => {
    if (value === undefined) delete process.env.NIARA_VC_PRIVATE_JWK;
    else process.env.NIARA_VC_PRIVATE_JWK = value;
    try {
      issuerConfig();
      return "ok";
    } catch (e) {
      assert.ok(e instanceof IssuerNotConfigured);
      return e.reason;
    }
  };
  assert.equal(reasonFor(`\uFEFF  ${good}\n`), "ok", "BOM and whitespace");
  assert.equal(reasonFor(JSON.stringify(good)), "ok", "JSON pasted as a quoted string");
  assert.equal(reasonFor(undefined), "missing");
  assert.equal(reasonFor("   "), "missing");
  assert.equal(reasonFor("{kty: EC"), "invalid_json");
  assert.equal(reasonFor(`NIARA_VC_PRIVATE_JWK=${good}`), "ok", "line copied from a .env file");
  assert.equal(reasonFor(`'${good}'`), "ok", "single quotes");
  assert.equal(reasonFor(good.replace(/"/g, (_q, i: number) => (i % 2 ? "\u201D" : "\u201C"))), "ok", "typographic quotes");
  // The shape of a broken value never repeats key material.
  try {
    process.env.NIARA_VC_PRIVATE_JWK = "C:\\Users\\x\\key.json";
    issuerConfig();
  } catch (e) {
    assert.ok(e instanceof IssuerNotConfigured && e.shape);
    assert.equal(e.shape.startsWith, "letter-or-digit");
    assert.ok(!JSON.stringify(e.shape).includes("Users"));
  }
  const publicOnly = JSON.parse(good);
  delete publicOnly.d;
  assert.equal(reasonFor(JSON.stringify(publicOnly)), "not_a_private_key");
  assert.equal(reasonFor(JSON.stringify({ ...JSON.parse(good), crv: "secp256k1" })), "unsupported_key");
  process.env.NIARA_VC_PRIVATE_JWK = good;

  console.log("ok - vc");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
