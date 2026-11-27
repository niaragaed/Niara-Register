import type { Locale } from "./i18n/locale";

/**
 * Exchange Registry (the /global-registry routes; formerly "Global Registry"): Niara Exchange settlements as read from each network by the
 * Register indexer (indexer/exchange-*.ts) and served by its read API
 * (indexer/exchange-api.ts). Nothing here comes from the Exchange's own
 * database or API.
 *
 * NEXT_PUBLIC_GLOBAL_REGISTRY_API_URL is the Register backend's public origin
 * (the Railway service). Without it the page says the API is not connected.
 */

export const GLOBAL_REGISTRY_API_URL = (process.env.NEXT_PUBLIC_GLOBAL_REGISTRY_API_URL ?? "").replace(/\/+$/, "");

export type SettlementNetwork =
  | "solana-devnet"
  | "base-sepolia"
  | "robinhood-testnet"
  | "tempo-testnet"
  | "hyperevm-testnet";

/** Same slugs and order as the indexer (exchange-config.ts); they are URL segments. */
export const SETTLEMENT_NETWORKS: SettlementNetwork[] = [
  "solana-devnet",
  "base-sepolia",
  "robinhood-testnet",
  "tempo-testnet",
  "hyperevm-testnet",
];

export const SETTLEMENT_NETWORK_NAMES: Record<SettlementNetwork, string> = {
  "solana-devnet": "Solana Devnet",
  "base-sepolia": "Base Sepolia",
  "robinhood-testnet": "Robinhood Chain Testnet",
  "tempo-testnet": "Tempo Testnet",
  "hyperevm-testnet": "HyperEVM Testnet",
};

export function isSettlementNetwork(value: string): value is SettlementNetwork {
  return (SETTLEMENT_NETWORKS as string[]).includes(value);
}

const EVM_TX = /^0x[0-9a-fA-F]{64}$/;
const SOLANA_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

/** The transaction id as the API stores it, or null if it is not valid for the network. */
export function normaliseTxId(network: SettlementNetwork, tx: string): string | null {
  if (network === "solana-devnet") return SOLANA_SIGNATURE.test(tx) ? tx : null;
  return EVM_TX.test(tx) ? tx.toLowerCase() : null;
}

/**
 * The network's own explorer. HyperEVM Testnet has no working public explorer:
 * its link is the site's RPC reader (/explorer), as elsewhere in the Register.
 */
export function explorerTxUrl(network: SettlementNetwork, tx: string): string {
  switch (network) {
    case "solana-devnet":
      return `https://explorer.solana.com/tx/${tx}?cluster=devnet`;
    case "base-sepolia":
      return `https://sepolia.basescan.org/tx/${tx}`;
    case "robinhood-testnet":
      return `https://explorer.testnet.chain.robinhood.com/tx/${tx}`;
    case "tempo-testnet":
      return `https://explore.testnet.tempo.xyz/tx/${tx}`;
    case "hyperevm-testnet":
      return `/explorer/hyperevm-testnet/tx/${tx}`;
  }
}

export function explorerAddressUrl(network: SettlementNetwork, address: string): string {
  switch (network) {
    case "solana-devnet":
      return `https://explorer.solana.com/address/${address}?cluster=devnet`;
    case "base-sepolia":
      return `https://sepolia.basescan.org/address/${address}`;
    case "robinhood-testnet":
      return `https://explorer.testnet.chain.robinhood.com/address/${address}`;
    case "tempo-testnet":
      return `https://explore.testnet.tempo.xyz/address/${address}`;
    case "hyperevm-testnet":
      return `/explorer/hyperevm-testnet/address/${address}`;
  }
}

// ── API shapes (indexer/exchange-api.ts) ─────────────────────────────────────────

export type ApiToken = { address: string; symbol: string | null; decimals: number };

export type ApiSettlement = {
  network: SettlementNetwork;
  txHash: string;
  logIndex: number;
  blockNumber: number | null;
  slot: number | null;
  blockTime: string;
  matchId: string;
  contract: string;
  asset: ApiToken;
  payment: ApiToken;
  /** Integers in base units, as strings. */
  baseQuantity: string;
  notional: string;
  fee: string;
  cashback: string;
  sellerReceives: string;
  /** Decimal string: base quantity / 10^asset decimals (one lot = one whole token). */
  lots: string;
  /** Decimal string: notional per lot, in payment base units. */
  price: string;
  buyer: string;
  seller: string;
};

export type ApiNetworkStatus = {
  network: SettlementNetwork;
  indexed: boolean;
  contract: string | null;
  unit: "block" | "slot";
  lastSynced: number | null;
  /** Chain head the indexer scans up to (null if unknown) and head − lastSynced. */
  head?: number | null;
  lag?: number | null;
  syncedAt: string | null;
};

export type ApiResult<T> = { ok: true; data: T } | { ok: false; reason: "not-configured" | "unreachable" };

async function getJson<T>(path: string, accept404 = false): Promise<ApiResult<T>> {
  if (!GLOBAL_REGISTRY_API_URL) return { ok: false, reason: "not-configured" };
  try {
    const res = await fetch(`${GLOBAL_REGISTRY_API_URL}${path}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
      headers: { accept: "application/json" },
    });
    if (!res.ok && !(accept404 && res.status === 404)) return { ok: false, reason: "unreachable" };
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}

export function settlementsPath(q: { network?: SettlementNetwork; cursor?: string; limit?: number }): string {
  const params = new URLSearchParams();
  if (q.network) params.set("network", q.network);
  if (q.cursor) params.set("cursor", q.cursor);
  params.set("limit", String(q.limit ?? 50));
  return `/v1/settlements?${params}`;
}

export function fetchSettlements(q: { network?: SettlementNetwork; cursor?: string; limit?: number }) {
  return getJson<{ items: ApiSettlement[]; nextCursor: string | null }>(settlementsPath(q));
}

export function fetchNetworks() {
  return getJson<{ networks: ApiNetworkStatus[] }>("/v1/networks");
}

export function fetchTransaction(network: SettlementNetwork, tx: string) {
  return getJson<{ network: SettlementNetwork; txHash: string; indexed: boolean; items: ApiSettlement[] }>(
    `/v1/settlements/${network}/${encodeURIComponent(tx)}`,
    true,
  );
}

// ── formatting ───────────────────────────────────────────────────────────────────

const intlLocale = (locale: Locale) => (locale === "pt" ? "pt-BR" : "en-US");

/**
 * A decimal string (integer or with a fraction) divided by 10^decimals, shown
 * exactly with the language's separators: no float, no rounding. At least
 * `minFraction` decimals (currency amounts show cents), trailing zeros beyond
 * that trimmed.
 */
export function formatDecimal(value: string, decimals: number, locale: Locale, minFraction = 0): string {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!m) return value;
  const [, sign, whole, fraction = ""] = m;
  const digits = (whole + fraction).replace(/^0+(?=\d)/, "");
  const point = digits.length - fraction.length - decimals;
  const padded = point <= 0 ? "0".repeat(1 - point) + digits : digits;
  const at = point <= 0 ? 1 : point;
  const intPart = padded.slice(0, at) || "0";
  let frac = padded.slice(at).replace(/0+$/, "");
  if (frac.length < minFraction) frac = frac.padEnd(minFraction, "0");
  const grouped = new Intl.NumberFormat(intlLocale(locale)).format(BigInt(intPart));
  const separator = new Intl.NumberFormat(intlLocale(locale)).formatToParts(1.5).find((p) => p.type === "decimal")?.value ?? ".";
  return `${sign}${grouped}${frac ? `${separator}${frac}` : ""}`;
}

/** An amount of the payment token (base units) for display, e.g. "1.25". */
export function formatPayment(baseUnits: string, s: ApiSettlement, locale: Locale): string {
  return formatDecimal(baseUnits, s.payment.decimals, locale, 2);
}

export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

/** "2026-11-22 14:18:23 UTC": the record's time, always in UTC. */
export function formatUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}
