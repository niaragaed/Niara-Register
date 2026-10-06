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

/**
 * symbol() do token de pagamento da oferta, como o indexer leu da chain (hoje
 * "mBRL"). A exibição passa por `rotuloMoeda` (dicionário), que mostra "mBRL"
 * como "MockBRL".
 */
export type Moeda = string;

type Base = {
  /**
   * De registro_ofertas: 1–11 legadas, 12+ do orquestrador. Null só em linhas
   * gravadas antes da tabela existir.
   */
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

/** OfertaCompletaCriada: oferta criada pelo próprio emissor, via OfertaOrquestrador. */
export type DadosOfferingCreated = Base & {
  evento: "offering_created";
  emissor: string;
  token: string;
  metaMinima: string;
  metaMaxima: string;
  precoPorCota: string;
  /** Timestamp Unix (segundos) de encerramento, como string. */
  prazo: string;
  moeda: Moeda;
};

export type DadosEvento =
  | DadosOfferingCreated
  | DadosInvestment
  | DadosOfferingClosed
  | DadosOfferingCancelled
  | DadosSharesRedeemed
  | DadosFundsReleased
  | DadosRefund;

const EVENTOS = [
  "offering_created",
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
