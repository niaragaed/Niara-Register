import { dictionaries } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/get-locale";
import { LookupForm } from "./lookup-form";

export default async function VerifyPage() {
  const locale = await getLocale();
  const dict = dictionaries[locale];
  return (
    <div className="mx-auto max-w-5xl px-6 py-14">
      <header className="border-b border-slate/15 pb-8">
        <p className="font-mono text-xs uppercase tracking-wide text-slate">{dict.verify.eyebrow}</p>
        <h1 className="mt-3 font-display text-3xl text-ink">{dict.verify.title}</h1>
        <p className="mt-3 max-w-xl font-body text-sm leading-relaxed text-slate">{dict.verify.lede}</p>
      </header>
      <LookupForm t={{ verify: dict.verify, register: dict.register }} />
    </div>
  );
}
