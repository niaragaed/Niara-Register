// Wallets the Niara ecosystem lists by name: established, self-custody, widely
// audited browser wallets. Detected wallets that match an entry are shown
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
};

export const TRUSTED_WALLETS: TrustedWallet[] = [
  { id: "metamask", name: "MetaMask", installUrl: "https://metamask.io/download/", evm: ["io.metamask"] },
  { id: "phantom", name: "Phantom", installUrl: "https://phantom.com/download", evm: ["app.phantom"], solana: ["Phantom"] },
  {
    id: "coinbase",
    name: "Coinbase Wallet",
    installUrl: "https://www.coinbase.com/wallet/downloads",
    evm: ["com.coinbase.wallet"],
    solana: ["Coinbase Wallet"],
  },
  { id: "okx", name: "OKX Wallet", installUrl: "https://www.okx.com/web3", evm: ["com.okex.wallet"], solana: ["OKX Wallet"] },
  { id: "rabby", name: "Rabby", installUrl: "https://rabby.io/", evm: ["io.rabby"] },
  { id: "trust", name: "Trust Wallet", installUrl: "https://trustwallet.com/download", evm: ["com.trustwallet.app"], solana: ["Trust"] },
  { id: "solflare", name: "Solflare", installUrl: "https://solflare.com/download", solana: ["Solflare"] },
  { id: "backpack", name: "Backpack", installUrl: "https://backpack.app/downloads", evm: ["app.backpack"], solana: ["Backpack"] },
];

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
