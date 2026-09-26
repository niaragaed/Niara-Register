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
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-5">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="font-display text-lg text-ink">{t.nav.brand}</span>
          <span className="font-body text-sm text-slate">{t.nav.product}</span>
        </Link>
        <div className="flex items-center gap-6">
          <nav className="flex gap-6">
            {areas.map((area) => (
              <Link
                key={area.href}
                href={area.href}
                className="font-body text-sm text-slate transition-colors hover:text-ink"
              >
                {area.label}
              </Link>
            ))}
          </nav>
          <LanguageSwitcher locale={locale} label={t.nav.languageLabel} />
        </div>
      </div>
    </header>
  );
}
