// Type and pure helpers for the tracked offerings. Kept apart from config.ts so
// they can be imported without requiring the environment variables (e.g. in
// the indexer test, which runs with a fake RPC and database).

export type TrackedOffering = {
  /** Always lowercase: it is the key matched against log.address. */
  address: `0x${string}`;
  token: `0x${string}` | null;
  /** From registro_ofertas: 1–11 legacy, 12+ from the orchestrator, in creation order. */
  number: number;
  label: string;
  origin: "legado" | "orquestrador";
  company: string | null;
  creationBlock: number;
  /**
   * Backfill of the events before the offering joined the batch (orchestrator
   * offerings only). Pending while backfillUntil < backfillTarget.
   */
  backfillTarget: number | null;
  backfillUntil: number | null;
};

export function offeringLabel(address: string, number: number): string {
  return `oferta-${number} (${address.slice(0, 6)}...${address.slice(-4)})`;
}

/** A registro_ofertas row, as the database returns it or the indexer writes it. */
export type OfferingRow = {
  endereco: string;
  token: string;
  numero: number;
  origem: "legado" | "orquestrador";
  empresa: string | null;
  bloco_criacao: number;
  backfill_alvo: number | null;
  backfill_ate: number | null;
};

export function toTracked(row: OfferingRow): TrackedOffering {
  return {
    address: row.endereco.toLowerCase() as `0x${string}`,
    token: row.token.toLowerCase() as `0x${string}`,
    number: row.numero,
    label: offeringLabel(row.endereco, row.numero),
    origin: row.origem,
    company: row.empresa,
    creationBlock: Number(row.bloco_criacao),
    backfillTarget: row.backfill_alvo === null ? null : Number(row.backfill_alvo),
    backfillUntil: row.backfill_ate === null ? null : Number(row.backfill_ate),
  };
}
