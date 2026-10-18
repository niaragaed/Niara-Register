import { switchLocale } from "@/app/actions/set-locale";
import type { Locale } from "@/lib/i18n/locale";

/**
 * "EN · PT" selector to the right of the navigation.
 *
 * It is a <form> with two submit buttons calling a server action, so it stays a
 * server component, ships no JS to the client and switching works even with JS
 * turned off. The server action answers on the same URL, so the current route
 * is kept.
 */

const LANGUAGES: { code: Locale; label: string }[] = [
  { code: "en", label: "EN" },
  { code: "pt", label: "PT" },
];

export function LanguageSwitcher({
  locale,
  label,
}: {
  locale: Locale;
  label: string;
}) {
  return (
    <form
      action={switchLocale}
      aria-label={label}
      className="flex items-center gap-1.5"
    >
      {LANGUAGES.map((language, i) => (
        <span key={language.code} className="flex items-center gap-1.5">
          {i > 0 && (
            <span aria-hidden="true" className="font-mono text-xs text-slate/50">
              ·
            </span>
          )}
          <button
            type="submit"
            name="locale"
            value={language.code}
            aria-current={locale === language.code ? "true" : undefined}
            className={`font-mono text-xs uppercase underline-offset-4 transition-colors hover:underline ${
              locale === language.code ? "text-ink" : "text-slate"
            }`}
          >
            {language.label}
          </button>
        </span>
      ))}
    </form>
  );
}
