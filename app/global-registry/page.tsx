import { dictionaries } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/get-locale";

export default async function RegistroGlobalPage() {
  // Área deliberadamente sem indexer ligado ainda: a Niara Exchange só tem
  // contratos deployados e testados localmente, sem transação real na
  // Sepolia. Mostrar qualquer dado aqui violaria a regra de honestidade do
  // grupo Niara. Esta página populará sozinha quando a Exchange operar de
  // verdade — não antes.
  const t = dictionaries[await getLocale()];

  return (
    <div className="mx-auto max-w-5xl px-6 py-14">
      <header className="border-b border-slate/15 pb-8">
        <p className="font-mono text-xs uppercase tracking-wide text-slate">
          {t.global.eyebrow}
        </p>
        <h1 className="mt-3 font-display text-3xl text-ink">{t.global.title}</h1>
        <p className="mt-3 max-w-xl font-body text-sm leading-relaxed text-slate">
          {t.global.lede}
        </p>
      </header>

      <div className="mt-10 border border-dashed border-slate/30 px-6 py-10">
        <p className="font-body text-sm text-ink">{t.global.vazioTitulo}</p>
        <p className="mt-2 max-w-md font-body text-sm leading-relaxed text-slate">
          {t.global.vazioTexto}
        </p>
      </div>
    </div>
  );
}
