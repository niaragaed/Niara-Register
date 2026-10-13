import { formatWithOptions } from "node:util";

/**
 * No indexer log may contain the Alchemy key.
 *
 * The key goes inside the RPC URL (…/v2/<key>), and ethers copies that URL into
 * every error it throws: in the info.requestUrl field and in the message text
 * itself. Since the indexer prints the whole error object, the key used to show
 * up in the Railway logs on every network failure.
 *
 * Instead of cleaning errors one by one (easy to miss a path), this module
 * wraps console.log/info/warn/error/debug: the arguments are formatted exactly
 * as the console would and the final text goes through the mask before being
 * written. Import this file BEFORE any other one at every entry point
 * (index.ts, scripts/*).
 */

const URL_WITH_KEY = /\/v2\/[A-Za-z0-9_-]+/g;

export function maskSecrets(text: string): string {
  let masked = text.replace(URL_WITH_KEY, "/v2/***");
  // Also the bare key, in case it shows up outside a URL. Read on every call
  // because dotenv may load after this module.
  const key = process.env.ALCHEMY_API_KEY;
  if (key && key.length >= 8) masked = masked.split(key).join("***");
  return masked;
}

const methods = ["log", "info", "warn", "error", "debug"] as const;

for (const method of methods) {
  const original = console[method].bind(console);
  console[method] = (...args: unknown[]) => {
    original(maskSecrets(formatWithOptions({}, ...args)));
  };
}

// Unhandled errors: Node's default handler writes straight to stderr, without
// going through the console. Registering them here sends them through the mask.
// Both exit the process, as Node would by default: Railway restarts it and the
// checkpoint guarantees the resume.
process.on("uncaughtException", (error) => {
  console.error("[indexer] fatal unhandled error:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("[indexer] unhandled promise rejection:", reason);
  process.exit(1);
});
