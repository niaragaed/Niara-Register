import { ethers } from "ethers";
import { STATE_LABELS } from "./abi";
import type { TrackedOffering } from "./offerings";
import type { TokenReader } from "./tokens";

/**
 * Structured form of each ledger event, stored in the `dados` (jsonb) column
 * of registro_transacoes.
 *
 * Rule: neutral values only. No Portuguese text here: addresses, numbers as
 * strings and English codes. The sentence is built at display time, in each
 * language, from these fields. The `descricao` column is still written as it
 * is, so as not to break anything that already depends on it.
 *
 * The jsonb keys (ofertaNumero, valor, totalArrecadado, ...) are part of the
 * stored data format and stay as they are; only the TypeScript names are in
 * English.
 *
 * Money and share amounts go as STRINGS, converted with the decimals read
 * from the on-chain token itself (see tokens.ts), not an assumed 18. A JSON
 * number is a double and would lose precision on large values; a string goes
 * through Postgres, JSON and JS without rounding.
 *
 * KEEP IN SYNC WITH lib/event-data.ts, the mirror used by the site. The two
 * projects have separate tsconfigs and dependencies (the site excludes
 * indexer/), so the type is duplicated on purpose.
 */

/**
 * symbol() of the offering's payment token, read from the chain (see
 * tokens.ts): currently "mBRL" in both MockBRLs. Until migration 004 it was the
 * literal "MockBRL"; 004 itself converted the old rows. The site decides how to
 * display it.
 */
export type CurrencySymbol = string;

/** Common to all: which offering emitted the event. */
type Base = {
  /**
   * From registro_ofertas: 1–11 legacy, 12+ from the orchestrator. The type
   * allows null only for compatibility with rows written before the table
   * existed.
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
  /** From the contract's Estado enum: 1 = EncerradaSucesso, 2 = EncerradaFalha. */
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

/**
 * OfertaOrquestrador's OfertaCompletaCriada: the offering was created by the
 * issuer itself (the transaction's msg.sender), not by the platform. Targets
 * and price in the offering's currency; prazo is the closing Unix timestamp
 * (seconds), as a string.
 */
export type OfferingCreatedData = Base & {
  evento: "offering_created";
  emissor: string;
  token: string;
  metaMinima: string;
  metaMaxima: string;
  precoPorCota: string;
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

function outcomeOf(result: unknown): OfferingClosedData["desfecho"] {
  switch (STATE_LABELS[Number(result)]) {
    case "EncerradaSucesso":
      return "success";
    case "EncerradaFalha":
      return "failure";
    default:
      return "unknown";
  }
}

/**
 * Builds the structured data from a log already decoded by the ABI. Returns
 * null for an event outside our minimal ABI; in that case the row keeps a null
 * `dados` and the display falls back.
 */
export async function buildEventData(
  parsed: ethers.LogDescription,
  offering: TrackedOffering,
  tokens: TokenReader,
): Promise<EventData | null> {
  const base: Base = {
    ofertaNumero: offering.number,
    ofertaEndereco: offering.address,
  };

  // Only fetches the decimals of the token the event actually uses: amount
  // events query the currency, the share event queries the participation token.
  const inCurrency = async (v: unknown) =>
    ethers.formatUnits(v as bigint, await tokens.currencyDecimals(offering.address));
  const currency = () => tokens.currencySymbol(offering.address);

  switch (parsed.name) {
    case "Aporte":
      return {
        ...base,
        evento: "investment",
        investidor: parsed.args.investidor as string,
        valor: await inCurrency(parsed.args.valor),
        moeda: await currency(),
        totalArrecadadoAtual: await inCurrency(parsed.args.totalArrecadadoAtual),
      };

    case "OfertaEncerrada":
      return {
        ...base,
        evento: "offering_closed",
        desfecho: outcomeOf(parsed.args.resultado),
        totalArrecadado: await inCurrency(parsed.args.totalArrecadado),
        moeda: await currency(),
      };

    case "OfertaCancelada":
      return { ...base, evento: "offering_cancelled" };

    case "CotasResgatadas": {
      const decimals = await tokens.shareTokenDecimals(offering.address, offering.token);
      return {
        ...base,
        evento: "shares_redeemed",
        investidor: parsed.args.investidor as string,
        cotas: ethers.formatUnits(parsed.args.cotas as bigint, decimals),
      };
    }

    case "RecursosLiberados":
      return {
        ...base,
        evento: "funds_released",
        emissor: parsed.args.emissorWallet as string,
        valorEmissor: await inCurrency(parsed.args.valorEmissor),
        protocolo: parsed.args.protocoloWallet as string,
        taxa: await inCurrency(parsed.args.taxa),
        moeda: await currency(),
      };

    case "Reembolso":
      return {
        ...base,
        evento: "refund",
        investidor: parsed.args.investidor as string,
        valor: await inCurrency(parsed.args.valor),
        moeda: await currency(),
      };

    default:
      return null;
  }
}

/**
 * Data for the `offering_created` row, from an already decoded
 * OfertaCompletaCriada. `offering` is the one just registered in
 * registro_ofertas (already numbered); the amounts use the decimals and symbol
 * of its moeda().
 */
export async function buildCreationData(
  parsed: ethers.LogDescription,
  offering: TrackedOffering,
  tokens: TokenReader,
): Promise<OfferingCreatedData> {
  const decimals = await tokens.currencyDecimals(offering.address);
  const inCurrency = (v: unknown) => ethers.formatUnits(v as bigint, decimals);

  return {
    ofertaNumero: offering.number,
    ofertaEndereco: offering.address,
    evento: "offering_created",
    emissor: parsed.args.emissor as string,
    token: parsed.args.token as string,
    metaMinima: inCurrency(parsed.args.metaMinima),
    metaMaxima: inCurrency(parsed.args.metaMaxima),
    precoPorCota: inCurrency(parsed.args.precoPorCota),
    prazo: (parsed.args.prazo as bigint).toString(),
    moeda: await tokens.currencySymbol(offering.address),
  };
}
