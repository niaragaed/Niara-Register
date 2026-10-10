import "dotenv/config";

// Configuração do indexer. A lista de ofertas NÃO vem mais daqui: vive na
// tabela registro_ofertas (ver supabase/migrations_004_registro_ofertas.sql),
// semeada com as 11 legadas e alimentada pelo próprio indexer quando o
// OfertaOrquestrador emite OfertaCompletaCriada. Ver db.ts / carregarOfertas.

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return value;
}

export type { OfertaMonitorada } from "./ofertas";

/** Configuração de uma rede EVM adicional, com override por variável de ambiente. */
function redeEvmExtra(base: {
  rede: "base-sepolia" | "robinhood-testnet" | "hyperevm-testnet" | "tempo-testnet";
  prefixo: string;
  chainId: number;
  rpcUrl: string;
  endereco: string;
  blocoDeploy: number;
  chunk: number;
  confirmacoes: number;
  maxPedacosPorCiclo?: number;
  intervaloEntrePedacosMs?: number;
}) {
  const env = (nome: string) => process.env[`${base.prefixo}_${nome}`];
  return {
    rede: base.rede,
    fonte: `${base.rede}-assinaturas`,
    chainId: base.chainId,
    ativo: env("DESATIVADO") !== "1",
    rpcUrl: base.rpcUrl,
    endereco: (env("REGISTRO_ASSINATURAS_ENDERECO") ?? base.endereco) as `0x${string}`,
    blocoDeploy: Number(env("START_BLOCK") ?? base.blocoDeploy),
    chunk: Number(env("BLOCK_RANGE_CHUNK") ?? base.chunk),
    maxPedacosPorCiclo: Number(env("PEDACOS_POR_CICLO") ?? base.maxPedacosPorCiclo ?? 20),
    intervaloEntrePedacosMs: Number(env("INTERVALO_PEDACOS_MS") ?? base.intervaloEntrePedacosMs ?? 0),
    confirmacoes: Number(env("CONFIRMACOES") ?? base.confirmacoes),
    pollIntervalMs: Number(env("POLL_INTERVAL_MS") ?? 30_000),
  };
}

export const config = {
  rpcUrl: `https://eth-sepolia.g.alchemy.com/v2/${required("ALCHEMY_API_KEY")}`,
  supabaseUrl: required("SUPABASE_URL"),
  supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  // Bloco a partir do qual começar a fonte pmes se não houver checkpoint salvo.
  startBlock: Number(process.env.START_BLOCK ?? 0),
  // Uma chamada eth_getLogs por ciclo em regime normal (ver index.ts); 30s
  // corresponde a ~2,5 blocos da Sepolia, ainda dentro de um único pedaço.
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 30_000),
  // eth_getLogs tem limite de range no plano gratuito da Alchemy (10 blocos) —
  // processamos em pedaços pra nunca estourar o limite.
  blockRangeChunk: Number(process.env.BLOCK_RANGE_CHUNK ?? 500),
  // Trabalho atrasado (varredura do orquestrador, backfill de ofertas novas):
  // no máximo CHUNKS_ATRASO_POR_CICLO chamadas por ciclo, espaçadas por
  // ATRASO_INTERVALO_MS. O lote normal roda antes, em todo ciclo, e não depende
  // disso. 300 ms ≈ 3 chamadas/s ≈ 250 CU/s, abaixo do limite de taxa do plano
  // free da Alchemy mesmo somando o lote normal.
  chunksAtrasoPorCiclo: Number(process.env.CHUNKS_ATRASO_POR_CICLO ?? 60),
  atrasoIntervaloMs: Number(process.env.ATRASO_INTERVALO_MS ?? 300),
  // Backoff em limite de taxa (429): 1s, 2s, 4s, 8s, 16s, 30s… até 6 tentativas.
  backoff: {
    tentativas: Number(process.env.BACKOFF_TENTATIVAS ?? 6),
    baseMs: Number(process.env.BACKOFF_BASE_MS ?? 1_000),
    tetoMs: Number(process.env.BACKOFF_TETO_MS ?? 30_000),
  },

  // Contrato próprio do Register (não do PMEs) — endereço fixo, deployado em
  // niaragaed/niara-contracts-Register. A env var só existe para o caso raro de
  // um redeploy do contrato.
  registroAssinaturasEndereco: (process.env.REGISTRO_ASSINATURAS_ENDERECO ??
    "0x5627857ee73f37d6da96530ed08c07339dd9d93a") as `0x${string}`,
  // Bloco do deploy do RegistroAssinaturas na Sepolia (ver
  // niara-contracts-Register/broadcast/DeployRegistro.s.sol/11155111/run-latest.json).
  startBlockAssinaturas: Number(process.env.START_BLOCK_ASSINATURAS ?? 11691290),

  // OfertaOrquestrador do niara-contracts-PMEs (criação self-service de ofertas).
  // Bloco do deploy: broadcast/DeployFase2Sepolia.s.sol/11155111/run-latest.json.
  orquestradorEndereco: (process.env.ORQUESTRADOR_ENDERECO ??
    "0xde9cc84d1300b57f640f2d1862900393b82796e5").toLowerCase() as `0x${string}`,
  startBlockOrquestrador: Number(process.env.START_BLOCK_ORQUESTRADOR ?? 11733723),

  // Solana devnet — programa niara-register-solana. Laço próprio, independente
  // do lote EVM (ver solana.ts). SOLANA_DESATIVADO=1 desliga só esta fonte.
  solana: {
    ativo: process.env.SOLANA_DESATIVADO !== "1",
    rpcUrl: process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
    programId: process.env.SOLANA_PROGRAM_ID ?? "9RPHqLouFjoUbPdcmA1GyHMeDoWvjZMuCyYFPBWLmTcR",
    // Slot do deploy do programa na devnet (solana program show) — ponto de
    // partida sem checkpoint salvo.
    slotInicial: Number(process.env.SOLANA_START_SLOT ?? 509235000),
    pollIntervalMs: Number(process.env.SOLANA_POLL_INTERVAL_MS ?? 30_000),
  },

  // Redes EVM adicionais com o mesmo RegistroAssinaturas, cada uma num laço
  // próprio (ver evm-assinaturas.ts). Variáveis por rede com prefixo próprio
  // (BASE_*, ROBINHOOD_*); <PREFIXO>_DESATIVADO=1 desliga só aquela rede.
  redesEvmExtras: [
    redeEvmExtra({
      rede: "base-sepolia",
      prefixo: "BASE",
      chainId: 84532,
      // O RPC público da Base basta para o volume do Register; para mais folga,
      // um RPC da Alchemy/QuickNode em BASE_SEPOLIA_RPC_URL.
      rpcUrl: process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org",
      // Fonte: niara-contracts-Register, broadcast/DeployRegistro.s.sol/84532/run-latest.json
      // (bloco 47915732 = 0x2db22d4). Mesmo endereço da Sepolia: mesma carteira, mesmo nonce.
      endereco: "0x5627857ee73f37d6da96530ed08c07339dd9d93a",
      blocoDeploy: 47915732,
      // O RPC público da Base limita eth_getLogs a 200 blocos por chamada.
      chunk: 200,
      confirmacoes: 5,
    }),
    redeEvmExtra({
      rede: "robinhood-testnet",
      prefixo: "ROBINHOOD",
      chainId: 46630,
      // RPC público da Robinhood Chain Testnet (docs.robinhood.com/chain/connecting);
      // para mais folga, o da Alchemy em ROBINHOOD_RPC_URL.
      rpcUrl: process.env.ROBINHOOD_RPC_URL ?? "https://rpc.testnet.chain.robinhood.com",
      // Fonte: niara-contracts-Register, broadcast/DeployRegistro.s.sol/46630/run-latest.json
      endereco: "0x5627857ee73f37d6da96530ed08c07339dd9d93a",
      // bloco 131998737 = 0x7de2411; mesmo endereço das outras redes (mesma carteira, nonce 0).
      blocoDeploy: 131998737,
      // Chain Arbitrum: blocos de ~250 ms, então pedaços maiores (o RPC público
      // aceitou 5000 blocos por eth_getLogs em teste) e margem de 20 blocos.
      chunk: 2000,
      confirmacoes: 20,
    }),
    redeEvmExtra({
      rede: "hyperevm-testnet",
      prefixo: "HYPEREVM",
      chainId: 998,
      // RPC oficial da HyperEVM Testnet (hyperliquid.gitbook.io → HyperEVM).
      rpcUrl: process.env.HYPEREVM_RPC_URL ?? "https://rpc.hyperliquid-testnet.xyz/evm",
      // Fonte: niara-contracts-Register, broadcast/DeployRegistro.s.sol/998/run-latest.json
      endereco: "0x5627857ee73f37d6da96530ed08c07339dd9d93a",
      // bloco 66500325 = 0x3f6b6e5; mesmo endereço das outras redes (mesma carteira, nonce 0).
      blocoDeploy: 66500325,
      // O RPC oficial limita eth_getLogs a 50 blocos e tem limite de taxa por
      // IP apertado: pedaços de 50, até 30 por ciclo, 1 s entre eles.
      chunk: 50,
      confirmacoes: 2,
      maxPedacosPorCiclo: 30,
      intervaloEntrePedacosMs: 1000,
    }),
    redeEvmExtra({
      rede: "tempo-testnet",
      prefixo: "TEMPO",
      chainId: 42431,
      // Tempo Testnet (Moderato) — tempo.xyz/developers/docs/quickstart/connection-details
      rpcUrl: process.env.TEMPO_RPC_URL ?? "https://rpc.moderato.tempo.xyz",
      // Fonte: niara-contracts-Register, broadcast/DeployRegistro.s.sol/42431/run-latest.json
      endereco: "0x5627857ee73f37d6da96530ed08c07339dd9d93a",
      // bloco 38942339 = 0x2523683; mesmo endereço das outras redes (mesma carteira, nonce 0).
      blocoDeploy: 38942339,
      // Blocos de ~0,5 s com finalidade determinística (Simplex BFT); o RPC
      // público aceitou 10 000 blocos por eth_getLogs em teste.
      chunk: 5000,
      confirmacoes: 2,
    }),
  ],

  // Modo de validação: lê a chain e o banco, mas não grava nada (nem
  // checkpoint). Imprime o que seria inserido e encerra ao alcançar a chain.
  dryRun: process.argv.includes("--dry-run") || process.env.DRY_RUN === "1",
};
