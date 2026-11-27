/**
 * RPC variables (rpc-sources.ts): the table matches what config.ts and
 * exchange-config.ts actually read, URLs are printed with keys redacted, and
 * a variable nothing reads (e.g. EXCHANGE_HYPERLIQUID_RPC_URL) is reported.
 */
import { loadExchangeConfig } from "../exchange-config";
import { maskSecrets } from "../safe-log";
import { describeRpcSources, redactRpcUrl, RPC_SOURCES, unusedRpcVariables } from "../rpc-sources";

let failures = 0;
function check(c: boolean, d: string) {
  console.log(`${c ? "ok  " : "FAIL"} ${d}`);
  if (!c) failures++;
}

(async () => {
  // config.ts reads process.env when it is imported: set a sentinel per variable first.
  const KEY = "AlchemyKey_0123456789abcdef";
  const sentinel = (v: string) => `https://${v.toLowerCase().replace(/_/g, "-")}.example/secret-${v}`;
  process.env.ALCHEMY_API_KEY = KEY;
  process.env.SUPABASE_URL ??= "http://supabase.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "x";
  for (const s of RPC_SOURCES) if (!s.keyTemplate) process.env[s.variable] = sentinel(s.variable);
  const { config } = await import("../config");

  const evm = (network: string) => config.extraEvmNetworks.find((n) => n.network === network)!.rpcUrl;
  const v2 = (network: string) => config.v2.evm.find((n) => n.network === network)!.rpcUrl;
  check(config.rpcUrl === `https://eth-sepolia.g.alchemy.com/v2/${KEY}` && v2("sepolia") === config.rpcUrl, "Sepolia v1 and v2: ALCHEMY_API_KEY");
  for (const [network, variable] of [
    ["base-sepolia", "BASE_SEPOLIA_RPC_URL"],
    ["robinhood-testnet", "ROBINHOOD_RPC_URL"],
    ["hyperevm-testnet", "HYPEREVM_RPC_URL"],
    ["tempo-testnet", "TEMPO_RPC_URL"],
  ]) {
    check(evm(network) === sentinel(variable) && v2(network) === sentinel(variable), `${network} v1 and v2: ${variable}`);
  }
  check(config.solana.rpcUrl === sentinel("SOLANA_RPC_URL"), "Solana (v1, v2, pmes): SOLANA_RPC_URL");

  const ex = loadExchangeConfig(process.env);
  for (const s of ex.sources) {
    const variable = s.kind === "solana" ? "EXCHANGE_SOLANA_RPC_URL" : `EXCHANGE_${s.source === "exchange-base-sepolia" ? "BASE_SEPOLIA" : s.network.split("-")[0].toUpperCase()}_RPC_URL`;
    check(s.rpcUrl === sentinel(variable) && RPC_SOURCES.some((r) => r.variable === variable), `${s.source}: ${variable}`);
  }

  // A misspelt variable is read by nothing.
  const env = { EXCHANGE_HYPERLIQUID_RPC_URL: "https://x.example/key", EXCHANGE_HYPEREVM_RPC_URL: "https://y.example", SEPOLIA_RPC_URL: "https://z.example" };
  check(unusedRpcVariables(env).join() === "EXCHANGE_HYPERLIQUID_RPC_URL", "EXCHANGE_HYPERLIQUID_RPC_URL: reported as read by no source");
  const hyperCfg = loadExchangeConfig({ EXCHANGE_HYPERLIQUID_RPC_URL: "https://x.example" }).sources.find((s) => s.network === "hyperevm-testnet")!;
  check(hyperCfg.rpcUrl === "" && hyperCfg.missing.includes("EXCHANGE_HYPEREVM_RPC_URL"), "the Exchange HyperEVM source ignores it");

  // Redaction.
  check(redactRpcUrl(`https://base-sepolia.g.alchemy.com/v2/${KEY}`) === "https://base-sepolia.g.alchemy.com/***", "Alchemy key hidden");
  check(redactRpcUrl("https://devnet.helius-rpc.com/?api-key=abc123") === "https://devnet.helius-rpc.com?***", "Helius query key hidden");
  check(redactRpcUrl("https://foo.solana-devnet.quiknode.pro/tok3n/") === "https://foo.solana-devnet.quiknode.pro/***", "QuickNode token hidden");
  check(redactRpcUrl("https://rpc.hyperliquid-testnet.xyz/evm") === "https://rpc.hyperliquid-testnet.xyz/evm" && redactRpcUrl("https://sepolia.base.org") === "https://sepolia.base.org", "public URLs stay readable");
  const lines = describeRpcSources({ ALCHEMY_API_KEY: KEY, EXCHANGE_TEMPO_RPC_URL: `https://tempo-moderato.g.alchemy.com/v2/${KEY}` }).join("\n");
  check(!lines.includes(KEY) && lines.includes("EXCHANGE_TEMPO_RPC_URL = https://tempo-moderato.g.alchemy.com/***"), "startup lines never contain the key");
  check(lines.includes("TEMPO_RPC_URL not set → default https://rpc.moderato.tempo.xyz") && lines.includes("EXCHANGE_BASE_SEPOLIA_RPC_URL not set → source off"), "unset variables: default or off");
  check(
    maskSecrets("https://a.example/?api-key=s3cr3t&x=1 https://b.quiknode.pro/t0k3n/ https://mainnet.infura.io/v3/0123456789abcdef0123") ===
      "https://a.example/?api-key=***&x=1 https://b.quiknode.pro/***/ https://mainnet.infura.io/v3/***",
    "log mask: Helius, QuickNode and Infura keys too",
  );

  console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})();
