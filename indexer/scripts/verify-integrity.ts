/**
 * Integrity check of the public mirror (Supabase) against the chains.
 *
 * Read-only. Uses the PUBLIC read key (the same one the site uses), never the
 * service-role key. Nothing is written anywhere.
 *
 * How: it re-derives the rows from the chain with the indexer's own code (the
 * same source factories as index.ts, with an in-memory database) and compares
 * them, field by field, with what is in the database:
 *   - FORGED   a row in the database that the chain does not produce;
 *   - ALTERED  a row whose fields differ from what the chain says;
 *   - MISSING  a row the chain produces that is not in the database.
 *
 * Coverage:
 *   - Solana (signatures v1, register v2, transferable records, SMEs): the
 *     whole program history is re-read, so FORGED, ALTERED and MISSING are all
 *     complete.
 *   - EVM networks: only the blocks the database rows point to are re-read
 *     (a full rescan of HyperEVM alone would take hours on its public RPC), so
 *     FORGED and ALTERED are complete; MISSING only covers other events in
 *     those same blocks. A deleted row in another block is not seen: if in
 *     doubt, rebuild the mirror by re-indexing from the deploy blocks.
 *   - registro_ofertas: Sepolia offerings must be in the versioned seed
 *     (supabase/migrations_004_offerings.sql) or be created by the
 *     orchestrator on-chain; Solana offerings must be re-derived from the program.
 *   - registro_checkpoints: printed against each chain tip (a checkpoint moved
 *     ahead would make the indexer skip real events).
 *
 * USAGE (from indexer/, in a terminal):
 *   SUPABASE_URL=https://<project>.supabase.co \
 *   SUPABASE_READ_KEY=<anon / publishable key> \
 *   npx tsx scripts/verify-integrity.ts [--report=report.json]
 *
 * Optional RPCs (defaults are public endpoints): SEPOLIA_RPC_URL, and the
 * indexer's BASE_SEPOLIA_RPC_URL, ROBINHOOD_RPC_URL, HYPEREVM_RPC_URL,
 * TEMPO_RPC_URL, SOLANA_RPC_URL.
 *
 * Self-test without a database (checks that the comparison catches a forged,
 * an altered and a deleted row): npx tsx scripts/verify-integrity.ts --self-test
 *
 * Exit code: 0 when everything matches, 1 when something does not.
 */
import "../safe-log";
import "dotenv/config";
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { ethers } from "ethers";
import { Connection } from "@solana/web3.js";
import { createClient } from "@supabase/supabase-js";

// config.ts reads these two at import time for the indexer itself. This script
// never uses them (no writes, its own Sepolia RPC), so placeholders are enough
// and no secret has to be present on the machine running the check.
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "not-used-by-verify-integrity";
process.env.ALCHEMY_API_KEY ??= "not-used-by-verify-integrity";
process.env.SUPABASE_URL ??= "http://not-used-in-self-test.invalid";

const { config } = await import("../config");
const { createIndexer, SOURCE_PMES, SOURCE_SIGNATURES, SOURCE_ORCHESTRATOR } = await import("../indexer");
const { createEvmSignatureIndexer } = await import("../evm-signatures");
const { createEvmV2Indexer, createSolanaV2Indexer, SOURCE_SOLANA_V2 } = await import("../v2");
const { createSolanaIndexer, SOURCE_SOLANA } = await import("../solana");
const { createPmesSolanaIndexer, SOURCE_PMES_SOLANA } = await import("../pmes-solana");
const { Tokens } = await import("../tokens");
const { toTracked } = await import("../offerings");
type NewLedgerEntry = import("../db").NewLedgerEntry;
type NewSignature = import("../db").NewSignature;
type NewOffering = import("../db").NewOffering;
type NewSignatureV2 = import("../v2").NewSignatureV2;
type NewEtrEvent = import("../v2").NewEtrEvent;
type NewSolanaOffering = import("../pmes-solana").NewSolanaOffering;

const SELF_TEST = process.argv.includes("--self-test");
const REPORT = process.argv.find((a) => a.startsWith("--report="))?.split("=")[1];
const here = dirname(fileURLToPath(import.meta.url));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const backoff = config.backoff;

type Row = Record<string, unknown>;
type TableName =
  | "registro_transacoes"
  | "registro_assinaturas"
  | "registro_assinaturas_v2"
  | "registro_transferiveis_eventos"
  | "registro_ofertas";

/** How each table's rows are identified (the indexer's own uniqueness keys). */
const KEYS: Record<TableName, (r: Row) => string> = {
  registro_transacoes: (r) => `${String(r.tx_hash).toLowerCase()}#${r.log_index}`,
  registro_assinaturas: (r) => `${r.rede}|${String(r.hash_sha256).toLowerCase()}`,
  registro_assinaturas_v2: (r) => `${r.rede}|${String(r.hash_registro).toLowerCase()}`,
  registro_transferiveis_eventos: (r) => `${r.rede}|${String(r.tx_hash).toLowerCase()}#${r.log_index}`,
  registro_ofertas: (r) => String(r.endereco),
};
const TABLES = Object.keys(KEYS) as TableName[];

// ── reading the database ──────────────────────────────────────────────────────────

async function readDatabase(): Promise<{ tables: Record<TableName, Row[]>; checkpoints: Row[] | null }> {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_READ_KEY;
  if (!key) throw new Error("Set SUPABASE_READ_KEY (the anon / publishable key the site uses).");
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const readAll = async (table: string): Promise<Row[]> => {
    const rows: Row[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from(table).select("*").range(from, from + 999);
      if (error) throw new Error(`Reading ${table}: ${error.message}`);
      rows.push(...((data ?? []) as Row[]));
      if (!data || data.length < 1000) return rows;
    }
  };
  const tables = {} as Record<TableName, Row[]>;
  for (const t of TABLES) tables[t] = await readAll(t);
  let checkpoints: Row[] | null = null;
  try {
    checkpoints = await readAll("registro_checkpoints");
  } catch {
    checkpoints = null; // not readable with the public key (as it should be after migration 013)
  }
  return { tables, checkpoints };
}

// ── the trusted list of legacy offerings (versioned in the repo) ───────────────────

function seedOfferings(): Row[] {
  const sql = readFileSync(join(here, "../../supabase/migrations_004_offerings.sql"), "utf8");
  const rows: Row[] = [];
  const re =
    /\('(0x[0-9a-f]{40})', '(0x[0-9a-f]{40})', '(0x[0-9a-f]{40})', '(0x[0-9a-f]{40})', 'legado',\s*(\d+), '([^']*)', '([^']*)', '([^']*)', (\d+), '([^']+)'\)/g;
  for (const m of sql.matchAll(re)) {
    rows.push({
      endereco: m[1],
      token: m[2],
      emissor: m[3],
      moeda: m[4],
      origem: "legado",
      numero: Number(m[5]),
      nome: m[6],
      simbolo: m[7],
      empresa: m[8],
      bloco_criacao: Number(m[9]),
      criada_em: m[10],
    });
  }
  if (rows.length !== 11) throw new Error(`Expected 11 seed offerings in migrations_004, found ${rows.length}`);
  return rows;
}

// ── re-deriving the rows from the chain ───────────────────────────────────────────

type Derived = Record<TableName, Map<string, Row>>;
type Coverage = { complete: Set<string>; blocks: Map<string, Set<number>> };

function emptyDerived(): Derived {
  return Object.fromEntries(TABLES.map((t) => [t, new Map<string, Row>()])) as Derived;
}

function memoryDb(out: Derived) {
  const put = (t: TableName, row: Row) => {
    const k = KEYS[t](row);
    if (!out[t].has(k)) out[t].set(k, row); // first write wins, like ignoreDuplicates
  };
  let solanaNumber = 0;
  return {
    saveLedgerEntry: async (e: NewLedgerEntry) => put("registro_transacoes", { rede: "sepolia", ...e }),
    saveSignature: async (s: NewSignature) => put("registro_assinaturas", s),
    saveSignatureV2: async (s: NewSignatureV2) => put("registro_assinaturas_v2", s),
    saveEtrEvent: async (e: NewEtrEvent) => put("registro_transferiveis_eventos", e),
    saveOffering: async (o: NewOffering) => put("registro_ofertas", { rede: "sepolia", ...o }),
    saveBackfill: async () => {},
    readCheckpoint: async (_source: string, fallback: number) => fallback,
    saveCheckpoints: async () => {},
    loadOfferings: async () => seedOfferings().map((r) => toTracked({ ...(r as Record<string, unknown>), backfill_alvo: null, backfill_ate: null } as never)),
    loadSolanaOfferings: async () => [],
    registerSolanaOffering: async (o: NewSolanaOffering) => {
      const existing = out.registro_ofertas.get(o.endereco);
      if (existing) return Number(existing.numero);
      const numero = ++solanaNumber;
      put("registro_ofertas", { ...o, numero, origem: "solana", rede: "solana-devnet" });
      return numero;
    },
  };
}

type EvmReader = Pick<ReturnType<typeof fallbackProvider>, "getBlockNumber" | "getBlock" | "getLogs">;

/** An EVM RPC that only returns the logs of the given blocks (plus the real tip and block times). */
function targetedEvmRpc(provider: EvmReader, blocks: Set<number>) {
  const sorted = [...blocks].sort((a, b) => a - b);
  return {
    getBlockNumber: () => provider.getBlockNumber(),
    getBlock: async (b: number) => {
      const block = await provider.getBlock(b);
      return block ? { timestamp: block.timestamp } : null;
    },
    getLogs: async (f: { address: string[]; fromBlock: number; toBlock: number }) => {
      const logs: ethers.Log[] = [];
      for (const b of sorted) {
        if (b < f.fromBlock) continue;
        if (b > f.toBlock) break;
        logs.push(...(await provider.getLogs({ address: f.address, fromBlock: b, toBlock: b })));
      }
      return logs;
    },
  };
}

function evmProvider(url: string, chainId: number) {
  const req = new ethers.FetchRequest(url);
  req.retryFunc = async () => false; // 429s go through the indexer's own backoff
  return new ethers.JsonRpcProvider(req, chainId, { staticNetwork: true });
}

/**
 * Several RPCs for one network, tried in order. Public endpoints behind a load
 * balancer sometimes answer old blocks with "pruned history unavailable"; the
 * next one is tried then. Rate limits are left to the indexer's backoff.
 */
function fallbackProvider(urls: string[], chainId: number) {
  const providers = urls.map((u) => evmProvider(u, chainId));
  const attempt = async <T,>(fn: (p: ethers.JsonRpcProvider) => Promise<T>): Promise<T> => {
    let last: unknown;
    for (const p of providers) {
      try {
        return await fn(p);
      } catch (e) {
        last = e;
        if (/429|Too Many|rate limit/i.test(String((e as Error)?.message ?? e))) throw e;
      }
    }
    throw last;
  };
  return {
    first: providers[0],
    getBlockNumber: () => attempt((p) => p.getBlockNumber()),
    getBlock: (b: number) => attempt((p) => p.getBlock(b)),
    getLogs: (f: ethers.Filter) => attempt((p) => p.getLogs(f)),
  };
}

// Sepolia: archive-capable public RPCs first (publicnode answers some old blocks with "pruned history").
const SEPOLIA_RPCS = (process.env.SEPOLIA_RPC_URL ?? "https://rpc.sepolia.ethpandaops.io,https://ethereum-sepolia-rpc.publicnode.com")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/** Blocks the database rows point to, per EVM network. */
function targetBlocks(tables: Record<TableName, Row[]>): Map<string, Set<number>> {
  const blocks = new Map<string, Set<number>>();
  const add = (net: unknown, b: unknown) => {
    const n = Number(b);
    if (typeof net !== "string" || net === "solana-devnet" || !Number.isFinite(n) || n <= 0) return;
    if (!blocks.has(net)) blocks.set(net, new Set());
    blocks.get(net)!.add(n);
  };
  for (const r of tables.registro_transacoes) add(r.rede ?? "sepolia", r.bloco);
  for (const r of tables.registro_assinaturas) add(r.rede, r.bloco);
  for (const r of tables.registro_assinaturas_v2) add(r.rede, r.bloco);
  for (const r of tables.registro_transferiveis_eventos) add(r.rede, r.bloco);
  for (const r of tables.registro_ofertas) add(r.rede ?? "sepolia", r.bloco_criacao);
  return blocks;
}

async function derive(blocks: Map<string, Set<number>>, log: (s: string) => void): Promise<{ derived: Derived; coverage: Coverage; tips: Record<string, number> }> {
  const derived = emptyDerived();
  const db = memoryDb(derived);
  const coverage: Coverage = { complete: new Set(), blocks };
  const tips: Record<string, number> = {};
  const guard = (n: number, what: string) => {
    if (n > 100_000) throw new Error(`${what}: did not finish (loop guard)`);
  };

  // Sepolia: SMEs ledger, offerings (orchestrator), signatures v1.
  {
    const provider = fallbackProvider(SEPOLIA_RPCS, 11155111);
    const sepoliaBlocks = blocks.get("sepolia") ?? new Set<number>();
    tips.sepolia = await provider.getBlockNumber();
    const seedStart = Math.min(...seedOfferings().map((r) => Number(r.bloco_criacao))) - 1;
    const core = createIndexer({
      rpc: targetedEvmRpc(provider, sepoliaBlocks),
      tokens: new Tokens(provider.first),
      db,
      cfg: {
        ...config,
        startBlock: Number(process.env.START_BLOCK ?? seedStart),
        blockRangeChunk: 50_000,
        backlogChunksPerCycle: 1_000,
        backlogIntervalMs: 0,
      },
      sleep,
    });
    await core.start();
    let i = 0;
    for (;;) {
      const r = await core.cycle();
      if (r.failed) throw new Error("sepolia: a cycle failed (see the log above)");
      if (r.upToDate) break;
      guard(++i, "sepolia");
    }
    log(`sepolia: ${sepoliaBlocks.size} block(s) re-read (${SOURCE_PMES}, ${SOURCE_SIGNATURES}, ${SOURCE_ORCHESTRATOR})`);
  }

  // Other EVM networks: signatures v1 and v2 (registry + transferable records).
  for (const n of config.extraEvmNetworks) {
    const nb = blocks.get(n.network) ?? new Set<number>();
    const provider = fallbackProvider([n.rpcUrl], n.chainId);
    tips[n.network] = await provider.getBlockNumber();
    const idx = createEvmSignatureIndexer({
      network: n.network,
      source: n.source,
      rpc: targetedEvmRpc(provider, nb),
      db,
      address: n.address,
      deployBlock: n.deployBlock,
      chunk: 1_000_000,
      maxChunksPerCycle: 1_000,
      confirmations: n.confirmations,
      backoff,
      sleep,
    });
    await idx.start();
    for (let i = 0; !(await idx.cycle()).upToDate; i++) guard(i, n.network);
  }
  for (const n of config.v2.evm) {
    const nb = blocks.get(n.network) ?? new Set<number>();
    const provider = n.network === "sepolia" ? fallbackProvider(SEPOLIA_RPCS, n.chainId) : fallbackProvider([n.rpcUrl], n.chainId);
    tips[n.network] ??= await provider.getBlockNumber();
    const idx = createEvmV2Indexer({
      network: n.network,
      source: n.source,
      rpc: targetedEvmRpc(provider, nb),
      db,
      registry: n.registry,
      etr: n.etr,
      deployBlock: n.deployBlock,
      chunk: 1_000_000,
      maxChunksPerCycle: 1_000,
      confirmations: n.confirmations,
      backoff,
      sleep,
    });
    await idx.start();
    for (let i = 0; !(await idx.cycle()).upToDate; i++) guard(i, `${n.network}-v2`);
    log(`${n.network}: ${nb.size} block(s) re-read${n.network === "sepolia" ? " (v2)" : " (v1 + v2)"}`);
  }

  // Solana: whole program histories.
  const solana = () =>
    new Connection(config.solana.rpcUrl, { commitment: "finalized", disableRetryOnRateLimit: true }) as unknown as never;
  tips["solana-devnet"] = await new Connection(config.solana.rpcUrl, "finalized").getSlot("finalized");
  const solanaRuns: [string, { start(): Promise<void>; cycle(): Promise<{ transactions: number }> }][] = [
    [SOURCE_SOLANA, createSolanaIndexer({ rpc: solana(), db, programId: config.solana.programId, startSlot: config.solana.startSlot, backoff, sleep })],
    [SOURCE_SOLANA_V2, createSolanaV2Indexer({ rpc: solana(), db, programId: config.solana.programId, startSlot: config.v2.solana.startSlot, backoff, sleep })],
    [SOURCE_PMES_SOLANA, createPmesSolanaIndexer({ rpc: solana(), db, programId: config.pmesSolana.programId, startSlot: config.pmesSolana.startSlot, backoff, sleep })],
  ];
  for (const [name, idx] of solanaRuns) {
    await idx.start();
    let total = 0;
    for (let i = 0; ; i++) {
      const { transactions } = await idx.cycle();
      total += transactions;
      if (transactions === 0) break;
      guard(i, name);
    }
    log(`solana ${name}: ${total} transaction(s) re-read (whole history)`);
  }
  coverage.complete.add("solana-devnet");
  return { derived, coverage, tips };
}

// ── comparing ─────────────────────────────────────────────────────────────────────

const ADDRESS_LIKE = /^0x[0-9a-fA-F]+$/;
const TIME_FIELDS = new Set(["assinado_em", "ocorrido_em", "criada_em"]);
// Bookkeeping of the indexer itself, not data.
const IGNORED_FIELDS = new Set(["backfill_alvo", "backfill_ate", "rede"]);

function same(field: string, expected: unknown, actual: unknown): boolean {
  if ((expected === undefined || expected === null) && (actual === undefined || actual === null)) return true;
  if (TIME_FIELDS.has(field)) return Date.parse(String(expected)) === Date.parse(String(actual));
  if (typeof expected === "number" || typeof actual === "number") return Number(expected) === Number(actual);
  if (typeof expected === "string" && typeof actual === "string") {
    return ADDRESS_LIKE.test(expected) ? expected.toLowerCase() === actual.toLowerCase() : expected === actual;
  }
  if (typeof expected === "object" && expected && typeof actual === "object" && actual) {
    return stable(expected) === stable(actual);
  }
  return expected === actual;
}

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${k}:${stable((v as Row)[k])}`)
      .join(",")}}`;
  }
  if (typeof v === "string" && ADDRESS_LIKE.test(v)) return JSON.stringify(v.toLowerCase());
  return JSON.stringify(v);
}

type Finding = { table: TableName; kind: "FORGED" | "ALTERED" | "MISSING"; key: string; detail: string };

function rowNetwork(table: TableName, r: Row): string {
  if (table === "registro_transacoes" || table === "registro_ofertas") return String(r.rede ?? "sepolia");
  return String(r.rede);
}
function rowBlock(table: TableName, r: Row): number {
  return Number(table === "registro_ofertas" ? r.bloco_criacao : r.bloco);
}

export function compare(dbTables: Record<TableName, Row[]>, derived: Derived, coverage: Coverage): { findings: Finding[]; verified: Record<string, number> } {
  const findings: Finding[] = [];
  const verified: Record<string, number> = {};
  const seed = new Map(seedOfferings().map((r) => [String(r.endereco), r]));

  for (const table of TABLES) {
    verified[table] = 0;
    const dbByKey = new Map(dbTables[table].map((r) => [KEYS[table](r), r]));
    for (const [key, dbRow] of dbByKey) {
      const expected = derived[table].get(key) ?? (table === "registro_ofertas" ? seed.get(key) : undefined);
      if (!expected) {
        findings.push({ table, kind: "FORGED", key, detail: "not produced by the chain" });
        continue;
      }
      const diffs = Object.keys(expected)
        .filter((f) => !IGNORED_FIELDS.has(f) && f in dbRow)
        .filter((f) => !same(f, expected[f], dbRow[f]))
        .map((f) => `${f}: database ${JSON.stringify(dbRow[f])} ≠ chain ${JSON.stringify(expected[f])}`);
      if (diffs.length) findings.push({ table, kind: "ALTERED", key, detail: diffs.join("; ") });
      else verified[table]++;
    }
    for (const [key, chainRow] of derived[table]) {
      if (dbByKey.has(key)) continue;
      const net = rowNetwork(table, chainRow);
      const covered = coverage.complete.has(net) || coverage.blocks.get(net)?.has(rowBlock(table, chainRow));
      if (covered) findings.push({ table, kind: "MISSING", key, detail: `on ${net}, not in the database` });
    }
  }
  return { findings, verified };
}

// ── main ──────────────────────────────────────────────────────────────────────────

function printReport(findings: Finding[], verified: Record<string, number>, extra: string[]) {
  console.log("\n════════ integrity of the public mirror ════════\n");
  for (const t of TABLES) {
    const f = findings.filter((x) => x.table === t);
    console.log(`${t.padEnd(32)} ${String(verified[t]).padStart(5)} verified  ${f.length ? `${f.length} PROBLEM(S)` : "ok"}`);
  }
  for (const line of extra) console.log(line);
  if (findings.length) {
    console.log("\nProblems:");
    for (const f of findings) console.log(`  [${f.kind}] ${f.table} ${f.key} — ${f.detail}`);
  } else {
    console.log("\nEverything in the database matches the chain.");
  }
}

async function selfTest() {
  // Uses the chain only: the "database" is the derived rows themselves, then
  // tampered with in three ways that must all be caught.
  // Real Sepolia blocks with SMEs events (offerings 1 and 11), the
  // orchestrator deploy/creation block and RegistroAssinaturas registrations.
  const blocks = new Map<string, Set<number>>([
    ["sepolia", new Set([11496281, 11496702, 11496737, 11622512, 11622518, 11622519, 11622520, 11697746, 11733723, 11745350, 11746748])],
  ]);
  const { derived, coverage } = await derive(blocks, (s) => console.log(`  ${s}`));
  const evmRows = [...derived.registro_transacoes.values()].filter((r) => r.rede === "sepolia");
  const evmSignatures = [...derived.registro_assinaturas.values()].filter((r) => r.rede === "sepolia");
  console.log(`self-test: re-derived ${evmRows.length} Sepolia ledger row(s), ${evmSignatures.length} Sepolia signature(s)`);
  if (!evmRows.length || !evmSignatures.length) throw new Error("self-test: the EVM path produced nothing");
  const asDb = Object.fromEntries(TABLES.map((t) => [t, [...derived[t].values()].map((r) => ({ ...r }))])) as Record<TableName, Row[]>;
  const clean = compare(asDb, derived, coverage);
  if (clean.findings.length) throw new Error(`self-test: untouched copy reported ${clean.findings.length} problem(s)`);
  const sol = asDb.registro_assinaturas.find((r) => r.rede === "solana-devnet") ?? asDb.registro_transacoes.find((r) => r.rede === "solana-devnet");
  if (!sol) throw new Error("self-test: no Solana row to tamper with");
  const table: TableName = "documento_nome" in sol ? "registro_assinaturas" : "registro_transacoes";
  const tampered = { ...asDb, [table]: asDb[table].filter((r) => r !== sol) } as Record<TableName, Row[]>;
  const victim = tampered[table][0];
  const altered = { ...victim, assinante_endereco: "AttackerAttackerAttackerAttackerAttacker111", descricao: "phishing" };
  tampered[table] = [altered, ...tampered[table].slice(1)];
  // An EVM ledger row with its amount changed inside `dados`.
  const evmIndex = tampered.registro_transacoes.findIndex((r) => r.rede === "sepolia" && (r.dados as Row | null)?.valor);
  if (evmIndex >= 0) {
    const r = tampered.registro_transacoes[evmIndex];
    tampered.registro_transacoes = tampered.registro_transacoes.map((x, i) =>
      i === evmIndex ? { ...r, dados: { ...(r.dados as Row), valor: "1000000.0" } } : x,
    );
  }
  tampered.registro_assinaturas_v2 = [
    ...tampered.registro_assinaturas_v2,
    { rede: "base-sepolia", hash_registro: `0x${"ab".repeat(32)}`, bloco: 1, assinante_endereco: "0x0000000000000000000000000000000000000001" },
  ];
  const { findings } = compare(tampered, derived, coverage);
  const kinds = new Set(findings.map((f) => f.kind));
  console.log(`self-test: clean copy ok (${Object.values(clean.verified).reduce((a, b) => a + b, 0)} rows); tampered copy → ${findings.map((f) => f.kind).join(", ")}`);
  if (!(kinds.has("FORGED") && kinds.has("ALTERED") && kinds.has("MISSING"))) throw new Error("self-test: a tampering was not caught");
  console.log("self-test: ok");
}

async function main() {
  if (SELF_TEST) return selfTest();
  console.log("Reading the database (public key, read-only)...");
  const { tables, checkpoints } = await readDatabase();
  console.log(TABLES.map((t) => `${t}: ${tables[t].length}`).join(" · "));
  const blocks = targetBlocks(tables);
  console.log("Re-reading the chains...");
  const { derived, coverage, tips } = await derive(blocks, (s) => console.log(`  ${s}`));
  const { findings, verified } = compare(tables, derived, coverage);

  const extra: string[] = [];
  if (checkpoints) {
    extra.push("\nCheckpoints (last block/slot processed; must not be ahead of the chain):");
    for (const c of checkpoints) {
      const source = String(c.fonte);
      const net =
        source.startsWith("solana") || source === "pmes-solana"
          ? "solana-devnet"
          : (Object.keys(tips).find((n) => source.startsWith(n)) ?? "sepolia");
      const ahead = Number(c.ultimo_bloco) > tips[net];
      extra.push(`  ${source.padEnd(32)} ${String(c.ultimo_bloco).padStart(12)}  tip ${tips[net]}${ahead ? "  AHEAD OF THE CHAIN" : ""}`);
      if (ahead) findings.push({ table: "registro_ofertas", kind: "ALTERED", key: `checkpoint ${source}`, detail: "ahead of the chain tip" });
    }
  } else {
    extra.push("\nCheckpoints: not readable with the public key (expected after migration 013).");
  }
  extra.push(
    "\nCoverage: Solana programs re-read in full; EVM networks re-read at the blocks the rows point to (forged/altered rows are always caught; a deleted EVM row elsewhere is not).",
  );
  printReport(findings, verified, extra);
  if (REPORT) writeFileSync(REPORT, JSON.stringify({ at: new Date().toISOString(), verified, findings }, null, 2));
  process.exit(findings.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(2);
});
