import { ethers } from "ethers";
import { ESTADO_LABELS } from "./abi";
import type { OfertaMonitorada } from "./ofertas";
import type { LeitorTokens } from "./tokens";

/**
 * Forma estruturada de cada evento do ledger, gravada na coluna `dados` (jsonb)
 * de registro_transacoes.
 *
 * Regra: só valores neutros. Nada de texto em português aqui — endereços,
 * números como string e códigos em inglês. A frase é montada na exibição, em
 * cada idioma, a partir destes campos. A `descricao` continua sendo gravada
 * como está, para não quebrar nada que já dependa dela.
 *
 * Valores monetários e de cota vão como STRING, convertidos com as casas
 * decimais lidas do próprio token on-chain (ver tokens.ts) — não com um 18
 * assumido. Número em JSON é double e perderia precisão em valores grandes;
 * string atravessa o Postgres, o JSON e o JS sem arredondar.
 *
 * MANTER EM SINCRONIA COM lib/dados-evento.ts, o espelho usado pelo site. Os
 * dois projetos têm tsconfig e dependências separados (o site exclui indexer/),
 * então o tipo é duplicado de propósito.
 */

/**
 * symbol() do token de pagamento da oferta, lido da chain (ver tokens.ts) —
 * hoje "mBRL" nas duas MockBRL. Até a migration 004 era o literal "MockBRL";
 * a própria 004 converteu as linhas antigas. O site decide como exibir.
 */
export type Moeda = string;

/** Comum a todos: qual oferta emitiu o evento. */
type Base = {
  /**
   * De registro_ofertas: 1–11 legadas, 12+ do orquestrador. O tipo admite null
   * só por compatibilidade com linhas gravadas antes da tabela existir.
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
  /** Do enum Estado do contrato: 1 = EncerradaSucesso, 2 = EncerradaFalha. */
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

/**
 * OfertaCompletaCriada do OfertaOrquestrador: a oferta foi criada pelo próprio
 * emissor (msg.sender da transação), não pela plataforma. Metas e preço na
 * moeda da oferta; prazo é o timestamp Unix (segundos) de encerramento, como
 * string.
 */
export type DadosOfferingCreated = Base & {
  evento: "offering_created";
  emissor: string;
  token: string;
  metaMinima: string;
  metaMaxima: string;
  precoPorCota: string;
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

function desfechoDe(resultado: unknown): DadosOfferingClosed["desfecho"] {
  switch (ESTADO_LABELS[Number(resultado)]) {
    case "EncerradaSucesso":
      return "success";
    case "EncerradaFalha":
      return "failure";
    default:
      return "unknown";
  }
}

/**
 * Monta os dados estruturados a partir do log já decodificado pela ABI.
 * Devolve null para evento fora da nossa ABI mínima — nesse caso a linha fica
 * com `dados` nulo e a exibição cai no fallback.
 */
export async function montarDados(
  parsed: ethers.LogDescription,
  oferta: OfertaMonitorada,
  tokens: LeitorTokens,
): Promise<DadosEvento | null> {
  const base: Base = {
    ofertaNumero: oferta.numero,
    ofertaEndereco: oferta.endereco,
  };

  // Só busca as casas decimais do token que o evento realmente usa: eventos de
  // valor consultam a moeda, o de cotas consulta o token de participação.
  const emMoeda = async (v: unknown) =>
    ethers.formatUnits(v as bigint, await tokens.daMoeda(oferta.endereco));
  const moeda = () => tokens.simboloDaMoeda(oferta.endereco);

  switch (parsed.name) {
    case "Aporte":
      return {
        ...base,
        evento: "investment",
        investidor: parsed.args.investidor as string,
        valor: await emMoeda(parsed.args.valor),
        moeda: await moeda(),
        totalArrecadadoAtual: await emMoeda(parsed.args.totalArrecadadoAtual),
      };

    case "OfertaEncerrada":
      return {
        ...base,
        evento: "offering_closed",
        desfecho: desfechoDe(parsed.args.resultado),
        totalArrecadado: await emMoeda(parsed.args.totalArrecadado),
        moeda: await moeda(),
      };

    case "OfertaCancelada":
      return { ...base, evento: "offering_cancelled" };

    case "CotasResgatadas": {
      const casas = await tokens.doTokenDeCotas(oferta.endereco, oferta.token);
      return {
        ...base,
        evento: "shares_redeemed",
        investidor: parsed.args.investidor as string,
        cotas: ethers.formatUnits(parsed.args.cotas as bigint, casas),
      };
    }

    case "RecursosLiberados":
      return {
        ...base,
        evento: "funds_released",
        emissor: parsed.args.emissorWallet as string,
        valorEmissor: await emMoeda(parsed.args.valorEmissor),
        protocolo: parsed.args.protocoloWallet as string,
        taxa: await emMoeda(parsed.args.taxa),
        moeda: await moeda(),
      };

    case "Reembolso":
      return {
        ...base,
        evento: "refund",
        investidor: parsed.args.investidor as string,
        valor: await emMoeda(parsed.args.valor),
        moeda: await moeda(),
      };

    default:
      return null;
  }
}

/**
 * Dados da linha `offering_created`, a partir do OfertaCompletaCriada já
 * decodificado. `oferta` é a recém-registrada em registro_ofertas (já com
 * número); os valores usam as casas e o símbolo da moeda() dela.
 */
export async function montarDadosCriacao(
  parsed: ethers.LogDescription,
  oferta: OfertaMonitorada,
  tokens: LeitorTokens,
): Promise<DadosOfferingCreated> {
  const casas = await tokens.daMoeda(oferta.endereco);
  const emMoeda = (v: unknown) => ethers.formatUnits(v as bigint, casas);

  return {
    ofertaNumero: oferta.numero,
    ofertaEndereco: oferta.endereco,
    evento: "offering_created",
    emissor: parsed.args.emissor as string,
    token: parsed.args.token as string,
    metaMinima: emMoeda(parsed.args.metaMinima),
    metaMaxima: emMoeda(parsed.args.metaMaxima),
    precoPorCota: emMoeda(parsed.args.precoPorCota),
    prazo: (parsed.args.prazo as bigint).toString(),
    moeda: await tokens.simboloDaMoeda(oferta.endereco),
  };
}
