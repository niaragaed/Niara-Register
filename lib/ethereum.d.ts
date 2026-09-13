// Tipagem mínima do provider injetado por carteiras (MetaMask e compatíveis).
// Não é um pacote de tipos completo — só o suficiente para o que a página
// de assinatura usa (eth_requestAccounts, eth_chainId, wallet_switchEthereumChain).
export {};

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
  }
}
