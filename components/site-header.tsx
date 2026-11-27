import Link from "next/link";
import { HeaderMenu } from "@/components/header-menu";
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
  const products = [
    { href: "https://niaraglobal.com", label: t.nav.exchange },
    { href: "https://sme.niaraglobal.com", label: t.nav.sme },
  ];

  const inline = "whitespace-nowrap font-body text-[13px] text-slate transition-colors hover:text-ink xl:text-sm";
  const stacked = "block px-4 py-2 font-body text-sm text-slate transition-colors hover:bg-slate/5 hover:text-ink";

  return (
    <header className="border-b border-slate/15 bg-bone">
      {/*
        Two shapes, never wrapping.

        From lg up: one row — brand, every link, the other products, the
        language selector. The container is wider than the pages' content
        (max-w-7xl) and the spacing tightens at lg, so even the longest
        language fits on one line at 1024 px; every item is nowrap.

        Below lg: brand, language selector and a "Menu" disclosure that holds
        the same links stacked. Before, the links wrapped onto extra rows
        ("SME ↗" dropped to a second line at desktop widths).
      */}
      <div className="mx-auto flex max-w-7xl items-center gap-x-4 px-4 py-5 sm:px-6 lg:gap-x-5 lg:px-5 xl:gap-x-8 xl:px-6">
        <Link href="/" className="flex shrink-0 items-baseline gap-2 whitespace-nowrap">
          <span className="font-display text-lg text-ink">{t.nav.brand}</span>
          <span className="font-body text-sm text-slate">{t.nav.product}</span>
        </Link>

        <nav aria-label={t.nav.mainLabel} className="ml-auto hidden flex-nowrap items-center gap-x-3.5 lg:flex xl:gap-x-5">
          {areas.map((area) => (
            <Link key={area.href} href={area.href} className={inline}>
              {area.label}
            </Link>
          ))}
          {/* The other Niara products, on their own domains. */}
          <span aria-hidden="true" className="text-slate/40">
            |
          </span>
          {products.map((p) => (
            <a key={p.href} href={p.href} aria-label={`${p.label} (${t.nav.productsLabel})`} className={inline}>
              {p.label}
              <span aria-hidden="true"> ↗</span>
            </a>
          ))}
        </nav>

        <div className="ml-auto shrink-0 lg:ml-0">
          <LanguageSwitcher locale={locale} label={t.nav.languageLabel} />
        </div>

        <HeaderMenu label={t.nav.menu}>
          <nav aria-label={t.nav.mainLabel}>
            {areas.map((area) => (
              <Link key={area.href} href={area.href} className={stacked}>
                {area.label}
              </Link>
            ))}
            <p className="mt-2 border-t border-slate/15 px-4 pb-1 pt-3 font-mono text-[10px] uppercase tracking-wide text-slate">
              {t.nav.productsLabel}
            </p>
            {products.map((p) => (
              <a key={p.href} href={p.href} className={stacked}>
                {p.label}
                <span aria-hidden="true"> ↗</span>
              </a>
            ))}
          </nav>
        </HeaderMenu>
      </div>
    </header>
  );
}
