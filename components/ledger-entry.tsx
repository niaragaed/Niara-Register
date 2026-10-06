import type { RegistroTransacao } from "@/lib/supabase";
import { dictionaries, rotuloEvento } from "@/lib/i18n/dictionaries";
import { formatarData } from "@/lib/i18n/formato";
import type { Locale } from "@/lib/i18n/locale";
import { lerDadosEvento } from "@/lib/dados-evento";
import { FraseEvento } from "@/components/frase-evento";

function truncarHash(hash: string) {
  if (hash.length <= 14) return hash;
  return `${hash.slice(0, 8)}...${hash.slice(-4)}`;
}

export function LedgerEntry({
  registro,
  locale,
  empresas,
}: {
  registro: RegistroTransacao;
  locale: Locale;
  /** Empresa por endereço de oferta (minúsculo), de registro_ofertas. */
  empresas?: Map<string, string>;
}) {
  const t = dictionaries[locale];

  const rotulo = rotuloEvento(t, registro.tipo_evento) ?? registro.tipo_evento;

  // Caminho principal: a frase é montada a partir da coluna `dados`, em cada
  // idioma, com valor, oferta e endereços. Fallback para as linhas anteriores à
  // migration 003, que ainda têm `dados` nulo: em português sobra a `descricao`
  // gravada pelo indexer; em inglês ela não serve (está em português), então
  // fica só o rótulo do evento.
  const dados = lerDadosEvento(registro.dados);
  const detalhe = dados ? null : locale === "pt" ? registro.descricao : null;

  return (
    <div className="ledger-rule flex gap-5 py-5 pl-6">
      <div className="w-16 shrink-0 pt-0.5 font-mono text-xs text-slate">
        {t.entrada.numeroPrefixo}{" "}
        {String(registro.numero_sequencial).padStart(4, "0")}
      </div>
      <div className="flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="font-body text-[15px] text-ink">
            {rotulo}
            {dados && (
              <span className="text-slate">
                {" · "}
                <FraseEvento
                  dados={dados}
                  locale={locale}
                  empresa={empresas?.get(dados.ofertaEndereco.toLowerCase())}
                />
              </span>
            )}
            {detalhe && <span className="text-slate"> · {detalhe}</span>}
          </p>
          <time className="font-mono text-xs text-slate">
            {formatarData(registro.ocorrido_em, locale)}
          </time>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          <span
            className={`font-mono text-xs ${
              registro.confirmado ? "text-moss" : "text-slate"
            }`}
          >
            {registro.confirmado
              ? t.entrada.confirmado
              : t.entrada.aguardandoConfirmacao}
          </span>
          <a
            href={`https://sepolia.etherscan.io/tx/${registro.tx_hash}`}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs text-brass underline decoration-brass/40 underline-offset-2 hover:decoration-brass"
          >
            {truncarHash(registro.tx_hash)} ↗ {t.entrada.verNaSepolia}
          </a>
        </div>
      </div>
    </div>
  );
}
