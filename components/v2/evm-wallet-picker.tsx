"use client";
// Asks which EVM wallet to use when more than one is installed (EIP-6963).
// One wallet: used directly. Several: the last one chosen in this browser is
// used, unless the user asks to change it; otherwise a small dialog lists them.
import { useEffect, useRef, useState } from "react";
import {
  discoverEvmWallets,
  rememberEvmWallet,
  rememberedEvmWallet,
  type EvmWalletOption,
} from "@/lib/evm-wallets";
import { WalletMissing, WalletRejected } from "@/lib/wallets";
import { secondaryButton } from "./ui";

export type WalletPickerTexts = {
  chooseWallet: string;
  chooseWalletHint: string;
  cancel: string;
};

export function useEvmWalletPicker(texts: WalletPickerTexts) {
  const [options, setOptions] = useState<EvmWalletOption[] | null>(null);
  const resolver = useRef<((picked: EvmWalletOption | null) => void) | null>(null);

  function close(picked: EvmWalletOption | null) {
    resolver.current?.(picked);
    resolver.current = null;
    setOptions(null);
  }

  /** Resolves to the wallet to use; `ask` forces the dialog (the "change wallet" link). */
  async function choose(ask = false): Promise<EvmWalletOption> {
    const list = await discoverEvmWallets();
    if (list.length === 0) throw new WalletMissing("no EVM wallet");
    if (list.length === 1 && !ask) return list[0];
    if (!ask) {
      const remembered = list.find((o) => o.rdns === rememberedEvmWallet());
      if (remembered) return remembered;
    }
    const picked = await new Promise<EvmWalletOption | null>((resolve) => {
      resolver.current = resolve;
      setOptions(list);
    });
    // Same handling as a wallet's own "cancel": the caller shows "rejected".
    if (!picked) throw new WalletRejected("wallet choice cancelled");
    rememberEvmWallet(picked.rdns);
    return picked;
  }

  const element = options ? <PickerDialog options={options} texts={texts} onClose={close} /> : null;
  return { choose, element };
}

function PickerDialog({
  options,
  texts,
  onClose,
}: {
  options: EvmWalletOption[];
  texts: WalletPickerTexts;
  onClose: (picked: EvmWalletOption | null) => void;
}) {
  const remembered = rememberedEvmWallet();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4"
      onClick={(e) => e.target === e.currentTarget && onClose(null)}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="evm-wallet-picker-title" className="w-full max-w-sm border border-slate/30 bg-bone px-6 py-6">
        <p id="evm-wallet-picker-title" className="font-display text-xl text-ink">
          {texts.chooseWallet}
        </p>
        <p className="mt-2 font-body text-xs leading-relaxed text-slate">{texts.chooseWalletHint}</p>
        <ul className="mt-4 space-y-2">
          {options.map((o) => (
            <li key={o.rdns}>
              <button
                autoFocus={o.rdns === remembered}
                onClick={() => onClose(o)}
                className="flex w-full items-center gap-3 border border-slate/30 px-4 py-3 text-left font-body text-sm text-ink transition-colors hover:border-brass focus:border-brass focus:outline-none"
              >
                {o.icon ? (
                  // Wallet-announced data: URI; next/image adds nothing for it.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={o.icon} alt="" width={24} height={24} className="h-6 w-6" />
                ) : (
                  <span className="h-6 w-6 border border-slate/30" aria-hidden />
                )}
                <span className="flex-1">{o.name}</span>
                {o.rdns === remembered && <span className="font-mono text-[11px] text-slate">✓</span>}
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-5 text-right">
          <button className={secondaryButton} onClick={() => onClose(null)}>
            {texts.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}
