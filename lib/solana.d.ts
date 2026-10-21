// Minimal typing of the provider injected by Solana wallets (Phantom, Solflare
// and anything compatible with the `window.solana` interface). Only what the
// pages use: connect, sign a transaction and sign a message (presentations).
import type { PublicKey, Transaction } from "@solana/web3.js";

export {};

export type SolanaProvider = {
  isPhantom?: boolean;
  publicKey: PublicKey | null;
  connect: () => Promise<{ publicKey: PublicKey }>;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
  signMessage?: (message: Uint8Array, display?: "utf8" | "hex") => Promise<{ signature: Uint8Array }>;
};

declare global {
  interface Window {
    solana?: SolanaProvider;
    phantom?: { solana?: SolanaProvider };
  }
}
