// Reads v2 records straight from the chain (server and client). No database:
// the verification page and the credential issuer only trust the chain.
import { Connection } from "@solana/web3.js";
import { ethers } from "ethers";
import { EVM_NETWORKS } from "./register-contract";
import { SIGNATURE_REGISTRY_V2_ABI, SIGNATURE_REGISTRY_V3_ABI, v2Deployment, v3Registry } from "./register-v2-evm";
import { fetchRecordAny } from "./register-v2-solana";
import { SOLANA_PROGRAM_ID, SOLANA_RPC, fetchSolanaRecord } from "./register-solana";
import { isEvm, type RegisterNetwork } from "./networks";

/**
 * A v2 or v3 record (same privacy model). v3 was registered through
 * commit-reveal and may carry an ORB attestation.
 */
export type OnChainRecord = {
  version: 2 | 3;
  recordHash: string;
  signer: string;
  timestamp: number;
  scheme: number;
  documentType: number;
  metadataCommitment: string;
  registry: string;
  receiptId: string;
  /** Hash of the attested ORB analysis report (v3 only), or null. */
  orbReportHash: string | null;
  /**
   * EVM only: the same hash also has a record on the older v2 registry, which
   * had no commit-reveal. Shown so a copy made there is not hidden.
   */
  alsoOnV2?: { signer: string; timestamp: number };
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

async function readEvmV2(network: Exclude<RegisterNetwork, "solana-devnet">, hash: string): Promise<OnChainRecord | null> {
  const { registry } = v2Deployment(network);
  if (!registry) return null;
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
    orbReportHash: null,
  };
}

async function readEvmV3(network: Exclude<RegisterNetwork, "solana-devnet">, hash: string): Promise<OnChainRecord | null> {
  const registry = v3Registry(network);
  if (!registry) return null;
  const contract = new ethers.Contract(registry, SIGNATURE_REGISTRY_V3_ABI, evmProvider(network));
  const [exists, signer, timestamp, scheme, documentType, meta, orb] = await contract.verify(`0x${hash}`);
  if (!exists) return null;
  const orbHex = strip0x(String(orb));
  return {
    version: 3,
    recordHash: hash,
    signer: String(signer),
    timestamp: Number(timestamp),
    scheme: Number(scheme),
    documentType: Number(documentType),
    metadataCommitment: strip0x(String(meta)),
    registry,
    receiptId: BigInt(`0x${hash}`).toString(),
    orbReportHash: /^0+$/.test(orbHex) ? null : orbHex,
  };
}

/** Reads the v3 record of a hash, falling back to v2 (the name predates v3). */
export async function readRecordV2(network: RegisterNetwork, hashHex: string): Promise<OnChainRecord | null> {
  const hash = strip0x(hashHex);
  if (isEvm(network)) {
    if (!v2Deployment(network).registry && !v3Registry(network)) {
      throw new NotDeployed(`SignatureRegistry v2/v3 is not deployed on ${network} yet.`);
    }
    const [v3, v2] = await Promise.all([readEvmV3(network, hash), readEvmV2(network, hash)]);
    if (v3) return v2 ? { ...v3, alsoOnV2: { signer: v2.signer, timestamp: v2.timestamp } } : v3;
    return v2;
  }
  const rec = await fetchRecordAny(new Connection(SOLANA_RPC, "confirmed"), hash);
  if (!rec) return null;
  return {
    version: rec.version,
    recordHash: hash,
    signer: rec.signer,
    timestamp: rec.timestamp,
    scheme: rec.scheme,
    documentType: rec.documentType,
    metadataCommitment: rec.metadataCommitment,
    registry: SOLANA_PROGRAM_ID.toBase58(),
    receiptId: rec.receiptAssetId,
    orbReportHash: rec.orbReportHash,
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
