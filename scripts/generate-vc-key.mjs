// Generates Niara's credential issuer key (EC P-256) and prints it as a JWK for
// NIARA_VC_PRIVATE_JWK. Keep it in the hosting provider's secret store (e.g.
// Vercel → Environment Variables), never in the repository.
//
//   node scripts/generate-vc-key.mjs
//
// Rotating the key invalidates verification of credentials signed with the
// old one (the DID document only lists the current key), so rotate only on
// compromise, and then re-issue.
import { exportJWK, generateKeyPair } from "jose";

const { privateKey } = await generateKeyPair("ES256", { extractable: true });
const jwk = await exportJWK(privateKey);
jwk.alg = "ES256";
console.log(JSON.stringify(jwk));
