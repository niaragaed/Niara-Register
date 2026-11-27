import { isRateLimit } from "./rate-limit";

/**
 * Adaptive eth_getLogs ranges, shared by the Exchange EVM sources and the
 * Register's own EVM loops (evm-signatures.ts, v2.ts).
 *
 * - `isTimeout` / `isRangeRefusal` classify provider errors that mean "this
 *   range is too heavy": a block-range cap, too many results, a response size
 *   cap, or a server-side timeout (HyperEVM's `-32000 execution aborted
 *   (timeout = 5s)`). Retrying the same range can never help, so the caller
 *   halves it.
 * - `createChunkController` holds the current range size: double after a run
 *   of successes up to a maximum, halve (never below a floor) on a refusal.
 * - `fetchAdaptive` runs one range with that controller: on a refusal it
 *   halves and retries (with a growing wait after timeouts), and gives up at
 *   the floor.
 *
 * A rate limit (429) is not a range problem: it keeps going through
 * withBackoff, and `isRangeRefusal` is false for it.
 */

function errorText(error: unknown): string {
  const e = error as {
    shortMessage?: string;
    message?: string;
    error?: { message?: string };
    info?: { error?: { message?: string }; responseStatus?: string };
    cause?: unknown;
  };
  const own = [e?.shortMessage, e?.message, e?.error?.message, e?.info?.error?.message, e?.info?.responseStatus].filter(Boolean).join(" ");
  const cause = e?.cause && e.cause !== error ? errorText(e.cause) : "";
  return `${own} ${cause}`;
}

function errorCode(error: unknown): number | undefined {
  const e = error as { error?: { code?: number }; info?: { error?: { code?: number } }; code?: unknown };
  return e?.error?.code ?? e?.info?.error?.code ?? (typeof e?.code === "number" ? e.code : undefined);
}

/** A provider-side or client-side timeout: "execution aborted (timeout = 5s)", "query timeout exceeded", an aborted fetch. */
export function isTimeout(error: unknown): boolean {
  if (isRateLimit(error)) return false;
  const e = error as { code?: unknown; name?: string };
  if (e?.code === "TIMEOUT" || e?.name === "TimeoutError") return true;
  return /execution aborted|timed? ?out|timeout|deadline exceeded|\b(504|524)\b|gateway time/i.test(errorText(error));
}

/** The provider refused the range: size, result count, block-range cap or timeout. */
export function isRangeRefusal(error: unknown): boolean {
  if (isRateLimit(error)) return false;
  if (isTimeout(error)) return true;
  const code = errorCode(error);
  if (code === 413) return true;
  return /block range|range (is )?too (large|wide|big)|exceed(s|ed)? (the )?(max|maximum|limit|range)|query returned more than|too many (results|logs)|more than \d+ results|response size|limit exceeded|payload too large|\b413\b|ranges? (over|larger|greater)|max(imum)? (block )?range|eth_getlogs is limited|up to a \d+ block range|invalid block range/i.test(
    errorText(error),
  );
}

export type ChunkOptions = {
  /** Floor: the range is never halved below it (>= 1). */
  min: number;
  /** Ceiling: the range never grows above it. */
  max: number;
  /** Starting range; defaults to `max`. */
  initial?: number;
  /** Doublings happen after this many consecutive successes. */
  growAfter?: number;
};

export function createChunkController(options: ChunkOptions) {
  const min = Math.max(1, Math.floor(options.min));
  const max = Math.max(min, Math.floor(options.max));
  const growAfter = Math.max(1, options.growAfter ?? 3);
  let size = Math.min(max, Math.max(min, Math.floor(options.initial ?? max)));
  let streak = 0;

  return {
    get size() {
      return size;
    },
    get min() {
      return min;
    },
    get max() {
      return max;
    },
    /** The range worked: after `growAfter` in a row, doubles (up to max). */
    success(): void {
      if (++streak >= growAfter && size < max) {
        size = Math.min(max, size * 2);
        streak = 0;
      }
    },
    /** The range was refused: halves the one that was tried (never below min). Returns the new size. */
    refused(attempted: number = size): number {
      size = Math.max(min, Math.floor(Math.min(attempted, size) / 2));
      streak = 0;
      return size;
    },
  };
}

export type ChunkController = ReturnType<typeof createChunkController>;

export type AdaptiveOptions = {
  controller: ChunkController;
  /** Wait after a timeout before the retry: base × 2^(consecutive timeouts − 1), capped. */
  timeoutBackoff: { baseMs: number; capMs: number };
  sleep: (ms: number) => Promise<void>;
  /** For the log line when a range is refused. */
  label: string;
};

/**
 * Fetches [from, min(from + size − 1, limit)]. A refused range is halved and
 * retried until it succeeds or the floor is reached (then the error goes up).
 * Returns the last block of the range that worked.
 */
export async function fetchAdaptive<T>(
  from: number,
  limit: number,
  fetchRange: (from: number, to: number) => Promise<T>,
  opts: AdaptiveOptions,
): Promise<{ to: number; result: T }> {
  let timeouts = 0;
  for (;;) {
    const to = Math.min(from + opts.controller.size - 1, limit);
    try {
      const result = await fetchRange(from, to);
      opts.controller.success();
      return { to, result };
    } catch (error) {
      const span = to - from + 1;
      if (!isRangeRefusal(error) || span <= opts.controller.min) throw error;
      const next = opts.controller.refused(span);
      console.warn(`[indexer] ${opts.label}: ${from}–${to} refused (${(error as { shortMessage?: string }).shortMessage ?? (error as Error).message}); trying ${next} blocks`);
      if (isTimeout(error)) {
        const wait = Math.min(opts.timeoutBackoff.baseMs * 2 ** timeouts, opts.timeoutBackoff.capMs);
        timeouts++;
        await opts.sleep(wait);
      }
    }
  }
}
