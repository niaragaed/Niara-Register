// RegistroAssinaturas: the SAME contract (niaragaed/niara-contracts-Register)
// deployed on more than one EVM network. A contract address is public
// information (anyone can check it on the explorer), so it lives here and not
// in an environment variable: on a redeploy, update only this file.
// Contract, function, event and error names in the ABI are on-chain names.

export type EvmNetwork =
  | "sepolia"
  | "base-sepolia"
  | "robinhood-testnet"
  | "hyperevm-testnet"
  | "tempo-testnet";

export type EvmNetworkConfig = {
  /** chainId in hex, as the wallet returns it in eth_chainId. */
  chainIdHex: string;
  /** Name used when asking the wallet to add the network. */
  chainName: string;
  rpcUrl: string;
  /**
   * Base of the transaction/address links (`${explorer}/tx/<hash>`). Usually a
   * third-party explorer; when `ownExplorer`, it is the site's own route
   * (/explorer/<network>), which reads the transaction straight from the
   * network's RPC.
   */
  explorer: string;
  ownExplorer?: boolean;
  /** Contract deployment transaction (shown on the address page). */
  deployTx?: `0x${string}`;
  /** Gas currency, used when asking the wallet to add the network. */
  currency: { name: string; symbol: string };
  address: `0x${string}`;
};

export const EVM_NETWORKS: Record<EvmNetwork, EvmNetworkConfig> = {
  // Source: script/DeployRegistro.s.sol, broadcast/.../11155111/run-latest.json
  sepolia: {
    chainIdHex: "0xaa36a7", // 11155111
    chainName: "Sepolia",
    currency: { name: "Ether", symbol: "ETH" },
    rpcUrl: "https://rpc.sepolia.org",
    explorer: "https://sepolia.etherscan.io",
    address: "0x5627857ee73f37d6da96530ed08c07339dd9d93a",
  },
  // Source: broadcast/.../84532/run-latest.json; same address as Sepolia
  // because it came from the same deploy wallet with the same nonce (CREATE).
  "base-sepolia": {
    chainIdHex: "0x14a34", // 84532
    chainName: "Base Sepolia",
    currency: { name: "Ether", symbol: "ETH" },
    rpcUrl: "https://sepolia.base.org",
    explorer: "https://sepolia.basescan.org",
    address: "0x5627857ee73f37d6da96530ed08c07339dd9d93a",
  },
  // Source: broadcast/.../46630/run-latest.json. Network data:
  // docs.robinhood.com/chain/connecting
  "robinhood-testnet": {
    chainIdHex: "0xb626", // 46630
    chainName: "Robinhood Chain Testnet",
    currency: { name: "Ether", symbol: "ETH" },
    rpcUrl: "https://rpc.testnet.chain.robinhood.com",
    explorer: "https://explorer.testnet.chain.robinhood.com",
    address: "0x5627857ee73f37d6da96530ed08c07339dd9d93a",
  },
  // Source: broadcast/.../998/run-latest.json. Network data: hyperliquid.gitbook.io
  // (HyperEVM). No working public explorer for the testnet (Oct/2026: Purrsec
  // 404, testnet.hyperevmscan.io does not exist, the community Blockscout is
  // millions of blocks behind), so the links go to the site's own reader.
  "hyperevm-testnet": {
    chainIdHex: "0x3e6", // 998
    chainName: "HyperEVM Testnet",
    currency: { name: "HYPE", symbol: "HYPE" },
    rpcUrl: "https://rpc.hyperliquid-testnet.xyz/evm",
    explorer: "/explorer/hyperevm-testnet",
    ownExplorer: true,
    deployTx: "0xedbc0391b0368ffc182435769d3891d7837f1d2c56a2a76a3f41f0039bf1c517",
    address: "0x5627857ee73f37d6da96530ed08c07339dd9d93a",
  },
  // Source: broadcast/.../42431/run-latest.json. Network data:
  // tempo.xyz/developers/docs/quickstart/connection-details. No native token:
  // fees are paid in stablecoin (pathUSD by default); "USD" is the symbol Tempo
  // itself recommends for wallets.
  "tempo-testnet": {
    chainIdHex: "0xa5bf", // 42431
    chainName: "Tempo Testnet (Moderato)",
    currency: { name: "USD", symbol: "USD" },
    rpcUrl: "https://rpc.moderato.tempo.xyz",
    explorer: "https://explore.testnet.tempo.xyz",
    address: "0x5627857ee73f37d6da96530ed08c07339dd9d93a",
  },
};

export const REGISTRO_ASSINATURAS_ABI = [
  "function registrar(bytes32 hashDocumento, string nomeDocumento, string tipoDocumento) external",
  "function verificar(bytes32 hashDocumento) external view returns (bool existe, address assinante, uint256 timestamp, string nomeDocumento, string tipoDocumento)",
  "event DocumentoRegistrado(bytes32 indexed hashDocumento, address indexed assinante, string nomeDocumento, string tipoDocumento, uint256 timestamp)",
  "error DocumentoJaRegistrado(bytes32 hashDocumento)",
  "error HashInvalido()",
] as const;

/** Route of the site's own reader (works for any EVM network in the list). */
export function readerTxLink(network: EvmNetwork, tx: string): string {
  return `/explorer/${network}/tx/${tx}`;
}

export function readerAddressLink(network: EvmNetwork, address: string): string {
  return `/explorer/${network}/address/${address}`;
}

export function evmTxLink(network: EvmNetwork, tx: string): string {
  return `${EVM_NETWORKS[network].explorer}/tx/${tx}`;
}

export function evmAddressLink(network: EvmNetwork, address: string): string {
  return `${EVM_NETWORKS[network].explorer}/address/${address}`;
}
