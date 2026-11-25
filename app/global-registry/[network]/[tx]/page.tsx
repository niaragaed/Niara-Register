import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  explorerAddressUrl,
  explorerTxUrl,
  fetchTransaction,
  formatDecimal,
  formatPayment,
  formatUtc,
  isSettlementNetwork,
  normaliseTxId,
  SETTLEMENT_NETWORK_NAMES,
  type ApiSettlement,
} from "@/lib/global-registry";
import { dictionaries, type Dictionary } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/get-locale";
import type { Locale } from "@/lib/i18n/locale";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ network: string; tx: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { network, tx } = await params;
  const id = isSettlementNetwork(network) ? normaliseTxId(network, tx) : null;
  return {
    title: `Settlement ${tx.slice(0, 10)}… · Niara Register`,
    alternates: id ? { canonical: `/global-registry/${network}/${id}` } : undefined,
  };
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-slate/10 py-3 sm:grid-cols-[14rem_1fr]">
      <dt className="font-mono text-xs uppercase tracking-wide text-slate">{label}</dt>
      <dd className="break-all font-body text-sm text-ink">{children}</dd>
    </div>
  );
}

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  const cls = "underline decoration-slate/30 underline-offset-2 hover:text-ink";
  return href.startsWith("/") ? (
    <Link href={href} className={cls}>
      {children}
    </Link>
  ) : (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
      {children}
    </a>
  );
}

function token(symbol: string | null, t: Dictionary["global"]) {
  return symbol ?? t.noSymbol;
}

function Settlement({ s, t, locale }: { s: ApiSettlement; t: Dictionary["global"]; locale: Locale }) {
  const pay = s.payment.symbol ?? "";
  return (
    <dl className="mt-6 border-t border-slate/15">
      <Row label={t.fieldMatch}>
        <span className="font-mono">{s.matchId}</span>
      </Row>
      {s.blockNumber != null && <Row label={t.fieldBlock}>{s.blockNumber}</Row>}
      {s.slot != null && <Row label={t.fieldSlot}>{s.slot}</Row>}
      <Row label={t.fieldTime}>{formatUtc(s.blockTime)}</Row>
      <Row label={t.fieldAsset}>
        {token(s.asset.symbol, t)} · <Ext href={explorerAddressUrl(s.network, s.asset.address)}><span className="font-mono">{s.asset.address}</span></Ext>
      </Row>
      <Row label={t.fieldPaymentToken}>
        {token(s.payment.symbol, t)} · <Ext href={explorerAddressUrl(s.network, s.payment.address)}><span className="font-mono">{s.payment.address}</span></Ext>
      </Row>
      <Row label={t.fieldBaseQuantity}>
        <span className="font-mono">{s.baseQuantity}</span>
      </Row>
      <Row label={t.fieldLots}>{formatDecimal(s.lots, 0, locale)}</Row>
      <Row label={t.fieldPrice}>
        {formatDecimal(s.price, s.payment.decimals, locale, 2)} {pay}
      </Row>
      <Row label={t.fieldNotional}>
        {formatPayment(s.notional, s, locale)} {pay}
      </Row>
      <Row label={t.fieldFee}>
        {formatPayment(s.fee, s, locale)} {pay}
      </Row>
      <Row label={t.fieldCashback}>
        {formatPayment(s.cashback, s, locale)} {pay}
      </Row>
      <Row label={t.fieldSellerReceives}>
        {formatPayment(s.sellerReceives, s, locale)} {pay}
      </Row>
      <Row label={t.fieldBuyer}>
        <Ext href={explorerAddressUrl(s.network, s.buyer)}><span className="font-mono">{s.buyer}</span></Ext>
      </Row>
      <Row label={t.fieldSeller}>
        <Ext href={explorerAddressUrl(s.network, s.seller)}><span className="font-mono">{s.seller}</span></Ext>
      </Row>
      <Row label={t.fieldContract}>
        <Ext href={explorerAddressUrl(s.network, s.contract)}><span className="font-mono">{s.contract}</span></Ext>
      </Row>
    </dl>
  );
}

export default async function SettlementPage({ params }: Props) {
  const { network, tx: rawTx } = await params;
  if (!isSettlementNetwork(network)) notFound();
  const tx = normaliseTxId(network, rawTx);
  if (!tx) notFound();

  const locale = await getLocale();
  const t = dictionaries[locale].global;
  const result = await fetchTransaction(network, tx);
  const explorer = explorerTxUrl(network, tx);
  const items = result.ok ? result.data.items : [];

  return (
    <div className="mx-auto max-w-5xl px-6 py-14">
      <header className="border-b border-slate/15 pb-8">
        <div className="flex flex-wrap items-center gap-3">
          <p className="font-mono text-xs uppercase tracking-wide text-slate">{t.txEyebrow}</p>
          <span className="border border-amber-700/50 bg-amber-50 px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wide text-amber-900">
            {t.testnetBadge}
          </span>
        </div>
        <h1 className="mt-3 font-display text-3xl text-ink">
          {t.txTitle} {SETTLEMENT_NETWORK_NAMES[network]}
        </h1>
        <p className="mt-3 break-all font-mono text-xs text-slate">
          {t.fieldTx}: {tx}
        </p>
        <p className="mt-3 max-w-2xl font-body text-sm font-medium leading-relaxed text-ink">{t.source}</p>
      </header>

      {items.length > 0 ? (
        items.map((s) => <Settlement key={s.logIndex} s={s} t={t} locale={locale} />)
      ) : (
        <div className="mt-10 border border-dashed border-slate/30 px-6 py-8">
          {result.ok && <p className="font-body text-sm text-ink">{t.txNotIndexedTitle}</p>}
          <p className="mt-2 max-w-2xl font-body text-sm leading-relaxed text-slate">
            {result.ok ? t.txNotIndexedText : t.txUnreachable}
          </p>
        </div>
      )}

      <div className="mt-8 flex flex-wrap gap-6 font-body text-sm text-slate">
        <Ext href={explorer}>{t.txOpenExplorer}</Ext>
        <Link href="/global-registry" className="underline decoration-slate/30 underline-offset-2 hover:text-ink">
          {t.txBack}
        </Link>
      </div>

      <p className="mt-8 max-w-3xl font-body text-xs leading-relaxed text-slate">{t.unitsNote}</p>
    </div>
  );
}
