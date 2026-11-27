import type { ExchangeConfig, ExchangeNetwork } from "./exchange-config";
import { readSafeHead } from "./exchange-evm";
import { createJsonRpc, type JsonRpc } from "./exchange-rpc";

/**
 * Chain head per network, for GET /v1/networks (head and lag).
 *
 * The API runs on every replica but only the lease holder indexes, so the head
 * is read from the RPC here instead of from the indexer's memory. The same
 * "safe head" the indexer scans up to: the `finalized` block (or latest −
 * confirmations) on EVM, the finalized slot on Solana. Cached for `ttlMs`
 * (concurrent calls share one request); on an RPC failure the last known value
 * is returned, or null if there never was one. Never throws.
 */
export function createHeadReader(
  cfg: ExchangeConfig,
  options: { ttlMs?: number; timeoutMs?: number; now?: () => number; rpcFor?: (url: string) => JsonRpc } = {},
): (network: ExchangeNetwork) => Promise<number | null> {
  const ttlMs = options.ttlMs ?? 30_000;
  const now = options.now ?? Date.now;
  const rpcFor = options.rpcFor ?? ((url: string) => createJsonRpc(url, { timeoutMs: options.timeoutMs ?? 4_000 }));
  const cache = new Map<ExchangeNetwork, { value: number | null; at: number }>();
  const inflight = new Map<ExchangeNetwork, Promise<number | null>>();

  async function fetchHead(network: ExchangeNetwork): Promise<number | null> {
    const s = cfg.sources.find((x) => x.network === network);
    if (!s || !cfg.indexerEnabled || !s.enabled || s.missing.length > 0) return null;
    const rpc = rpcFor(s.rpcUrl);
    if (s.kind === "solana") return Number(await rpc<number>("getSlot", [{ commitment: "finalized" }]));
    return readSafeHead(s, rpc);
  }

  return async (network) => {
    const hit = cache.get(network);
    if (hit && now() - hit.at < ttlMs) return hit.value;
    let pending = inflight.get(network);
    if (!pending) {
      pending = fetchHead(network)
        .then((value) => {
          cache.set(network, { value, at: now() });
          return value;
        })
        .catch(() => {
          // Keep the stale value, but retry only after the ttl so a dead RPC is not hammered.
          const value = hit?.value ?? null;
          cache.set(network, { value, at: now() });
          return value;
        })
        .finally(() => inflight.delete(network));
      inflight.set(network, pending);
    }
    return pending;
  };
}
