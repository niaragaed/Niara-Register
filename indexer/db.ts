import { createClient } from "@supabase/supabase-js";
import { config } from "./config";
import { toTracked, type OfferingRow, type TrackedOffering } from "./offerings";
import type { EventData } from "./events";
import type { NewSolanaOffering, RegisteredSolanaOffering } from "./pmes-solana";

// Client with the service role key: the indexer needs to write straight to
// Postgres, bypassing any RLS that exists for the site's public client. Never
// reuse this key in the Niara-Register frontend (lib/supabase.ts there uses
// the anon key).
//
// Table and column names (registro_transacoes, tx_hash, ocorrido_em, ...) are
// the database schema and stay as they are.
export const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);

/**
 * In dry-run nothing is written: each write becomes an in-memory record, which
 * index.ts prints at the end. Reads (checkpoints, offerings) still go to the
 * real database.
 */
export const simulated = {
  entries: [] as NewLedgerEntry[],
  offerings: [] as NewOffering[],
};

export type NewLedgerEntry = {
  fonte: "pmes";
  /** Source network (migration 010). Missing = 'sepolia' (the column default). */
  rede?: "sepolia" | "solana-devnet";
  tipo_evento: string;
  descricao: string;
  tx_hash: string;
  log_index: number;
  endereco_contrato: string;
  /** EVM block; null on Solana. */
  bloco: number | null;
  /** Solana slot (missing on EVM). */
  slot?: number;
  ocorrido_em: string;
  confirmado: boolean;
  /**
   * Structured form of the event (see events.ts). Null for an event outside
   * the minimal ABI; the display has a fallback. `descricao` is still written
   * the same way, in parallel.
   */
  dados: EventData | null;
};

// onConflict on (tx_hash, log_index) guarantees idempotency: if the indexer
// crashes and reprocesses an already written block range, it does not
// duplicate the ledger row.
export async function saveLedgerEntry(entry: NewLedgerEntry): Promise<void> {
  if (config.dryRun) {
    const key = `${entry.tx_hash}#${entry.log_index}`;
    if (!simulated.entries.some((r) => `${r.tx_hash}#${r.log_index}` === key)) {
      simulated.entries.push(entry);
    }
    return;
  }

  const { error } = await supabase
    .from("registro_transacoes")
    .upsert(entry, { onConflict: "tx_hash,log_index", ignoreDuplicates: true });

  if (error) {
    throw new Error(`Failed to save ledger entry (${entry.tx_hash}#${entry.log_index}): ${error.message}`);
  }
}

export type NewSignature = {
  /** Source network (migration 005). */
  rede: "sepolia" | "base-sepolia" | "robinhood-testnet" | "hyperevm-testnet" | "tempo-testnet" | "solana-devnet";
  documento_nome: string;
  tipo_documento: string;
  /** Always "0x" + 64 lowercase hex characters, on every network. */
  hash_sha256: string;
  /** EVM: 0x… address; Solana: base58 public key. */
  assinante_endereco: string;
  /** EVM: transaction hash; Solana: transaction signature (base58). */
  tx_hash: string;
  log_index: number;
  /** EVM: RegistroAssinaturas contract; Solana: program ID. */
  endereco_contrato: string;
  /** EVM block (null on Solana). */
  bloco: number | null;
  /** Solana slot (missing on EVM). */
  slot?: number;
  assinado_em: string;
  status: "assinado_onchain";
};

// onConflict on (rede, hash_sha256): each contract/program only lets a hash be
// recorded once ON ITS NETWORK, so this constraint mirrors the same guarantee
// in the database (it avoids duplicates if the indexer reprocesses
// blocks/slots after a restart), without stopping the same document from
// having proof on two networks.
export async function saveSignature(record: NewSignature): Promise<void> {
  if (config.dryRun) {
    console.log(
      `[dry-run] signature that would be saved (${record.rede}): ${record.hash_sha256} — "${record.documento_nome}" — ${record.assinante_endereco}`,
    );
    return;
  }

  const { error } = await supabase
    .from("registro_assinaturas")
    .upsert(record, { onConflict: "rede,hash_sha256", ignoreDuplicates: true });

  if (error) {
    throw new Error(`Failed to save signature (${record.hash_sha256}): ${error.message}`);
  }
}

// ── Offerings (registro_ofertas, migration 004) ──────────────────────────────────

/**
 * The list of tracked offerings, read from the database every time the process
 * starts: it is what lets a discovered offering survive restarts. Empty means
 * migration 004 has not run (its seed brings the 11 legacy offerings): fail
 * loudly instead of silently indexing nothing.
 */
export async function loadOfferings(): Promise<TrackedOffering[]> {
  const { data, error } = await supabase
    .from("registro_ofertas")
    .select("endereco,token,numero,origem,empresa,bloco_criacao,backfill_alvo,backfill_ate")
    // Sepolia only: the Solana ones (migration 010) have their own loop
    // (pmes-solana.ts) and a base58 address, which must never go into an EVM getLogs.
    .eq("rede", "sepolia")
    .order("numero");

  if (error) {
    throw new Error(`Failed to load registro_ofertas (did migration 004 run?): ${error.message}`);
  }
  if (!data || data.length === 0) {
    throw new Error("registro_ofertas is empty — run supabase/migrations_004_offerings.sql.");
  }
  return (data as OfferingRow[]).map(toTracked);
}

export type NewOffering = {
  endereco: string;
  token: string;
  emissor: string;
  moeda: string;
  origem: "orquestrador";
  numero: number;
  nome: string | null;
  simbolo: string | null;
  empresa: string | null;
  bloco_criacao: number;
  criada_em: string;
  tx_criacao: string;
  backfill_alvo: number;
  backfill_ate: number;
};

/**
 * Saves an offering discovered through OfertaCompletaCriada. The number is
 * already decided by the caller (max + 1, in event order); the unique
 * constraint on `numero` and the PK on `endereco` stop a reprocess from
 * duplicating or renumbering it.
 */
export async function saveOffering(offering: NewOffering): Promise<void> {
  if (config.dryRun) {
    simulated.offerings.push(offering);
    return;
  }

  const { error } = await supabase
    .from("registro_ofertas")
    .upsert(offering, { onConflict: "endereco", ignoreDuplicates: true });

  if (error) {
    throw new Error(`Failed to save offering ${offering.endereco}: ${error.message}`);
  }
}

export function newOfferingToTracked(o: NewOffering): TrackedOffering {
  return toTracked(o);
}

/** Backfill progress of an offering (last block already scanned). */
export async function saveBackfill(address: string, until: number): Promise<void> {
  if (config.dryRun) return;

  const { error } = await supabase
    .from("registro_ofertas")
    .update({ backfill_ate: until })
    .eq("endereco", address.toLowerCase());

  if (error) {
    throw new Error(`Failed to save backfill of ${address}: ${error.message}`);
  }
}

// ── Checkpoints ──────────────────────────────────────────────────────────────────

export async function readCheckpoint(source: string, fallback: number): Promise<number> {
  const { data, error } = await supabase
    .from("registro_checkpoints")
    .select("ultimo_bloco")
    .eq("fonte", source)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read checkpoint (${source}): ${error.message}`);
  }

  return data?.ultimo_bloco === undefined || data?.ultimo_bloco === null
    ? fallback
    : Number(data.ultimo_bloco);
}

/** Saves the checkpoint of several sources in a single write. */
export async function saveCheckpoints(sources: string[], block: number): Promise<void> {
  if (config.dryRun || sources.length === 0) return;

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("registro_checkpoints")
    .upsert(sources.map((fonte) => ({ fonte, ultimo_bloco: block, atualizado_em: now })));

  if (error) {
    throw new Error(`Failed to save checkpoint (${sources.join(", ")}): ${error.message}`);
  }
}

// ── PMEs offerings on Solana (registro_ofertas with rede = 'solana-devnet', migration 010) ──

export async function loadSolanaOfferings(): Promise<RegisteredSolanaOffering[]> {
  const { data, error } = await supabase
    .from("registro_ofertas")
    .select("endereco,numero,empresa")
    .eq("rede", "solana-devnet")
    .order("numero");
  if (error) {
    throw new Error(`Failed to load Solana offerings (did migration 010 run?): ${error.message}`);
  }
  return (data ?? []) as RegisteredSolanaOffering[];
}

let simulatedNumber = 0;

/**
 * Saves the offering (idempotent by address) with the next Solana number: each
 * network has its own numbering (unique (rede, numero)), so it never competes
 * for a number with the Sepolia loop. If another process takes the same number
 * in between, it retries with the next one.
 */
export async function registerSolanaOffering(offering: NewSolanaOffering): Promise<number> {
  if (config.dryRun) return ++simulatedNumber;

  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: existing } = await supabase.from("registro_ofertas").select("numero").eq("endereco", offering.endereco).maybeSingle();
    if (existing) return Number(existing.numero);

    const { data: last, error: maxError } = await supabase
      .from("registro_ofertas")
      .select("numero")
      .eq("rede", "solana-devnet")
      .order("numero", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (maxError) throw new Error(`Failed to read the Solana offering numbering: ${maxError.message}`);
    const number = (last ? Number(last.numero) : 0) + 1;

    const { error } = await supabase.from("registro_ofertas").insert({ ...offering, numero: number, origem: "solana", rede: "solana-devnet" });
    if (!error) return number;
    if (error.code !== "23505") throw new Error(`Failed to save offering ${offering.endereco}: ${error.message}`);
  }
  throw new Error(`Could not number offering ${offering.endereco} after 5 attempts.`);
}
