// Reads v2 records straight from the chain (server and client). No database:
// the verification page and the credential issuer only trust the chain.
import { Connection } from "@solana/web3.js";
import { ethers } from "ethers";
import { EVM_NETWORKS } from "./register-contract";
import { SIGNATURE_REGISTRY_V2_ABI, SIGNATURE_REGISTRY_V3_ABI, V2_RETIRED_AT, v2Deployment, v3Registry } from "./register-v2-evm";
import { fetchRecordsAll } from "./register-v2-solana";
import { SOLANA_PROGRAM_ID, SOLANA_RPC, fetchSolanaRecord } from "./register-solana";
import { isEvm, type RegisterNetwork } from "./networks";

/**
 * A v2 or v3 record (same privacy model). v3 was registered through
 * commit-reveal, is one per (hash, signer) and may carry an ORB attestation.
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
   * EVM v2 only: made after v2 was retired on that network (V2_RETIRED_AT).
   * Not from the site; possibly a mempool copy. Shown, never counted.
   */
  afterV2Retirement?: boolean;
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

const sameSigner = (a: string, b: string) => (a.startsWith("0x") ? a.toLowerCase() === b.toLowerCase() : a === b);

async function readEvmV2(network: Exclude<RegisterNetwork, "solana-devnet">, hash: string): Promise<OnChainRecord | null> {
  const { registry } = v2Deployment(network);
  if (!registry) return null;
  const contract = new ethers.Contract(registry, SIGNATURE_REGISTRY_V2_ABI, evmProvider(network));
  const [exists, signer, timestamp, scheme, documentType, meta] = await contract.verify(`0x${hash}`);
  if (!exists) return null;
  const retiredAt = V2_RETIRED_AT[network];
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
    ...(retiredAt !== null && Number(timestamp) > retiredAt ? { afterV2Retirement: true } : {}),
  };
}

async function readEvmV3(network: Exclude<RegisterNetwork, "solana-devnet">, hash: string): Promise<OnChainRecord[]> {
  const registry = v3Registry(network);
  if (!registry) return [];
  const contract = new ethers.Contract(registry, SIGNATURE_REGISTRY_V3_ABI, evmProvider(network));
  const signers: string[] = await contract.signersOf(`0x${hash}`);
  const out: OnChainRecord[] = [];
  for (const signer of signers) {
    const [exists, timestamp, scheme, documentType, meta, orb, tokenId] = await contract.verify(`0x${hash}`, signer);
    if (!exists) continue;
    const orbHex = strip0x(String(orb));
    out.push({
      version: 3,
      recordHash: hash,
      signer: String(signer),
      timestamp: Number(timestamp),
      scheme: Number(scheme),
      documentType: Number(documentType),
      metadataCommitment: strip0x(String(meta)),
      registry,
      receiptId: BigInt(tokenId).toString(),
      orbReportHash: /^0+$/.test(orbHex) ? null : orbHex,
    });
  }
  return out;
}

/**
 * Every record of a hash on a network, oldest first: the v2 one (if any) and
 * the v3 ones (one per signer). EVM v2 records made after v2 was retired are
 * included with `afterV2Retirement` so callers can show them without counting them.
 */
export async function readRecords(network: RegisterNetwork, hashHex: string): Promise<OnChainRecord[]> {
  const hash = strip0x(hashHex);
  if (isEvm(network)) {
    if (!v2Deployment(network).registry && !v3Registry(network)) {
      throw new NotDeployed(`SignatureRegistry v2/v3 is not deployed on ${network} yet.`);
    }
    const [v2, v3] = await Promise.all([readEvmV2(network, hash), readEvmV3(network, hash)]);
    return [...(v2 ? [v2] : []), ...v3].sort((a, b) => a.timestamp - b.timestamp);
  }
  const recs = await fetchRecordsAll(new Connection(SOLANA_RPC, "confirmed"), hash);
  return recs.map((rec) => ({
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
  }));
}

/** Records that count (everything except EVM v2 records made after v2 was retired). */
export const countedRecords = (records: OnChainRecord[]) => records.filter((r) => !r.afterV2Retirement);

/**
 * One record of a hash: `signer`'s when given, else the oldest counted one.
 * (The name predates v3.)
 */
export async function readRecordV2(network: RegisterNetwork, hashHex: string, signer?: string): Promise<OnChainRecord | null> {
  const records = countedRecords(await readRecords(network, hashHex));
  if (signer) return records.find((r) => sameSigner(r.signer, signer)) ?? null;
  return records[0] ?? null;
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
