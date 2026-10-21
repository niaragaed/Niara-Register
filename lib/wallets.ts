"use client";
// Wallet plumbing shared by the signing, verification and transferable-record
// pages. Self-custody only: the site asks the wallet to sign; it never sees keys.
import { BrowserProvider, type Signer } from "ethers";
import { Connection, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { EVM_NETWORKS, type EvmNetwork, type EvmNetworkConfig } from "./register-contract";
import { SOLANA_RPC } from "./register-solana";
import type { SolanaProvider } from "./solana";

export class WalletMissing extends Error {}
export class WalletRejected extends Error {}

export function isRejection(error: unknown): boolean {
  const e = error as { code?: number | string; message?: string; info?: { error?: { code?: number } } };
  return (
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

export async function ensureEvmNetwork(network: EvmNetwork): Promise<void> {
  const ethereum = window.ethereum;
  if (!ethereum) throw new WalletMissing("no EVM wallet");
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

export async function connectEvm(network: EvmNetwork): Promise<{ signer: Signer; address: string }> {
  if (!window.ethereum) throw new WalletMissing("no EVM wallet");
  await window.ethereum.request({ method: "eth_requestAccounts" });
  await ensureEvmNetwork(network);
  const signer = await new BrowserProvider(window.ethereum).getSigner();
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
