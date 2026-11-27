/**
 * Which environment variable each source reads for its RPC, printed at startup
 * with the URL redacted, plus a warning for any *_RPC_URL variable that no
 * source reads (a misspelt name is otherwise silently ignored and the source
 * falls back to its default).
 *
 * Keep this table in step with config.ts and exchange-config.ts;
 * test/rpc-sources.test.ts checks it against both.
 */

type Env = Record<string, string | undefined>;

export type RpcSource = {
  /** Sources (checkpoint names / networks) that use this RPC. */
  sources: string;
  /** The variable read. */
  variable: string;
  /** Used when the variable is not set; null = the source is off/not configured without it. */
  fallback: string | null;
  /** The variable holds an API key that the code puts in a URL template, not a URL. */
  keyTemplate?: (key: string) => string;
};

export const RPC_SOURCES: RpcSource[] = [
  {
    sources: "Ethereum Sepolia v1 (pmes, orquestrador, assinaturas) and sepolia-v2",
    variable: "ALCHEMY_API_KEY",
    fallback: null,
    keyTemplate: (key) => `https://eth-sepolia.g.alchemy.com/v2/${key}`,
  },
  { sources: "base-sepolia-assinaturas, base-sepolia-v2", variable: "BASE_SEPOLIA_RPC_URL", fallback: "https://sepolia.base.org" },
  { sources: "robinhood-testnet-assinaturas, robinhood-testnet-v2", variable: "ROBINHOOD_RPC_URL", fallback: "https://rpc.testnet.chain.robinhood.com" },
  { sources: "hyperevm-testnet-assinaturas, hyperevm-testnet-v2", variable: "HYPEREVM_RPC_URL", fallback: "https://rpc.hyperliquid-testnet.xyz/evm" },
  { sources: "tempo-testnet-assinaturas, tempo-testnet-v2", variable: "TEMPO_RPC_URL", fallback: "https://rpc.moderato.tempo.xyz" },
  { sources: "solana (Register v1), solana-v2, pmes-solana", variable: "SOLANA_RPC_URL", fallback: "https://api.devnet.solana.com" },
  { sources: "exchange-solana-devnet", variable: "EXCHANGE_SOLANA_RPC_URL", fallback: null },
  { sources: "exchange-base-sepolia", variable: "EXCHANGE_BASE_SEPOLIA_RPC_URL", fallback: null },
  { sources: "exchange-robinhood-testnet", variable: "EXCHANGE_ROBINHOOD_RPC_URL", fallback: null },
  { sources: "exchange-tempo-testnet", variable: "EXCHANGE_TEMPO_RPC_URL", fallback: null },
  { sources: "exchange-hyperevm-testnet", variable: "EXCHANGE_HYPEREVM_RPC_URL", fallback: null },
];

/** RPC variables read outside the indexer process (scripts), so they are not "unused". */
const READ_BY_SCRIPTS = [
  "SEPOLIA_RPC_URL", // scripts/verify-integrity.ts
  "PMES_SOLANA_TEST_RPC", // test/pmes-solana.test.ts
];

/**
 * Keeps the scheme and host, hides everything that can carry a key: the path
 * (Alchemy /v2/<key>, Infura /v3/<key>, QuickNode /<token>/), the query
 * (Helius ?api-key=) and any user:password.
 */
export function redactRpcUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const path = u.pathname.replace(/\/+$/, "");
    // Public paths with no secret in them stay readable.
    const publicPath = path === "" || /^\/(evm|rpc|v1)?$/i.test(path);
    return `${u.protocol}//${u.host}${publicPath ? path : "/***"}${u.search ? "?***" : ""}`;
  } catch {
    return "(not a valid URL)";
  }
}

export function describeRpcSources(env: Env = process.env): string[] {
  return RPC_SOURCES.map((s) => {
    const value = env[s.variable];
    if (!value) {
      return `${s.sources}: ${s.variable} not set → ${s.fallback ? `default ${s.fallback}` : "source off / not configured"}`;
    }
    const url = s.keyTemplate ? s.keyTemplate(value) : value;
    return `${s.sources}: ${s.variable} = ${redactRpcUrl(url)}`;
  });
}

/** *_RPC_URL variables that are set but that nothing reads. */
export function unusedRpcVariables(env: Env = process.env): string[] {
  const known = new Set([...RPC_SOURCES.map((s) => s.variable), ...READ_BY_SCRIPTS]);
  return Object.keys(env)
    .filter((k) => /RPC(_URL)?$/.test(k) && env[k] && !known.has(k))
    .sort();
}

export function logRpcSources(env: Env = process.env): void {
  for (const line of describeRpcSources(env)) console.log(`[indexer] RPC — ${line}`);
  for (const name of unusedRpcVariables(env)) {
    console.warn(`[indexer] RPC — ${name} is set but no source reads it (misspelt? see indexer/README.md "RPC variables")`);
  }
}
