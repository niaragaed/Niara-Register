import { dictionaries } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/get-locale";

export default async function Carregando() {
  const t = dictionaries[await getLocale()];

  return (
    <div className="mx-auto max-w-5xl px-6 py-14">
      <p className="font-mono text-xs uppercase tracking-wide text-slate">
        {t.carregando}
      </p>
    </div>
  );
}
