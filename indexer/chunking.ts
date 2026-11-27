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
 * - `providerRangeLimit` reads the limit a provider states in its refusal
 *   (Alchemy: "up to a 10 block range ... should work: [a, b]"; Base:
 *   "eth_getLogs is limited to a 200 range").
 * - `createChunkController` holds the current range size: double after a run
 *   of successes up to a maximum, halve (never below a floor) on a refusal.
 *   A stated provider limit becomes a ceiling, so the range jumps straight to
 *   it and never grows back into a refusal. A timeout makes the halved range
 *   a ceiling too, lifted after a long run of successes: on a node that times
 *   out by range size (HyperEVM's public RPC scans ~2 blocks/s and aborts at
 *   5 s), growing back into the timed-out size cost a 5–7 s timeout plus a
 *   backoff every few ranges.
 * - `fetchAdaptive` runs one range with that controller. Any failure that is
 *   not a rate limit or the node being unreachable halves the range and
 *   retries (with a growing wait after timeouts), and gives up at the floor.
 *   Unrecognized errors halve too: retrying an identical range can never
 *   succeed, and an unknown provider message must not stop a source
 *   (2026-11-27: Alchemy's HTTP 400 was not recognized and the Exchange EVM
 *   sources retried the same range forever).
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
  if (providerRangeLimit(error) !== null) return true;
  return /block range|range (is )?too (large|wide|big)|exceed(s|ed)? (the )?(max|maximum|limit|range)|query returned more than|too many (results|logs)|more than \d+ results|response size|limit exceeded|payload too large|\b413\b|ranges? (over|larger|greater)|max(imum)? (block )?range|eth_getlogs is limited|up to a \d+ block range|invalid block range/i.test(
    errorText(error),
  );
}

/** The node could not be reached at all: a smaller range would not help. */
export function isUnreachable(error: unknown): boolean {
  if (isTimeout(error)) return false;
  const e = error as { code?: unknown; error?: { code?: number; message?: string }; httpStatus?: number };
  if (e?.code === "NETWORK_ERROR") return true;
  if (e?.error?.code === 0 && e.error.message === "network error") return true;
  if (e?.httpStatus === 502 || e?.httpStatus === 503) return true;
  return /fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|socket hang up|getaddrinfo/i.test(errorText(error));
}

/**
 * The largest range the provider says it accepts, or null:
 * "should work: [0x3d38a92, 0x3d38a9b]" (Alchemy, inclusive) → 10;
 * "up to a 10 block range" → 10; "limited to a 200 range" → 200.
 */
export function providerRangeLimit(error: unknown): number | null {
  const text = errorText(error);
  const pair = /should work:?\s*\[\s*(0x[0-9a-f]+|\d+)\s*,\s*(0x[0-9a-f]+|\d+)\s*\]/i.exec(text);
  if (pair) {
    const span = Number(BigInt(pair[2])) - Number(BigInt(pair[1])) + 1;
    if (span >= 1) return span;
  }
  // "up to a 10 block range", "limited to a 200 range", "up to a 2K block range", "maximum block range is 5000".
  const stated =
    /(?:up to (?:a )?|limited to (?:a )?)([\d,]+)(k?)[ -]*(?:block )?range/i.exec(text) ??
    /max(?:imum)? (?:block )?range (?:is |of )?([\d,]+)(k?)\b/i.exec(text);
  if (stated) {
    const n = Number(stated[1].replace(/,/g, "")) * (stated[2] ? 1000 : 1);
    if (Number.isSafeInteger(n) && n >= 1) return n;
  }
  return null;
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
  /**
   * A timeout lowers the ceiling to the halved range, so the range does not
   * grow straight back into the size that timed out. After this many
   * consecutive successes the timeout ceiling is lifted and growth resumes
   * (a timeout can be a slow moment of the node, not its limit). Default 500.
   */
  relaxAfter?: number;
};

export function createChunkController(options: ChunkOptions) {
  const min = Math.max(1, Math.floor(options.min));
  const max = Math.max(min, Math.floor(options.max));
  const growAfter = Math.max(1, options.growAfter ?? 3);
  const relaxAfter = Math.max(1, options.relaxAfter ?? 500);
  let size = Math.min(max, Math.max(min, Math.floor(options.initial ?? max)));
  /** A limit the provider stated: the range never grows above it. */
  let stated = max;
  /** Lowered by timeouts; lifted after `relaxAfter` successes in a row. */
  let soft = max;
  let streak = 0;
  let sinceTimeout = 0;
  const ceilingNow = () => Math.min(stated, soft);

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
    /** max, the provider's stated limit once one was seen, or lower after a recent timeout. */
    get ceiling() {
      return ceilingNow();
    },
    /** The range worked: after `growAfter` in a row, doubles (up to the ceiling). */
    success(): void {
      if (soft < max && ++sinceTimeout >= relaxAfter) {
        soft = max;
        sinceTimeout = 0;
      }
      if (++streak >= growAfter && size < ceilingNow()) {
        size = Math.min(ceilingNow(), size * 2);
        streak = 0;
      }
    },
    /**
     * The range was refused. With the provider's stated limit, jumps to it and
     * keeps it as the ceiling; otherwise halves the range that was tried. After
     * a timeout the halved range is also the ceiling until `relaxAfter`
     * successes. Never below min. Returns the new size.
     */
    refused(attempted: number = size, statedLimit: number | null = null, timedOut = false): number {
      if (statedLimit !== null && statedLimit < attempted) {
        stated = Math.max(min, Math.min(stated, statedLimit));
        size = ceilingNow();
      } else {
        size = Math.max(min, Math.floor(Math.min(attempted, size) / 2));
        if (timedOut) {
          soft = Math.max(min, Math.min(soft, size));
          sinceTimeout = 0;
        }
      }
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
 * Fetches [from, min(from + size − 1, limit)]. A failed range is shrunk and
 * retried until it succeeds or the floor is reached (then the error goes up).
 * Rate limits (already retried by withBackoff) and an unreachable node go up
 * at once. Returns the last block of the range that worked.
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
      if (isRateLimit(error) || isUnreachable(error) || span <= opts.controller.min) throw error;
      const next = opts.controller.refused(span, providerRangeLimit(error), isTimeout(error));
      const reason = (error as { shortMessage?: string }).shortMessage ?? (error as Error).message;
      console.warn(
        `[indexer] ${opts.label}: ${from}–${to} ${isRangeRefusal(error) ? "refused" : "failed with an unrecognized error"} (${reason}); trying ${next} blocks`,
      );
      if (isTimeout(error)) {
        const wait = Math.min(opts.timeoutBackoff.baseMs * 2 ** timeouts, opts.timeoutBackoff.capMs);
        timeouts++;
        await opts.sleep(wait);
      }
    }
  }
}
