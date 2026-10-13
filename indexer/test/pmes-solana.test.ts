/**
 * Test of the Niara-PMEs source on Solana (pmes-solana.ts).
 *
 * Part 1 (offline): Borsh decoding of the events, amount formatting with the
 * SPL MockBRL's 6 decimals, and attribution through the invoke stack (an event
 * from another program is ignored).
 *
 * Part 2 (network, optional): runs cycles against a real RPC
 * (PMES_SOLANA_TEST_RPC, e.g. http://127.0.0.1:8899 with the program loaded,
 * or devnet) with an in-memory database: checks that offerings get their own
 * Solana number, that each event becomes a row with valid `dados`, and that a
 * second cycle saves nothing new. Skipped if PMES_SOLANA_TEST_RPC is not set.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import type { NewLedgerEntry } from "../db";
import {
  createPmesSolanaIndexer,
  decodePmesEvent,
  formatCurrency,
  SOURCE_PMES_SOLANA,
  type NewSolanaOffering,
  type RegisteredSolanaOffering,
} from "../pmes-solana";
import { programDataPayloads } from "../solana";

const PROGRAM = "FKefGFhUmgXBM1xCtSFBWpoNnp3wuPJs6Yddpsp67J2y";
let failures = 0;
function check(condition: boolean, description: string) {
  console.log(`${condition ? "ok  " : "FAIL"} ${description}`);
  if (!condition) failures++;
}

// ── Part 1 ───────────────────────────────────────────────────────────────────────

const u64 = (v: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
};
const OFFERING = new PublicKey("5tTbyjnjWSefYSSuLrnpNj7RXFfrt6oB3FddR8cDWSxp");
const INVESTOR = new PublicKey("bFc9manVzJ72vdSRu5fgv872KNe4J8aus3wsnknTNY3");

const investment = Buffer.concat([
  Buffer.from([154, 197, 120, 78, 134, 58, 222, 5]),
  OFFERING.toBuffer(),
  INVESTOR.toBuffer(),
  u64(BigInt(120_000_000)),
  u64(BigInt(120_000_000)),
]).toString("base64");

const ev = decodePmesEvent(investment);
check(ev?.name === "Aporte", "Aporte recognized by its discriminator");
check(ev?.name === "Aporte" && ev.investidor === INVESTOR.toBase58() && ev.valor === BigInt(120_000_000), "Aporte decoded (investor, amount)");
check(formatCurrency(BigInt(120_000_000)) === "120.0", "120 mBRL → '120.0' (same format as formatUnits)");
check(formatCurrency(BigInt(118_800_000)) === "118.8", "118.8 mBRL → '118.8'");
check(formatCurrency(BigInt(1)) === "0.000001", "smallest unit → '0.000001'");
check(decodePmesEvent(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9]).toString("base64")) === null, "unknown discriminator → null");

const logs = [
  `Program ${PROGRAM} invoke [1]`,
  `Program data: ${investment}`,
  "Program Outro11111111111111111111111111111111 invoke [2]",
  `Program data: ${investment}`,
  "Program Outro11111111111111111111111111111111 success",
  `Program ${PROGRAM} success`,
];
check(programDataPayloads(logs, PROGRAM).length === 1, "an event emitted by another program (CPI) is ignored");

// ── Part 2 ───────────────────────────────────────────────────────────────────────

async function networkPart(rpcUrl: string) {
  const entries: NewLedgerEntry[] = [];
  const offerings: (NewSolanaOffering & { numero: number })[] = [];
  const checkpoints = new Map<string, number>();
  const db = {
    async saveLedgerEntry(r: NewLedgerEntry) {
      if (!entries.some((x) => x.tx_hash === r.tx_hash && x.log_index === r.log_index)) entries.push(r);
    },
    async readCheckpoint(source: string, fallback: number) {
      return checkpoints.get(source) ?? fallback;
    },
    async saveCheckpoints(sources: string[], block: number) {
      for (const s of sources) checkpoints.set(s, block);
    },
    async loadSolanaOfferings(): Promise<RegisteredSolanaOffering[]> {
      return offerings.map((o) => ({ endereco: o.endereco, numero: o.numero, empresa: o.empresa }));
    },
    async registerSolanaOffering(o: NewSolanaOffering) {
      const existing = offerings.find((x) => x.endereco === o.endereco);
      if (existing) return existing.numero;
      const numero = offerings.length + 1;
      offerings.push({ ...o, numero });
      return numero;
    },
  };
  const idx = createPmesSolanaIndexer({
    rpc: new Connection(rpcUrl, { commitment: "finalized" }) as never,
    db,
    programId: PROGRAM,
    startSlot: 0,
    backoff: { attempts: 3, baseMs: 500, capMs: 2000 },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  });
  await idx.start();
  const r1 = await idx.cycle();
  console.log(`     cycle 1: ${r1.transactions} transaction(s), ${r1.saved} event(s); ${offerings.length} offering(s)`);
  check(r1.transactions > 0, "cycle 1 found program transactions");
  check(offerings.length > 0 && offerings.every((o, i) => o.numero === i + 1), "offerings numbered 1, 2, 3… on Solana");
  check(offerings.every((o) => o.nome !== null && o.simbolo !== null), "name and symbol read from the offering account");
  const created = entries.filter((r) => r.tipo_evento === "Oferta criada");
  check(created.length === offerings.filter((o) => o.tx_criacao !== null).length, "one 'Oferta criada' row per offering created inside the window");
  check(
    entries.every((r) => r.rede === "solana-devnet" && r.bloco === null && typeof r.slot === "number" && r.confirmado && r.dados !== null),
    "every row with network solana-devnet, slot, confirmed and with dados",
  );
  const numbered = entries.filter((r) => r.dados && (r.dados as { ofertaNumero: number | null }).ofertaNumero !== null);
  check(numbered.length === entries.length, "every event points to a numbered offering");
  for (const r of entries.slice(0, 8)) console.log(`     ${r.tipo_evento}: ${r.descricao}`);
  check(checkpoints.get(SOURCE_PMES_SOLANA) === idx.checkpoint && idx.checkpoint > 0, "checkpoint saved with the highest slot");

  const before = entries.length;
  const r2 = await idx.cycle();
  check(r2.transactions === 0 && entries.length === before, "cycle 2 saves nothing new");
}

(async () => {
  const rpc = process.env.PMES_SOLANA_TEST_RPC;
  if (rpc) await networkPart(rpc);
  else console.log("--   part 2 skipped (set PMES_SOLANA_TEST_RPC to run against an RPC)");
  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\npmes-solana: all ok");
})();
