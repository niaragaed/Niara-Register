"use client";
// Looks a file up on all six networks at once, from the browser (the file
// hash never goes to a Niara server). It finds what can be found from the
// file alone:
//   - v2 records of signed PDFs (scheme 0: the record hash is the file's SHA-256);
//   - v1 records (the old registry used the plain file hash).
// Salted v2 records (scheme 1) cannot be found this way by design: their hash
// depends on a random salt that only the proof package holds.
import { REGISTER_NETWORKS, type RegisterNetwork } from "./networks";
import { readLegacyRecord, readRecordV2 } from "./v2-reader";

export type NetworkHit = { network: RegisterNetwork; version: 1 | 2; signer: string; timestamp: number };
export type LookupResult = { hits: NetworkHit[]; failed: RegisterNetwork[] };

const TIMEOUT_MS = 12_000;

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS))]);
}

async function lookupOne(network: RegisterNetwork, fileSha: string): Promise<NetworkHit[]> {
  const [v2, v1] = await Promise.all([
    withTimeout(readRecordV2(network, fileSha)),
    withTimeout(readLegacyRecord(network, fileSha)),
  ]);
  const hits: NetworkHit[] = [];
  // Only a signed-PDF record (scheme 0) is keyed by the file hash itself.
  if (v2 && v2.scheme === 0) hits.push({ network, version: 2, signer: v2.signer, timestamp: v2.timestamp });
  if (v1) hits.push({ network, version: 1, signer: v1.signer, timestamp: v1.timestamp });
  return hits;
}

export async function lookupOnAllNetworks(fileSha: string): Promise<LookupResult> {
  const settled = await Promise.allSettled(REGISTER_NETWORKS.map((n) => lookupOne(n, fileSha)));
  const result: LookupResult = { hits: [], failed: [] };
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") result.hits.push(...s.value);
    else result.failed.push(REGISTER_NETWORKS[i]);
  });
  return result;
}
