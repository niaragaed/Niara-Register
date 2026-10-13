import { ethers } from "ethers";
import { REGISTRO_ASSINATURAS_ABI } from "./abi";
import type { NewSignature } from "./db";
import { withBackoff, type BackoffOptions } from "./rate-limit";

/**
 * Signature source for an ADDITIONAL EVM network (Base Sepolia, Robinhood
 * Chain Testnet, HyperEVM Testnet, Tempo Testnet), with the same
 * RegistroAssinaturas contract as Sepolia.
 *
 * Sepolia stays in the indexer.ts batch (together with PMEs and the
 * orchestrator, which only exist there). Each extra network runs here, in its
 * own loop, with its own RPC and checkpoint: slowness or an error on one
 * network never delays another.
 *
 * Per cycle: from the checkpoint up to (tip − confirmations), in chunks of
 * `chunk` blocks, at most `maxChunksPerCycle` chunks. The checkpoint is saved
 * at the end of each chunk, so a crash in the middle resumes where it stopped.
 * The date comes from the event itself (its `timestamp` field), with no extra
 * getBlock.
 *
 * Idempotent writes by (rede, hash_sha256): see migrations 005/006.
 */

export type ExtraEvmNetwork = "base-sepolia" | "robinhood-testnet" | "hyperevm-testnet" | "tempo-testnet";

export type LightEvmRpc = {
  getBlockNumber(): Promise<number>;
  getLogs(filter: { address: string[]; fromBlock: number; toBlock: number }): Promise<ethers.Log[]>;
};

export type LightEvmDb = {
  saveSignature(signature: NewSignature): Promise<void>;
  readCheckpoint(source: string, fallback: number): Promise<number>;
  saveCheckpoints(sources: string[], block: number): Promise<void>;
};

const iface = new ethers.Interface(REGISTRO_ASSINATURAS_ABI);

export function createEvmSignatureIndexer(deps: {
  network: ExtraEvmNetwork;
  source: string;
  rpc: LightEvmRpc;
  db: LightEvmDb;
  address: string;
  /** Deploy block; the initial checkpoint is this − 1. */
  deployBlock: number;
  chunk: number;
  maxChunksPerCycle: number;
  /** Margin of blocks behind the tip, against reorgs. */
  confirmations: number;
  /** Pause between chunks in the same cycle (RPC with a tight rate limit). */
  chunkIntervalMs?: number;
  backoff: Omit<BackoffOptions, "sleep">;
  sleep: (ms: number) => Promise<void>;
}) {
  const { rpc, db } = deps;
  const address = deps.address.toLowerCase();
  const options: BackoffOptions = { ...deps.backoff, sleep: deps.sleep };
  const net = <T,>(fn: () => Promise<T>, context: string) =>
    withBackoff(fn, `${deps.network}: ${context}`, options);

  let checkpoint = 0;

  async function start(): Promise<void> {
    checkpoint = await db.readCheckpoint(deps.source, deps.deployBlock - 1);
  }

  async function processLog(log: ethers.Log): Promise<boolean> {
    if (log.address.toLowerCase() !== address) return false;
    let parsed: ethers.LogDescription | null;
    try {
      parsed = iface.parseLog(log);
    } catch {
      return false;
    }
    if (!parsed || parsed.name !== "DocumentoRegistrado") return false;

    const timestamp = Number(parsed.args.timestamp as bigint);
    await db.saveSignature({
      rede: deps.network,
      documento_nome: parsed.args.nomeDocumento as string,
      tipo_documento: parsed.args.tipoDocumento as string,
      hash_sha256: (parsed.args.hashDocumento as string).toLowerCase(),
      assinante_endereco: parsed.args.assinante as string,
      tx_hash: log.transactionHash,
      log_index: log.index,
      endereco_contrato: deps.address,
      bloco: log.blockNumber,
      assinado_em: new Date(timestamp * 1000).toISOString(),
      status: "assinado_onchain",
    });
    console.log(
      `[indexer] ${deps.network}: Document recorded — "${parsed.args.nomeDocumento}" (${parsed.args.tipoDocumento}) — block ${log.blockNumber} — ${log.transactionHash}`,
    );
    return true;
  }

  /** Throws on error; whatever was already processed stays saved in the checkpoint. */
  async function cycle(): Promise<{ saved: number; upToDate: boolean }> {
    const tip = (await net(() => rpc.getBlockNumber(), "getBlockNumber")) - deps.confirmations;
    let saved = 0;
    for (let i = 0; i < deps.maxChunksPerCycle && checkpoint < tip; i++) {
      if (i > 0 && deps.chunkIntervalMs) await deps.sleep(deps.chunkIntervalMs);
      const from = checkpoint + 1;
      const to = Math.min(checkpoint + deps.chunk, tip);
      const logs = await net(
        () => rpc.getLogs({ address: [address], fromBlock: from, toBlock: to }),
        `getLogs ${from}–${to}`,
      );
      const sorted = [...logs].sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
      for (const log of sorted) if (await processLog(log)) saved++;
      await db.saveCheckpoints([deps.source], to);
      checkpoint = to;
    }
    return { saved, upToDate: checkpoint >= tip };
  }

  return {
    start,
    cycle,
    get checkpoint() {
      return checkpoint;
    },
  };
}
