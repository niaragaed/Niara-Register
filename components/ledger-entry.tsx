import type { RegistroTransacao } from "@/lib/supabase";
import { dictionaries, rotuloEvento } from "@/lib/i18n/dictionaries";
import { formatarData } from "@/lib/i18n/formato";
import type { Locale } from "@/lib/i18n/locale";

function truncarHash(hash: string) {
  if (hash.length <= 14) return hash;
  return `${hash.slice(0, 8)}...${hash.slice(-4)}`;
}

export function LedgerEntry({
  registro,
  locale,
}: {
  registro: RegistroTransacao;
  locale: Locale;
}) {
  const t = dictionaries[locale];

  // O rótulo vem do mapa por idioma. A `descricao` é gravada em português pelo
  // indexer e nós não mexemos no banco, então ela só entra como fallback quando
  // o tipo de evento não estiver mapeado.
  const rotulo = rotuloEvento(t, registro.tipo_evento) ?? registro.descricao;

  // Em português a descrição continua aparecendo ao lado do rótulo, que é o
  // texto atual da página. Em inglês ela fica de fora: é texto em português
  // vindo do banco e não há como traduzi-lo sem reescrever o indexer.
  const detalhe = locale === "pt" ? registro.descricao : null;

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
