import { createClient } from "@supabase/supabase-js";

// Niara-Register Supabase client.
// IMPORTANT (Niara group honesty rule): this database belongs to the Register
// (e.g. "niara-register-dev"), separate from the Niara-PMEs database.
// The Register is an INDEXER: it holds no balance and executes no transaction,
// it only mirrors what already happened on-chain. No data here may be made up
// or used to demonstrate something that did not really happen.
//
// Table and column names (registro_transacoes, tx_hash, ocorrido_em, ...) are
// the database schema and stay as they are.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// While the real credentials are not configured (.env.local), the client
// points at a non-existent project: calls fail in a controlled way (handled in
// the pages as "indexer not connected"), instead of breaking the build or
// pretending there is data.
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = createClient(
  supabaseUrl || "https://placeholder.supabase.co",
  supabaseAnonKey || "placeholder-anon-key"
);

// Origin of each displayed record: always explicit in the UI, never implicit.
export type LedgerSource = "pmes" | "exchange";

/** A registro_transacoes row. */
export type LedgerTransaction = {
  id: string;
  numero_sequencial: number;
  fonte: LedgerSource;
  tipo_evento: string;
  descricao: string;
  tx_hash: string;
  log_index: number;
  endereco_contrato: string;
  bloco: number;
  ocorrido_em: string;
  confirmado: boolean;
  /** Source network (migration 010). Missing before it: Sepolia. */
  rede?: "sepolia" | "solana-devnet";
  /** Solana slot (bloco is null there). */
  slot?: number | null;
  /**
   * Structured form of the event, written by the indexer (see
   * lib/event-data.ts). `unknown` because it comes from a jsonb column:
   * consumers validate it with `parseEventData` before use. Null in rows from
   * before migration 003.
   */
  dados: unknown;
};

/** A registro_ofertas row (migration 004): an offering tracked by the indexer. */
export type OfferingRow = {
  endereco: string;
  token: string;
  emissor: string;
  moeda: string;
  origem: "legado" | "orquestrador" | "solana";
  numero: number;
  nome: string | null;
  simbolo: string | null;
  empresa: string | null;
  bloco_criacao: number;
  criada_em: string;
  tx_criacao: string | null;
};

/** A registro_assinaturas row. */
export type SignatureRow = {
  id: string;
  /**
   * Source network (migration 005). Missing before the migration: treat it as
   * "sepolia", which was the only network.
   */
  rede?: "sepolia" | "base-sepolia" | "robinhood-testnet" | "hyperevm-testnet" | "tempo-testnet" | "solana-devnet";
  /** Solana slot; null in the Sepolia rows. */
  slot?: number | null;
  documento_nome: string;
  tipo_documento: string | null;
  hash_sha256: string;
  assinante_endereco: string;
  tx_hash: string | null;
  log_index: number | null;
  endereco_contrato: string | null;
  bloco: number | null;
  assinado_em: string | null;
  status: "pendente" | "assinado_onchain";
};

/** A registro_assinaturas_v2 row (migration 011): no name or type, by design. */
export type SignatureV2Row = {
  id: string;
  rede: "sepolia" | "base-sepolia" | "robinhood-testnet" | "hyperevm-testnet" | "tempo-testnet" | "solana-devnet";
  hash_registro: string;
  esquema_hash: 0 | 1;
  compromisso_metadados: string;
  assinante_endereco: string;
  recibo_id: string;
  tx_hash: string;
  log_index: number;
  endereco_contrato: string;
  bloco: number | null;
  slot: number | null;
  assinado_em: string;
};
