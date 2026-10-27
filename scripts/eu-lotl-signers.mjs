// Certificates allowed to sign the EU List of Trusted Lists (LOTL).
//
// The authoritative list is the European Commission's notice in the Official
// Journal of the EU, "Information related to data on Member States' trusted
// lists" (latest seen: OJ C/2026/1944, 15 April 2026,
// https://eur-lex.europa.eu/eli/C/2026/1944/oj). The values below were copied on
// 2026-10-26 from the LOTL's pointer to itself (LOTL #397), which repeats that
// list. They have NOT yet been compared byte by byte with the Official Journal
// text: do that (SHA-256 of each certificate in the notice) before relying on
// this list in production, and again whenever the Commission publishes a new
// notice. A LOTL signed by any other certificate is rejected by
// fetch-eu-trusted-lists.mjs.
export const PINNED_LOTL_SIGNERS = [
  { sha256: "d2064fdd70f6982dcc516b86d9d5c56aea939417c624b2e478c0b29de54f8474", subject: "Patrick Kremer (Signature), BE", notAfter: "2028-05-30" },
  { sha256: "e0a620fbb6747362bb933ac44169d676a553444716cf5f31605f12a22b8396b1", subject: "EUROPEAN COMMISSION (DIGIT), LU", notAfter: "2027-11-17" },
  { sha256: "c0641c4f7d56c431b1c924742db7fce9c1eef7d7fd212113a2768486b3abcdc5", subject: "IOANNA KALOGEROPOULOU, EC", notAfter: "2029-11-23" },
  { sha256: "df7e29360c34b2b8d6d5f40325c1d4d12c9922cecd33b7407674a74b2b3ca1e5", subject: "VICENTE ANDREU NAVARRO, EC", notAfter: "2027-05-06" },
  { sha256: "b63d416744e7098bf9ec2caa596a93bc2468e37f8284ba65ecc061711bcbaa18", subject: "APOSTOLOS APLADAS, EC", notAfter: "2027-04-26" },
  { sha256: "236103f03a8031ae8f47f9059bf8de38564cdbfebedde4a597d50f8980aa653b", subject: "EUROPEAN COMMISSION (EU-TRUST), LU", notAfter: "2029-12-17" },
];
