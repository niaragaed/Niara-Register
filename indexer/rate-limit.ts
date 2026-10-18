/**
 * RPC rate limit (HTTP 429 / Alchemy's "compute units per second").
 *
 * ethers retries 429 on its own, silently (up to 12 attempts), and only then
 * throws: the whole cycle used to abort with no clear signal in the log. The
 * indexer's provider turns that internal retry off (see index.ts) and calls go
 * through `withBackoff`: capped exponential wait, with one log line per wait.
 * If the attempts run out, the error goes up to the caller, which gives up on
 * that part of the cycle only.
 *
 * Messages go out through the console, so they pass through the mask in
 * safe-log.ts.
 */

export function isRateLimit(error: unknown): boolean {
  // A wrapped error (e.g. "Failed to read decimals()…" in tokens.ts) carries the
  // original in `cause`.
  const cause = (error as { cause?: unknown })?.cause;
  if (cause && cause !== error && isRateLimit(cause)) return true;
  const e = error as {
    info?: { responseStatus?: string };
    error?: { code?: number; message?: string };
    shortMessage?: string;
    message?: string;
  };
  if (e?.info?.responseStatus?.startsWith("429")) return true;
  // Some providers answer 200 with the error in the JSON-RPC body.
  if (e?.error?.code === 429 || e?.error?.code === -32005) return true;
  const text = `${e?.shortMessage ?? ""} ${e?.message ?? ""} ${e?.error?.message ?? ""}`;
  return /\b429\b|too many requests|compute units|rate limit|exceeded its/i.test(text);
}

export type BackoffOptions = {
  attempts: number;
  baseMs: number;
  capMs: number;
  sleep: (ms: number) => Promise<void>;
};

export async function withBackoff<T>(
  fn: () => Promise<T>,
  context: string,
  options: BackoffOptions,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!isRateLimit(error) || attempt >= options.attempts) throw error;
      const wait = Math.min(options.baseMs * 2 ** (attempt - 1), options.capMs);
      console.warn(
        `[indexer] RPC rate limit (429) on ${context} — attempt ${attempt}/${options.attempts}, retrying in ${(wait / 1000).toFixed(1)}s:`,
        (error as { shortMessage?: string; message?: string }).shortMessage ?? (error as Error).message,
      );
      await options.sleep(wait);
    }
  }
}
