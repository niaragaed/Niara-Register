// Tipagem mínima do provider injetado por carteiras Solana (Phantom, Solflare
// e compatíveis com a interface `window.solana`). Só o que a página de
// assinatura usa: conectar e assinar uma transação.
import type { PublicKey, Transaction } from "@solana/web3.js";

export {};

export type ProviderSolana = {
  isPhantom?: boolean;
  publicKey: PublicKey | null;
  connect: () => Promise<{ publicKey: PublicKey }>;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
};

declare global {
  interface Window {
    solana?: ProviderSolana;
    phantom?: { solana?: ProviderSolana };
  }
}
