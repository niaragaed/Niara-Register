/**
 * Parte do idioma que não depende do servidor: tipo, constantes do cookie e
 * normalização.
 *
 * Fica separada de get-locale.ts de propósito. Aquele módulo importa
 * `next/headers`, que só existe em server component; qualquer client component
 * que importasse uma constante de lá arrastaria o módulo inteiro e quebraria o
 * build — foi o que aconteceu com app/error.tsx.
 */

export const COOKIE_IDIOMA = "niara_locale";

/** Um ano. */
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export type Locale = "en" | "pt";

export const LOCALE_PADRAO: Locale = "en";

/** Qualquer valor fora de "en" | "pt" (cookie adulterado, versão antiga) vira "en". */
export function normalizarLocale(valor: string | undefined | null): Locale {
  return valor === "pt" || valor === "en" ? valor : LOCALE_PADRAO;
}
