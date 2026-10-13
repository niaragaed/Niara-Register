/**
 * Test of the Solana source (solana.ts).
 *
 * Part 1 (offline): decoding and event attribution through the invoke stack: a
 * "Program data:" emitted by ANOTHER program must not become a ledger row,
 * even with our discriminator.
 *
 * Part 2 (network, optional): runs a cycle against the real devnet with an
 * in-memory database and checks that the program's real records are read and
 * that a second cycle saves nothing new. Skipped if SOLANA_TEST_NETWORK=0.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import type { NewSignature } from "../db";
import {
  createSolanaIndexer,
  decodeAccount,
  recordAddress,
  extractEvents,
  SOURCE_SOLANA,
} from "../solana";

const PROGRAM = "9RPHqLouFjoUbPdcmA1GyHMeDoWvjZMuCyYFPBWLmTcR";
let failures = 0;
function check(condition: boolean, description: string) {
  console.log(`${condition ? "ok  " : "FAIL"} ${description}`);
  if (!condition) failures++;
}

// ── Part 1 ───────────────────────────────────────────────────────────────────────

function eventPayload(): string {
  const parts: Buffer[] = [
    Buffer.from([206, 226, 126, 15, 74, 52, 33, 1]),
    Buffer.alloc(32, 7), // hash
    new PublicKey(PROGRAM).toBuffer(), // any signer
  ];
  for (const t of ["Ata de sócios", "ata"]) {
    const b = Buffer.from(t, "utf8");
    const len = Buffer.alloc(4);
    len.writeUInt32LE(b.length);
    parts.push(len, b);
  }
  const ts = Buffer.alloc(8);
  ts.writeBigInt64LE(1791496391n);
  const slot = Buffer.alloc(8);
  slot.writeBigUInt64LE(586n);
  parts.push(ts, slot);
  return Buffer.concat(parts).toString("base64");
}

const payload = eventPayload();
const OTHER = "Fake111111111111111111111111111111111111111";

const legit = extractEvents(
  [
    `Program ${PROGRAM} invoke [1]`,
    "Program log: Instruction: Registrar",
    "Program 11111111111111111111111111111111 invoke [2]",
    "Program 11111111111111111111111111111111 success",
    `Program data: ${payload}`,
    `Program ${PROGRAM} consumed 12345 of 200000 compute units`,
    `Program ${PROGRAM} success`,
  ],
  PROGRAM,
);
check(legit.length === 1, "an event emitted by our program is extracted");
check(legit[0]?.documentName === "Ata de sócios" && legit[0]?.documentType === "ata", "UTF-8 name/type decoded");
check(legit[0]?.timestamp === 1791496391 && legit[0]?.slot === 586, "timestamp and slot decoded");
check(legit[0]?.hashHex === "07".repeat(32), "hash in lowercase hex");

const forged = extractEvents(
  [
    `Program ${OTHER} invoke [1]`,
    `Program data: ${payload}`,
    `Program ${OTHER} success`,
  ],
  PROGRAM,
);
check(forged.length === 0, "an event with our discriminator emitted by ANOTHER program is ignored");

const nested = extractEvents(
  [
    `Program ${OTHER} invoke [1]`,
    `Program ${PROGRAM} invoke [2]`,
    `Program data: ${payload}`,
    `Program ${PROGRAM} success`,
    `Program data: ${payload}`,
    `Program ${OTHER} success`,
  ],
  PROGRAM,
);
check(nested.length === 1, "CPI: only the event inside our program's frame counts");

check(extractEvents([`Program ${PROGRAM} invoke [1]`, "Program data: AAAA", `Program ${PROGRAM} success`], PROGRAM).length === 0, "a short/odd payload is ignored without throwing");
check(decodeAccount(Buffer.alloc(10)) === null, "account with the wrong discriminator → null");

// ── Part 2 ───────────────────────────────────────────────────────────────────────

async function networkPart() {
  if (process.env.SOLANA_TEST_NETWORK === "0") {
    console.log("(network part skipped)");
    return;
  }
  const connection = new Connection(process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com", {
    commitment: "finalized",
    disableRetryOnRateLimit: true,
  });
  const saved = new Map<string, NewSignature>();
  let attempts = 0;
  const checkpoints = new Map<string, number>();
  const db = {
    async saveSignature(a: NewSignature) {
      attempts++;
      const key = `${a.rede}|${a.hash_sha256}`;
      if (!saved.has(key)) saved.set(key, a);
    },
    readCheckpoint: async (s: string, fallback: number) => checkpoints.get(s) ?? fallback,
    async saveCheckpoints(sources: string[], block: number) {
      for (const s of sources) checkpoints.set(s, block);
    },
  };
  const idx = createSolanaIndexer({
    rpc: connection as never,
    db,
    programId: PROGRAM,
    startSlot: 509235000,
    backoff: { attempts: 6, baseMs: 1000, capMs: 30000 },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  });
  await idx.start();
  const r1 = await idx.cycle();
  console.log(`  devnet: ${r1.transactions} transaction(s), ${r1.saved} saved, checkpoint ${idx.checkpoint}`);
  for (const a of saved.values()) console.log(`   - ${a.documento_nome} · ${a.tipo_documento} · ${a.assinante_endereco} · ${a.assinado_em} · ${a.tx_hash.slice(0, 12)}…`);
  check(r1.saved >= 1, "a real cycle on devnet saves at least 1 document");
  check([...saved.values()].every((a) => a.rede === "solana-devnet" && /^0x[0-9a-f]{64}$/.test(a.hash_sha256)), "network and hash format are correct");
  check(checkpoints.get(SOURCE_SOLANA) === idx.checkpoint && idx.checkpoint > 509235000, "checkpoint saved with the highest slot");
  for (const a of saved.values()) {
    const pda = recordAddress(a.hash_sha256.slice(2), new PublicKey(PROGRAM));
    const account = await connection.getAccountInfo(pda, "finalized");
    const doc = account ? decodeAccount(Buffer.from(account.data)) : null;
    check(doc?.signer === a.assinante_endereco && doc?.documentName === a.documento_nome, `row "${a.documento_nome}" matches the on-chain PDA account`);
  }
  const before = attempts;
  const r2 = await idx.cycle();
  check(r2.transactions === 0 && attempts === before, "a second cycle with nothing new rewrites nothing");
}

networkPart()
  .catch((e) => {
    console.error(e);
    failures++;
  })
  .finally(() => {
    console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} FAILURE(S)`);
    process.exit(failures === 0 ? 0 : 1);
  });
