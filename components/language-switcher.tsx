import { trocarIdioma } from "@/app/actions/set-locale";
import type { Locale } from "@/lib/i18n/locale";

/**
 * Seletor "EN · PT" à direita da navegação.
 *
 * É um <form> com dois botões submit chamando um server action, então continua
 * sendo server component, não vai JS nenhum para o cliente e a troca funciona
 * mesmo com o JS desligado. O server action responde na própria URL, então a
 * rota atual é preservada.
 */

const IDIOMAS: { codigo: Locale; rotulo: string }[] = [
  { codigo: "en", rotulo: "EN" },
  { codigo: "pt", rotulo: "PT" },
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
      action={trocarIdioma}
      aria-label={label}
      className="flex items-center gap-1.5"
    >
      {IDIOMAS.map((idioma, i) => (
        <span key={idioma.codigo} className="flex items-center gap-1.5">
          {i > 0 && (
            <span aria-hidden="true" className="font-mono text-xs text-slate/50">
              ·
            </span>
          )}
          <button
            type="submit"
            name="locale"
            value={idioma.codigo}
            aria-current={locale === idioma.codigo ? "true" : undefined}
            className={`font-mono text-xs uppercase underline-offset-4 transition-colors hover:underline ${
              locale === idioma.codigo ? "text-ink" : "text-slate"
            }`}
          >
            {idioma.rotulo}
          </button>
        </span>
      ))}
    </form>
  );
}
