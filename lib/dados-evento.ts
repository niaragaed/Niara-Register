/**
 * Espelho de leitura da coluna `dados` (jsonb) de registro_transacoes.
 *
 * MANTER EM SINCRONIA COM indexer/eventos.ts, que é quem produz esses objetos.
 * Os dois projetos têm tsconfig e dependências separados (o site exclui
 * indexer/), então o tipo é duplicado de propósito. Ao mexer em um, mexer no
 * outro.
 *
 * Aqui só existe o tipo e a leitura: o site nunca constrói esses dados, só
 * consome o que o indexer gravou.
 */

export type Moeda = "MockBRL";

type Base = {
  /** Do mapa explícito em indexer/config.ts. `null` para oferta fora do mapa. */
  ofertaNumero: number | null;
  ofertaEndereco: string;
};

export type DadosInvestment = Base & {
  evento: "investment";
  investidor: string;
  valor: string;
  moeda: Moeda;
  totalArrecadadoAtual: string;
};

export type DadosOfferingClosed = Base & {
  evento: "offering_closed";
  desfecho: "success" | "failure" | "unknown";
  totalArrecadado: string;
  moeda: Moeda;
};

export type DadosOfferingCancelled = Base & {
  evento: "offering_cancelled";
};

export type DadosSharesRedeemed = Base & {
  evento: "shares_redeemed";
  investidor: string;
  cotas: string;
};

export type DadosFundsReleased = Base & {
  evento: "funds_released";
  emissor: string;
  valorEmissor: string;
  protocolo: string;
  taxa: string;
  moeda: Moeda;
};

export type DadosRefund = Base & {
  evento: "refund";
  investidor: string;
  valor: string;
  moeda: Moeda;
};

export type DadosEvento =
  | DadosInvestment
  | DadosOfferingClosed
  | DadosOfferingCancelled
  | DadosSharesRedeemed
  | DadosFundsReleased
  | DadosRefund;

const EVENTOS = [
  "investment",
  "offering_closed",
  "offering_cancelled",
  "shares_redeemed",
  "funds_released",
  "refund",
] as const;

/**
 * O que vem do banco é jsonb — pode ser null, pode ter sido gravado por uma
 * versão antiga do indexer, pode ter um evento que este site ainda não conhece.
 * Só devolve o objeto quando o discriminador é reconhecido; qualquer outra
 * coisa vira null e a exibição cai no fallback.
 */
export function lerDadosEvento(valor: unknown): DadosEvento | null {
  if (!valor || typeof valor !== "object") return null;
  const evento = (valor as { evento?: unknown }).evento;
  if (typeof evento !== "string") return null;
  if (!(EVENTOS as readonly string[]).includes(evento)) return null;
  return valor as DadosEvento;
}

/** Endereço no formato curto usado no ledger inteiro. */
export function enderecoCurto(endereco: string): string {
  return `${endereco.slice(0, 6)}…${endereco.slice(-4)}`;
}
