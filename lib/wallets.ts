"use client";
// Wallet plumbing shared by the signing, verification and transferable-record
// pages. Self-custody only: the site asks the wallet to sign; it never sees keys.
import { BrowserProvider, type Signer } from "ethers";
import { Connection, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { EVM_NETWORKS, type EvmNetwork, type EvmNetworkConfig } from "./register-contract";
import { SOLANA_RPC } from "./register-solana";
import type { SolanaProvider } from "./solana";
import type { Eip1193Provider } from "./evm-wallets";

export class WalletMissing extends Error {}
export class WalletRejected extends Error {}
/** The injected wallet is on another chain than the one the site asked for. */
export class WrongEvmNetwork extends Error {
  constructor(readonly actualChainId: number) {
    super(`wallet is on chain ${actualChainId}`);
  }
}

/** "Sepolia (11155111)" for chains the site knows, the bare id otherwise. */
export function evmChainLabel(chainId: number): string {
  const known = Object.values(EVM_NETWORKS).find((n) => Number(n.chainIdHex) === chainId);
  return known ? `${known.chainName} (${chainId})` : `chain id ${chainId}`;
}

export function isRejection(error: unknown): boolean {
  const e = error as { code?: number | string; message?: string; info?: { error?: { code?: number } } };
  return (
    error instanceof WalletRejected ||
    e?.code === 4001 ||
    e?.code === "ACTION_REJECTED" ||
    e?.info?.error?.code === 4001 ||
    /reject|denied|cancel/i.test(e?.message ?? "")
  );
}

/** Explorer URL for wallet_addEthereumChain; null if there is no https one. */
function explorerUrls(cfg: EvmNetworkConfig): string[] | null {
  if (!cfg.ownExplorer) return [cfg.explorer];
  const origin = window.location.origin;
  return origin.startsWith("https://") ? [`${origin}${cfg.explorer}`] : null;
}

export async function ensureEvmNetwork(network: EvmNetwork, ethereum: Eip1193Provider): Promise<void> {
  const cfg = EVM_NETWORKS[network];
  const current = await ethereum.request({ method: "eth_chainId" });
  if (String(current).toLowerCase() === cfg.chainIdHex) return;
  try {
    await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: cfg.chainIdHex }] });
  } catch (error: unknown) {
    // 4902 = the wallet does not know this network yet and needs to add it.
    if ((error as { code?: number })?.code !== 4902) throw error;
    await ethereum.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: cfg.chainIdHex,
          chainName: cfg.chainName,
          nativeCurrency: { ...cfg.currency, decimals: 18 },
          rpcUrls: [cfg.rpcUrl],
          blockExplorerUrls: explorerUrls(cfg),
        },
      ],
    });
  }
}

/**
 * Connects the given wallet (picked by the user among the EIP-6963 announced
 * ones, see components/v2/evm-wallet-picker.tsx) and puts it on `network`.
 */
export async function connectEvm(
  network: EvmNetwork,
  ethereum: Eip1193Provider,
): Promise<{ signer: Signer; address: string }> {
  await ethereum.request({ method: "eth_requestAccounts" });
  await ensureEvmNetwork(network, ethereum);
  // Some wallets (or a second wallet that took over window.ethereum) accept the
  // switch request without switching. Never go on with the wrong chain: a
  // register call sent to an address with no contract would just burn gas.
  // Some wallets answer the switch before eth_chainId reflects it: wait up to 3 s.
  const expected = Number(EVM_NETWORKS[network].chainIdHex);
  let chainId = 0;
  for (let i = 0; i < 12; i++) {
    chainId = Number(await ethereum.request({ method: "eth_chainId" }));
    if (chainId === expected) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  if (chainId !== expected) throw new WrongEvmNetwork(chainId);
  const signer = await new BrowserProvider(ethereum).getSigner();
  return { signer, address: await signer.getAddress() };
}

export function solanaProvider(): SolanaProvider | null {
  if (typeof window === "undefined") return null;
  return window.phantom?.solana ?? window.solana ?? null;
}

export async function connectSolana(): Promise<{ provider: SolanaProvider; address: string }> {
  const provider = solanaProvider();
  if (!provider) throw new WalletMissing("no Solana wallet");
  const { publicKey } = await provider.connect();
  return { provider, address: publicKey.toBase58() };
}

export function solanaConnection(): Connection {
  return new Connection(SOLANA_RPC, "confirmed");
}

/**
 * Signs in the wallet and sends through the site's devnet RPC, so the
 * transaction goes to devnet even if the wallet is set to another cluster.
 */
export async function sendSolana(provider: SolanaProvider, ...ixs: TransactionInstruction[]): Promise<string> {
  if (!provider.publicKey) throw new WalletMissing("Solana wallet not connected");
  const connection = solanaConnection();
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: provider.publicKey, blockhash, lastValidBlockHeight }).add(...ixs);
  const signed = await provider.signTransaction(tx);
  const signature = await connection.sendRawTransaction(signed.serialize());
  const result = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  if (result.value.err) throw new Error(JSON.stringify(result.value.err));
  return signature;
}

export function downloadBytes(bytes: Uint8Array | string, filename: string, type: string) {
  const blob = new Blob([typeof bytes === "string" ? bytes : (bytes as BlobPart)], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
