/**
 * Test of the additional EVM signature source (evm-signatures.ts), with an
 * in-memory RPC and database: chunks, confirmation margin, address filter,
 * resume after an error with no gap or duplicate, and 429 absorbed by the backoff.
 */
import { ethers } from "ethers";
import { REGISTRO_ASSINATURAS_ABI } from "../abi";
import type { NewSignature } from "../db";
import { createEvmSignatureIndexer, type LightEvmRpc } from "../evm-signatures";

let failures = 0;
function check(c: boolean, d: string) {
  console.log(`${c ? "ok  " : "FAIL"} ${d}`);
  if (!c) failures++;
}

const CONTRACT = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const PERSON = "0x4369000000000000000000000000000000035dc0";
const iface = new ethers.Interface(REGISTRO_ASSINATURAS_ABI);

const logs: ethers.Log[] = [];
let seq = 0;
function document(address: string, block: number, name: string, ts: number) {
  const { topics, data } = iface.encodeEventLog("DocumentoRegistrado", [ethers.id(name), PERSON, name, "ata", ts]);
  logs.push({
    address,
    blockNumber: block,
    index: logs.filter((l) => l.blockNumber === block).length,
    transactionHash: ethers.zeroPadValue(ethers.toBeHex(++seq), 32),
    topics,
    data,
  } as unknown as ethers.Log);
}

document(CONTRACT, 1000, "deploy-block", 1_700_000_000); // at the deploy block
document(CONTRACT, 1499, "end-of-chunk", 1_700_000_100);
document(CONTRACT, 1500, "start-of-chunk", 1_700_000_200);
document(OTHER, 1600, "other-contract", 1_700_000_300); // must not get in
document(CONTRACT, 2400, "near-the-tip", 1_700_000_400);
document(CONTRACT, 2497, "inside-the-margin", 1_700_000_500); // tip 2500 − 5 → left for later

let tip = 2500;
let failNextGetLogs = false;
let errors429 = 2;
const rpc: LightEvmRpc = {
  async getBlockNumber() {
    if (errors429-- > 0) {
      throw ethers.makeError("server response 429 Too Many Requests", "SERVER_ERROR", {
        request: undefined as never,
        response: undefined as never,
        info: { responseStatus: "429 Too Many Requests" } as never,
      });
    }
    return tip;
  },
  async getLogs({ address, fromBlock, toBlock }) {
    if (failNextGetLogs) {
      failNextGetLogs = false;
      throw new Error("RPC went down");
    }
    if (toBlock - fromBlock + 1 > 500) throw new Error(`range too large: ${fromBlock}-${toBlock}`);
    return logs.filter(
      (l) => address.includes(l.address.toLowerCase()) && l.blockNumber >= fromBlock && l.blockNumber <= toBlock,
    );
  },
};

const saved = new Map<string, NewSignature>();
let attempts = 0;
const checkpoints = new Map<string, number>();
const db = {
  async saveSignature(a: NewSignature) {
    attempts++;
    const k = `${a.rede}|${a.hash_sha256}`;
    if (!saved.has(k)) saved.set(k, a);
  },
  readCheckpoint: async (s: string, fb: number) => checkpoints.get(s) ?? fb,
  async saveCheckpoints(ss: string[], b: number) {
    for (const s of ss) checkpoints.set(s, b);
  },
};

const create = () =>
  createEvmSignatureIndexer({
    network: "base-sepolia",
    source: "base-sepolia-assinaturas",
    rpc,
    db,
    address: CONTRACT,
    deployBlock: 1000,
    chunk: 500,
    maxChunksPerCycle: 2,
    confirmations: 5,
    backoff: { attempts: 6, baseMs: 1, capMs: 1 },
    sleep: async () => {},
  });

(async () => {
  let idx = create();
  await idx.start();
  check(idx.checkpoint === 999, "with no checkpoint, starts at the block before the deploy");

  const r1 = await idx.cycle(); // 429 twice on getBlockNumber, absorbed
  check(r1.saved === 3 && idx.checkpoint === 1999 && !r1.upToDate, `cycle 1: 2 chunks (1000–1999), 3 docs (${r1.saved}), behind`);

  failNextGetLogs = true;
  let threw = false;
  try {
    await idx.cycle();
  } catch {
    threw = true;
  }
  check(threw && checkpoint() === 1999, "getLogs error: the cycle throws and the checkpoint does not move");

  idx = create(); // simulates a process restart
  await idx.start();
  check(idx.checkpoint === 1999, "restart resumes from the saved checkpoint");
  const r3 = await idx.cycle();
  check(r3.saved === 1 && idx.checkpoint === 2495 && r3.upToDate, `cycle 3: up to tip − 5 (2495), 1 doc (${r3.saved}), up to date`);

  tip = 2510;
  const r4 = await idx.cycle();
  check(r4.saved === 1 && idx.checkpoint === 2505, "a document inside the margin gets in once it has confirmations");

  const names = [...saved.values()].map((a) => a.documento_nome);
  check(!names.includes("other-contract"), "an event from another contract is ignored");
  check(saved.size === 5 && attempts === 5, `5 documents, no duplicate (${saved.size}/${attempts})`);
  const one = saved.get(`base-sepolia|${ethers.id("deploy-block")}`);
  check(one?.rede === "base-sepolia" && one.assinado_em === new Date(1_700_000_000_000).toISOString() && one.bloco === 1000, "network, date (from the event) and block are correct");
  check(/^0x[0-9a-f]{64}$/.test(one?.hash_sha256 ?? ""), "hash is 0x + 64 lowercase hex, same format as the other networks");

  // Pause between chunks (HyperEVM): sleep called between chunks, never before the first one.
  const pauses: number[] = [];
  const withPause = createEvmSignatureIndexer({
    network: "hyperevm-testnet",
    source: "test-pause",
    rpc,
    db,
    address: CONTRACT,
    deployBlock: 1000,
    chunk: 500,
    maxChunksPerCycle: 3,
    confirmations: 5,
    chunkIntervalMs: 1000,
    backoff: { attempts: 6, baseMs: 1, capMs: 1 },
    sleep: async (ms) => {
      pauses.push(ms);
    },
  });
  await withPause.start();
  await withPause.cycle();
  check(pauses.length === 2 && pauses.every((ms) => ms === 1000), `3 chunks → 2 pauses of 1 s between them (${pauses.join(",")})`);

  console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})();

function checkpoint() {
  return checkpoints.get("base-sepolia-assinaturas");
}
