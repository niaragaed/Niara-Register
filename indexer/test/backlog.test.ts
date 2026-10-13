/**
 * Test of the indexer under a long catch-up with rate limiting (429), with no
 * network and no database: RPC, tokens, database and clock are fakes, in memory.
 *
 * Scenario: the pmes and assinaturas sources are up to date; the orchestrator
 * is 1,000 blocks behind (100 chunks of 10, with a budget of 20 per cycle)
 * and, in the middle of that range, created two offerings with events spread
 * around, including at chunk edges and after the point where they join the
 * batch. The RPC returns 429 on ~1 in 5 calls and, for one specific backlog
 * chunk, 7 times in a row (more than the backoff's 6 attempts), bringing down
 * that part of the cycle. eth_blockNumber (1 in 3), getBlock (1 in 4) and the
 * token reads (1 in 3; half of them wrapped as tokens.ts does, with the 429 in
 * `cause`) also answer 429 intermittently. The chain grows 3 blocks every cycle.
 *
 * Checks:
 *  (a) a new event at the chain tip, created during the catch-up, is saved in
 *      the next cycle, with the orchestrator still behind;
 *  (b) at the end, every expected event is saved exactly once, nothing more,
 *      and each address's block coverage is continuous (no gap).
 *
 * Usage (from indexer/): npx tsx test/backlog.test.ts
 */
import "../safe-log";
import { ethers } from "ethers";
import { OFERTA_CAPTACAO_ABI, OFERTA_ORQUESTRADOR_ABI, REGISTRO_ASSINATURAS_ABI } from "../abi";
import type { NewSignature, NewOffering, NewLedgerEntry } from "../db";
import { createIndexer, type Db, type Rpc } from "../indexer";
import { toTracked, type TrackedOffering } from "../offerings";
import type { TokenReader } from "../tokens";

// Fake key: it shows up in the URL of the simulated 429 errors, to prove the mask works.
const KEY = "fakeTestKey0123456789abcdef";
process.env.ALCHEMY_API_KEY = KEY;

// Silences the indexer's normal progress ([indexer] … saved); backoff
// warnings and errors still show.
const originalLog = console.log;
console.log = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].startsWith("[indexer]")) return;
  originalLog(...args);
};

const addr = (n: number) => ethers.getAddress(`0x${n.toString(16).padStart(40, "0")}`).toLowerCase();
const ORCH = addr(0x0de9c);
const SIGS = addr(0x5627);
const LEGACY = addr(0xd4ac);
const N1 = addr(0x6587);
const N2 = addr(0x50e4);
const CURRENCY = addr(0xec37);
const PERSON = addr(0x47d9);

const iOffering = new ethers.Interface(OFERTA_CAPTACAO_ABI);
const iOrch = new ethers.Interface(OFERTA_ORQUESTRADOR_ABI);
const iSigs = new ethers.Interface(REGISTRO_ASSINATURAS_ABI);
const mBRL = (v: number) => ethers.parseUnits(String(v), 18);

// ── fake chain ───────────────────────────────────────────────────────────────────

type FakeLog = ethers.Log;
const logs: FakeLog[] = [];
let txSeq = 0;
function emit(address: string, block: number, iface: ethers.Interface, event: string, args: unknown[]) {
  const { topics, data } = iface.encodeEventLog(event, args);
  const log = {
    address,
    blockNumber: block,
    index: logs.filter((l) => l.blockNumber === block).length,
    transactionHash: ethers.zeroPadValue(ethers.toBeHex(++txSeq), 32),
    topics,
    data,
  } as unknown as FakeLog;
  logs.push(log);
  return log;
}

const creation = (offering: string, block: number) =>
  emit(ORCH, block, iOrch, "OfertaCompletaCriada", [PERSON, addr(0x7000 + block), offering, mBRL(500000), mBRL(600000), mBRL(1000), 1797698979]);
const investment = (offering: string, block: number, amount: number) =>
  emit(offering, block, iOffering, "Aporte", [PERSON, mBRL(amount), mBRL(amount)]);

// Events already in history (before the test starts):
const expected: FakeLog[] = [
  creation(N1, 1203),
  investment(N1, 1250, 250000),
  creation(N2, 1510), // last row of a chunk (1501–1510)
  investment(N2, 1511, 1000), // first row of the next chunk
  emit(N2, 1800, iOffering, "RecursosLiberados", [PERSON, mBRL(594000), addr(0x9780), mBRL(6000)]),
  investment(N1, 1990, 350000),
  investment(N1, 2000, 1), // exactly at the initial pmes checkpoint
];
// Already saved before (below the pmes checkpoint = 2000): must NOT reappear.
const alreadySaved = investment(LEGACY, 1500, 777);

// Future events, which "happen" as the chain grows:
const future: { block: number; create: () => FakeLog }[] = [
  { block: 2003, create: () => emit(SIGS, 2003, iSigs, "DocumentoRegistrado", [ethers.id("doc"), PERSON, "Ata", "Ata", 1]) },
  { block: 2007, create: () => investment(N1, 2007, 5) }, // after N1's backfill target
];

let tip = 2000;
let getLogsCalls = 0;
let errors429 = 0;
const errors429ByKind = { getLogs: 0, getBlockNumber: 0, getBlock: 0, tokens: 0 };
let blockNumberCalls = 0;
let getBlockCalls = 0;
let tokenCalls = 0;
const coverage = new Map<string, [number, number][]>();
const failuresByChunk = new Map<string, number>();

function error429(): Error {
  return ethers.makeError("server response 429 Too Many Requests", "SERVER_ERROR", {
    request: undefined as never,
    response: undefined as never,
    info: {
      requestUrl: `https://eth-sepolia.g.alchemy.com/v2/${KEY}`,
      responseBody: '{"jsonrpc":"2.0","id":1,"error":{"code":429,"message":"Your app has exceeded its compute units per second capacity"}}',
      responseStatus: "429 Too Many Requests",
    },
  });
}

const rpc: Rpc = {
  async getBlockNumber() {
    if (++blockNumberCalls % 3 === 1) {
      errors429ByKind.getBlockNumber++;
      throw error429();
    }
    tip += 3; // the chain moves between one cycle and the next
    for (const f of future.filter((f) => f.block <= tip)) expected.push(f.create());
    future.splice(0, future.length, ...future.filter((f) => f.block > tip));
    return tip;
  },
  async getLogs({ address, fromBlock, toBlock }) {
    getLogsCalls++;
    if (toBlock - fromBlock + 1 > 10) throw new Error(`range of ${toBlock - fromBlock + 1} blocks (free plan: 10)`);
    if (toBlock > tip) throw new Error(`toBlock ${toBlock} above the tip ${tip}`);

    // Burst: this backlog chunk fails 7 times in a row (the backoff has 6).
    const key = `${fromBlock}-${toBlock}-${address.join()}`;
    if (fromBlock === 1301 && address.includes(ORCH)) {
      const n = failuresByChunk.get(key) ?? 0;
      if (n < 7) {
        failuresByChunk.set(key, n + 1);
        errors429++;
        errors429ByKind.getLogs++;
        throw error429();
      }
    }
    // Intermittent: ~1 in every 5 calls.
    if (getLogsCalls % 5 === 2) {
      errors429++;
      errors429ByKind.getLogs++;
      throw error429();
    }

    for (const a of address) {
      coverage.set(a, [...(coverage.get(a) ?? []), [fromBlock, toBlock]]);
    }
    const target = new Set(address.map((a) => a.toLowerCase()));
    return logs.filter((l) => target.has(l.address) && l.blockNumber >= fromBlock && l.blockNumber <= toBlock);
  },
  async getBlock(number) {
    if (++getBlockCalls % 4 === 1) {
      errors429ByKind.getBlock++;
      throw error429();
    }
    return { timestamp: 1_790_000_000 + number * 12 };
  },
};

// 1 in every 3 token reads answers 429, alternating between ethers' raw error
// and the error wrapped by tokens.ts ("Failed to read …", with the 429 in cause).
function maybe429<T>(description: string, value: T): Promise<T> {
  const n = ++tokenCalls;
  if (n % 3 === 1) {
    errors429ByKind.tokens++;
    if (n % 2 === 0) return Promise.reject(error429());
    return Promise.reject(new Error(`Failed to read ${description}: limit`, { cause: error429() }));
  }
  return Promise.resolve(value);
}
const tokens: TokenReader = {
  currencyDecimals: () => maybe429("decimals()", 18),
  currencySymbol: () => maybe429("symbol()", "mBRL"),
  offeringCurrency: () => maybe429("moeda()", CURRENCY),
  shareTokenDecimals: () => maybe429("token decimals()", 18),
  metadata: () => maybe429("metadata", { name: "Teste Participações", symbol: "TST", company: "Empresa Teste" }),
};

// ── fake database ────────────────────────────────────────────────────────────────

const entries = new Map<string, NewLedgerEntry>();
const signatures = new Map<string, NewSignature>();
const savedOfferings = new Map<string, NewOffering>();
const dbCheckpoints = new Map<string, number>([["pmes", 2000], ["assinaturas", 2000]]);
let writeAttempts = 0;

const legacy: TrackedOffering = toTracked({
  endereco: LEGACY, token: addr(0x4ddd), numero: 1, origem: "legado", empresa: "Empresa Demo",
  bloco_criacao: 900, backfill_alvo: null, backfill_ate: null,
});

const db: Db = {
  loadOfferings: async () => [legacy],
  async saveLedgerEntry(r) {
    writeAttempts++;
    const k = `${r.tx_hash}#${r.log_index}`;
    if (!entries.has(k)) entries.set(k, r); // ignoreDuplicates, like the real upsert
  },
  async saveSignature(a) {
    writeAttempts++;
    if (!signatures.has(a.hash_sha256)) signatures.set(a.hash_sha256, a);
  },
  async saveOffering(o) {
    if (!savedOfferings.has(o.endereco)) savedOfferings.set(o.endereco, o);
  },
  async saveBackfill(address, until) {
    const o = savedOfferings.get(address);
    if (o) o.backfill_ate = until;
  },
  readCheckpoint: async (source, fallback) => dbCheckpoints.get(source) ?? fallback,
  async saveCheckpoints(sources, block) {
    for (const s of sources) dbCheckpoints.set(s, block);
  },
};

let backoffWaitMs = 0;
let spacingWaitMs = 0;
const sleep = async (ms: number) => {
  if (ms === 300) spacingWaitMs += ms;
  else backoffWaitMs += ms;
};

// ── run ──────────────────────────────────────────────────────────────────────────

const indexer = createIndexer({
  rpc,
  tokens,
  db,
  sleep,
  cfg: {
    blockRangeChunk: 10,
    backlogChunksPerCycle: 20,
    backlogIntervalMs: 300,
    backoff: { attempts: 6, baseMs: 1_000, capMs: 30_000 },
    startBlock: 0,
    startBlockSignatures: 0,
    startBlockOrchestrator: 1001,
    orchestratorAddress: ORCH,
    signatureRegistryAddress: SIGS,
  },
});

const failures: string[] = [];
const check = (ok: boolean, text: string) => {
  originalLog(`${ok ? "  ✔" : "  ✘"} ${text}`);
  if (!ok) failures.push(text);
};

await indexer.start();
originalLog(`start: checkpoints ${JSON.stringify(indexer.checkpoints)}, tip ${tip}\n`);

// (a) new event at the tip, created in the middle of the catch-up
let tipEvent: FakeLog | null = null;
let tipEventCycle = 0;
let cycleWhenSeen = 0;
let orchAtThatMoment = 0;
let pmesAtThatMoment = 0;

let cycle = 0;
let cyclesWithFailure = 0;
let cyclesWithNormalBatchFailure = 0;
const abortedCycles: { cycle: number; pmesBefore: number; pmesAfter: number; tip: number }[] = [];
while (cycle < 500) {
  cycle++;
  const pmesBefore = indexer.checkpoints.pmes;
  const r = await indexer.cycle();
  if (r.normalBatchFailed) cyclesWithNormalBatchFailure++;
  if (r.failed) {
    cyclesWithFailure++;
    abortedCycles.push({ cycle, pmesBefore, pmesAfter: indexer.checkpoints.pmes, tip });
  }

  if (cycle === 2) {
    // After the 2nd cycle the catch-up is still far from done: create an
    // investment in the legacy offering at the chain's next block.
    tipEvent = investment(LEGACY, tip + 1, 4242);
    expected.push(tipEvent);
    tipEventCycle = cycle;
  }
  if (tipEvent && !cycleWhenSeen && entries.has(`${tipEvent.transactionHash}#${tipEvent.index}`)) {
    cycleWhenSeen = cycle;
    orchAtThatMoment = indexer.checkpoints.orquestrador;
    pmesAtThatMoment = indexer.checkpoints.pmes;
  }
  if (r.upToDate && future.length === 0) break;
}

// ── checks ───────────────────────────────────────────────────────────────────────

originalLog(`\nend: ${cycle} cycles (${cyclesWithFailure} with some part aborted by 429), checkpoints ${JSON.stringify(indexer.checkpoints)}, tip ${tip}`);
originalLog(`getLogs: ${getLogsCalls} calls, ${errors429} answered with 429; simulated wait: backoff ${(backoffWaitMs / 1000).toFixed(0)}s, spacing ${(spacingWaitMs / 1000).toFixed(0)}s\n`);

originalLog(`429 by call kind: ${JSON.stringify(errors429ByKind)}\n`);

originalLog("429 outside getLogs");
check(
  errors429ByKind.getBlockNumber > 0 && errors429ByKind.getBlock > 0 && errors429ByKind.tokens > 0,
  `there were 429s on eth_blockNumber (${errors429ByKind.getBlockNumber}), getBlock (${errors429ByKind.getBlock}) and token reads (${errors429ByKind.tokens})`,
);
check(
  cyclesWithNormalBatchFailure === 0,
  `no cycle had its normal batch aborted (${cyclesWithNormalBatchFailure}); all those 429s were absorbed by the backoff`,
);
check(
  cyclesWithFailure === 1,
  `the only cycle with an aborted part is the one with the burst of 7× 429 on the backlog getLogs (${cyclesWithFailure})`,
);

originalLog("\n(a) new event at the tip during the catch-up");
check(cycleWhenSeen === tipEventCycle + 1, `created after cycle ${tipEventCycle}, saved in cycle ${cycleWhenSeen}`);
check(orchAtThatMoment < pmesAtThatMoment, `at that moment the orchestrator was still behind (orchestrator ${orchAtThatMoment} < pmes ${pmesAtThatMoment})`);

for (const c of abortedCycles) {
  check(
    c.pmesAfter === c.tip && c.pmesAfter > c.pmesBefore,
    `cycle ${c.cycle}: the catch-up aborted on 429, but the normal batch took pmes from ${c.pmesBefore} to ${c.pmesAfter} (tip ${c.tip})`,
  );
}
check(
  abortedCycles.length > 0,
  `there were ${abortedCycles.length} cycle(s) with the catch-up aborted (the burst of 7× 429 exhausts the 6 attempts)`,
);

originalLog("\n(b) complete catch-up, with no gap or duplicate");
const keyOf = (l: FakeLog) => `${l.transactionHash}#${l.index}`;
const expectedEntries = expected.filter((l) => l.address !== SIGS);
const missing = expectedEntries.filter((l) => !entries.has(keyOf(l)));
const expectedKeys = new Set(expectedEntries.map(keyOf));
const extras = [...entries.keys()].filter((k) => !expectedKeys.has(k));
check(missing.length === 0, `all ${expectedEntries.length} expected events saved (missing: ${missing.length})`);
check(extras.length === 0, `no extra rows (extras: ${extras.length}; the block-1500 investment, saved before, does not reappear: ${!entries.has(keyOf(alreadySaved))})`);
check(entries.size === expectedEntries.length, `unique rows in the database = ${entries.size}; write attempts = ${writeAttempts} (reprocessing after 429 is absorbed by the tx_hash+log_index key)`);
check(signatures.size === 1, `block-2003 signature saved (${signatures.size})`);
const newOfferings = [...savedOfferings.values()].sort((a, b) => a.numero - b.numero);
check(
  newOfferings.map((o) => `${o.numero}:${o.endereco}`).join() === `2:${N1},3:${N2}`,
  `new offerings numbered in creation order: ${newOfferings.map((o) => `no. ${o.numero} block ${o.bloco_criacao}`).join(", ")}`,
);
check(
  newOfferings.every((o) => o.backfill_ate === o.backfill_alvo),
  `backfill finished on both: ${newOfferings.map((o) => `${o.backfill_ate}/${o.backfill_alvo}`).join(", ")}`,
);

const final = indexer.checkpoints.pmes;
function noGap(address: string, since: number): { ok: boolean; text: string } {
  const ranges = [...(coverage.get(address) ?? [])].sort((a, b) => a[0] - b[0]);
  let until = since - 1;
  for (const [from, end] of ranges) {
    if (from > until + 1) return { ok: false, text: `gap ${until + 1}–${from - 1}` };
    until = Math.max(until, end);
  }
  return until >= final ? { ok: true, text: `${since}–${until} continuous` } : { ok: false, text: `stopped at ${until}` };
}
for (const [name, address, since] of [
  ["orchestrator", ORCH, 1001],
  ["new offering 2", N1, 1203],
  ["new offering 3", N2, 1510],
  ["legacy offering 1", LEGACY, 2001],
  ["signatures", SIGS, 2001],
] as const) {
  const r = noGap(address, since);
  check(r.ok, `block coverage — ${name}: ${r.text}`);
}
check(
  indexer.checkpoints.pmes === indexer.checkpoints.assinaturas &&
    indexer.checkpoints.assinaturas === indexer.checkpoints.orquestrador,
  `three checkpoints together at the end (${indexer.checkpoints.pmes})`,
);

originalLog(failures.length === 0 ? "\nRESULT: OK" : `\nRESULT: FAILED (${failures.length})`);
process.exit(failures.length === 0 ? 0 : 1);
