import {
  isRangeRefusal,
  isTimeout,
  isUnreachable,
  providerRangeLimit,
  type ChunkController,
  type ConcurrencyController,
} from "./chunking";
import { isRateLimit } from "./rate-limit";

/**
 * Parallel eth_getLogs for the Register's own EVM sources, for nodes that are
 * slow per request but accept several at once (the public HyperEVM testnet RPC
 * scans ~2 blocks/s per request and aborts at 5 s, so one 10-block range takes
 * ~4.7 s; the chain makes ~1 block/s, so one range at a time never catches up).
 *
 * Each round plans up to `concurrency` consecutive ranges of the controller's
 * current size from the checkpoint, runs them at once, then handles results in
 * order: the checkpoint only moves over a CONTIGUOUS prefix of completed
 * ranges, one `handle` (rows + checkpoint save) per range. The first failed
 * range ends the prefix; its later siblings are discarded and planned again.
 *
 *   rate limit (429)     → concurrency halves, wait (doubling, capped), same ranges again
 *   timeout              → concurrency halves, range halves and becomes a ceiling (chunking.ts), wait
 *   other refusal/error  → range halves (a stated provider limit becomes the ceiling)
 *   node unreachable     → throws at once
 *   no progress at floor → throws (after `maxStalls` rounds for rate limits)
 */

export type ScanOptions<T> = {
  /** Last block already handled. */
  checkpoint: number;
  /** Last block to read (head − confirmations). */
  tip: number;
  controller: ChunkController;
  concurrency: ConcurrencyController;
  /** At most this many ranges per call (a cycle). */
  maxRanges: number;
  /** Pause between rounds (per-IP rate limits). */
  intervalMs: number;
  /** One eth_getLogs for [from, to], no retry of its own. */
  fetchRange: (from: number, to: number) => Promise<T>;
  /** Saves the rows of a range and its checkpoint; called in order, once per range. */
  handle: (to: number, result: T) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  backoff: { baseMs: number; capMs: number; attempts: number };
  label: string;
  now?: () => number;
};

export type ScanResult = { checkpoint: number; ranges: number; blocksPerSecond: number };

export async function scanParallel<T>(o: ScanOptions<T>): Promise<ScanResult> {
  const now = o.now ?? Date.now;
  const startedAt = now();
  const startBlock = o.checkpoint;
  let checkpoint = o.checkpoint;
  let ranges = 0;
  let stalls = 0;
  let rounds = 0;

  while (checkpoint < o.tip && ranges < o.maxRanges) {
    if (rounds++ > 0 && o.intervalMs > 0) await o.sleep(o.intervalMs);
    const size = o.controller.size;
    const plan: { from: number; to: number }[] = [];
    for (let from = checkpoint + 1; from <= o.tip && plan.length < Math.min(o.concurrency.size, o.maxRanges - ranges); from += size) {
      plan.push({ from, to: Math.min(from + size - 1, o.tip) });
    }
    const settled = await Promise.allSettled(plan.map((r) => o.fetchRange(r.from, r.to)));

    let failure: { error: unknown; span: number } | null = null;
    for (let i = 0; i < plan.length; i++) {
      const s = settled[i];
      if (s.status === "rejected") {
        failure = { error: s.reason, span: plan[i].to - plan[i].from + 1 };
        break;
      }
      await o.handle(plan[i].to, s.value);
      checkpoint = plan[i].to;
      ranges++;
      stalls = 0;
    }
    // An unreachable node anywhere in the round ends the cycle (the prefix is already saved).
    const unreachable = settled.find((s) => s.status === "rejected" && isUnreachable(s.reason));
    if (unreachable && unreachable.status === "rejected") throw unreachable.reason;

    if (!failure) {
      o.concurrency.ok();
      continue;
    }
    const { error, span } = failure;
    const reason = (error as { shortMessage?: string }).shortMessage ?? (error as Error).message;
    if (isRateLimit(error)) {
      if (++stalls >= o.backoff.attempts && o.concurrency.size === 1) throw error;
      const c = o.concurrency.stepDown();
      console.warn(`[indexer] ${o.label}: rate limit (${reason}); ${c} request(s) at a time`);
      await o.sleep(Math.min(o.backoff.baseMs * 2 ** (stalls - 1), o.backoff.capMs));
      continue;
    }
    const timedOut = isTimeout(error);
    if (span <= o.controller.min && o.concurrency.size === 1) throw error;
    const c = timedOut ? o.concurrency.stepDown() : o.concurrency.size;
    const next = o.controller.refused(span, providerRangeLimit(error), timedOut);
    console.warn(
      `[indexer] ${o.label}: ${plan.length} range(s) of ${span} ${isRangeRefusal(error) ? "refused" : "failed with an unrecognized error"} (${reason}); trying ${next} blocks, ${c} at a time`,
    );
    if (timedOut) {
      stalls++;
      await o.sleep(Math.min(o.backoff.baseMs * 2 ** Math.min(stalls - 1, 10), o.backoff.capMs));
    }
  }

  const seconds = Math.max(0.001, (now() - startedAt) / 1000);
  return { checkpoint, ranges, blocksPerSecond: (checkpoint - startBlock) / seconds };
}

/** "3 d 4 h", "5 h 10 min", "12 min", "40 s". */
export function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "unknown";
  const s = Math.round(seconds);
  if (s < 90) return `${s} s`;
  const min = Math.round(s / 60);
  if (min < 120) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ${min % 60} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

/**
 * Backfill progress line for a cycle that did not reach the tip: the pace the
 * cycle achieved and the time left at that pace (the chain keeps moving, so
 * the ETA divides by pace minus the chain's own block rate when it is known).
 */
export function backfillLine(label: string, r: ScanResult, tip: number, chainBlocksPerSecond = 0): string {
  const behind = Math.max(0, tip - r.checkpoint);
  const net = r.blocksPerSecond - chainBlocksPerSecond;
  const eta = net > 0 ? formatEta(behind / net) : "not catching up";
  return `[indexer] ${label}: ${r.blocksPerSecond.toFixed(1)} blocks/s, ${behind.toLocaleString("en-US")} blocks behind, ETA ${eta}`;
}

/** The chain's own block rate, from the tips seen in successive cycles (0 until two are known). */
export function createChainRate(now: () => number = Date.now) {
  let last: { tip: number; at: number } | null = null;
  return (tip: number): number => {
    const at = now();
    const rate = last && at > last.at && tip >= last.tip ? ((tip - last.tip) / (at - last.at)) * 1000 : 0;
    if (!last || at - last.at > 60_000) last = { tip, at };
    return rate;
  };
}
