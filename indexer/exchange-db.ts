import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExchangeNetwork } from "./exchange-config";

/**
 * Register database access for the Exchange settlements
 * (supabase/migrations_016_exchange_settlements.sql). Writes use the service
 * role (index.ts); the read API uses the same client, read-only.
 *
 * numeric(78,0) columns are written as decimal strings and read back cast to
 * text (PostgREST would otherwise return them as JSON numbers and lose digits).
 */

export type SettlementRow = {
  network: ExchangeNetwork;
  tx_hash: string;
  log_index: number;
  block_number: number | null;
  slot: number | null;
  block_time: string;
  match_id: string;
  contract_address: string;
  asset_address: string;
  asset_symbol: string | null;
  asset_decimals: number;
  payment_address: string;
  payment_symbol: string | null;
  payment_decimals: number;
  base_quantity: string;
  lots: string;
  price: string;
  notional: string;
  fee: string;
  cashback: string;
  buyer: string;
  seller: string;
};

export type StoredSettlement = SettlementRow & { id: number; indexed_at: string };

export type ExchangeDb = {
  saveSettlements(rows: SettlementRow[]): Promise<void>;
  readCursor(source: string, fallback: number): Promise<number>;
  saveCursor(source: string, value: number): Promise<void>;
};

const SELECT_COLUMNS = [
  "id",
  "network",
  "tx_hash",
  "log_index",
  "block_number",
  "slot",
  "block_time",
  "match_id",
  "contract_address",
  "asset_address",
  "asset_symbol",
  "asset_decimals",
  "payment_address",
  "payment_symbol",
  "payment_decimals",
  "base_quantity::text",
  "lots::text",
  "price::text",
  "notional::text",
  "fee::text",
  "cashback::text",
  "buyer",
  "seller",
  "indexed_at",
].join(",");

export function createExchangeDb(supabase: SupabaseClient, opts: { dryRun?: boolean } = {}) {
  /** Idempotent: unique (network, tx_hash, log_index); a re-scan rewrites the same values. */
  async function saveSettlements(rows: SettlementRow[]): Promise<void> {
    if (rows.length === 0) return;
    if (opts.dryRun) {
      for (const r of rows) console.log(`[dry-run] exchange ${r.network}: settlement ${r.tx_hash}#${r.log_index} would be saved`);
      return;
    }
    const { error } = await supabase.from("exchange_settlements").upsert(rows, { onConflict: "network,tx_hash,log_index" });
    if (error) throw new Error(`Failed to save exchange settlements (${rows[0].network}): ${error.message}`);
  }

  async function readCursor(source: string, fallback: number): Promise<number> {
    const { data, error } = await supabase.from("registro_checkpoints").select("ultimo_bloco").eq("fonte", source).maybeSingle();
    if (error) throw new Error(`Failed to read cursor (${source}): ${error.message}`);
    return data?.ultimo_bloco == null ? fallback : Number(data.ultimo_bloco);
  }

  async function saveCursor(source: string, value: number): Promise<void> {
    if (opts.dryRun) return;
    const { error } = await supabase
      .from("registro_checkpoints")
      .upsert({ fonte: source, ultimo_bloco: value, atualizado_em: new Date().toISOString() });
    if (error) throw new Error(`Failed to save cursor (${source}): ${error.message}`);
  }

  // ── single-instance lease ──────────────────────────────────────────────────────

  async function tryLease(name: string, holder: string, ttlSeconds: number): Promise<boolean> {
    if (opts.dryRun) return true;
    const { data, error } = await supabase.rpc("exchange_indexer_try_lease", {
      p_name: name,
      p_holder: holder,
      p_ttl_seconds: ttlSeconds,
    });
    if (error) throw new Error(`Failed to take the exchange indexer lease: ${error.message}`);
    return data === true;
  }

  async function releaseLease(name: string, holder: string): Promise<void> {
    if (opts.dryRun) return;
    await supabase.rpc("exchange_indexer_release_lease", { p_name: name, p_holder: holder });
  }

  // ── reads for the public API ───────────────────────────────────────────────────

  async function listSettlements(q: {
    network?: ExchangeNetwork;
    limit: number;
    /** Exclusive keyset: rows strictly older than (block_time, id). */
    before?: { blockTime: string; id: number };
  }): Promise<StoredSettlement[]> {
    let query = supabase
      .from("exchange_settlements")
      .select(SELECT_COLUMNS)
      .order("block_time", { ascending: false })
      .order("id", { ascending: false })
      .limit(q.limit);
    if (q.network) query = query.eq("network", q.network);
    if (q.before) {
      // Double-quoted: a timestamp has ':' and '+', which PostgREST's or() syntax reserves.
      const t = `"${q.before.blockTime}"`;
      query = query.or(`block_time.lt.${t},and(block_time.eq.${t},id.lt.${q.before.id})`);
    }
    const { data, error } = await query;
    if (error) throw new Error(`Failed to list exchange settlements: ${error.message}`);
    return (data ?? []) as unknown as StoredSettlement[];
  }

  async function settlementsOfTx(network: ExchangeNetwork, txHash: string): Promise<StoredSettlement[]> {
    const { data, error } = await supabase
      .from("exchange_settlements")
      .select(SELECT_COLUMNS)
      .eq("network", network)
      .eq("tx_hash", txHash)
      .order("log_index");
    if (error) throw new Error(`Failed to read exchange settlement: ${error.message}`);
    return (data ?? []) as unknown as StoredSettlement[];
  }

  async function readCursors(sources: string[]): Promise<Map<string, { value: number; updatedAt: string }>> {
    const { data, error } = await supabase.from("registro_checkpoints").select("fonte,ultimo_bloco,atualizado_em").in("fonte", sources);
    if (error) throw new Error(`Failed to read cursors: ${error.message}`);
    return new Map(
      (data ?? []).map((r: { fonte: string; ultimo_bloco: number; atualizado_em: string }) => [
        r.fonte,
        { value: Number(r.ultimo_bloco), updatedAt: r.atualizado_em },
      ]),
    );
  }

  return { saveSettlements, readCursor, saveCursor, tryLease, releaseLease, listSettlements, settlementsOfTx, readCursors };
}

export type ExchangeDbClient = ReturnType<typeof createExchangeDb>;
