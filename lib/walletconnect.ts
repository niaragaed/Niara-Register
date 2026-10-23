"use client";
// WalletConnect (Reown) for EVM wallets on another device: a QR code on a
// computer, or the wallet app on a phone or tablet. Only active when
// NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is set (a free project id from
// dashboard.reown.com, with this site's domain in its allowlist).
//
// The provider code (and the modal it opens) is loaded only when the user
// picks WalletConnect. After connecting, the wallet on the other end must be
// on the Niara list, judged by the URL in its session metadata; otherwise the
// session is closed. That metadata is self-declared by the wallet, so this
// curates what the site accepts, like the extension list does.
import { EVM_NETWORKS } from "./register-contract";
import type { Eip1193Provider } from "./evm-wallets";
import { TRUSTED_WALLETS, matchWalletConnectPeer, type TrustedWallet } from "./wallet-catalog";
import { WalletRejected } from "./wallets";

export const WALLETCONNECT_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";
export const walletConnectEnabled = () => WALLETCONNECT_PROJECT_ID.length > 0;

/** The connected wallet is not on the Niara list. */
export class UnlistedWalletConnectPeer extends Error {
  constructor(readonly peerName: string) {
    super(`WalletConnect peer not on the list: ${peerName}`);
  }
}

type WcProvider = Eip1193Provider & {
  session?: { peer: { metadata: { name: string; url: string } } };
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
};

let instance: Promise<WcProvider> | null = null;

async function getProvider(): Promise<WcProvider> {
  if (!instance) {
    instance = (async () => {
      const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
      const networks = Object.values(EVM_NETWORKS);
      const chainIds = networks.map((n) => Number(n.chainIdHex));
      const origin = window.location.origin;
      const provider = await EthereumProvider.init({
        projectId: WALLETCONNECT_PROJECT_ID,
        optionalChains: [chainIds[0], ...chainIds.slice(1)],
        rpcMap: Object.fromEntries(networks.map((n) => [Number(n.chainIdHex), n.rpcUrl])),
        showQrModal: true,
        qrModalOptions: {
          themeMode: "light",
          explorerRecommendedWalletIds: TRUSTED_WALLETS.flatMap((w) => (w.walletConnectId ? [w.walletConnectId] : [])),
        },
        metadata: {
          name: "Niara Register",
          description: "Record a document's fingerprint on-chain and receive a non-transferable receipt.",
          url: origin,
          icons: [`${origin}/brand/niara-globe-poster.png`],
        },
      });
      return provider as unknown as WcProvider;
    })();
    instance.catch(() => (instance = null));
  }
  return instance;
}

/** Opens WalletConnect (QR or app list) and returns the session's provider. */
export async function connectWalletConnect(): Promise<{ provider: Eip1193Provider; name: string; wallet: TrustedWallet }> {
  const provider = await getProvider();
  // Always a fresh session: the site asks which wallet every time, and a
  // remembered session would silently reuse the previous one.
  if (provider.session) await provider.disconnect().catch(() => {});
  try {
    await provider.connect();
  } catch (e) {
    // Closing the WalletConnect window rejects with a generic error.
    throw new WalletRejected(e instanceof Error ? e.message : "WalletConnect closed");
  }
  const peer = provider.session?.peer.metadata;
  const wallet = matchWalletConnectPeer(peer?.url);
  if (!wallet) {
    await provider.disconnect().catch(() => {});
    throw new UnlistedWalletConnectPeer(peer?.name ?? "unknown wallet");
  }
  return { provider, name: `${wallet.name} (WalletConnect)`, wallet };
}
