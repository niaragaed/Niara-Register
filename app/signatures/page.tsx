import { VerificadorDeDocumento } from "./verificador";
import { AssinaturaEntry } from "@/components/assinatura-entry";
import { supabase, supabaseConfigurado } from "@/lib/supabase";
import type { RegistroAssinatura } from "@/lib/supabase";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/get-locale";
import { ID_PROGRAMA_SOLANA, linkExplorerSolana } from "@/lib/registro-solana";
import { REDES_EVM, linkEnderecoEvm } from "@/lib/registro-contract";
export const dynamic = "force-dynamic";
export default async function AssinaturaPage() {
  const locale = await getLocale();
  const t = dictionaries[locale];

  // Mesmo princípio do /sme-registry: lê direto da tabela indexada, nunca
  // gera dado na hora. Se o Supabase não estiver configurado nesta instância,
  // cai no estado vazio abaixo em vez de mostrar erro cru.
  const { data, error } = supabaseConfigurado
    ? await supabase
        .from("registro_assinaturas")
        .select("*")
        .order("assinado_em", { ascending: false })
        .limit(50)
    : { data: null, error: null };

  const registros = (data ?? []) as RegistroAssinatura[];
  const indexadorDesconectado = !supabaseConfigurado || Boolean(error);

  return (
    <div className="mx-auto max-w-5xl px-6 py-14">
      <header className="border-b border-slate/15 pb-8">
        <p className="font-mono text-xs uppercase tracking-wide text-slate">
          {t.assinatura.eyebrow}
        </p>
        <h1 className="mt-3 font-display text-3xl text-ink">
          {t.assinatura.title}
        </h1>
        <p className="mt-3 max-w-xl font-body text-sm leading-relaxed text-slate">
          {t.assinatura.lede}
        </p>
      </header>

      <div className="mt-10">
        {/* O verificador é o único client component que precisa de textos.
            Recebe só a sua fatia do dicionário por props — com um consumidor
            só, um provider de contexto seria peso sem ganho. */}
        <VerificadorDeDocumento t={t.verificador} locale={locale} />
      </div>

      <div className="mt-6 border border-dashed border-moss/40 px-6 py-6">
        <p className="font-body text-sm text-slate">
          {t.assinatura.contratoPrefixo}
          <a
            href="https://github.com/niaragaed/niara-contracts-Register"
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs text-brass underline decoration-brass/40 underline-offset-2 hover:decoration-brass"
          >
            niara-contracts-Register
          </a>
          {t.assinatura.contratoSufixo}
          <a
            href={linkEnderecoEvm("sepolia", REDES_EVM.sepolia.endereco)}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs text-brass underline decoration-brass/40 underline-offset-2 hover:decoration-brass"
          >
            Etherscan
          </a>
          {" · "}
          <a
            href={linkEnderecoEvm("base-sepolia", REDES_EVM["base-sepolia"].endereco)}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs text-brass underline decoration-brass/40 underline-offset-2 hover:decoration-brass"
          >
            BaseScan
          </a>
          {" · "}
          <a
            href={linkEnderecoEvm("robinhood-testnet", REDES_EVM["robinhood-testnet"].endereco)}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs text-brass underline decoration-brass/40 underline-offset-2 hover:decoration-brass"
          >
            Robinhood Explorer
          </a>
          {" · "}
          <a
            href={linkEnderecoEvm("hyperevm-testnet", REDES_EVM["hyperevm-testnet"].endereco)}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs text-brass underline decoration-brass/40 underline-offset-2 hover:decoration-brass"
          >
            Purrsec
          </a>
          .
        </p>
        <p className="mt-3 font-body text-sm text-slate">
          {t.assinatura.solanaPrefixo}
          <a
            href={linkExplorerSolana("address", ID_PROGRAMA_SOLANA.toBase58())}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs text-brass underline decoration-brass/40 underline-offset-2 hover:decoration-brass"
          >
            niara-register-solana
          </a>
          {t.assinatura.solanaSufixo}
        </p>
      </div>

      <div className="mt-14 border-t border-slate/15 pt-8">
        <h2 className="font-display text-xl text-ink">
          {t.assinatura.historicoTitulo}
        </h2>
        <p className="mt-2 max-w-xl font-body text-sm leading-relaxed text-slate">
          {t.assinatura.historicoLede}
        </p>

        {registros.length > 0 ? (
          <div className="mt-6">
            {registros.map((registro) => (
              <AssinaturaEntry
                key={registro.id}
                registro={registro}
                locale={locale}
              />
            ))}
          </div>
        ) : (
          <div className="mt-6 border border-dashed border-slate/30 px-6 py-10">
            <p className="font-body text-sm text-slate">
              {indexadorDesconectado
                ? t.assinatura.desconectado
                : t.assinatura.vazio}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
