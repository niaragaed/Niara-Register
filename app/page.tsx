import Link from "next/link";
import { NiaraGlobe } from "@/components/niara-globe";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/get-locale";

export default async function HomePage() {
  const t = dictionaries[await getLocale()];

  const areas = [
    { href: "/sme-registry", ...t.home.cards.pmes },
    { href: "/global-registry", ...t.home.cards.global },
    { href: "/signatures", ...t.home.cards.signing },
  ];

  return (
    <div className="mx-auto max-w-5xl px-6">
      {/* py-10 below lg: with py-20 the CTA fell 31px below the fold at
          360x800 (PT, the tightest case). Reducing the top frees 40px and
          keeps the globe at 150px. From lg up, the usual py-20. */}
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
                {t.home.ctaSigning}
              </Link>
            </div>
          </div>

          {/* A single <video>: below lg, `order-first` moves the globe above
              the title; from lg up, `lg:order-none` restores the DOM order and
              it goes back to the right column. The size changes through CSS only. */}
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
