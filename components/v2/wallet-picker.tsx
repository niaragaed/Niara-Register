"use client";
// "Connect wallet" always asks which wallet to use (EVM through EIP-6963,
// Solana through the Wallet Standard). Wallets on the Niara list come first,
// the last one used on top; other wallets the browser announces are shown
// apart; listed wallets that are not installed get a link to their official
// site. Nothing connects until the user picks one.
import { useEffect, useRef, useState } from "react";
import { discoverEvmWallets, type EvmWalletOption } from "@/lib/evm-wallets";
import { discoverSolanaWallets, type SolanaWalletOption } from "@/lib/solana-wallets";
import {
  matchTrusted,
  rememberWallet,
  rememberedWallet,
  trustedFor,
  type TrustedWallet,
  type WalletFamily,
} from "@/lib/wallet-catalog";
import { WalletMissing, WalletRejected } from "@/lib/wallets";
import { linkClass, secondaryButton } from "./ui";

export type WalletPickerTexts = {
  chooseWallet: string;
  chooseWalletHintEvm: string;
  chooseWalletHintSolana: string;
  lastUsed: string;
  otherWallets: string;
  notInstalled: string;
  noWalletFound: string;
  cancel: string;
};

type Item = { key: string; name: string; icon: string | null; trusted: TrustedWallet | null };
type Pending = { family: WalletFamily; items: Item[]; missing: TrustedWallet[]; last: string | null };

export function useWalletPicker(texts: WalletPickerTexts) {
  const [pending, setPending] = useState<Pending | null>(null);
  const resolver = useRef<((key: string | null) => void) | null>(null);

  function close(key: string | null) {
    resolver.current?.(key);
    resolver.current = null;
    setPending(null);
  }

  async function ask<T extends { name: string; icon: string | null }>(
    family: WalletFamily,
    options: T[],
    keyOf: (o: T) => string,
  ): Promise<T> {
    const last = rememberedWallet(family);
    // A wallet that announced no icon for this family may have announced one for
    // the other (Phantom does both): use the wallet's own icon from there.
    const otherIcons = new Map<string, string>();
    const others =
      family === "evm"
        ? (await discoverSolanaWallets(0)).map((o) => ({ t: matchTrusted("solana", o.key), icon: o.icon }))
        : (await discoverEvmWallets(0)).map((o) => ({ t: matchTrusted("evm", o.rdns), icon: o.icon }));
    for (const o of others) if (o.t && o.icon) otherIcons.set(o.t.id, o.icon);
    const items: Item[] = options.map((o) => {
      const trusted = matchTrusted(family, keyOf(o));
      return { key: keyOf(o), name: o.name, icon: o.icon ?? (trusted ? otherIcons.get(trusted.id) ?? null : null), trusted };
    });
    const present = new Set(items.map((i) => i.trusted?.id).filter(Boolean));
    const missing = trustedFor(family).filter((w) => !present.has(w.id));
    const key = await new Promise<string | null>((resolve) => {
      resolver.current = resolve;
      setPending({ family, items, missing, last });
    });
    if (!key) {
      if (options.length === 0) throw new WalletMissing(`no ${family} wallet`);
      throw new WalletRejected("wallet choice cancelled");
    }
    rememberWallet(family, key);
    return options.find((o) => keyOf(o) === key)!;
  }

  return {
    chooseEvm: async (): Promise<EvmWalletOption> => ask("evm", await discoverEvmWallets(), (o) => o.rdns),
    chooseSolana: async (): Promise<SolanaWalletOption> => ask("solana", await discoverSolanaWallets(), (o) => o.key),
    element: pending ? <PickerDialog pending={pending} texts={texts} onClose={close} /> : null,
  };
}

function WalletButton({ item, tag, onPick }: { item: Item; tag?: string; onPick: () => void }) {
  return (
    <button
      onClick={onPick}
      className="flex w-full items-center gap-3 border border-slate/30 px-4 py-3 text-left font-body text-sm text-ink transition-colors hover:border-brass focus:border-brass focus:outline-none"
    >
      {item.icon ? (
        // Wallet-announced data: URI (checked to be an image); next/image adds nothing here.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.icon} alt="" width={24} height={24} className="h-6 w-6" />
      ) : (
        <span className="h-6 w-6 border border-slate/30" aria-hidden />
      )}
      <span className="flex-1">{item.name}</span>
      {tag && <span className="font-mono text-[11px] text-slate">{tag}</span>}
    </button>
  );
}

function PickerDialog({
  pending,
  texts,
  onClose,
}: {
  pending: Pending;
  texts: WalletPickerTexts;
  onClose: (key: string | null) => void;
}) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const trusted = pending.items
    .filter((i) => i.trusted)
    .sort((a, b) => Number(b.key === pending.last) - Number(a.key === pending.last) || a.name.localeCompare(b.name));
  const others = pending.items.filter((i) => !i.trusted);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-ink/40 px-4 py-8"
      onClick={(e) => e.target === e.currentTarget && onClose(null)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-picker-title"
        className="w-full max-w-sm border border-slate/30 bg-bone px-6 py-6"
      >
        <p id="wallet-picker-title" className="font-display text-xl text-ink">
          {texts.chooseWallet}
        </p>
        <p className="mt-2 font-body text-xs leading-relaxed text-slate">
          {pending.items.length === 0
            ? texts.noWalletFound
            : pending.family === "evm"
              ? texts.chooseWalletHintEvm
              : texts.chooseWalletHintSolana}
        </p>

        {trusted.length > 0 && (
          <ul className="mt-4 space-y-2">
            {trusted.map((i) => (
              <li key={i.key}>
                <WalletButton item={i} tag={i.key === pending.last ? texts.lastUsed : undefined} onPick={() => onClose(i.key)} />
              </li>
            ))}
          </ul>
        )}

        {others.length > 0 && (
          <>
            <p className="mt-5 font-mono text-[11px] uppercase tracking-wide text-slate">{texts.otherWallets}</p>
            <ul className="mt-2 space-y-2">
              {others.map((i) => (
                <li key={i.key}>
                  <WalletButton item={i} tag={i.key === pending.last ? texts.lastUsed : undefined} onPick={() => onClose(i.key)} />
                </li>
              ))}
            </ul>
          </>
        )}

        {pending.missing.length > 0 && (
          <>
            <p className="mt-5 font-mono text-[11px] uppercase tracking-wide text-slate">{texts.notInstalled}</p>
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {pending.missing.map((w) => (
                <a key={w.id} href={w.installUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
                  {w.name} ↗
                </a>
              ))}
            </p>
          </>
        )}

        <div className="mt-6 text-right">
          <button className={secondaryButton} onClick={() => onClose(null)}>
            {texts.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}
