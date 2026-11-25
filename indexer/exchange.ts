import { hostname } from "node:os";
import { randomBytes } from "node:crypto";
import type { ExchangeConfig } from "./exchange-config";
import type { ExchangeDbClient } from "./exchange-db";
import { createEvmSettlementSource } from "./exchange-evm";
import { createSolanaSettlementSource } from "./exchange-solana";
import { createJsonRpc } from "./exchange-rpc";
import type { BackoffOptions } from "./rate-limit";

/**
 * Starts the Exchange settlement sources: one loop per configured network,
 * none of which can stop or delay another, all gated by a single-instance lease.
 *
 * Why a lease: Railway can run several replicas of a service, and a new
 * deployment overlaps the old one for a while. Writes are idempotent, so two
 * writers would not duplicate rows, but they would race on the cursors and
 * double the RPC load. The lease (exchange_indexer_lease, migration 016) is
 * taken and renewed every ttl/3 through a Postgres function; a holder that
 * misses its renewals stops writing before the lease can expire, and only then
 * can another instance take it. The read API runs on every replica.
 */

export function startExchangeIndexer(deps: {
  cfg: ExchangeConfig;
  db: ExchangeDbClient;
  backoff: Omit<BackoffOptions, "sleep">;
  sleep: (ms: number) => Promise<void>;
  dryRun: boolean;
}) {
  const { cfg, db, sleep } = deps;
  const holder = `${process.env.RAILWAY_REPLICA_ID ?? hostname()}:${process.pid}:${randomBytes(4).toString("hex")}`;
  const ttlMs = cfg.lease.ttlSeconds * 1000;
  // Considered held only until 2/3 of the TTL after the last renewal: always
  // short of the moment another instance could take it.
  let heldUntil = 0;
  let stopped = false;
  const isHeld = () => !stopped && Date.now() < heldUntil;

  for (const s of cfg.sources) {
    if (!cfg.indexerEnabled || !s.enabled) {
      console.log(`[exchange] ${s.network}: disabled`);
    } else if (s.missing.length > 0) {
      console.warn(`[exchange] ${s.network}: not configured — missing ${s.missing.join(", ")}; skipped`);
    }
  }
  const active = cfg.indexerEnabled ? cfg.sources.filter((s) => s.enabled && s.missing.length === 0) : [];
  if (active.length === 0) return { holder, stop: async () => {} };

  async function leaseLoop(): Promise<void> {
    let had = false;
    while (!stopped) {
      const attemptAt = Date.now();
      try {
        const ok = await db.tryLease(cfg.lease.name, holder, cfg.lease.ttlSeconds);
        heldUntil = ok ? attemptAt + (ttlMs * 2) / 3 : 0;
        if (ok !== had) console.log(`[exchange] lease ${ok ? "taken" : "held by another instance — waiting"} (${holder})`);
        had = ok;
      } catch (error) {
        console.error("[exchange] lease renewal failed:", (error as Error).message);
      }
      await sleep(ttlMs / 3);
    }
  }

  async function run(name: string, pollMs: number, cycle: () => Promise<boolean>, startFn: () => Promise<void>) {
    // start() reads the cursor; retried until it works (e.g. migration 016 not applied yet).
    for (;;) {
      if (stopped) return;
      try {
        await startFn();
        break;
      } catch (error) {
        console.error(`[exchange] ${name}: did not start, retrying in 60 s:`, (error as Error).message);
        await sleep(60_000);
      }
    }
    for (;;) {
      if (stopped) return;
      if (!isHeld()) {
        await sleep(5_000);
        continue;
      }
      let upToDate = true;
      try {
        upToDate = await cycle();
      } catch (error) {
        console.error(`[exchange] ${name}: cycle error, retrying in the next one:`, error);
      }
      if (deps.dryRun) {
        console.log(`[dry-run] exchange ${name}: one cycle done`);
        return;
      }
      if (upToDate) await sleep(pollMs);
    }
  }

  void leaseLoop();

  for (const s of active) {
    if (s.kind === "solana") {
      const source = createSolanaSettlementSource({ cfg: s, rpc: createJsonRpc(s.rpcUrl), db, backoff: deps.backoff, sleep });
      console.log(`[exchange] solana-devnet: program ${s.programId}, start slot ${s.startSlot}`);
      void run(
        s.network,
        s.pollIntervalMs,
        async () => {
          const r = await source.cycle();
          if (r.transactions > 0) console.log(`[exchange] solana-devnet: ${r.transactions} transaction(s), ${r.saved} settlement(s) — cursor slot ${source.cursor}`);
          return true;
        },
        source.start,
      );
    } else {
      const source = createEvmSettlementSource({ cfg: s, rpc: createJsonRpc(s.rpcUrl), db, backoff: deps.backoff, sleep });
      console.log(`[exchange] ${s.network}: NiaraSettlement ${s.settlement}, CashbackDistributor ${s.cashbackDistributor}, start block ${s.startBlock}, ${s.finality}`);
      void run(
        s.network,
        s.pollIntervalMs,
        async () => {
          const r = await source.cycle();
          if (r.saved > 0) console.log(`[exchange] ${s.network}: ${r.saved} settlement(s) — cursor block ${source.cursor}`);
          return r.upToDate;
        },
        source.start,
      );
    }
  }

  return {
    holder,
    /** Stops the loops and frees the lease, so the next deployment takes over at once. */
    async stop(): Promise<void> {
      stopped = true;
      try {
        await db.releaseLease(cfg.lease.name, holder);
      } catch {
        // It expires on its own.
      }
    },
  };
}
