// Minimal typing of the provider injected by Solana wallets (Phantom, Solflare
// and anything compatible with the `window.solana` interface). Only what the
// signing page uses: connect and sign a transaction.
import type { PublicKey, Transaction } from "@solana/web3.js";

export {};

export type SolanaProvider = {
  isPhantom?: boolean;
  publicKey: PublicKey | null;
  connect: () => Promise<{ publicKey: PublicKey }>;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
};

declare global {
  interface Window {
    solana?: SolanaProvider;
    phantom?: { solana?: SolanaProvider };
  }
}
