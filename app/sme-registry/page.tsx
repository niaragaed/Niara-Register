import { LedgerEntry } from "@/components/ledger-entry";
import { supabase, supabaseConfigurado } from "@/lib/supabase";
import type { RegistroTransacao } from "@/lib/supabase";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/get-locale";
export const dynamic = "force-dynamic";
export default async function RegistroPmesPage() {
  const locale = await getLocale();
  const t = dictionaries[locale];

  // Lê direto da tabela indexada pelo Register — nunca gerada na hora.
  // Se as variáveis de ambiente do Supabase ainda não estiverem configuradas
  // neste ambiente, cai no estado vazio abaixo em vez de mostrar erro cru.
  const { data, error } = supabaseConfigurado
    ? await supabase
        .from("registro_transacoes")
        .select("*")
        .eq("fonte", "pmes")
        .order("numero_sequencial", { ascending: false })
        .limit(50)
    : { data: null, error: null };

  const registros = (data ?? []) as RegistroTransacao[];
  const indexadorDesconectado = !supabaseConfigurado || Boolean(error);

  return (
    <div className="mx-auto max-w-5xl px-6 py-14">
      <header className="border-b border-slate/15 pb-8">
        <p className="font-mono text-xs uppercase tracking-wide text-slate">
          {t.pmes.eyebrow}
        </p>
        <h1 className="mt-3 font-display text-3xl text-ink">{t.pmes.title}</h1>
        <p className="mt-3 max-w-xl font-body text-sm leading-relaxed text-slate">
          {t.pmes.lede}
        </p>
      </header>

      {registros.length > 0 ? (
        <div className="mt-2">
          {registros.map((registro) => (
            <LedgerEntry key={registro.id} registro={registro} locale={locale} />
          ))}
        </div>
      ) : (
        <div className="mt-10 border border-dashed border-slate/30 px-6 py-10">
          <p className="font-body text-sm text-slate">
            {indexadorDesconectado ? t.pmes.desconectado : t.pmes.vazio}
          </p>
        </div>
      )}
    </div>
  );
}
