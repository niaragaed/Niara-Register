import type { SolanaExchangeConfig } from "./exchange-config";
import type { ExchangeDb, SettlementRow } from "./exchange-db";
import { decodeSolanaMint, decodeSolanaSettlements, lotsAndPrice, type RawSolanaTransaction } from "./exchange-decode";
import type { JsonRpc } from "./exchange-rpc";
import { withBackoff, type BackoffOptions } from "./rate-limit";

/**
 * Solana devnet Exchange settlement source: the niara_exchange program.
 *
 * Commitment "finalized" everywhere. Each cycle:
 * 1. Reads the finalized slot S (before listing, so the list covers it).
 * 2. getSignaturesForAddress(program), newest to oldest, back to the cursor.
 * 3. Oldest to newest, reads each successful transaction (encoding "json")
 *    and decodes the `Settled` events from its inner instructions
 *    (exchange-decode.ts). The cursor is saved each time a slot is complete.
 * 4. With nothing left, the cursor moves to S − SLOT_MARGIN (never back), so
 *    "last synced slot" advances on a quiet program. The margin covers an RPC
 *    pool whose nodes are a few slots apart; anything re-read is re-upserted
 *    unchanged.
 */

const PAGE_SIZE = 1000;
const SLOT_MARGIN = 150;

type SignatureInfo = { signature: string; slot: number; err: unknown };

export function createSolanaSettlementSource(deps: {
  cfg: SolanaExchangeConfig;
  rpc: JsonRpc;
  db: ExchangeDb;
  backoff: Omit<BackoffOptions, "sleep">;
  sleep: (ms: number) => Promise<void>;
}) {
  const { cfg, rpc, db } = deps;
  const options: BackoffOptions = { ...deps.backoff, sleep: deps.sleep };
  const net = <T,>(fn: () => Promise<T>, context: string) => withBackoff(fn, `exchange solana-devnet: ${context}`, options);

  let cursor = 0;
  const mints = new Map<string, { symbol: string | null; decimals: number }>();

  async function start(): Promise<void> {
    cursor = await db.readCursor(cfg.source, cfg.startSlot - 1);
  }

  async function newSignatures(): Promise<SignatureInfo[]> {
    const found: SignatureInfo[] = [];
    let before: string | undefined;
    for (;;) {
      const page = await net(
        () =>
          rpc<SignatureInfo[]>("getSignaturesForAddress", [
            cfg.programId,
            { limit: PAGE_SIZE, commitment: "finalized", ...(before ? { before } : {}) },
          ]),
        "getSignaturesForAddress",
      );
      let reached = false;
      for (const s of page) {
        if (s.slot <= cursor) {
          reached = true;
          break;
        }
        found.push(s);
      }
      if (reached || page.length < PAGE_SIZE) break;
      before = page[page.length - 1].signature;
    }
    return found.reverse();
  }

  async function mint(address: string) {
    const cached = mints.get(address);
    if (cached) return cached;
    const info = await net(
      () => rpc<{ value: unknown }>("getAccountInfo", [address, { encoding: "jsonParsed", commitment: "finalized" }]),
      `getAccountInfo ${address.slice(0, 8)}`,
    );
    const meta = decodeSolanaMint(info?.value);
    mints.set(address, meta);
    return meta;
  }

  async function rowsOf(signature: string): Promise<SettlementRow[]> {
    const tx = await net(
      () =>
        rpc<RawSolanaTransaction | null>("getTransaction", [
          signature,
          { encoding: "json", commitment: "finalized", maxSupportedTransactionVersion: 0 },
        ]),
      `getTransaction ${signature.slice(0, 8)}`,
    );
    if (!tx) throw new Error(`transaction ${signature} not returned at finalized commitment`);
    const decoded = decodeSolanaSettlements(tx, cfg.programId);
    if (decoded.length === 0) return [];
    if (tx.blockTime == null) throw new Error(`transaction ${signature} has no block time`);
    const rows: SettlementRow[] = [];
    for (const s of decoded) {
      const asset = await mint(s.asset);
      const payment = await mint(s.payment);
      const { lots, price } = lotsAndPrice(s.baseQuantity, s.notional, asset.decimals);
      rows.push({
        network: "solana-devnet",
        tx_hash: s.txHash,
        log_index: s.logIndex,
        block_number: null,
        slot: tx.slot,
        block_time: new Date(tx.blockTime * 1000).toISOString(),
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

  /** Throws on error; the cursor only covers slots fully processed. */
  async function cycle(): Promise<{ transactions: number; saved: number }> {
    const finalizedSlot = await net(() => rpc<number>("getSlot", [{ commitment: "finalized" }]), "getSlot");
    const found = await newSignatures();
    let saved = 0;
    for (let i = 0; i < found.length; i++) {
      const s = found[i];
      if (!s.err) {
        const rows = await rowsOf(s.signature);
        await db.saveSettlements(rows);
        saved += rows.length;
        for (const r of rows) {
          console.log(`[exchange] solana-devnet: settlement ${r.match_id} — ${r.lots} ${r.asset_symbol ?? r.asset_address} — slot ${r.slot} — ${r.tx_hash}`);
        }
      }
      const slotDone = i === found.length - 1 || found[i + 1].slot > s.slot;
      if (slotDone && s.slot > cursor) {
        await db.saveCursor(cfg.source, s.slot);
        cursor = s.slot;
      }
    }
    const quiet = finalizedSlot - SLOT_MARGIN;
    if (quiet > cursor) {
      await db.saveCursor(cfg.source, quiet);
      cursor = quiet;
    }
    return { transactions: found.length, saved };
  }

  return {
    start,
    cycle,
    get cursor() {
      return cursor;
    },
  };
}
