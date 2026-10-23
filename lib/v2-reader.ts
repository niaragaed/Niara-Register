// Reads v2 records straight from the chain (server and client). No database:
// the verification page and the credential issuer only trust the chain.
import { Connection } from "@solana/web3.js";
import { ethers } from "ethers";
import { EVM_NETWORKS } from "./register-contract";
import { SIGNATURE_REGISTRY_V2_ABI, v2Deployment } from "./register-v2-evm";
import { fetchRecordV2 } from "./register-v2-solana";
import { SOLANA_PROGRAM_ID, SOLANA_RPC, fetchSolanaRecord } from "./register-solana";
import { isEvm, type RegisterNetwork } from "./networks";

export type OnChainRecord = {
  version: 2;
  recordHash: string;
  signer: string;
  timestamp: number;
  scheme: number;
  documentType: number;
  metadataCommitment: string;
  registry: string;
  receiptId: string;
};

export type LegacyRecord = {
  version: 1;
  recordHash: string;
  signer: string;
  timestamp: number;
  documentName: string;
  documentType: string;
};

export class NotDeployed extends Error {}

const strip0x = (h: string) => (h.startsWith("0x") ? h.slice(2) : h).toLowerCase();

export function evmProvider(network: Exclude<RegisterNetwork, "solana-devnet">): ethers.JsonRpcProvider {
  const cfg = EVM_NETWORKS[network];
  const req = new ethers.FetchRequest(cfg.rpcUrl);
  req.timeout = 10_000;
  return new ethers.JsonRpcProvider(req, Number(cfg.chainIdHex), { staticNetwork: true, batchMaxCount: 1 });
}

export async function readRecordV2(network: RegisterNetwork, hashHex: string): Promise<OnChainRecord | null> {
  const hash = strip0x(hashHex);
  if (isEvm(network)) {
    const { registry } = v2Deployment(network);
    if (!registry) throw new NotDeployed(`SignatureRegistryV2 is not deployed on ${network} yet.`);
    const contract = new ethers.Contract(registry, SIGNATURE_REGISTRY_V2_ABI, evmProvider(network));
    const [exists, signer, timestamp, scheme, documentType, meta] = await contract.verify(`0x${hash}`);
    if (!exists) return null;
    return {
      version: 2,
      recordHash: hash,
      signer: String(signer),
      timestamp: Number(timestamp),
      scheme: Number(scheme),
      documentType: Number(documentType),
      metadataCommitment: strip0x(String(meta)),
      registry,
      receiptId: BigInt(`0x${hash}`).toString(),
    };
  }
  const rec = await fetchRecordV2(new Connection(SOLANA_RPC, "confirmed"), hash);
  if (!rec) return null;
  return {
    version: 2,
    recordHash: hash,
    signer: rec.signer,
    timestamp: rec.timestamp,
    scheme: rec.scheme,
    documentType: rec.documentType,
    metadataCommitment: rec.metadataCommitment,
    registry: SOLANA_PROGRAM_ID.toBase58(),
    receiptId: rec.receiptAssetId,
  };
}

/** v1 lookup, for documents registered before v2 (name/type are public there). */
export async function readLegacyRecord(network: RegisterNetwork, hashHex: string): Promise<LegacyRecord | null> {
  const hash = strip0x(hashHex);
  if (isEvm(network)) {
    const contract = new ethers.Contract(
      EVM_NETWORKS[network].address,
      ["function verificar(bytes32) view returns (bool, address, uint256, string, string)"],
      evmProvider(network),
    );
    const [exists, signer, timestamp, name, type] = await contract.verificar(`0x${hash}`);
    if (!exists) return null;
    return { version: 1, recordHash: hash, signer, timestamp: Number(timestamp), documentName: name, documentType: type };
  }
  const rec = await fetchSolanaRecord(new Connection(SOLANA_RPC, "confirmed"), hash);
  if (!rec) return null;
  return {
    version: 1,
    recordHash: hash,
    signer: rec.signer,
    timestamp: rec.timestamp,
    documentName: rec.documentName,
    documentType: rec.documentType,
  };
}
