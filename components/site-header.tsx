import Link from "next/link";
import { LanguageSwitcher } from "@/components/language-switcher";
import { dictionaries } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/locale";

export function SiteHeader({ locale }: { locale: Locale }) {
  const t = dictionaries[locale];

  // As rotas não mudam com o idioma — só os rótulos.
  const areas = [
    { href: "/sme-registry", label: t.nav.pmes },
    { href: "/global-registry", label: t.nav.global },
    { href: "/signatures", label: t.nav.assinatura },
  ];

  return (
    <header className="border-b border-slate/15 bg-bone">
      {/*
        Um DOM só, em duas formas.

        Abaixo de lg: primeira linha com a marca à esquerda e o seletor à
        direita; os três links descem juntos para uma segunda linha alinhada
        pela mesma margem da marca. Antes eles quebravam em três linhas
        desencontradas em inglês ("Document Signing" sobrava sozinho) e, pior,
        os rótulos longos empurravam a largura da página e criavam rolagem
        horizontal.

        A partir de lg: marca à esquerda, navegação e seletor à direita, que é
        exatamente o cabeçalho de sempre. A ordem é trocada por `order`, sem
        repetir nenhum elemento no HTML.
      */}
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-3 px-6 py-5 lg:flex-nowrap lg:gap-x-6">
        <Link href="/" className="order-1 flex items-baseline gap-2">
          <span className="font-display text-lg text-ink">{t.nav.brand}</span>
          <span className="font-body text-sm text-slate">{t.nav.product}</span>
        </Link>

        <div className="order-2 ml-auto lg:order-3 lg:ml-0">
          <LanguageSwitcher locale={locale} label={t.nav.languageLabel} />
        </div>

        <nav className="order-3 flex w-full flex-wrap gap-x-5 gap-y-1 lg:order-2 lg:ml-auto lg:w-auto lg:gap-x-6">
          {areas.map((area) => (
            <Link
              key={area.href}
              href={area.href}
              className="font-body text-xs text-slate transition-colors hover:text-ink sm:text-sm"
            >
              {area.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
