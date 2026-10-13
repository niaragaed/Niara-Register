import "dotenv/config";

// Indexer configuration. The list of offerings NO LONGER comes from here: it
// lives in the registro_ofertas table (see
// supabase/migrations_004_offerings.sql), seeded with the 11 legacy offerings
// and fed by the indexer itself when OfertaOrquestrador emits
// OfertaCompletaCriada. See db.ts / loadOfferings.
//
// Environment variable names are kept as they were (some in Portuguese, e.g.
// SOLANA_DESATIVADO) so existing deployments keep working.

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export type { TrackedOffering } from "./offerings";

/** Configuration of an additional EVM network, with per-network env overrides. */
function extraEvmNetwork(base: {
  network: "base-sepolia" | "robinhood-testnet" | "hyperevm-testnet" | "tempo-testnet";
  prefix: string;
  chainId: number;
  rpcUrl: string;
  address: string;
  deployBlock: number;
  chunk: number;
  confirmations: number;
  maxChunksPerCycle?: number;
  chunkIntervalMs?: number;
}) {
  const env = (name: string) => process.env[`${base.prefix}_${name}`];
  return {
    network: base.network,
    source: `${base.network}-assinaturas`,
    chainId: base.chainId,
    enabled: env("DESATIVADO") !== "1",
    rpcUrl: base.rpcUrl,
    address: (env("REGISTRO_ASSINATURAS_ENDERECO") ?? base.address) as `0x${string}`,
    deployBlock: Number(env("START_BLOCK") ?? base.deployBlock),
    chunk: Number(env("BLOCK_RANGE_CHUNK") ?? base.chunk),
    maxChunksPerCycle: Number(env("PEDACOS_POR_CICLO") ?? base.maxChunksPerCycle ?? 20),
    chunkIntervalMs: Number(env("INTERVALO_PEDACOS_MS") ?? base.chunkIntervalMs ?? 0),
    confirmations: Number(env("CONFIRMACOES") ?? base.confirmations),
    pollIntervalMs: Number(env("POLL_INTERVAL_MS") ?? 30_000),
  };
}

export const config = {
  rpcUrl: `https://eth-sepolia.g.alchemy.com/v2/${required("ALCHEMY_API_KEY")}`,
  supabaseUrl: required("SUPABASE_URL"),
  supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  // Block to start the pmes source from when there is no saved checkpoint.
  startBlock: Number(process.env.START_BLOCK ?? 0),
  // One eth_getLogs call per cycle in steady state (see index.ts); 30s is
  // ~2.5 Sepolia blocks, still within a single chunk.
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 30_000),
  // eth_getLogs has a range limit on Alchemy's free plan (10 blocks): we
  // process in chunks so we never exceed it.
  blockRangeChunk: Number(process.env.BLOCK_RANGE_CHUNK ?? 500),
  // Backlog work (the orchestrator scan, backfill of new offerings): at most
  // CHUNKS_ATRASO_POR_CICLO calls per cycle, spaced by ATRASO_INTERVALO_MS.
  // The normal batch runs first, every cycle, and does not depend on this.
  // 300 ms ≈ 3 calls/s ≈ 250 CU/s, below the Alchemy free plan rate limit even
  // adding the normal batch.
  backlogChunksPerCycle: Number(process.env.CHUNKS_ATRASO_POR_CICLO ?? 60),
  backlogIntervalMs: Number(process.env.ATRASO_INTERVALO_MS ?? 300),
  // Backoff on rate limit (429): 1s, 2s, 4s, 8s, 16s, 30s… up to 6 attempts.
  backoff: {
    attempts: Number(process.env.BACKOFF_TENTATIVAS ?? 6),
    baseMs: Number(process.env.BACKOFF_BASE_MS ?? 1_000),
    capMs: Number(process.env.BACKOFF_TETO_MS ?? 30_000),
  },

  // The Register's own contract (not the PMEs one): a fixed address, deployed
  // from niaragaed/niara-contracts-Register. The env var only exists for the
  // rare case of a contract redeploy.
  signatureRegistryAddress: (process.env.REGISTRO_ASSINATURAS_ENDERECO ??
    "0x5627857ee73f37d6da96530ed08c07339dd9d93a") as `0x${string}`,
  // RegistroAssinaturas deploy block on Sepolia (see
  // niara-contracts-Register/broadcast/DeployRegistro.s.sol/11155111/run-latest.json).
  startBlockSignatures: Number(process.env.START_BLOCK_ASSINATURAS ?? 11691290),

  // niara-contracts-PMEs's OfertaOrquestrador (self-service offering creation).
  // Deploy block: broadcast/DeployFase2Sepolia.s.sol/11155111/run-latest.json.
  orchestratorAddress: (process.env.ORQUESTRADOR_ENDERECO ??
    "0xde9cc84d1300b57f640f2d1862900393b82796e5").toLowerCase() as `0x${string}`,
  startBlockOrchestrator: Number(process.env.START_BLOCK_ORQUESTRADOR ?? 11733723),

  // Solana devnet: the niara-register-solana program. Its own loop, independent
  // of the EVM batch (see solana.ts). SOLANA_DESATIVADO=1 turns off only this source.
  solana: {
    enabled: process.env.SOLANA_DESATIVADO !== "1",
    rpcUrl: process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
    programId: process.env.SOLANA_PROGRAM_ID ?? "9RPHqLouFjoUbPdcmA1GyHMeDoWvjZMuCyYFPBWLmTcR",
    // Slot of the program deploy on devnet (solana program show): the starting
    // point when there is no saved checkpoint.
    startSlot: Number(process.env.SOLANA_START_SLOT ?? 509235000),
    pollIntervalMs: Number(process.env.SOLANA_POLL_INTERVAL_MS ?? 30_000),
  },

  // Niara-PMEs on Solana devnet: the niara-pmes-solana program. Same ledger as
  // PMEs (registro_transacoes, fonte 'pmes', rede 'solana-devnet'), its own
  // loop (pmes-solana.ts). Uses the same RPC as the signatures source.
  // PMES_SOLANA_DESATIVADO=1 turns off only this source.
  pmesSolana: {
    enabled: process.env.PMES_SOLANA_DESATIVADO !== "1",
    programId: process.env.PMES_SOLANA_PROGRAM_ID ?? "FKefGFhUmgXBM1xCtSFBWpoNnp3wuPJs6Yddpsp67J2y",
    // With no saved checkpoint, starts from the beginning of the program's
    // history (there are few transactions): getSignaturesForAddress pages from
    // newest to oldest until it runs out.
    startSlot: Number(process.env.PMES_SOLANA_START_SLOT ?? 0),
    pollIntervalMs: Number(process.env.PMES_SOLANA_POLL_INTERVAL_MS ?? 30_000),
  },

  // Additional EVM networks with the same RegistroAssinaturas, each in its own
  // loop (see evm-signatures.ts). Per-network variables with their own prefix
  // (BASE_*, ROBINHOOD_*); <PREFIX>_DESATIVADO=1 turns off only that network.
  extraEvmNetworks: [
    extraEvmNetwork({
      network: "base-sepolia",
      prefix: "BASE",
      chainId: 84532,
      // Base's public RPC is enough for the Register's volume; for more
      // headroom, an Alchemy/QuickNode RPC in BASE_SEPOLIA_RPC_URL.
      rpcUrl: process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org",
      // Source: niara-contracts-Register, broadcast/DeployRegistro.s.sol/84532/run-latest.json
      // (block 47915732 = 0x2db22d4). Same address as Sepolia: same wallet, same nonce.
      address: "0x5627857ee73f37d6da96530ed08c07339dd9d93a",
      deployBlock: 47915732,
      // Base's public RPC limits eth_getLogs to 200 blocks per call.
      chunk: 200,
      confirmations: 5,
    }),
    extraEvmNetwork({
      network: "robinhood-testnet",
      prefix: "ROBINHOOD",
      chainId: 46630,
      // Robinhood Chain Testnet public RPC (docs.robinhood.com/chain/connecting);
      // for more headroom, the Alchemy one in ROBINHOOD_RPC_URL.
      rpcUrl: process.env.ROBINHOOD_RPC_URL ?? "https://rpc.testnet.chain.robinhood.com",
      // Source: niara-contracts-Register, broadcast/DeployRegistro.s.sol/46630/run-latest.json
      address: "0x5627857ee73f37d6da96530ed08c07339dd9d93a",
      // block 131998737 = 0x7de2411; same address as the other networks (same wallet, nonce 0).
      deployBlock: 131998737,
      // Arbitrum chain: ~250 ms blocks, so bigger chunks (the public RPC
      // accepted 5000 blocks per eth_getLogs in testing) and a 20-block margin.
      chunk: 2000,
      confirmations: 20,
    }),
    extraEvmNetwork({
      network: "hyperevm-testnet",
      prefix: "HYPEREVM",
      chainId: 998,
      // Official HyperEVM Testnet RPC (hyperliquid.gitbook.io → HyperEVM).
      rpcUrl: process.env.HYPEREVM_RPC_URL ?? "https://rpc.hyperliquid-testnet.xyz/evm",
      // Source: niara-contracts-Register, broadcast/DeployRegistro.s.sol/998/run-latest.json
      address: "0x5627857ee73f37d6da96530ed08c07339dd9d93a",
      // block 66500325 = 0x3f6b6e5; same address as the other networks (same wallet, nonce 0).
      deployBlock: 66500325,
      // The official RPC limits eth_getLogs to 50 blocks and has a tight
      // per-IP rate limit: chunks of 50, up to 30 per cycle, 1 s between them.
      chunk: 50,
      confirmations: 2,
      maxChunksPerCycle: 30,
      chunkIntervalMs: 1000,
    }),
    extraEvmNetwork({
      network: "tempo-testnet",
      prefix: "TEMPO",
      chainId: 42431,
      // Tempo Testnet (Moderato): tempo.xyz/developers/docs/quickstart/connection-details
      rpcUrl: process.env.TEMPO_RPC_URL ?? "https://rpc.moderato.tempo.xyz",
      // Source: niara-contracts-Register, broadcast/DeployRegistro.s.sol/42431/run-latest.json
      address: "0x5627857ee73f37d6da96530ed08c07339dd9d93a",
      // block 38942339 = 0x2523683; same address as the other networks (same wallet, nonce 0).
      deployBlock: 38942339,
      // ~0.5 s blocks with deterministic finality (Simplex BFT); the public RPC
      // accepted 10,000 blocks per eth_getLogs in testing.
      chunk: 5000,
      confirmations: 2,
    }),
  ],

  // Validation mode: reads the chain and the database, but writes nothing (not
  // even the checkpoint). Prints what would be inserted and exits once it
  // catches up with the chain.
  dryRun: process.argv.includes("--dry-run") || process.env.DRY_RUN === "1",
};
