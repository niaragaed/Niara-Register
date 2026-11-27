/**
 * Niara Exchange settlement sources: one per network, configured only from
 * environment variables. No contract address or RPC URL is hard-coded here:
 * a network whose variables are missing is reported as "not configured" and
 * skipped, never guessed.
 *
 * Where the values come from (read-only sources, see README "Exchange
 * settlements"):
 * - EVM: niara-contracts, `broadcast/Deploy.s.sol/<chainId>/run-latest.json`
 *   (CREATE receipts of NiaraSettlement and CashbackDistributor) and the
 *   "v1 deployments" section of its README.
 * - Solana: niara-exchange-solana, `declare_id!` in programs/niara_exchange/src/lib.rs
 *   and docs/devnet-deploy.md (deploy slot).
 *
 * The slugs below are also the public URL segments of /global-registry/{network}/{tx}
 * and the `network` column of exchange_settlements: never rename them.
 */

export type ExchangeNetwork =
  | "solana-devnet"
  | "base-sepolia"
  | "robinhood-testnet"
  | "tempo-testnet"
  | "hyperevm-testnet";

export const EXCHANGE_NETWORKS: ExchangeNetwork[] = [
  "solana-devnet",
  "base-sepolia",
  "robinhood-testnet",
  "tempo-testnet",
  "hyperevm-testnet",
];

export type EvmExchangeNetwork = Exclude<ExchangeNetwork, "solana-devnet">;

export type EvmExchangeConfig = {
  kind: "evm";
  network: EvmExchangeNetwork;
  /** registro_checkpoints.fonte of this source. */
  source: string;
  chainId: number;
  enabled: boolean;
  /** Names of required variables that are missing (empty = configured). */
  missing: string[];
  rpcUrl: string;
  settlement: string;
  cashbackDistributor: string;
  /** NiaraSettlement deploy block: the first block scanned when there is no cursor. */
  startBlock: number;
  /**
   * "finalized": scan up to the RPC's `finalized` block. "depth": up to
   * latest − confirmations. In "finalized" mode an RPC that rejects the tag
   * falls back to "depth" for that cycle.
   */
  finality: "finalized" | "depth";
  confirmations: number;
  /** Largest eth_getLogs range tried; halved when the RPC refuses a range, doubled back after successes. */
  maxBlockRange: number;
  /** Floor of the adaptive range: never halved below it. */
  minBlockRange: number;
  /** One cycle keeps fetching ranges until this much time has passed (a range in flight finishes). */
  cycleBudgetMs: number;
  /** Optional hard cap of ranges per cycle (default: none, the budget decides). */
  maxRangesPerCycle: number;
  /** A progress line (block, head, blocks/s, ETA) every N ranges; 0 turns it off. */
  progressEveryChunks: number;
  rangeIntervalMs: number;
  pollIntervalMs: number;
};

export type SolanaExchangeConfig = {
  kind: "solana";
  network: "solana-devnet";
  source: string;
  enabled: boolean;
  missing: string[];
  rpcUrl: string;
  programId: string;
  /** Slot of the program deploy: the cursor when there is none. */
  startSlot: number;
  pollIntervalMs: number;
};

export type ExchangeSourceConfig = EvmExchangeConfig | SolanaExchangeConfig;

type Env = Record<string, string | undefined>;

function flag(env: Env, name: string): boolean {
  return env[name] === "1" || env[name]?.toLowerCase() === "true";
}

function num(env: Env, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number, got "${raw}"`);
  return value;
}

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BASE58_KEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function evmNetwork(
  env: Env,
  base: {
    network: EvmExchangeNetwork;
    prefix: string;
    chainId: number;
    /** HyperEVM: off until the contracts are deployed there. */
    defaultEnabled: boolean;
    confirmations: number;
    maxBlockRange: number;
    maxRangesPerCycle?: number;
    rangeIntervalMs?: number;
  },
): EvmExchangeConfig {
  const p = `EXCHANGE_${base.prefix}`;
  const enabled = base.defaultEnabled ? !flag(env, `${p}_DISABLED`) : flag(env, `${p}_ENABLED`) && !flag(env, `${p}_DISABLED`);

  const missing: string[] = [];
  const rpcUrl = env[`${p}_RPC_URL`] ?? "";
  if (!rpcUrl) missing.push(`${p}_RPC_URL`);
  const settlement = (env[`${p}_SETTLEMENT`] ?? "").toLowerCase();
  if (!EVM_ADDRESS.test(settlement)) missing.push(`${p}_SETTLEMENT`);
  const cashbackDistributor = (env[`${p}_CASHBACK_DISTRIBUTOR`] ?? "").toLowerCase();
  if (!EVM_ADDRESS.test(cashbackDistributor)) missing.push(`${p}_CASHBACK_DISTRIBUTOR`);
  const startRaw = env[`${p}_START_BLOCK`];
  if (!startRaw || !/^\d+$/.test(startRaw)) missing.push(`${p}_START_BLOCK`);

  const finality = env[`${p}_FINALITY`] === "depth" ? "depth" : "finalized";

  return {
    kind: "evm",
    network: base.network,
    source: `exchange-${base.network}`,
    chainId: base.chainId,
    enabled,
    missing,
    rpcUrl,
    settlement,
    cashbackDistributor,
    startBlock: startRaw && /^\d+$/.test(startRaw) ? Number(startRaw) : 0,
    finality,
    confirmations: num(env, `${p}_CONFIRMATIONS`, base.confirmations),
    maxBlockRange: Math.max(1, num(env, `${p}_MAX_BLOCK_RANGE`, base.maxBlockRange)),
    minBlockRange: Math.max(1, num(env, `${p}_MIN_BLOCK_RANGE`, 1)),
    cycleBudgetMs: Math.max(1000, num(env, `${p}_CYCLE_BUDGET_MS`, num(env, "EXCHANGE_CYCLE_BUDGET_MS", 45_000))),
    maxRangesPerCycle: Math.max(1, num(env, `${p}_RANGES_PER_CYCLE`, base.maxRangesPerCycle ?? Number.MAX_SAFE_INTEGER)),
    progressEveryChunks: Math.floor(num(env, `${p}_PROGRESS_EVERY_CHUNKS`, num(env, "EXCHANGE_PROGRESS_EVERY_CHUNKS", 50))),
    rangeIntervalMs: num(env, `${p}_RANGE_INTERVAL_MS`, base.rangeIntervalMs ?? 0),
    pollIntervalMs: num(env, `${p}_POLL_INTERVAL_MS`, num(env, "EXCHANGE_POLL_INTERVAL_MS", 30_000)),
  };
}

export function loadExchangeConfig(env: Env = process.env) {
  const solanaMissing: string[] = [];
  const solanaRpc = env.EXCHANGE_SOLANA_RPC_URL ?? "";
  if (!solanaRpc) solanaMissing.push("EXCHANGE_SOLANA_RPC_URL");
  const programId = env.EXCHANGE_SOLANA_PROGRAM_ID ?? "";
  if (!BASE58_KEY.test(programId)) solanaMissing.push("EXCHANGE_SOLANA_PROGRAM_ID");
  const startSlotRaw = env.EXCHANGE_SOLANA_START_SLOT;
  if (!startSlotRaw || !/^\d+$/.test(startSlotRaw)) solanaMissing.push("EXCHANGE_SOLANA_START_SLOT");

  const solana: SolanaExchangeConfig = {
    kind: "solana",
    network: "solana-devnet",
    source: "exchange-solana-devnet",
    enabled: !flag(env, "EXCHANGE_SOLANA_DISABLED"),
    missing: solanaMissing,
    rpcUrl: solanaRpc,
    programId,
    startSlot: startSlotRaw && /^\d+$/.test(startSlotRaw) ? Number(startSlotRaw) : 0,
    pollIntervalMs: num(env, "EXCHANGE_SOLANA_POLL_INTERVAL_MS", num(env, "EXCHANGE_POLL_INTERVAL_MS", 30_000)),
  };

  const sources: ExchangeSourceConfig[] = [
    solana,
    // Base Sepolia: OP Stack, `finalized` tag supported.
    evmNetwork(env, { network: "base-sepolia", prefix: "BASE_SEPOLIA", chainId: 84532, defaultEnabled: true, confirmations: 10, maxBlockRange: 10000 }),
    // Robinhood Chain testnet: Arbitrum Orbit (~250 ms blocks), `finalized` tag supported.
    evmNetwork(env, { network: "robinhood-testnet", prefix: "ROBINHOOD", chainId: 46630, defaultEnabled: true, confirmations: 40, maxBlockRange: 20000 }),
    // Tempo testnet (Moderato): deterministic finality, `finalized` tag supported.
    evmNetwork(env, { network: "tempo-testnet", prefix: "TEMPO", chainId: 42431, defaultEnabled: true, confirmations: 2, maxBlockRange: 10000 }),
    // HyperEVM testnet: in the list, OFF until NiaraSettlement is deployed there
    // (niara-contracts has only a dry run for chain 998). The official RPC caps
    // eth_getLogs at 50 blocks and rate-limits per IP.
    evmNetwork(env, {
      network: "hyperevm-testnet",
      prefix: "HYPEREVM",
      chainId: 998,
      defaultEnabled: false,
      confirmations: 2,
      maxBlockRange: 50,
      rangeIntervalMs: 1000,
    }),
  ];

  return {
    /** EXCHANGE_INDEXER_DISABLED=1 turns every settlement source off (the API keeps running). */
    indexerEnabled: !flag(env, "EXCHANGE_INDEXER_DISABLED"),
    sources,
    lease: {
      name: "exchange-settlements",
      ttlSeconds: Math.max(15, num(env, "EXCHANGE_LEASE_TTL_SECONDS", 90)),
    },
    api: {
      enabled: !flag(env, "EXCHANGE_API_DISABLED"),
      /** Railway injects PORT when the service has a public domain. */
      port: num(env, "PORT", 8080),
      corsOrigins: (env.API_CORS_ORIGINS ?? "https://register.niaraglobal.com,https://niara-register.vercel.app")
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean),
    },
  };
}

export type ExchangeConfig = ReturnType<typeof loadExchangeConfig>;

export function isExchangeNetwork(value: string): value is ExchangeNetwork {
  return (EXCHANGE_NETWORKS as string[]).includes(value);
}
