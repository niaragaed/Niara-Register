import type { Metadata } from "next";
import Link from "next/link";
import { GlobalRegistryTable } from "@/components/global-registry-table";
import {
  fetchNetworks,
  fetchSettlements,
  formatUtc,
  isSettlementNetwork,
  normaliseWallet,
  SETTLEMENT_NETWORK_NAMES,
  SETTLEMENT_NETWORKS,
  type SettlementNetwork,
} from "@/lib/global-registry";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/get-locale";

// Canonical URL on the production domain (metadataBase in app/layout.tsx).
export const metadata: Metadata = { alternates: { canonical: "/global-registry" } };

// Read on every request: new settlements and sync points arrive every cycle.
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ network?: string; wallet?: string }> };

/** The registry URL for a network filter, keeping the wallet filter. */
function registryHref(network: SettlementNetwork | undefined, wallet: string | undefined): string {
  const params = new URLSearchParams();
  if (network) params.set("network", network);
  if (wallet) params.set("wallet", wallet);
  const qs = params.toString();
  return qs ? `/global-registry?${qs}` : "/global-registry";
}

/**
 * Niara Exchange settlements, from the Register's own indexer and read API
 * (indexer/exchange-*.ts). Every row was read from the network itself; the
 * Exchange's database and API are never consulted.
 */
/** Below this many blocks/slots behind the head, a network counts as up to date (finality depth and polling jitter). */
const CATCHING_UP_FROM = 1000;

export default async function GlobalRegistryPage({ searchParams }: Props) {
  const locale = await getLocale();
  const t = dictionaries[locale].global;
  const { network: networkParam, wallet: walletParam } = await searchParams;
  const network: SettlementNetwork | undefined =
    networkParam && isSettlementNetwork(networkParam) ? networkParam : undefined;
  const walletRaw = typeof walletParam === "string" ? walletParam.trim() : "";
  const wallet = walletRaw ? (normaliseWallet(walletRaw) ?? undefined) : undefined;
  const walletInvalid = walletRaw !== "" && !wallet;

  const [settlements, networks] = await Promise.all([fetchSettlements({ network, wallet }), fetchNetworks()]);
  const statusByNetwork = new Map(networks.ok ? networks.data.networks.map((n) => [n.network, n]) : []);
  const numberFormat = new Intl.NumberFormat(locale === "pt" ? "pt-BR" : "en-US");

  const filterLink = (value: SettlementNetwork | undefined, label: string) => {
    const active = value === network;
    return (
      <Link
        key={value ?? "all"}
        href={registryHref(value, wallet)}
        aria-current={active ? "page" : undefined}
        className={`border px-3 py-1 font-body text-xs transition-colors ${
          active ? "border-ink text-ink" : "border-slate/25 text-slate hover:border-ink hover:text-ink"
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-14">
      <header className="border-b border-slate/15 pb-8">
        <div className="flex flex-wrap items-center gap-3">
          <p className="font-mono text-xs uppercase tracking-wide text-slate">{t.eyebrow}</p>
          <span className="border border-amber-700/50 bg-amber-50 px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wide text-amber-900">
            {t.testnetBadge}
          </span>
        </div>
        <h1 className="mt-3 font-display text-3xl text-ink">{t.title}</h1>
        <p className="mt-3 max-w-2xl font-body text-sm leading-relaxed text-slate">{t.lede}</p>
        <p className="mt-3 max-w-2xl font-body text-sm font-medium leading-relaxed text-ink">{t.source}</p>

        <div className="mt-6">
          <p className="font-mono text-[11px] uppercase tracking-wide text-slate">{t.syncTitle}</p>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {SETTLEMENT_NETWORKS.map((n) => {
              const s = statusByNetwork.get(n);
              let text: string;
              if (!networks.ok) text = "—";
              else if (!s?.indexed) text = t.syncNotIndexed;
              else if (s.lastSynced == null) text = t.syncNotYet;
              else
                text = `${s.unit === "slot" ? t.syncSlot : t.syncBlock} ${numberFormat.format(s.lastSynced)}${
                  s.syncedAt ? ` · ${t.syncAt} ${formatUtc(s.syncedAt)}` : ""
                }${
                  s.lag != null && s.lag > CATCHING_UP_FROM
                    ? ` · ${t.syncCatchingUp} ${numberFormat.format(s.lag)} ${s.unit === "slot" ? t.syncBehindSlots : t.syncBehindBlocks}`
                    : ""
                }`;
              return (
                <li key={n} className="font-body text-xs text-slate">
                  <span className="text-ink">{SETTLEMENT_NETWORK_NAMES[n]}</span> — {text}
                </li>
              );
            })}
          </ul>
        </div>
      </header>

      <nav aria-label={t.filterLabel} className="mt-8 flex flex-wrap gap-2">
        {filterLink(undefined, t.filterAll)}
        {SETTLEMENT_NETWORKS.map((n) => filterLink(n, SETTLEMENT_NETWORK_NAMES[n]))}
      </nav>

      {/* A plain GET form: ?wallet= is the state, so the view can be linked and works without JS. */}
      <form method="get" action="/global-registry" className="mt-4 flex max-w-2xl flex-wrap items-center gap-2">
        {network && <input type="hidden" name="network" value={network} />}
        <label htmlFor="wallet" className="font-mono text-[11px] uppercase tracking-wide text-slate">
          {t.walletLabel}
        </label>
        <input
          id="wallet"
          name="wallet"
          defaultValue={walletRaw}
          placeholder={t.walletPlaceholder}
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1 basis-60 border border-slate/30 bg-transparent px-3 py-1.5 font-mono text-xs text-ink placeholder:text-slate/60 focus:border-ink focus:outline-none"
        />
        <button
          type="submit"
          className="border border-ink px-3 py-1.5 font-body text-xs text-ink transition-colors hover:bg-ink hover:text-bone"
        >
          {t.walletApply}
        </button>
        {walletRaw && (
          <Link
            href={registryHref(network, undefined)}
            className="font-body text-xs text-slate underline decoration-slate/30 underline-offset-2 hover:text-ink"
          >
            {t.walletClear}
          </Link>
        )}
      </form>
      {walletInvalid && <p className="mt-2 font-body text-xs text-amber-900">{t.walletInvalid}</p>}
      {wallet && (
        <p className="mt-2 break-all font-body text-xs text-slate">
          {t.walletShowing} <span className="font-mono text-ink">{wallet}</span>
        </p>
      )}

      <div className="mt-6">
        {!settlements.ok ? (
          <div className="border border-dashed border-slate/30 px-6 py-10">
            <p className="font-body text-sm text-slate">
              {settlements.reason === "not-configured" ? t.notConnected : t.unreachable}
            </p>
          </div>
        ) : settlements.data.items.length === 0 ? (
          <div className="border border-dashed border-slate/30 px-6 py-10">
            <p className="font-body text-sm text-slate">{wallet ? t.walletEmpty : t.empty}</p>
          </div>
        ) : (
          <GlobalRegistryTable
            key={`${network ?? "all"}:${wallet ?? ""}`}
            initial={settlements.data.items}
            initialCursor={settlements.data.nextCursor}
            network={network}
            wallet={wallet}
            t={t}
            locale={locale}
          />
        )}
      </div>

      <p className="mt-8 max-w-3xl font-body text-xs leading-relaxed text-slate">{t.unitsNote}</p>
    </div>
  );
}
