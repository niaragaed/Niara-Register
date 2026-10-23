import Link from "next/link";
import { LanguageSwitcher } from "@/components/language-switcher";
import { dictionaries } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/locale";

export function SiteHeader({ locale }: { locale: Locale }) {
  const t = dictionaries[locale];

  // Routes do not change with the language, only the labels.
  const areas = [
    { href: "/sme-registry", label: t.nav.pmes },
    { href: "/global-registry", label: t.nav.global },
    { href: "/signatures", label: t.nav.signing },
    { href: "/verify", label: t.nav.verify },
    { href: "/transferable", label: t.nav.transferable },
  ];

  return (
    <header className="border-b border-slate/15 bg-bone">
      {/*
        A single DOM, in two shapes.

        Below lg: a first row with the brand on the left and the selector on
        the right; the links drop together to a second row aligned on
        the brand's margin. Before, they broke into three misaligned rows in
        English ("Document Signing" was left on its own) and, worse, the long
        labels pushed the page width and created horizontal scrolling.

        From lg up: brand on the left, navigation and selector on the right,
        which is exactly the usual header. The order is swapped with `order`,
        without repeating any element in the HTML.
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
