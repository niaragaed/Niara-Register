import type { EvmExchangeConfig } from "./exchange-config";
import type { ExchangeDb, SettlementRow } from "./exchange-db";
import {
  decodeErc20Decimals,
  decodeErc20Symbol,
  decodeEvmSettlements,
  FEE_RECORDED_TOPIC,
  lotsAndPrice,
  SETTLED_TOPIC,
  type RawLog,
} from "./exchange-decode";
import type { JsonRpc } from "./exchange-rpc";
import { createChunkController, fetchAdaptive } from "./chunking";
import { isRateLimit, withBackoff, type BackoffOptions } from "./rate-limit";

/**
 * One EVM network's Exchange settlement source.
 *
 * Each cycle scans from the stored cursor up to the safe head: the RPC's
 * `finalized` block, or latest − confirmations where the tag is not supported
 * (or the network is configured for depth). One eth_getLogs per range covers
 * NiaraSettlement's `Settled` and the CashbackDistributor's `FeeRecorded`
 * (topic0 OR filter, both addresses). The cursor is saved after each range, so
 * a stop in the middle resumes there.
 *
 * Backfill throughput: one cycle keeps fetching ranges until the cursor is
 * within the finality depth of the head, `cycleBudgetMs` is spent, or the
 * optional `maxRangesPerCycle` cap is reached (not one range per poll).
 *
 * Adaptive ranges (chunking.ts): the range doubles after a run of successes up
 * to maxBlockRange, and is halved (never below minBlockRange) when the RPC
 * refuses it: block-range cap, too many results, response size or a provider
 * timeout. Every N ranges the source logs the cursor, the head, blocks/s and
 * an ETA.
 */

/** Doublings happen after this many consecutive successful ranges. */
const GROW_AFTER = 3;

/** Safe head: the RPC's `finalized` block, or latest − confirmations. Shared with the API's lag figure. */
export async function readSafeHead(
  cfg: Pick<EvmExchangeConfig, "finality" | "confirmations" | "network">,
  rpc: JsonRpc,
  net: <T>(fn: () => Promise<T>, context: string) => Promise<T> = (fn) => fn(),
  onNoFinalizedTag?: () => void,
): Promise<number> {
  if (cfg.finality === "finalized") {
    try {
      const block = await net(() => rpc<{ number: string } | null>("eth_getBlockByNumber", ["finalized", false]), "finalized block");
      if (block?.number) return Number(BigInt(block.number));
    } catch (error) {
      if (isRateLimit(error)) throw error;
    }
    onNoFinalizedTag?.();
  }
  const latest = Number(BigInt(await net(() => rpc<string>("eth_blockNumber", []), "eth_blockNumber")));
  return latest - cfg.confirmations;
}

export function createEvmSettlementSource(deps: {
  cfg: EvmExchangeConfig;
  rpc: JsonRpc;
  db: ExchangeDb;
  backoff: Omit<BackoffOptions, "sleep">;
  sleep: (ms: number) => Promise<void>;
  /** Clock in ms; injectable for the time budget and the blocks/s figure. */
  now?: () => number;
}) {
  const { cfg, rpc, db } = deps;
  const now = deps.now ?? Date.now;
  const options: BackoffOptions = { ...deps.backoff, sleep: deps.sleep };
  const net = <T,>(fn: () => Promise<T>, context: string) => withBackoff(fn, `exchange ${cfg.network}: ${context}`, options);
  const hex = (n: number) => `0x${n.toString(16)}`;

  let cursor = 0;
  let lastHead = 0;
  const controller = createChunkController({ min: cfg.minBlockRange, max: cfg.maxBlockRange, growAfter: GROW_AFTER });
  let chunks = 0;
  let progressAt = { time: 0, block: 0 };
  let warnedNoFinalizedTag = false;
  const tokens = new Map<string, { symbol: string | null; decimals: number }>();

  async function start(): Promise<void> {
    cursor = await db.readCursor(cfg.source, cfg.startBlock - 1);
  }

  function safeHead(): Promise<number> {
    return readSafeHead(cfg, rpc, net, () => {
      if (warnedNoFinalizedTag) return;
      console.warn(`[exchange] ${cfg.network}: the RPC did not return a finalized block; using latest − ${cfg.confirmations}`);
      warnedNoFinalizedTag = true;
    });
  }
  async function token(address: string): Promise<{ symbol: string | null; decimals: number }> {
    const cached = tokens.get(address);
    if (cached) return cached;
    const call = (data: string) => net(() => rpc<string>("eth_call", [{ to: address, data }, "latest"]), `eth_call ${address.slice(0, 10)}`);
    const decimals = decodeErc20Decimals(await call("0x313ce567"));
    let symbol: string | null = null;
    try {
      symbol = decodeErc20Symbol(await call("0x95d89b41"));
    } catch (error) {
      if (isRateLimit(error)) throw error;
    }
    const meta = { symbol, decimals };
    tokens.set(address, meta);
    return meta;
  }

  async function blockTime(block: number): Promise<string> {
    const b = await net(() => rpc<{ timestamp: string } | null>("eth_getBlockByNumber", [hex(block), false]), `block ${block}`);
    if (!b?.timestamp) throw new Error(`block ${block} not found`);
    return new Date(Number(BigInt(b.timestamp)) * 1000).toISOString();
  }

  async function rowsFor(logs: RawLog[]): Promise<SettlementRow[]> {
    const decoded = decodeEvmSettlements(logs, {
      network: cfg.network,
      settlement: cfg.settlement,
      cashbackDistributor: cfg.cashbackDistributor,
    });
    const times = new Map<number, string>();
    const rows: SettlementRow[] = [];
    for (const s of decoded) {
      if (!times.has(s.blockNumber)) times.set(s.blockNumber, await blockTime(s.blockNumber));
      const asset = await token(s.asset);
      const payment = await token(s.payment);
      const { lots, price } = lotsAndPrice(s.baseQuantity, s.notional, asset.decimals);
      rows.push({
        network: cfg.network,
        tx_hash: s.txHash,
        log_index: s.logIndex,
        block_number: s.blockNumber,
        slot: null,
        block_time: times.get(s.blockNumber)!,
        match_id: s.matchId,
        contract_address: s.contract,
        asset_address: s.asset,
        asset_symbol: asset.symbol,
        asset_decimals: asset.decimals,
        payment_address: s.payment,
        payment_symbol: payment.symbol,
        payment_decimals: payment.decimals,
        base_quantity: s.baseQuantity.toString(),
        lots,
        price,
        notional: s.notional.toString(),
        fee: s.fee.toString(),
        cashback: s.cashback.toString(),
        buyer: s.buyer,
        seller: s.seller,
      });
    }
    return rows;
  }

  function logProgress(head: number): void {
    const t = now();
    const elapsedS = (t - progressAt.time) / 1000;
    const rate = elapsedS > 0 ? (cursor - progressAt.block) / elapsedS : 0;
    const remaining = Math.max(0, head - cursor);
    const eta = rate > 0 ? formatDuration(remaining / rate) : "unknown";
    console.log(
      `[exchange] ${cfg.network}: progress — block ${cursor} of ${head} (${remaining} behind), ${rate.toFixed(0)} blocks/s, range ${controller.size}, ETA ${eta}`,
    );
    progressAt = { time: t, block: cursor };
  }

  /**
   * Throws on error; every range already done stays saved in the cursor.
   * Keeps fetching ranges until the safe head, the time budget or the optional
   * range cap, whichever comes first.
   */
  async function cycle(): Promise<{ saved: number; upToDate: boolean }> {
    const startedAt = now();
    const head = await safeHead();
    lastHead = head;
    if (progressAt.time === 0) progressAt = { time: startedAt, block: cursor };
    let saved = 0;
    for (let i = 0; cursor < head && i < cfg.maxRangesPerCycle; i++) {
      if (i > 0 && now() - startedAt >= cfg.cycleBudgetMs) break;
      if (i > 0 && cfg.rangeIntervalMs) await deps.sleep(cfg.rangeIntervalMs);
      const { to, result: logs } = await fetchAdaptive(
        cursor + 1,
        head,
        (from, toBlock) =>
          net(
            () =>
              rpc<RawLog[]>("eth_getLogs", [
                {
                  fromBlock: hex(from),
                  toBlock: hex(toBlock),
                  address: [cfg.settlement, cfg.cashbackDistributor],
                  topics: [[SETTLED_TOPIC, FEE_RECORDED_TOPIC]],
                },
              ]),
            `eth_getLogs ${from}–${toBlock}`,
          ),
        { controller, timeoutBackoff: { baseMs: deps.backoff.baseMs, capMs: deps.backoff.capMs }, sleep: deps.sleep, label: `exchange ${cfg.network}: eth_getLogs` },
      );
      const rows = await rowsFor(logs);
      await db.saveSettlements(rows);
      await db.saveCursor(cfg.source, to);
      cursor = to;
      saved += rows.length;
      for (const r of rows) {
        console.log(`[exchange] ${cfg.network}: settlement ${r.match_id} — ${r.lots} ${r.asset_symbol ?? r.asset_address} — block ${r.block_number} — ${r.tx_hash}`);
      }
      if (cfg.progressEveryChunks > 0 && ++chunks % cfg.progressEveryChunks === 0 && cursor < head) logProgress(head);
    }
    return { saved, upToDate: cursor >= head };
  }

  return {
    start,
    cycle,
    get cursor() {
      return cursor;
    },
    get range() {
      return controller.size;
    },
    /** Safe head seen by the last cycle (0 before the first). */
    get head() {
      return lastHead;
    },
  };
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "unknown";
  if (seconds < 90) return `${Math.round(seconds)}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}min`;
  if (seconds < 172800) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86400).toFixed(1)}d`;
}
