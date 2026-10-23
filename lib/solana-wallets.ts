"use client";
// Solana wallet discovery through the Wallet Standard (the protocol Phantom,
// Solflare, Backpack, OKX, Coinbase and others register with), adapted to the
// small SolanaProvider interface the pages already use. window.phantom.solana /
// window.solana stay as the fallback for wallets that do not register.
//
// The registration handshake is implemented here (a few lines of the
// standard's app side) instead of pulling in @wallet-standard/app.
import { PublicKey, Transaction } from "@solana/web3.js";
import type { SolanaProvider } from "./solana";
import { walletIcon } from "./wallet-catalog";
import { WalletRejected } from "./wallets";

type StandardAccount = { address: string; publicKey: Uint8Array; chains?: readonly string[] };
type StandardWallet = {
  name: string;
  icon?: string;
  chains: readonly string[];
  accounts: readonly StandardAccount[];
  features: Record<string, unknown>;
};
type ConnectFeature = { connect: (input?: { silent?: boolean }) => Promise<{ accounts: readonly StandardAccount[] }> };
type SignTxFeature = {
  signTransaction: (
    ...inputs: { account: StandardAccount; transaction: Uint8Array; chain?: string }[]
  ) => Promise<readonly { signedTransaction: Uint8Array }[]>;
};
type SignMsgFeature = {
  signMessage: (...inputs: { account: StandardAccount; message: Uint8Array }[]) => Promise<readonly { signature: Uint8Array }[]>;
};

export type SolanaWalletOption = {
  /** Wallet Standard name, or "injected" for the window.solana fallback. */
  key: string;
  name: string;
  icon: string | null;
  provider: SolanaProvider;
};

const CHAIN = "solana:devnet";
const registered = new Set<StandardWallet>();
let started = false;

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  const api = Object.freeze({
    register(...wallets: StandardWallet[]) {
      wallets.forEach((w) => registered.add(w));
      return () => wallets.forEach((w) => registered.delete(w));
    },
  });
  // Wallets loaded after the app call this callback with the api...
  window.addEventListener("wallet-standard:register-wallet", (event) => {
    const callback = (event as CustomEvent).detail;
    if (typeof callback === "function") callback(api);
  });
  // ...and wallets loaded before it listen for this event.
  window.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: api }));
}
start();

const safeIcon = walletIcon;

function adapt(wallet: StandardWallet): SolanaProvider {
  const connectFeature = wallet.features["standard:connect"] as ConnectFeature;
  const signTx = wallet.features["solana:signTransaction"] as SignTxFeature;
  const signMsg = wallet.features["solana:signMessage"] as SignMsgFeature | undefined;
  let account: StandardAccount | null = null;

  const provider: SolanaProvider = {
    publicKey: null,
    async connect() {
      const { accounts } = await connectFeature.connect();
      account = accounts.find((a) => !a.chains || a.chains.some((c) => c.startsWith("solana:"))) ?? null;
      if (!account) throw new WalletRejected("no Solana account shared");
      provider.publicKey = new PublicKey(account.publicKey);
      return { publicKey: provider.publicKey };
    },
    async signTransaction(tx: Transaction) {
      if (!account) throw new WalletRejected("wallet not connected");
      const bytes = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
      const [out] = await signTx.signTransaction({ account, transaction: bytes, chain: CHAIN });
      return Transaction.from(out.signedTransaction);
    },
    signMessage: signMsg
      ? async (message: Uint8Array) => {
          if (!account) throw new WalletRejected("wallet not connected");
          const [out] = await signMsg.signMessage({ account, message });
          return { signature: out.signature };
        }
      : undefined,
  };
  return provider;
}

/** Installed Solana wallets that can connect and sign transactions. */
export async function discoverSolanaWallets(waitMs = 150): Promise<SolanaWalletOption[]> {
  start();
  await new Promise((r) => setTimeout(r, waitMs));
  const list: SolanaWalletOption[] = [...registered]
    .filter(
      (w) =>
        w.chains.some((c) => c.startsWith("solana:")) &&
        typeof (w.features["standard:connect"] as ConnectFeature | undefined)?.connect === "function" &&
        typeof (w.features["solana:signTransaction"] as SignTxFeature | undefined)?.signTransaction === "function",
    )
    .map((w) => ({ key: w.name, name: w.name.slice(0, 40), icon: safeIcon(w.icon), provider: adapt(w) }));
  const seen = new Set<string>();
  const unique = list.filter((o) => (seen.has(o.key) ? false : (seen.add(o.key), true)));
  if (unique.length === 0) {
    const legacy = window.phantom?.solana ?? window.solana;
    if (legacy) unique.push({ key: "injected", name: legacy.isPhantom ? "Phantom" : "Solana wallet", icon: null, provider: legacy });
  }
  return unique.sort((a, b) => a.name.localeCompare(b.name));
}
