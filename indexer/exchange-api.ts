import { createServer, type Server } from "node:http";
import { EXCHANGE_NETWORKS, isExchangeNetwork, type ExchangeConfig, type ExchangeNetwork } from "./exchange-config";
import type { ExchangeDbClient, StoredSettlement } from "./exchange-db";

/**
 * Public, read-only API over exchange_settlements. Served by the indexer
 * process on PORT (Railway), on every replica.
 *
 *   GET /v1/settlements?network=&limit=&cursor=   newest first, keyset pagination
 *   GET /v1/settlements/{network}/{tx}            every settlement of one transaction
 *   GET /v1/networks                              per network: configured, contract, last synced block/slot, chain head and lag
 *   GET /health
 *
 * CORS: only the origins in API_CORS_ORIGINS get Access-Control-Allow-Origin
 * (the data is public; CORS only decides which sites' scripts may read it).
 * No cookies, no credentials, nothing but GET.
 */

export type ApiResponse = { status: number; headers: Record<string, string>; body: string };

type Deps = {
  cfg: ExchangeConfig;
  db: Pick<ExchangeDbClient, "listSettlements" | "settlementsOfTx" | "readCursors">;
  /** Chain head of a network (the block/slot the indexer scans up to), or null if unknown. Optional: without it head and lag are null. */
  head?: (network: ExchangeNetwork) => Promise<number | null>;
};

const EVM_TX = /^0x[0-9a-fA-F]{64}$/;
const SOLANA_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

/** Normalised transaction id for a network, or null if it is not one. */
export function normaliseTx(network: ExchangeNetwork, tx: string): string | null {
  if (network === "solana-devnet") return SOLANA_SIGNATURE.test(tx) ? tx : null;
  return EVM_TX.test(tx) ? tx.toLowerCase() : null;
}

export function encodeCursor(row: Pick<StoredSettlement, "block_time" | "id">): string {
  return Buffer.from(JSON.stringify([row.block_time, row.id])).toString("base64url");
}

export function decodeCursor(cursor: string): { blockTime: string; id: number } | null {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!Array.isArray(value) || value.length !== 2) return null;
    const [blockTime, id] = value;
    if (typeof blockTime !== "string" || Number.isNaN(Date.parse(blockTime)) || !Number.isSafeInteger(id) || id < 1) return null;
    return { blockTime, id };
  } catch {
    return null;
  }
}

export function toApiSettlement(r: StoredSettlement) {
  return {
    network: r.network,
    txHash: r.tx_hash,
    logIndex: r.log_index,
    blockNumber: r.block_number == null ? null : Number(r.block_number),
    slot: r.slot == null ? null : Number(r.slot),
    blockTime: new Date(r.block_time).toISOString(),
    matchId: r.match_id,
    contract: r.contract_address,
    asset: { address: r.asset_address, symbol: r.asset_symbol, decimals: r.asset_decimals },
    payment: { address: r.payment_address, symbol: r.payment_symbol, decimals: r.payment_decimals },
    /** Integers in base units, as strings. */
    baseQuantity: r.base_quantity,
    notional: r.notional,
    fee: r.fee,
    cashback: r.cashback,
    sellerReceives: (BigInt(r.notional) - BigInt(r.fee)).toString(),
    /** One lot = one whole token; price = notional per lot, in payment base units. */
    lots: r.lots,
    price: r.price,
    buyer: r.buyer,
    seller: r.seller,
  };
}

export type ApiSettlement = ReturnType<typeof toApiSettlement>;

export function createApiHandler(deps: Deps) {
  const allowed = new Set(deps.cfg.api.corsOrigins);

  function respond(status: number, payload: unknown, origin: string | undefined, cacheSeconds = 0): ApiResponse {
    const headers: Record<string, string> = {
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
      "cache-control": cacheSeconds > 0 ? `public, max-age=${cacheSeconds}` : "no-store",
      vary: "Origin",
    };
    if (origin && allowed.has(origin)) headers["access-control-allow-origin"] = origin;
    return { status, headers, body: JSON.stringify(payload) };
  }

  return async function handle(method: string, rawUrl: string, origin?: string): Promise<ApiResponse> {
    if (method === "OPTIONS") {
      const r = respond(204, null, origin);
      r.body = "";
      if (r.headers["access-control-allow-origin"]) {
        r.headers["access-control-allow-methods"] = "GET, OPTIONS";
        r.headers["access-control-max-age"] = "600";
      }
      return r;
    }
    if (method !== "GET" && method !== "HEAD") return respond(405, { error: "method not allowed" }, origin);

    const url = new URL(rawUrl, "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);

    try {
      if (url.pathname === "/health") return respond(200, { ok: true }, origin);

      if (parts[0] === "v1" && parts[1] === "networks" && parts.length === 2) {
        const sources = deps.cfg.sources;
        const cursors = await deps.db.readCursors(sources.map((s) => s.source));
        const heads = await Promise.all(EXCHANGE_NETWORKS.map((network) => (deps.head ? deps.head(network).catch(() => null) : null)));
        const networks = EXCHANGE_NETWORKS.map((network, i) => {
          const s = sources.find((x) => x.network === network)!;
          const c = cursors.get(s.source);
          const active = deps.cfg.indexerEnabled && s.enabled && s.missing.length === 0;
          const head = active ? heads[i] : null;
          return {
            network,
            indexed: active,
            contract: s.missing.length === 0 ? (s.kind === "solana" ? s.programId : s.settlement) : null,
            unit: s.kind === "solana" ? "slot" : "block",
            lastSynced: c ? c.value : null,
            /** Block/slot the indexer scans up to (finalized), or null if unknown. */
            head,
            /** Units still to scan: head − lastSynced, never negative; null if either is unknown. */
            lag: head !== null && c ? Math.max(0, head - c.value) : null,
            syncedAt: c ? new Date(c.updatedAt).toISOString() : null,
          };
        });
        return respond(200, { networks }, origin, 15);
      }

      if (parts[0] === "v1" && parts[1] === "settlements" && parts.length === 2) {
        const network = url.searchParams.get("network") || undefined;
        if (network && !isExchangeNetwork(network)) return respond(400, { error: "unknown network" }, origin);
        const limitRaw = url.searchParams.get("limit");
        const limit = limitRaw ? Number(limitRaw) : DEFAULT_LIMIT;
        if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return respond(400, { error: `limit must be 1–${MAX_LIMIT}` }, origin);
        const cursorRaw = url.searchParams.get("cursor");
        const before = cursorRaw ? decodeCursor(cursorRaw) : undefined;
        if (cursorRaw && !before) return respond(400, { error: "invalid cursor" }, origin);

        // One extra row tells whether there is a next page.
        const rows = await deps.db.listSettlements({ network: network as ExchangeNetwork | undefined, limit: limit + 1, before: before ?? undefined });
        const page = rows.slice(0, limit);
        const nextCursor = rows.length > limit ? encodeCursor(page[page.length - 1]) : null;
        return respond(200, { items: page.map(toApiSettlement), nextCursor }, origin, 15);
      }

      if (parts[0] === "v1" && parts[1] === "settlements" && parts.length === 4) {
        const [, , network, txRaw] = parts;
        if (!isExchangeNetwork(network)) return respond(400, { error: "unknown network" }, origin);
        let decoded: string;
        try {
          decoded = decodeURIComponent(txRaw);
        } catch {
          return respond(400, { error: "invalid transaction id for this network" }, origin);
        }
        const tx = normaliseTx(network, decoded);
        if (!tx) return respond(400, { error: "invalid transaction id for this network" }, origin);
        const rows = await deps.db.settlementsOfTx(network, tx);
        if (rows.length === 0) return respond(404, { network, txHash: tx, indexed: false, items: [] }, origin, 15);
        return respond(200, { network, txHash: tx, indexed: true, items: rows.map(toApiSettlement) }, origin, 60);
      }

      return respond(404, { error: "not found" }, origin);
    } catch (error) {
      console.error("[api] request failed:", (error as Error).message);
      return respond(503, { error: "temporarily unavailable" }, origin);
    }
  };
}

export function startApiServer(deps: Deps): Server {
  const handle = createApiHandler(deps);
  const server = createServer(async (req, res) => {
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
    const r = await handle(req.method ?? "GET", req.url ?? "/", origin);
    res.writeHead(r.status, r.headers);
    res.end(req.method === "HEAD" ? undefined : r.body);
  });
  server.listen(deps.cfg.api.port, () => console.log(`[api] listening on port ${deps.cfg.api.port}`));
  server.on("error", (error) => console.error("[api] server error:", error.message));
  return server;
}
