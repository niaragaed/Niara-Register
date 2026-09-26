import Link from "next/link";
import { NiaraGlobe } from "@/components/niara-globe";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/get-locale";

export default async function HomePage() {
  const t = dictionaries[await getLocale()];

  const areas = [
    { href: "/sme-registry", ...t.home.cards.pmes },
    { href: "/global-registry", ...t.home.cards.global },
    { href: "/signatures", ...t.home.cards.assinatura },
  ];

  return (
    <div className="mx-auto max-w-5xl px-6">
      {/* py-10 abaixo de lg: com py-20 o CTA caía 31px abaixo da dobra em
          360x800 (PT, o caso mais apertado). Reduzir o topo libera 40px e
          mantém o globo nos 150px. A partir de lg o py-20 de sempre. */}
      <section className="border-b border-slate/15 py-10 lg:py-20">
        <div className="flex flex-col lg:grid lg:grid-cols-12 lg:items-center lg:gap-8">
          <div className="lg:col-span-7">
            <p className="font-mono text-xs uppercase tracking-wide text-slate">
              {t.home.eyebrow}
            </p>
            <h1 className="mt-4 max-w-2xl font-display text-4xl leading-[1.15] text-ink sm:text-5xl lg:text-[2.5rem]">
              {t.home.headlineLine1}{" "}
              <span className="lg:block">{t.home.headlineLine2}</span>
            </h1>
            <p className="mt-5 max-w-xl font-body text-base leading-relaxed text-slate">
              {t.home.lede}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/sme-registry"
                className="border border-ink bg-ink px-5 py-2.5 font-body text-sm text-bone transition-opacity hover:opacity-85"
              >
                {t.home.ctaPmes}
              </Link>
              <Link
                href="/signatures"
                className="border border-ink px-5 py-2.5 font-body text-sm text-ink transition-colors hover:bg-ink hover:text-bone"
              >
                {t.home.ctaAssinatura}
              </Link>
            </div>
          </div>

          {/* Um <video> só: abaixo de lg o `order-first` sobe o globo para cima
              do título; a partir de lg o `lg:order-none` devolve a ordem do DOM
              e ele volta para a coluna da direita. O tamanho muda só por CSS. */}
          <div className="order-first mb-8 flex justify-center lg:order-none lg:col-span-5 lg:mb-0 lg:items-center">
            <NiaraGlobe />
          </div>
        </div>
      </section>

      <section className="grid gap-px border-b border-slate/15 bg-slate/15 py-px sm:grid-cols-3">
        {areas.map((area) => (
          <Link
            key={area.href}
            href={area.href}
            className="bg-bone px-6 py-8 transition-colors hover:bg-deep hover:text-bone"
          >
            <h2 className="font-display text-lg">{area.title}</h2>
            <p className="mt-2 font-body text-sm leading-relaxed opacity-80">
              {area.text}
            </p>
          </Link>
        ))}
      </section>
    </div>
  );
}
