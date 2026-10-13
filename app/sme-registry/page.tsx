import { LedgerEntry } from "@/components/ledger-entry";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { OfferingRow, LedgerTransaction } from "@/lib/supabase";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/get-locale";
export const dynamic = "force-dynamic";
export default async function SmeRegistryPage() {
  const locale = await getLocale();
  const t = dictionaries[locale];

  // Reads straight from the table indexed by the Register, never generated on
  // the fly. If the Supabase environment variables are not configured yet in
  // this environment, it falls into the empty state below instead of a raw error.
  const [transactions, offeringsResponse] = isSupabaseConfigured
    ? await Promise.all([
        supabase
          .from("registro_transacoes")
          .select("*")
          .eq("fonte", "pmes")
          .order("numero_sequencial", { ascending: false })
          .limit(50),
        supabase.from("registro_ofertas").select("endereco,empresa"),
      ])
    : [null, null];
  const data = transactions?.data;
  const error = transactions?.error;
  const offeringsData = offeringsResponse?.data;

  const entries = (data ?? []) as LedgerTransaction[];

  // Company of each offering, for the ledger sentence. If registro_ofertas
  // fails, the sentences come out without a company; the ledger itself does
  // not depend on it.
  const companies = new Map(
    ((offeringsData ?? []) as Pick<OfferingRow, "endereco" | "empresa">[])
      .filter((o) => o.empresa)
      .map((o) => [o.endereco.toLowerCase(), o.empresa as string]),
  );
  const indexerDisconnected = !isSupabaseConfigured || Boolean(error);

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
        <p className="mt-2 max-w-xl font-body text-xs leading-relaxed text-slate/80">
          {t.pmes.numberingNote}
        </p>
      </header>

      {entries.length > 0 ? (
        <div className="mt-2">
          {entries.map((entry) => (
            <LedgerEntry
              key={entry.id}
              entry={entry}
              locale={locale}
              companies={companies}
            />
          ))}
        </div>
      ) : (
        <div className="mt-10 border border-dashed border-slate/30 px-6 py-10">
          <p className="font-body text-sm text-slate">
            {indexerDisconnected ? t.pmes.disconnected : t.pmes.empty}
          </p>
        </div>
      )}
    </div>
  );
}
