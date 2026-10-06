// Tipo e helpers puros das ofertas monitoradas. Separados de config.ts para
// poderem ser importados sem exigir as variáveis de ambiente (ex.: no teste
// do indexador, que roda com RPC e banco falsos).

export type OfertaMonitorada = {
  /** Sempre minúsculo — é a chave usada para casar com log.address. */
  endereco: `0x${string}`;
  token: `0x${string}` | null;
  /** De registro_ofertas: 1–11 legadas, 12+ do orquestrador, em ordem de criação. */
  numero: number;
  apelido: string;
  origem: "legado" | "orquestrador";
  empresa: string | null;
  bloco_criacao: number;
  /**
   * Backfill dos eventos anteriores à entrada da oferta no lote (só
   * orquestrador). Pendente enquanto backfill_ate < backfill_alvo.
   */
  backfill_alvo: number | null;
  backfill_ate: number | null;
};

export function apelidoDaOferta(endereco: string, numero: number): string {
  return `oferta-${numero} (${endereco.slice(0, 6)}...${endereco.slice(-4)})`;
}

/** Linha de registro_ofertas, como o banco devolve ou o indexador grava. */
export type LinhaOferta = {
  endereco: string;
  token: string;
  numero: number;
  origem: "legado" | "orquestrador";
  empresa: string | null;
  bloco_criacao: number;
  backfill_alvo: number | null;
  backfill_ate: number | null;
};

export function paraMonitorada(l: LinhaOferta): OfertaMonitorada {
  return {
    endereco: l.endereco.toLowerCase() as `0x${string}`,
    token: l.token.toLowerCase() as `0x${string}`,
    numero: l.numero,
    apelido: apelidoDaOferta(l.endereco, l.numero),
    origem: l.origem,
    empresa: l.empresa,
    bloco_criacao: Number(l.bloco_criacao),
    backfill_alvo: l.backfill_alvo === null ? null : Number(l.backfill_alvo),
    backfill_ate: l.backfill_ate === null ? null : Number(l.backfill_ate),
  };
}
