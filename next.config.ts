import type { NextConfig } from "next";

/**
 * Content-Security-Policy with a single directive, `connect-src`: it decides
 * which origins the page's scripts may reach with fetch, XHR and WebSockets,
 * and leaves scripts, styles, fonts and frames as they were (no nonces needed).
 *
 * Every origin the browser talks to must be listed here, or that feature
 * breaks: the Register backend (Global Registry API), Supabase, the RPCs of the
 * six networks (lib/register-contract.ts, NEXT_PUBLIC_SOLANA_RPC_URL), the
 * did:web documents of Niara credentials, WalletConnect (lib/walletconnect.ts)
 * and Lacuna Web PKI (lib/pades). Wallet extensions make their own requests
 * outside the page and are not affected.
 *
 * CSP_REPORT_ONLY=1 sends it as Content-Security-Policy-Report-Only instead:
 * violations are logged in the browser console without blocking anything.
 */
function origin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** The origin plus its WebSocket form (Supabase realtime, Solana subscriptions). */
function withWs(url: string | undefined): string[] {
  const o = origin(url);
  return o ? [o, o.replace(/^http/, "ws")] : [];
}

const connectSrc = [
  "'self'",
  // Register backend: the Global Registry read API (indexer/exchange-api.ts).
  origin(process.env.NEXT_PUBLIC_GLOBAL_REGISTRY_API_URL),
  ...withWs(process.env.NEXT_PUBLIC_SUPABASE_URL),
  // Solana devnet (default RPC and the configured one, with their WebSocket).
  ...withWs("https://api.devnet.solana.com"),
  ...withWs(process.env.NEXT_PUBLIC_SOLANA_RPC_URL),
  // EVM RPCs read by the browser (lib/register-contract.ts).
  "https://ethereum-sepolia-rpc.publicnode.com",
  "https://sepolia.base.org",
  "https://rpc.testnet.chain.robinhood.com",
  "https://rpc.hyperliquid-testnet.xyz",
  "https://rpc.moderato.tempo.xyz",
  // did:web of the Niara credential issuer (lib/vc), on both domains.
  "https://register.niaraglobal.com",
  "https://niara-register.vercel.app",
  origin(process.env.NIARA_DID_DOMAIN ? `https://${process.env.NIARA_DID_DOMAIN}` : undefined),
  // WalletConnect / Reown relay, RPC and verify endpoints.
  "https://*.walletconnect.org",
  "wss://*.walletconnect.org",
  "https://*.walletconnect.com",
  "wss://*.walletconnect.com",
  "https://*.reown.com",
  "wss://*.reown.com",
  "https://*.web3modal.org",
  "https://*.web3modal.com",
  // Lacuna Web PKI (certificate tokens and smart cards).
  "https://cloud.lacunasoftware.com",
  "wss://cloud.lacunasoftware.com",
  "https://get.webpkiplugin.com",
].filter((s): s is string => Boolean(s));

const csp = `connect-src ${[...new Set(connectSrc)].join(" ")}`;

/**
 * The site's routes are in English and the same in both languages: the
 * language comes from the cookie, not the URL.
 *
 * The old Portuguese paths were shared before the rename, so they answer with
 * a permanent redirect (308) instead of a 404. `permanent: true` emits 308,
 * which preserves the request method; the classic 301 does not guarantee that.
 * Do not remove them before the old links have had time to fall out of use.
 */
const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/registro-pmes", destination: "/sme-registry", permanent: true },
      { source: "/registro-global", destination: "/global-registry", permanent: true },
      { source: "/assinatura", destination: "/signatures", permanent: true },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: process.env.CSP_REPORT_ONLY === "1" ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy",
            value: csp,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
