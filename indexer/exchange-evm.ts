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
 * Adaptive ranges: when the RPC refuses a range (block-range limit, too many
 * results, timeout), the range is halved and retried, down to one block; after
 * a run of successes it doubles again, up to maxBlockRange.
 */

const GROW_AFTER = 5;

export function createEvmSettlementSource(deps: {
  cfg: EvmExchangeConfig;
  rpc: JsonRpc;
  db: ExchangeDb;
  backoff: Omit<BackoffOptions, "sleep">;
  sleep: (ms: number) => Promise<void>;
}) {
  const { cfg, rpc, db } = deps;
  const options: BackoffOptions = { ...deps.backoff, sleep: deps.sleep };
  const net = <T,>(fn: () => Promise<T>, context: string) => withBackoff(fn, `exchange ${cfg.network}: ${context}`, options);
  const hex = (n: number) => `0x${n.toString(16)}`;

  let cursor = 0;
  let range = cfg.maxBlockRange;
  let streak = 0;
  let warnedNoFinalizedTag = false;
  const tokens = new Map<string, { symbol: string | null; decimals: number }>();

  async function start(): Promise<void> {
    cursor = await db.readCursor(cfg.source, cfg.startBlock - 1);
  }

  async function safeHead(): Promise<number> {
    if (cfg.finality === "finalized") {
      try {
        const block = await net(() => rpc<{ number: string } | null>("eth_getBlockByNumber", ["finalized", false]), "finalized block");
        if (block?.number) return Number(BigInt(block.number));
      } catch (error) {
        if (isRateLimit(error)) throw error;
      }
      if (!warnedNoFinalizedTag) {
        console.warn(`[exchange] ${cfg.network}: the RPC did not return a finalized block; using latest − ${cfg.confirmations}`);
        warnedNoFinalizedTag = true;
      }
    }
    const latest = Number(BigInt(await net(() => rpc<string>("eth_blockNumber", []), "eth_blockNumber")));
    return latest - cfg.confirmations;
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

  /** Throws on error; every range already done stays saved in the cursor. */
  async function cycle(): Promise<{ saved: number; upToDate: boolean }> {
    const head = await safeHead();
    let saved = 0;
    for (let i = 0; i < cfg.maxRangesPerCycle && cursor < head; i++) {
      if (i > 0 && cfg.rangeIntervalMs) await deps.sleep(cfg.rangeIntervalMs);
      const from = cursor + 1;
      let to = Math.min(cursor + range, head);
      let logs: RawLog[];
      // A refused range is halved and retried at once (at most log2(range) times).
      for (;;) {
        try {
          const toBlock = to;
          logs = await net(
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
          );
          break;
        } catch (error) {
          if (isRateLimit(error) || to === from) throw error;
          range = Math.max(1, Math.floor((to - from + 1) / 2));
          streak = 0;
          console.warn(`[exchange] ${cfg.network}: eth_getLogs ${from}–${to} refused (${(error as Error).message}); trying ${range} blocks`);
          to = from + range - 1;
        }
      }
      const rows = await rowsFor(logs);
      await db.saveSettlements(rows);
      await db.saveCursor(cfg.source, to);
      cursor = to;
      saved += rows.length;
      for (const r of rows) {
        console.log(`[exchange] ${cfg.network}: settlement ${r.match_id} — ${r.lots} ${r.asset_symbol ?? r.asset_address} — block ${r.block_number} — ${r.tx_hash}`);
      }
      if (++streak >= GROW_AFTER && range < cfg.maxBlockRange) {
        range = Math.min(cfg.maxBlockRange, range * 2);
        streak = 0;
      }
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
      return range;
    },
  };
}
