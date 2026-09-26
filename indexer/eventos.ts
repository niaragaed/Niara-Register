import { ethers } from "ethers";
import { ESTADO_LABELS } from "./abi";
import type { OfertaMonitorada } from "./config";
import type { Decimais } from "./decimais";

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
 * decimais lidas do próprio token on-chain (ver decimais.ts) — não com um 18
 * assumido. Número em JSON é double e perderia precisão em valores grandes;
 * string atravessa o Postgres, o JSON e o JS sem arredondar.
 *
 * MANTER EM SINCRONIA COM lib/dados-evento.ts, o espelho usado pelo site. Os
 * dois projetos têm tsconfig e dependências separados (o site exclui indexer/),
 * então o tipo é duplicado de propósito.
 */

export type Moeda = "MockBRL";

/** Comum a todos: qual oferta emitiu o evento. */
type Base = {
  /** Do mapa explícito em config.ts. `null` para endereço fora do mapa. */
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

export type DadosEvento =
  | DadosInvestment
  | DadosOfferingClosed
  | DadosOfferingCancelled
  | DadosSharesRedeemed
  | DadosFundsReleased
  | DadosRefund;

const MOEDA: Moeda = "MockBRL";

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
  decimais: Decimais,
): Promise<DadosEvento | null> {
  const base: Base = {
    ofertaNumero: oferta.numero,
    ofertaEndereco: oferta.endereco,
  };

  // Só busca as casas decimais do token que o evento realmente usa: eventos de
  // valor consultam a moeda, o de cotas consulta o token de participação.
  const emMoeda = async (v: unknown) =>
    ethers.formatUnits(v as bigint, await decimais.daMoeda(oferta.endereco));

  switch (parsed.name) {
    case "Aporte":
      return {
        ...base,
        evento: "investment",
        investidor: parsed.args.investidor as string,
        valor: await emMoeda(parsed.args.valor),
        moeda: MOEDA,
        totalArrecadadoAtual: await emMoeda(parsed.args.totalArrecadadoAtual),
      };

    case "OfertaEncerrada":
      return {
        ...base,
        evento: "offering_closed",
        desfecho: desfechoDe(parsed.args.resultado),
        totalArrecadado: await emMoeda(parsed.args.totalArrecadado),
        moeda: MOEDA,
      };

    case "OfertaCancelada":
      return { ...base, evento: "offering_cancelled" };

    case "CotasResgatadas": {
      const casas = await decimais.doTokenDeCotas(oferta.endereco, oferta.token);
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
        moeda: MOEDA,
      };

    case "Reembolso":
      return {
        ...base,
        evento: "refund",
        investidor: parsed.args.investidor as string,
        valor: await emMoeda(parsed.args.valor),
        moeda: MOEDA,
      };

    default:
      return null;
  }
}
