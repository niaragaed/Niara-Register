import Link from "next/link";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/get-locale";

export default async function NaoEncontrado() {
  const t = dictionaries[await getLocale()];

  return (
    <div className="mx-auto max-w-5xl px-6 py-24">
      <h1 className="font-display text-3xl text-ink">{t.naoEncontrado.titulo}</h1>
      <p className="mt-3 max-w-md font-body text-sm leading-relaxed text-slate">
        {t.naoEncontrado.texto}
      </p>
      <Link
        href="/"
        className="mt-8 inline-block border border-ink px-5 py-2.5 font-body text-sm text-ink transition-colors hover:bg-ink hover:text-bone"
      >
        {t.naoEncontrado.voltar}
      </Link>
    </div>
  );
}
