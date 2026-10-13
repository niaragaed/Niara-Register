import type { Locale } from "./locale";

/**
 * Dates always in the São Paulo time zone, wherever the visitor is: what is
 * shown is when the event happened for Niara, not the reader's local time. In
 * English the BRT suffix makes the time zone explicit, since for a reader
 * abroad the time would be ambiguous.
 */
export function formatDate(iso: string, locale: Locale): string {
  const text = new Intl.DateTimeFormat(locale === "pt" ? "pt-BR" : "en-US", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(iso));

  return locale === "en" ? `${text} BRT` : text;
}

/** Same rule, for a Unix timestamp in seconds (it comes from the contract). */
export function formatTimestamp(seconds: number, locale: Locale): string {
  return formatDate(new Date(seconds * 1000).toISOString(), locale);
}

const intlLocale = (locale: Locale) => (locale === "pt" ? "pt-BR" : "en-US");

/** The language's decimal separator, asked of Intl itself. */
function decimalSeparator(locale: Locale): string {
  return (
    new Intl.NumberFormat(intlLocale(locale))
      .formatToParts(1.5)
      .find((p) => p.type === "decimal")?.value ?? "."
  );
}

// "123", "123.4", "-123.456789..." — what the indexer writes to `dados`.
const AMOUNT = /^(-?)(\d+)(?:\.(\d*))?$/;

// Written as calls, not as `100n` literals: the site's tsconfig has target
// ES2017, which does not accept the BigInt literal syntax yet. The bigint type
// exists (lib includes esnext), so the math is the same.
const HUNDRED = BigInt(100);
const ONE = BigInt(1);

/**
 * Formats a monetary amount from `dados` (a raw string, with the token's
 * decimals) for display: two decimals and the language's separators.
 *
 * The jsonb keeps the original string; only the screen changes.
 *
 * The math is done in BigInt, from the string's digits, and NEVER goes through
 * Number: the amounts come from uint256 in wei and a `parseFloat` would lose
 * precision silently well before the uint256 limit. Thousands grouping also
 * comes from Intl applied to a BigInt, which it accepts without converting.
 *
 * An amount in an unexpected format comes back as it was: better to show the
 * raw data than to hide that something went off the pattern.
 */
export function formatAmount(amount: string, locale: Locale): string {
  const m = AMOUNT.exec(amount.trim());
  if (!m) return amount;

  const [, sign, whole, fraction = ""] = m;

  // Needs 3 decimals to decide how to round the second.
  const digits = fraction.padEnd(3, "0");
  const third = digits.charCodeAt(2) - 48;

  let cents = BigInt(whole) * HUNDRED + BigInt(digits.slice(0, 2));
  if (third >= 5) cents += ONE; // half up, on the magnitude

  const wholePart = new Intl.NumberFormat(intlLocale(locale)).format(
    cents / HUNDRED,
  );
  const decimalPart = (cents % HUNDRED).toString().padStart(2, "0");

  return `${sign}${wholePart}${decimalSeparator(locale)}${decimalPart}`;
}

/**
 * Number of shares: whole ("350") when there is no decimal part, which is the
 * normal case, since each share is a whole token unit. With a fraction, it
 * falls back to the same two-decimal format as amounts, so the fraction is not
 * hidden.
 */
export function formatShares(amount: string, locale: Locale): string {
  const m = AMOUNT.exec(amount.trim());
  if (!m) return amount;

  const [, sign, whole, fraction = ""] = m;
  if (/^0*$/.test(fraction)) {
    return `${sign}${new Intl.NumberFormat(intlLocale(locale)).format(BigInt(whole))}`;
  }
  return formatAmount(amount, locale);
}
