/**
 * Read-side mirror of the `dados` (jsonb) column of registro_transacoes.
 *
 * KEEP IN SYNC WITH indexer/events.ts, which produces these objects. The two
 * projects have separate tsconfigs and dependencies (the site excludes
 * indexer/), so the type is duplicated on purpose. When changing one, change
 * the other.
 *
 * Only the type and the read live here: the site never builds this data, it
 * only consumes what the indexer wrote. The jsonb keys (ofertaNumero, valor,
 * ...) are the stored data format and stay as they are.
 */

/**
 * symbol() of the offering's payment token, as the indexer read it from the
 * chain (currently "mBRL"). The display goes through `currencyLabel`
 * (dictionary), which shows "mBRL" as "MockBRL".
 */
export type CurrencySymbol = string;

type Base = {
  /**
   * From registro_ofertas: 1–11 legacy, 12+ from the orchestrator. Null only in
   * rows written before the table existed.
   */
  ofertaNumero: number | null;
  ofertaEndereco: string;
};

export type InvestmentData = Base & {
  evento: "investment";
  investidor: string;
  valor: string;
  moeda: CurrencySymbol;
  totalArrecadadoAtual: string;
};

export type OfferingClosedData = Base & {
  evento: "offering_closed";
  desfecho: "success" | "failure" | "unknown";
  totalArrecadado: string;
  moeda: CurrencySymbol;
};

export type OfferingCancelledData = Base & {
  evento: "offering_cancelled";
};

export type SharesRedeemedData = Base & {
  evento: "shares_redeemed";
  investidor: string;
  cotas: string;
};

export type FundsReleasedData = Base & {
  evento: "funds_released";
  emissor: string;
  valorEmissor: string;
  protocolo: string;
  taxa: string;
  moeda: CurrencySymbol;
};

export type RefundData = Base & {
  evento: "refund";
  investidor: string;
  valor: string;
  moeda: CurrencySymbol;
};

/** OfertaCompletaCriada: an offering created by the issuer itself, through OfertaOrquestrador. */
export type OfferingCreatedData = Base & {
  evento: "offering_created";
  emissor: string;
  token: string;
  metaMinima: string;
  metaMaxima: string;
  precoPorCota: string;
  /** Closing Unix timestamp (seconds), as a string. */
  prazo: string;
  moeda: CurrencySymbol;
};

export type EventData =
  | OfferingCreatedData
  | InvestmentData
  | OfferingClosedData
  | OfferingCancelledData
  | SharesRedeemedData
  | FundsReleasedData
  | RefundData;

const EVENT_KINDS = [
  "offering_created",
  "investment",
  "offering_closed",
  "offering_cancelled",
  "shares_redeemed",
  "funds_released",
  "refund",
] as const;

/**
 * What comes from the database is jsonb: it may be null, may have been written
 * by an older indexer version, may hold an event this site does not know yet.
 * Only returns the object when the discriminator is recognized; anything else
 * becomes null and the display falls back.
 */
export function parseEventData(value: unknown): EventData | null {
  if (!value || typeof value !== "object") return null;
  const kind = (value as { evento?: unknown }).evento;
  if (typeof kind !== "string") return null;
  if (!(EVENT_KINDS as readonly string[]).includes(kind)) return null;
  return value as EventData;
}

/** Address in the short format used across the whole ledger. */
export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
