import type { ReactNode } from "react";
import { dictionaries, rotuloMoeda } from "@/lib/i18n/dictionaries";
import { formatarCotas, formatarTimestamp, formatarValor } from "@/lib/i18n/formato";
import type { Locale } from "@/lib/i18n/locale";
import { enderecoCurto, type DadosEvento } from "@/lib/dados-evento";

/**
 * Monta a frase de um evento do ledger a partir da coluna `dados`, no idioma
 * do visitante.
 *
 * O texto vem do dicionário com marcadores {chave}; aqui eles são trocados por
 * nós React, o que permite transformar endereços em link truncado para o
 * Etherscan sem picotar a frase em pedaços traduzidos separadamente — a ordem
 * das palavras fica livre para cada idioma.
 */

export type RedeLivro = "sepolia" | "solana-devnet";

function linkEndereco(rede: RedeLivro, valor: string) {
  return rede === "solana-devnet"
    ? `https://explorer.solana.com/address/${valor}?cluster=devnet`
    : `https://sepolia.etherscan.io/address/${valor}`;
}

function Endereco({ valor, rede }: { valor: string; rede: RedeLivro }) {
  return (
    <a
      href={linkEndereco(rede, valor)}
      target="_blank"
      rel="noreferrer"
      title={valor}
      className="font-mono text-brass underline decoration-brass/40 underline-offset-2 hover:decoration-brass"
    >
      {enderecoCurto(valor)}
    </a>
  );
}

/** Divide o template nos marcadores e injeta os nós correspondentes. */
function preencher(template: string, partes: Record<string, ReactNode>): ReactNode[] {
  return template.split(/(\{[a-zA-Z]+\})/).map((pedaco, i) => {
    const marcador = /^\{([a-zA-Z]+)\}$/.exec(pedaco);
    if (!marcador) return <span key={i}>{pedaco}</span>;
    const chave = marcador[1];
    // Marcador sem valor correspondente fica visível em vez de sumir calado —
    // assim um descompasso entre dicionário e dados aparece na revisão.
    return <span key={i}>{partes[chave] ?? pedaco}</span>;
  });
}

export function FraseEvento({
  dados,
  locale,
  empresa,
  rede = "sepolia",
}: {
  dados: DadosEvento;
  locale: Locale;
  /** Rede do evento — decide o explorador dos endereços. */
  rede?: RedeLivro;
  /** De registro_ofertas; ausente quando a oferta não tem empresa conhecida. */
  empresa?: string | null;
}) {
  const t = dictionaries[locale];

  // A oferta é número + empresa (quando há) + endereço; sem número (linha
  // anterior a registro_ofertas) sobra só o endereço, sem parênteses vazios.
  const oferta: ReactNode =
    dados.ofertaNumero === null ? (
      <Endereco rede={rede} valor={dados.ofertaEndereco} />
    ) : (
      <>
        {dados.ofertaNumero}
        {empresa ? ` · ${empresa}` : ""} (<Endereco rede={rede} valor={dados.ofertaEndereco} />)
      </>
    );

  const comuns: Record<string, ReactNode> = { oferta };

  // O jsonb guarda a string crua vinda da chain; a formatação com duas casas e
  // os separadores do idioma acontece só aqui, na exibição.
  const num = (v: string) => formatarValor(v, locale);

  // O jsonb guarda o symbol() on-chain ("mBRL"); o rótulo de tela vem do
  // dicionário ("MockBRL").
  const moeda = "moeda" in dados ? rotuloMoeda(t, dados.moeda) : "";

  switch (dados.evento) {
    case "offering_created":
      return (
        <>
          {preencher(t.frases.offering_created, {
            ...comuns,
            emissor: <Endereco rede={rede} valor={dados.emissor} />,
            metaMinima: num(dados.metaMinima),
            metaMaxima: num(dados.metaMaxima),
            precoPorCota: num(dados.precoPorCota),
            prazo: formatarTimestamp(Number(dados.prazo), locale),
            moeda,
          })}
        </>
      );

    case "investment":
      return (
        <>
          {preencher(t.frases.investment, {
            ...comuns,
            investidor: <Endereco rede={rede} valor={dados.investidor} />,
            valor: num(dados.valor),
            moeda,
          })}
        </>
      );

    case "offering_closed":
      return (
        <>
          {preencher(t.frases.offering_closed, {
            ...comuns,
            desfecho: t.desfechos[dados.desfecho],
            totalArrecadado: num(dados.totalArrecadado),
            moeda,
          })}
        </>
      );

    case "offering_cancelled":
      return <>{preencher(t.frases.offering_cancelled, comuns)}</>;

    case "shares_redeemed":
      return (
        <>
          {preencher(t.frases.shares_redeemed, {
            ...comuns,
            investidor: <Endereco rede={rede} valor={dados.investidor} />,
            cotas: formatarCotas(dados.cotas, locale),
          })}
        </>
      );

    case "funds_released":
      return (
        <>
          {preencher(t.frases.funds_released, {
            ...comuns,
            emissor: <Endereco rede={rede} valor={dados.emissor} />,
            valorEmissor: num(dados.valorEmissor),
            protocolo: <Endereco rede={rede} valor={dados.protocolo} />,
            taxa: num(dados.taxa),
            moeda,
          })}
        </>
      );

    case "refund":
      return (
        <>
          {preencher(t.frases.refund, {
            ...comuns,
            investidor: <Endereco rede={rede} valor={dados.investidor} />,
            valor: num(dados.valor),
            moeda,
          })}
        </>
      );
  }
}
