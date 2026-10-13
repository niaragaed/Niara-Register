import { ethers } from "ethers";
import {
  EVM_NETWORKS,
  REGISTRO_ASSINATURAS_ABI,
  type EvmNetwork,
} from "@/lib/register-contract";

/**
 * The site's own reader for EVM transactions and addresses, straight from the
 * network's official RPC.
 *
 * It exists because HyperEVM Testnet has no working public explorer (Oct/2026:
 * Purrsec returns 404, testnet.hyperevmscan.io does not exist, the community
 * Blockscout is millions of blocks behind and Hyperliquid's own explorer
 * renders blank). Instead of pointing the ledger at a broken link, the site
 * shows the transaction by reading the network on the spot: nothing here comes
 * from the Register's database.
 *
 * Server components only (the /explorer/... pages): the RPC is called from the
 * server, with a timeout, and a failure becomes an explicit state on screen.
 */

const TIMEOUT_MS = 10_000;
const iface = new ethers.Interface(REGISTRO_ASSINATURAS_ABI);

export function isEvmNetwork(network: string): network is EvmNetwork {
  return Object.prototype.hasOwnProperty.call(EVM_NETWORKS, network);
}

function providerFor(network: EvmNetwork): ethers.JsonRpcProvider {
  const cfg = EVM_NETWORKS[network];
  const req = new ethers.FetchRequest(cfg.rpcUrl);
  req.timeout = TIMEOUT_MS;
  // staticNetwork: does not spend an eth_chainId call on every page.
  // batchMaxCount 1: not every public RPC accepts JSON-RPC batches.
  return new ethers.JsonRpcProvider(req, Number(cfg.chainIdHex), {
    staticNetwork: true,
    batchMaxCount: 1,
  });
}

/** Current result of verificar(hash) on the contract. */
export type ContractState = {
  exists: boolean;
  signer: string;
  timestamp: number;
  documentName: string;
  documentType: string;
};

export type TxRecord = {
  logIndex: number;
  documentHash: string;
  signer: string;
  documentName: string;
  documentType: string;
  timestamp: number;
  /** null when the call to verificar() failed (RPC), not when the hash does not exist. */
  onContract: ContractState | null;
  /** The contract currently returns exactly what the event recorded. */
  matches: boolean;
};

export type TxReading =
  | { kind: "not-found" }
  | { kind: "pending"; from: string; to: string | null }
  | {
      kind: "included";
      from: string;
      to: string | null;
      success: boolean;
      block: number;
      confirmations: number;
      /** Block timestamp (unix, seconds). */
      blockTime: number | null;
      gasUsed: string;
      /** Created address, when the transaction is a deployment. */
      createdContract: string | null;
      records: TxRecord[];
    };

export class RpcUnavailable extends Error {}

async function readOnContract(
  contract: ethers.Contract,
  documentHash: string,
): Promise<ContractState | null> {
  try {
    const r = await contract.verificar(documentHash);
    return {
      exists: r[0] as boolean,
      signer: r[1] as string,
      timestamp: Number(r[2] as bigint),
      documentName: r[3] as string,
      documentType: r[4] as string,
    };
  } catch (error) {
    console.warn(`[evm-reader] verificar(${documentHash}) failed:`, error);
    return null;
  }
}

export async function readTransaction(network: EvmNetwork, hash: string): Promise<TxReading> {
  const cfg = EVM_NETWORKS[network];
  const p = providerFor(network);
  try {
    const tx = await p.getTransaction(hash);
    if (!tx) return { kind: "not-found" };

    const receipt = await p.getTransactionReceipt(hash);
    if (!receipt) return { kind: "pending", from: tx.from, to: tx.to };

    // Sequential, not parallel: the HyperEVM RPC rate-limits per IP.
    const block = await p.getBlock(receipt.blockNumber);
    const tip = await p.getBlockNumber();

    const contract = new ethers.Contract(cfg.address, REGISTRO_ASSINATURAS_ABI, p);
    const records: TxRecord[] = [];
    for (const log of receipt.logs) {
      // Only events emitted by Niara's contract: another contract may emit an
      // event with the same signature and must not become a record here.
      if (log.address.toLowerCase() !== cfg.address.toLowerCase()) continue;
      let event: ethers.LogDescription | null = null;
      try {
        event = iface.parseLog(log);
      } catch {
        continue;
      }
      if (!event || event.name !== "DocumentoRegistrado") continue;

      const documentHash = (event.args.hashDocumento as string).toLowerCase();
      const signer = event.args.assinante as string;
      const timestamp = Number(event.args.timestamp as bigint);
      const onContract = await readOnContract(contract, documentHash);
      records.push({
        logIndex: log.index,
        documentHash,
        signer,
        documentName: event.args.nomeDocumento as string,
        documentType: event.args.tipoDocumento as string,
        timestamp,
        onContract,
        matches: Boolean(
          onContract?.exists &&
            onContract.signer.toLowerCase() === signer.toLowerCase() &&
            onContract.timestamp === timestamp,
        ),
      });
    }

    return {
      kind: "included",
      from: tx.from,
      to: tx.to,
      success: receipt.status === 1,
      block: receipt.blockNumber,
      confirmations: Math.max(tip - receipt.blockNumber + 1, 1),
      blockTime: block?.timestamp ?? null,
      gasUsed: receipt.gasUsed.toString(),
      createdContract: receipt.contractAddress,
      records,
    };
  } catch (error) {
    console.error(`[evm-reader] ${network}: reading ${hash} failed:`, error);
    throw new RpcUnavailable(String(error));
  } finally {
    p.destroy();
  }
}

export type AddressReading = {
  /** Bytecode size in bytes; 0 = plain account (no code). */
  codeSize: number;
  nonce: number;
};

export async function readAddress(network: EvmNetwork, address: string): Promise<AddressReading> {
  const p = providerFor(network);
  try {
    const code = await p.getCode(address);
    const nonce = await p.getTransactionCount(address);
    return { codeSize: ethers.dataLength(code), nonce };
  } catch (error) {
    console.error(`[evm-reader] ${network}: reading ${address} failed:`, error);
    throw new RpcUnavailable(String(error));
  } finally {
    p.destroy();
  }
}
