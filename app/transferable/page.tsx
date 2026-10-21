import { dictionaries } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/get-locale";
import { EtrPanel } from "./etr-panel";

export default async function TransferablePage() {
  const locale = await getLocale();
  const dict = dictionaries[locale];
  const t = dict.etr;
  return (
    <div className="mx-auto max-w-5xl px-6 py-14">
      <header className="border-b border-slate/15 pb-8">
        <p className="font-mono text-xs uppercase tracking-wide text-slate">{t.eyebrow}</p>
        <h1 className="mt-3 font-display text-3xl text-ink">{t.title}</h1>
        <p className="mt-3 max-w-xl font-body text-sm leading-relaxed text-slate">{t.lede}</p>
        <p className="mt-4 max-w-xl border-l-2 border-brass/60 pl-4 font-body text-xs leading-relaxed text-slate">
          {t.mletrNote}
        </p>
      </header>
      <EtrPanel t={{ etr: dict.etr, register: dict.register }} locale={locale} />
    </div>
  );
}
