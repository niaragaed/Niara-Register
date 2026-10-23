// Wallets the Niara ecosystem lists by name: established, self-custody, widely
// audited wallets (browser extensions, and their mobile apps through the
// in-app browser or WalletConnect). Detected wallets that match an entry are shown
// first; trusted wallets that are missing get an install link to their
// official site; anything else the browser announces is shown apart, marked
// as not on this list.
//
// Matching is by the identifier the wallet announces (EIP-6963 rdns for EVM,
// Wallet Standard name for Solana). An extension can announce any identifier,
// so this list curates what the site recommends; the trust boundary is still
// the extension the user installed.

export type WalletFamily = "evm" | "solana";

export type TrustedWallet = {
  id: string;
  name: string;
  installUrl: string;
  /** EIP-6963 rdns values. */
  evm?: string[];
  /** Wallet Standard names. */
  solana?: string[];
  /** WalletConnect explorer id (featured in the WalletConnect window). */
  walletConnectId?: string;
  /** Hosts a WalletConnect session's peer metadata URL may have for this wallet. */
  walletConnectHosts?: string[];
  /** Link that opens a page inside the wallet's own mobile browser, per family. */
  openInApp?: Partial<Record<WalletFamily, (url: string) => string>>;
};

const enc = encodeURIComponent;
const browseRef = (base: string) => (url: string) => `${base}${enc(url)}?ref=${enc(new URL(url).origin)}`;
const okxLink = (url: string) => `https://www.okx.com/download?deeplink=${enc(`okx://wallet/dapp/url?dappUrl=${enc(url)}`)}`;
const cbLink = (url: string) => `https://go.cb-w.com/dapp?cb_url=${enc(url)}`;

export const TRUSTED_WALLETS: TrustedWallet[] = [
  {
    id: "metamask",
    name: "MetaMask",
    installUrl: "https://metamask.io/download/",
    evm: ["io.metamask"],
    walletConnectId: "c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96",
    walletConnectHosts: ["metamask.io"],
    openInApp: { evm: (url) => `https://metamask.app.link/dapp/${url.replace(/^https?:\/\//, "")}` },
  },
  {
    id: "phantom",
    name: "Phantom",
    installUrl: "https://phantom.com/download",
    evm: ["app.phantom"],
    solana: ["Phantom"],
    walletConnectId: "a797aa35c0fadbfc1a53e7f675162ed5226968b44a19ee3d24385c64d1d3c393",
    walletConnectHosts: ["phantom.app", "phantom.com"],
    openInApp: { evm: browseRef("https://phantom.app/ul/browse/"), solana: browseRef("https://phantom.app/ul/browse/") },
  },
  {
    id: "coinbase",
    name: "Coinbase Wallet",
    installUrl: "https://www.coinbase.com/wallet/downloads",
    evm: ["com.coinbase.wallet"],
    solana: ["Coinbase Wallet"],
    walletConnectId: "fd20dc426fb37566d803205b19bbc1d4096b248ac04548e3cfb6b3a38bd033aa",
    walletConnectHosts: ["coinbase.com"],
    openInApp: { evm: cbLink, solana: cbLink },
  },
  {
    id: "okx",
    name: "OKX Wallet",
    installUrl: "https://www.okx.com/web3",
    evm: ["com.okex.wallet"],
    solana: ["OKX Wallet"],
    walletConnectId: "971e689d0a5be527bac79629b4ee9b925e82208e5168b733496a09c0faed0709",
    walletConnectHosts: ["okx.com"],
    openInApp: { evm: okxLink, solana: okxLink },
  },
  { id: "rabby", name: "Rabby", installUrl: "https://rabby.io/", evm: ["io.rabby"], walletConnectHosts: ["rabby.io"] },
  {
    id: "trust",
    name: "Trust Wallet",
    installUrl: "https://trustwallet.com/download",
    evm: ["com.trustwallet.app"],
    solana: ["Trust"],
    walletConnectId: "4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0",
    walletConnectHosts: ["trustwallet.com"],
    openInApp: {
      evm: (url) => `https://link.trustwallet.com/open_url?coin_id=60&url=${enc(url)}`,
      solana: (url) => `https://link.trustwallet.com/open_url?coin_id=501&url=${enc(url)}`,
    },
  },
  {
    id: "solflare",
    name: "Solflare",
    installUrl: "https://solflare.com/download",
    solana: ["Solflare"],
    openInApp: { solana: browseRef("https://solflare.com/ul/v1/browse/") },
  },
  { id: "backpack", name: "Backpack", installUrl: "https://backpack.app/downloads", evm: ["app.backpack"], solana: ["Backpack"] },
];

/**
 * The icon a wallet announced about itself, if it is an inline image. Shown
 * only through <img>, which never runs scripts, so any data:image type is
 * fine; case and surrounding whitespace vary between wallets.
 */
export function walletIcon(icon: unknown): string | null {
  if (typeof icon !== "string") return null;
  const value = icon.trim();
  return /^data:image\/[a-z0-9.+-]+[;,]/i.test(value) ? value : null;
}

export function trustedFor(family: WalletFamily): TrustedWallet[] {
  return TRUSTED_WALLETS.filter((w) => (family === "evm" ? w.evm : w.solana));
}

/** The catalog entry a detected wallet belongs to, if any. */
export function matchTrusted(family: WalletFamily, key: string): TrustedWallet | null {
  return TRUSTED_WALLETS.find((w) => (family === "evm" ? w.evm : w.solana)?.includes(key)) ?? null;
}

// The last wallet used per family, a per-browser convenience (it only orders
// the list; the site always asks). Storage may be unavailable (private mode).
const storageKey = (family: WalletFamily) => `niara.${family}-wallet`;

export function rememberedWallet(family: WalletFamily): string | null {
  try {
    return window.localStorage.getItem(storageKey(family));
  } catch {
    return null;
  }
}

export function rememberWallet(family: WalletFamily, key: string) {
  try {
    window.localStorage.setItem(storageKey(family), key);
  } catch {
    // Nothing to do.
  }
}

/** The listed wallet a WalletConnect peer belongs to, judged by its metadata URL. */
export function matchWalletConnectPeer(peerUrl: string | undefined): TrustedWallet | null {
  let host = "";
  try {
    host = new URL(peerUrl ?? "").hostname.toLowerCase();
  } catch {
    return null;
  }
  return TRUSTED_WALLETS.find((w) => w.walletConnectHosts?.some((h) => host === h || host.endsWith(`.${h}`))) ?? null;
}
