"use client";
// EVM wallet discovery (EIP-6963). Every installed wallet announces its own
// provider, so the site can ask which one to use instead of taking whichever
// extension won the race for window.ethereum (with MetaMask and Phantom both
// installed, either can answer). window.ethereum stays as the fallback for
// wallets that do not implement EIP-6963.

export type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

export type EvmWalletOption = {
  /** Reverse-DNS id announced by the wallet (io.metamask, app.phantom, …); "injected" for the fallback. */
  rdns: string;
  name: string;
  /** data:image/… URI announced by the wallet, or null. */
  icon: string | null;
  provider: Eip1193Provider;
};

type AnnounceDetail = {
  info?: { uuid?: string; name?: string; icon?: string; rdns?: string };
  provider?: Eip1193Provider;
};

const announced = new Map<string, EvmWalletOption>();
let listening = false;

function listen() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("eip6963:announceProvider", (event) => {
    const { info, provider } = ((event as CustomEvent).detail ?? {}) as AnnounceDetail;
    if (!info?.rdns || !info.name || typeof provider?.request !== "function") return;
    announced.set(info.rdns, {
      rdns: info.rdns,
      name: info.name.slice(0, 40),
      // Only images: an announced icon is shown in an <img>, never as markup.
      icon: typeof info.icon === "string" && /^data:image\/(svg\+xml|png|jpeg|webp|gif)[;,]/.test(info.icon) ? info.icon : null,
      provider,
    });
  });
}

// Start listening as soon as this module loads, so announcements made at page
// load are not missed.
listen();

function legacyName(ethereum: unknown): string {
  const e = ethereum as { isMetaMask?: boolean; isPhantom?: boolean; isRabby?: boolean; isCoinbaseWallet?: boolean };
  if (e.isPhantom) return "Phantom";
  if (e.isRabby) return "Rabby";
  if (e.isCoinbaseWallet) return "Coinbase Wallet";
  if (e.isMetaMask) return "MetaMask";
  return "Browser wallet";
}

/** Installed EVM wallets, by name. Waits briefly for the wallets to answer. */
export async function discoverEvmWallets(waitMs = 350): Promise<EvmWalletOption[]> {
  listen();
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  await new Promise((r) => setTimeout(r, waitMs));
  const list = [...announced.values()].sort((a, b) => a.name.localeCompare(b.name));
  if (list.length === 0 && window.ethereum) {
    list.push({ rdns: "injected", name: legacyName(window.ethereum), icon: null, provider: window.ethereum });
  }
  return list;
}
