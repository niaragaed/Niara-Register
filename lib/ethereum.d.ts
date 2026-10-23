// Minimal typing of the provider injected by wallets (MetaMask and compatible).
// Not a full types package: just enough for what the signing page uses
// (eth_requestAccounts, eth_chainId, wallet_switchEthereumChain). With several
// wallets installed the site uses the EIP-6963 announcements instead
// (lib/evm-wallets.ts); window.ethereum is only the fallback.
export {};

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
  }
}
