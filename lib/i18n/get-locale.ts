import { cookies } from "next/headers";
import { LOCALE_COOKIE, normalizeLocale, type Locale } from "./locale";

/**
 * The visitor's language, read from the cookie. Server components only: this
 * module imports `next/headers`. Type and constants live in ./locale, which is
 * safe anywhere; nothing is re-exported from here so `next/headers` is not
 * dragged to the client by mistake.
 *
 * Deliberate rule: the default is English and `Accept-Language` is NOT
 * consulted. A Brazilian visitor without a cookie also lands in English:
 * switching is always an explicit act, done in the header's selector.
 *
 * Routes do not change with the language: no prefix, no middleware, only the
 * cookie.
 */
export async function getLocale(): Promise<Locale> {
  // In Next 16, cookies() is async.
  const store = await cookies();
  return normalizeLocale(store.get(LOCALE_COOKIE)?.value);
}
