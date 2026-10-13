import type { ReactNode } from "react";
import { dictionaries, currencyLabel } from "@/lib/i18n/dictionaries";
import { formatShares, formatTimestamp, formatAmount } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import { shortAddress, type EventData } from "@/lib/event-data";

/**
 * Builds the sentence of a ledger event from the `dados` column, in the
 * visitor's language.
 *
 * The text comes from the dictionary with {key} placeholders; here they are
 * replaced by React nodes, which lets addresses become a truncated explorer
 * link without chopping the sentence into separately translated pieces: word
 * order stays free for each language.
 */

export type LedgerNetwork = "sepolia" | "solana-devnet";

function addressLink(network: LedgerNetwork, value: string) {
  return network === "solana-devnet"
    ? `https://explorer.solana.com/address/${value}?cluster=devnet`
    : `https://sepolia.etherscan.io/address/${value}`;
}

function Address({ value, network }: { value: string; network: LedgerNetwork }) {
  return (
    <a
      href={addressLink(network, value)}
      target="_blank"
      rel="noreferrer"
      title={value}
      className="font-mono text-brass underline decoration-brass/40 underline-offset-2 hover:decoration-brass"
    >
      {shortAddress(value)}
    </a>
  );
}

/** Splits the template on the placeholders and injects the matching nodes. */
function fill(template: string, parts: Record<string, ReactNode>): ReactNode[] {
  return template.split(/(\{[a-zA-Z]+\})/).map((piece, i) => {
    const placeholder = /^\{([a-zA-Z]+)\}$/.exec(piece);
    if (!placeholder) return <span key={i}>{piece}</span>;
    const key = placeholder[1];
    // A placeholder with no matching value stays visible instead of silently
    // disappearing, so a mismatch between dictionary and data shows up in review.
    return <span key={i}>{parts[key] ?? piece}</span>;
  });
}

export function EventPhrase({
  data,
  locale,
  company,
  network = "sepolia",
}: {
  data: EventData;
  locale: Locale;
  /** The event's network: decides the explorer used for addresses. */
  network?: LedgerNetwork;
  /** From registro_ofertas; missing when the offering has no known company. */
  company?: string | null;
}) {
  const t = dictionaries[locale];

  // The offering is number + company (when there is one) + address; without a
  // number (a row from before registro_ofertas) only the address is left, with
  // no empty parentheses.
  const offering: ReactNode =
    data.ofertaNumero === null ? (
      <Address network={network} value={data.ofertaEndereco} />
    ) : (
      <>
        {data.ofertaNumero}
        {company ? ` · ${company}` : ""} (<Address network={network} value={data.ofertaEndereco} />)
      </>
    );

  const common: Record<string, ReactNode> = { offering };

  // The jsonb keeps the raw string from the chain; formatting with two decimals
  // and the language's separators happens only here, at display time.
  const num = (v: string) => formatAmount(v, locale);

  // The jsonb keeps the on-chain symbol() ("mBRL"); the screen label comes from
  // the dictionary ("MockBRL").
  const currency = "moeda" in data ? currencyLabel(t, data.moeda) : "";

  switch (data.evento) {
    case "offering_created":
      return (
        <>
          {fill(t.phrases.offering_created, {
            ...common,
            issuer: <Address network={network} value={data.emissor} />,
            minTarget: num(data.metaMinima),
            maxTarget: num(data.metaMaxima),
            pricePerShare: num(data.precoPorCota),
            deadline: formatTimestamp(Number(data.prazo), locale),
            currency,
          })}
        </>
      );

    case "investment":
      return (
        <>
          {fill(t.phrases.investment, {
            ...common,
            investor: <Address network={network} value={data.investidor} />,
            amount: num(data.valor),
            currency,
          })}
        </>
      );

    case "offering_closed":
      return (
        <>
          {fill(t.phrases.offering_closed, {
            ...common,
            outcome: t.outcomes[data.desfecho],
            totalRaised: num(data.totalArrecadado),
            currency,
          })}
        </>
      );

    case "offering_cancelled":
      return <>{fill(t.phrases.offering_cancelled, common)}</>;

    case "shares_redeemed":
      return (
        <>
          {fill(t.phrases.shares_redeemed, {
            ...common,
            investor: <Address network={network} value={data.investidor} />,
            shares: formatShares(data.cotas, locale),
          })}
        </>
      );

    case "funds_released":
      return (
        <>
          {fill(t.phrases.funds_released, {
            ...common,
            issuer: <Address network={network} value={data.emissor} />,
            issuerAmount: num(data.valorEmissor),
            protocol: <Address network={network} value={data.protocolo} />,
            fee: num(data.taxa),
            currency,
          })}
        </>
      );

    case "refund":
      return (
        <>
          {fill(t.phrases.refund, {
            ...common,
            investor: <Address network={network} value={data.investidor} />,
            amount: num(data.valor),
            currency,
          })}
        </>
      );
  }
}
