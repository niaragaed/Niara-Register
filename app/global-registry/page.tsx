import { dictionaries } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/get-locale";

export default async function GlobalRegistryPage() {
  // Deliberately no indexer connected yet: the Niara Exchange only has
  // contracts deployed and tested locally, with no real transaction on
  // Sepolia. Showing any data here would break the Niara group's honesty
  // rule. This page will fill itself once the Exchange really operates, not
  // before.
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
        <p className="font-body text-sm text-ink">{t.global.emptyTitle}</p>
        <p className="mt-2 max-w-md font-body text-sm leading-relaxed text-slate">
          {t.global.emptyText}
        </p>
      </div>
    </div>
  );
}
