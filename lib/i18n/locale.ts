/**
 * The part of the language handling that does not depend on the server: type,
 * cookie constants and normalization.
 *
 * Kept apart from get-locale.ts on purpose. That module imports `next/headers`,
 * which only exists in server components; any client component importing a
 * constant from there would drag the whole module along and break the build,
 * which is what happened with app/error.tsx.
 */

export const LOCALE_COOKIE = "niara_locale";

/** One year. */
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export type Locale = "en" | "pt";

export const DEFAULT_LOCALE: Locale = "en";

/** Any value other than "en" | "pt" (tampered cookie, old version) becomes "en". */
export function normalizeLocale(value: string | undefined | null): Locale {
  return value === "pt" || value === "en" ? value : DEFAULT_LOCALE;
}
