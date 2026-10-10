// RegistroAssinaturas — o MESMO contrato (niaragaed/niara-contracts-Register)
// deployado em mais de uma rede EVM. Endereço de contrato é informação pública
// (qualquer um confere no explorador), então fica aqui e não em variável de
// ambiente — se houver redeploy, atualizar só este arquivo.

export type RedeEvm =
  | "sepolia"
  | "base-sepolia"
  | "robinhood-testnet"
  | "hyperevm-testnet"
  | "tempo-testnet";

export type ConfigRedeEvm = {
  /** chainId em hex, como a carteira devolve em eth_chainId. */
  chainIdHex: string;
  /** Nome usado ao pedir para a carteira adicionar a rede. */
  chainName: string;
  rpcUrl: string;
  /**
   * Base dos links de transação/endereço (`${explorer}/tx/<hash>`). Normalmente
   * um explorador de terceiros; quando `explorerProprio`, é a rota do próprio
   * site (/explorer/<rede>), que lê a transação direto do RPC da rede.
   */
  explorer: string;
  explorerProprio?: boolean;
  /** Transação de deploy do contrato (mostrada na página do endereço). */
  txDeploy?: `0x${string}`;
  /** Moeda de gás, usada ao pedir para a carteira adicionar a rede. */
  moeda: { name: string; symbol: string };
  endereco: `0x${string}`;
};

export const REDES_EVM: Record<RedeEvm, ConfigRedeEvm> = {
  // Fonte: script/DeployRegistro.s.sol, broadcast/.../11155111/run-latest.json
  sepolia: {
    chainIdHex: "0xaa36a7", // 11155111
    chainName: "Sepolia",
    moeda: { name: "Ether", symbol: "ETH" },
    rpcUrl: "https://rpc.sepolia.org",
    explorer: "https://sepolia.etherscan.io",
    endereco: "0x5627857ee73f37d6da96530ed08c07339dd9d93a",
  },
  // Fonte: broadcast/.../84532/run-latest.json — mesmo endereço da Sepolia
  // porque saiu da mesma carteira de deploy com o mesmo nonce (CREATE).
  "base-sepolia": {
    chainIdHex: "0x14a34", // 84532
    chainName: "Base Sepolia",
    moeda: { name: "Ether", symbol: "ETH" },
    rpcUrl: "https://sepolia.base.org",
    explorer: "https://sepolia.basescan.org",
    endereco: "0x5627857ee73f37d6da96530ed08c07339dd9d93a",
  },
  // Fonte: broadcast/.../46630/run-latest.json. Dados da rede:
  // docs.robinhood.com/chain/connecting
  "robinhood-testnet": {
    chainIdHex: "0xb626", // 46630
    chainName: "Robinhood Chain Testnet",
    moeda: { name: "Ether", symbol: "ETH" },
    rpcUrl: "https://rpc.testnet.chain.robinhood.com",
    explorer: "https://explorer.testnet.chain.robinhood.com",
    endereco: "0x5627857ee73f37d6da96530ed08c07339dd9d93a",
  },
  // Fonte: broadcast/.../998/run-latest.json. Dados da rede: hyperliquid.gitbook.io
  // (HyperEVM). Sem explorador público funcionando para a testnet (out/2026:
  // Purrsec 404, testnet.hyperevmscan.io inexistente, Blockscout comunitário
  // milhões de blocos atrás) — os links vão para o leitor do próprio site.
  "hyperevm-testnet": {
    chainIdHex: "0x3e6", // 998
    chainName: "HyperEVM Testnet",
    moeda: { name: "HYPE", symbol: "HYPE" },
    rpcUrl: "https://rpc.hyperliquid-testnet.xyz/evm",
    explorer: "/explorer/hyperevm-testnet",
    explorerProprio: true,
    txDeploy: "0xedbc0391b0368ffc182435769d3891d7837f1d2c56a2a76a3f41f0039bf1c517",
    endereco: "0x5627857ee73f37d6da96530ed08c07339dd9d93a",
  },
  // Fonte: broadcast/.../42431/run-latest.json. Dados da rede:
  // tempo.xyz/developers/docs/quickstart/connection-details. Sem token nativo:
  // as taxas saem em stablecoin (pathUSD por padrão); "USD" é o símbolo que a
  // própria Tempo recomenda para carteiras.
  "tempo-testnet": {
    chainIdHex: "0xa5bf", // 42431
    chainName: "Tempo Testnet (Moderato)",
    moeda: { name: "USD", symbol: "USD" },
    rpcUrl: "https://rpc.moderato.tempo.xyz",
    explorer: "https://explore.testnet.tempo.xyz",
    endereco: "0x5627857ee73f37d6da96530ed08c07339dd9d93a",
  },
};

export const REGISTRO_ASSINATURAS_ABI = [
  "function registrar(bytes32 hashDocumento, string nomeDocumento, string tipoDocumento) external",
  "function verificar(bytes32 hashDocumento) external view returns (bool existe, address assinante, uint256 timestamp, string nomeDocumento, string tipoDocumento)",
  "event DocumentoRegistrado(bytes32 indexed hashDocumento, address indexed assinante, string nomeDocumento, string tipoDocumento, uint256 timestamp)",
  "error DocumentoJaRegistrado(bytes32 hashDocumento)",
  "error HashInvalido()",
] as const;

/** Rota do leitor próprio (funciona para qualquer rede EVM da lista). */
export function linkLeitorTx(rede: RedeEvm, tx: string): string {
  return `/explorer/${rede}/tx/${tx}`;
}

export function linkLeitorEndereco(rede: RedeEvm, endereco: string): string {
  return `/explorer/${rede}/address/${endereco}`;
}

export function linkTxEvm(rede: RedeEvm, tx: string): string {
  return `${REDES_EVM[rede].explorer}/tx/${tx}`;
}

export function linkEnderecoEvm(rede: RedeEvm, endereco: string): string {
  return `${REDES_EVM[rede].explorer}/address/${endereco}`;
}
