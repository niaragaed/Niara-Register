"use client";

import Link from "next/link";
import { useState } from "react";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/locale";
import {
  explorerAddressUrl,
  explorerTxUrl,
  formatDecimal,
  formatPayment,
  formatUtc,
  GLOBAL_REGISTRY_API_URL,
  SETTLEMENT_NETWORK_NAMES,
  settlementsPath,
  shortAddress,
  type ApiSettlement,
  type SettlementNetwork,
} from "@/lib/global-registry";

function ExternalOrInternal({ href, children, title }: { href: string; children: React.ReactNode; title?: string }) {
  const cls = "underline decoration-slate/30 underline-offset-2 hover:text-ink";
  return href.startsWith("/") ? (
    <Link href={href} className={cls} title={title}>
      {children}
    </Link>
  ) : (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls} title={title}>
      {children}
    </a>
  );
}

export function SettlementRows({ items, t, locale }: { items: ApiSettlement[]; t: Dictionary["global"]; locale: Locale }) {
  return (
    <>
      {items.map((s) => {
        const pay = s.payment.symbol ?? shortAddress(s.payment.address);
        return (
          <tr key={`${s.network}:${s.txHash}:${s.logIndex}`} className="border-b border-slate/10 align-top">
            <td className="py-3 pr-4 font-body text-xs text-ink">{SETTLEMENT_NETWORK_NAMES[s.network]}</td>
            <td className="whitespace-nowrap py-3 pr-4 font-mono text-xs text-slate">
              <Link
                href={`/global-registry/${s.network}/${s.txHash}`}
                className="underline decoration-slate/30 underline-offset-2 hover:text-ink"
                title={t.details}
              >
                {formatUtc(s.blockTime)}
              </Link>
            </td>
            <td className="py-3 pr-4 font-body text-xs text-ink">
              <span className="font-medium">{s.asset.symbol ?? t.noSymbol}</span>{" "}
              <span className="font-mono text-slate">
                <ExternalOrInternal href={explorerAddressUrl(s.network, s.asset.address)} title={s.asset.address}>
                  {shortAddress(s.asset.address)}
                </ExternalOrInternal>
              </span>
            </td>
            <td className="whitespace-nowrap py-3 pr-4 text-right font-mono text-xs text-ink">{formatDecimal(s.lots, 0, locale)}</td>
            <td className="whitespace-nowrap py-3 pr-4 text-right font-mono text-xs text-ink">
              {formatDecimal(s.price, s.payment.decimals, locale, 2)} <span className="text-slate">{pay}</span>
            </td>
            <td className="whitespace-nowrap py-3 pr-4 text-right font-mono text-xs text-ink">
              {formatPayment(s.notional, s, locale)} <span className="text-slate">{pay}</span>
            </td>
            <td className="whitespace-nowrap py-3 pr-4 text-right font-mono text-xs text-ink">{formatPayment(s.fee, s, locale)}</td>
            <td className="whitespace-nowrap py-3 pr-4 text-right font-mono text-xs text-ink">{formatPayment(s.cashback, s, locale)}</td>
            <td className="py-3 pr-4 font-mono text-xs text-slate">
              <ExternalOrInternal href={explorerAddressUrl(s.network, s.buyer)} title={s.buyer}>
                {shortAddress(s.buyer)}
              </ExternalOrInternal>
            </td>
            <td className="py-3 pr-4 font-mono text-xs text-slate">
              <ExternalOrInternal href={explorerAddressUrl(s.network, s.seller)} title={s.seller}>
                {shortAddress(s.seller)}
              </ExternalOrInternal>
            </td>
            <td className="py-3 font-body text-xs text-slate">
              <ExternalOrInternal href={explorerTxUrl(s.network, s.txHash)} title={s.txHash}>
                {t.explorer}
              </ExternalOrInternal>
            </td>
          </tr>
        );
      })}
    </>
  );
}

export function GlobalRegistryTable({
  initial,
  initialCursor,
  network,
  t,
  locale,
}: {
  initial: ApiSettlement[];
  initialCursor: string | null;
  network?: SettlementNetwork;
  t: Dictionary["global"];
  locale: Locale;
}) {
  const [items, setItems] = useState(initial);
  const [cursor, setCursor] = useState(initialCursor);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  async function loadMore() {
    if (!cursor || !GLOBAL_REGISTRY_API_URL) return;
    setState("loading");
    try {
      const res = await fetch(`${GLOBAL_REGISTRY_API_URL}${settlementsPath({ network, cursor })}`, {
        headers: { accept: "application/json" },
      });
      if (!res.ok) throw new Error(String(res.status));
      const page = (await res.json()) as { items: ApiSettlement[]; nextCursor: string | null };
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
      setState("idle");
    } catch {
      setState("error");
    }
  }

  const th = "py-2 pr-4 text-left font-mono text-[11px] font-normal uppercase tracking-wide text-slate";
  const thNum = `${th} text-right`;

  return (
    <div>
      {/* The table scrolls inside its own box; the page never scrolls sideways. */}
      <div className="-mx-6 overflow-x-auto px-6">
        <table className="w-full min-w-[60rem] border-collapse">
          <thead>
            <tr className="border-b border-slate/20">
              <th className={th}>{t.colNetwork}</th>
              <th className={th}>{t.colTime}</th>
              <th className={th}>{t.colAsset}</th>
              <th className={thNum}>{t.colLots}</th>
              <th className={thNum}>{t.colPrice}</th>
              <th className={thNum}>{t.colNotional}</th>
              <th className={thNum}>{t.colFee}</th>
              <th className={thNum}>{t.colCashback}</th>
              <th className={th}>{t.colBuyer}</th>
              <th className={th}>{t.colSeller}</th>
              <th className={th}>{t.colExplorer}</th>
            </tr>
          </thead>
          <tbody>
            <SettlementRows items={items} t={t} locale={locale} />
          </tbody>
        </table>
      </div>

      {cursor && (
        <div className="mt-6 flex items-center gap-4">
          <button
            type="button"
            onClick={loadMore}
            disabled={state === "loading"}
            className="border border-slate/30 px-4 py-2 font-body text-sm text-ink transition-colors hover:border-ink disabled:opacity-60"
          >
            {state === "loading" ? t.loading : t.loadMore}
          </button>
          {state === "error" && <p className="font-body text-xs text-slate">{t.loadError}</p>}
        </div>
      )}
    </div>
  );
}
