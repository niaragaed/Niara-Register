import Link from "next/link";
import { GlobalRegistryTable } from "@/components/global-registry-table";
import {
  fetchNetworks,
  fetchSettlements,
  formatUtc,
  isSettlementNetwork,
  SETTLEMENT_NETWORK_NAMES,
  SETTLEMENT_NETWORKS,
  type SettlementNetwork,
} from "@/lib/global-registry";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/get-locale";

// Read on every request: new settlements and sync points arrive every cycle.
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ network?: string }> };

/**
 * Niara Exchange settlements, from the Register's own indexer and read API
 * (indexer/exchange-*.ts). Every row was read from the network itself; the
 * Exchange's database and API are never consulted.
 */
export default async function GlobalRegistryPage({ searchParams }: Props) {
  const locale = await getLocale();
  const t = dictionaries[locale].global;
  const { network: networkParam } = await searchParams;
  const network: SettlementNetwork | undefined =
    networkParam && isSettlementNetwork(networkParam) ? networkParam : undefined;

  const [settlements, networks] = await Promise.all([fetchSettlements({ network }), fetchNetworks()]);
  const statusByNetwork = new Map(networks.ok ? networks.data.networks.map((n) => [n.network, n]) : []);
  const numberFormat = new Intl.NumberFormat(locale === "pt" ? "pt-BR" : "en-US");

  const filterLink = (value: SettlementNetwork | undefined, label: string) => {
    const active = value === network;
    return (
      <Link
        key={value ?? "all"}
        href={value ? `/global-registry?network=${value}` : "/global-registry"}
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

      <div className="mt-6">
        {!settlements.ok ? (
          <div className="border border-dashed border-slate/30 px-6 py-10">
            <p className="font-body text-sm text-slate">
              {settlements.reason === "not-configured" ? t.notConnected : t.unreachable}
            </p>
          </div>
        ) : settlements.data.items.length === 0 ? (
          <div className="border border-dashed border-slate/30 px-6 py-10">
            <p className="font-body text-sm text-slate">{t.empty}</p>
          </div>
        ) : (
          <GlobalRegistryTable
            key={network ?? "all"}
            initial={settlements.data.items}
            initialCursor={settlements.data.nextCursor}
            network={network}
            t={t}
            locale={locale}
          />
        )}
      </div>

      <p className="mt-8 max-w-3xl font-body text-xs leading-relaxed text-slate">{t.unitsNote}</p>
    </div>
  );
}
