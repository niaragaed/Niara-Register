import type { RegistroAssinatura } from "@/lib/supabase";
import { dictionaries, rotuloTipoDocumento } from "@/lib/i18n/dictionaries";
import { formatarData } from "@/lib/i18n/formato";
import type { Locale } from "@/lib/i18n/locale";

function truncarHash(hash: string) {
  if (hash.length <= 14) return hash;
  return `${hash.slice(0, 8)}...${hash.slice(-4)}`;
}

function truncarEndereco(endereco: string) {
  return `${endereco.slice(0, 6)}...${endereco.slice(-4)}`;
}

export function AssinaturaEntry({
  registro,
  locale,
}: {
  registro: RegistroAssinatura;
  locale: Locale;
}) {
  const t = dictionaries[locale];

  return (
    <div className="ledger-rule flex gap-5 py-5 pl-6">
      <div className="flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="font-body text-[15px] text-ink">
            {/* documento_nome é o dado gravado on-chain: aparece exatamente
                como foi registrado, em qualquer idioma. */}
            {registro.documento_nome}
            {registro.tipo_documento && (
              <span className="text-slate">
                {" · "}
                {rotuloTipoDocumento(t, registro.tipo_documento)}
              </span>
            )}
          </p>
          {registro.assinado_em && (
            <time className="font-mono text-xs text-slate">
              {formatarData(registro.assinado_em, locale)}
            </time>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          <span className="font-mono text-xs text-slate">
            {t.entrada.hash} {truncarHash(registro.hash_sha256)}
          </span>
          <span className="font-mono text-xs text-slate">
            {t.entrada.assinante} {truncarEndereco(registro.assinante_endereco)}
          </span>
          <span
            className={`font-mono text-xs ${
              registro.status === "assinado_onchain" ? "text-moss" : "text-slate"
            }`}
          >
            {registro.status === "assinado_onchain"
              ? t.entrada.assinadoOnchain
              : t.entrada.pendente}
          </span>
          {registro.tx_hash && (
            <a
              href={`https://sepolia.etherscan.io/tx/${registro.tx_hash}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-xs text-brass underline decoration-brass/40 underline-offset-2 hover:decoration-brass"
            >
              {truncarHash(registro.tx_hash)} ↗ {t.entrada.verNaSepolia}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
