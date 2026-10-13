// Minimal typing of the provider injected by wallets (MetaMask and compatible).
// Not a full types package: just enough for what the signing page uses
// (eth_requestAccounts, eth_chainId, wallet_switchEthereumChain).
export {};

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
  }
}
