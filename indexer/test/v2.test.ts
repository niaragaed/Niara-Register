/**
 * v2 sources (v2.ts), offline:
 *  - EVM: DocumentRegistered and the transferable-record events become rows,
 *    other contracts and mint/burn Transfers are ignored, checkpoint advances.
 *  - Solana: events encoded exactly as Anchor emits them (discriminator +
 *    Borsh) decode to the right rows; an event that does not match its
 *    account is dropped.
 * Optional: SOLANA_V2_LOCAL=http://127.0.0.1:8899 runs a cycle against a
 * local validator with real register_v2 / transferable-record transactions.
 */
import { ethers } from "ethers";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { SIGNATURE_REGISTRY_V2_ABI, TRANSFERABLE_RECORD_ABI } from "../abi";
import {
  createEvmV2Indexer,
  createSolanaV2Indexer,
  decodeSolanaV2Event,
  recordV2Address,
  type NewEtrEvent,
  type NewSignatureV2,
  type V2Db,
} from "../v2";

let failures = 0;
function check(c: boolean, d: string) {
  console.log(`${c ? "ok  " : "FAIL"} ${d}`);
  if (!c) failures++;
}

function memoryDb() {
  const sigs: NewSignatureV2[] = [];
  const etr: NewEtrEvent[] = [];
  const checkpoints = new Map<string, number>();
  const db: V2Db = {
    async saveSignatureV2(r) {
      if (!sigs.some((s) => s.rede === r.rede && s.hash_registro === r.hash_registro)) sigs.push(r);
    },
    async saveEtrEvent(r) {
      if (!etr.some((s) => s.rede === r.rede && s.tx_hash === r.tx_hash && s.log_index === r.log_index)) etr.push(r);
    },
    async readCheckpoint(src, fb) {
      return checkpoints.get(src) ?? fb;
    },
    async saveCheckpoints(srcs, b) {
      for (const s of srcs) checkpoints.set(s, b);
    },
  };
  return { db, sigs, etr, checkpoints };
}

const noBackoff = { attempts: 1, baseMs: 1, capMs: 1 };
const sleep = async () => {};

async function evm() {
  const REG = "0x1111111111111111111111111111111111111111";
  const ETR = "0x2222222222222222222222222222222222222222";
  const OTHER = "0x3333333333333333333333333333333333333333";
  const ALICE = "0x000000000000000000000000000000000000a11c";
  const BOB = "0x0000000000000000000000000000000000000b0b";
  const reg = new ethers.Interface(SIGNATURE_REGISTRY_V2_ABI);
  const etr = new ethers.Interface(TRANSFERABLE_RECORD_ABI);
  const h = ethers.sha256(ethers.toUtf8Bytes("doc"));
  const meta = ethers.sha256(ethers.toUtf8Bytes("meta"));
  const logs: ethers.Log[] = [];
  const add = (address: string, block: number, iface: ethers.Interface, name: string, args: unknown[]) => {
    const { topics, data } = iface.encodeEventLog(name, args);
    logs.push({ address, blockNumber: block, index: logs.length, transactionHash: ethers.zeroPadValue(ethers.toBeHex(logs.length + 1), 32), topics, data } as unknown as ethers.Log);
  };
  add(REG, 100, reg, "DocumentRegistered", [h, ALICE, 1, 4, meta, 1_800_000_000]);
  add(OTHER, 100, reg, "DocumentRegistered", [h, BOB, 0, 1, meta, 1_800_000_001]);
  add(ETR, 101, etr, "RecordIssued", [BigInt(h), ALICE, BOB, h, ethers.ZeroHash]);
  add(ETR, 101, etr, "Transfer", [ethers.ZeroAddress, BOB, BigInt(h)]); // mint: ignored
  add(ETR, 102, etr, "Transfer", [BOB, ALICE, BigInt(h)]);
  add(ETR, 103, etr, "RecordTerminated", [BigInt(h), 1]);

  const { db, sigs, etr: events, checkpoints } = memoryDb();
  const idx = createEvmV2Indexer({
    network: "sepolia",
    source: "sepolia-v2",
    rpc: {
      async getBlockNumber() {
        return 200;
      },
      async getLogs({ address, fromBlock, toBlock }) {
        return logs.filter((l) => address.includes(l.address.toLowerCase()) && l.blockNumber >= fromBlock && l.blockNumber <= toBlock);
      },
      async getBlock(b) {
        return { timestamp: 1_800_000_000 + b };
      },
    },
    db,
    registry: REG,
    etr: ETR,
    deployBlock: 100,
    chunk: 50,
    maxChunksPerCycle: 10,
    confirmations: 5,
    backoff: noBackoff,
    sleep,
  });
  await idx.start();
  await idx.cycle();
  check(sigs.length === 1, "evm: one v2 signature (other contract ignored)");
  check(sigs[0]?.hash_registro === h && sigs[0]?.esquema_hash === 1 && sigs[0]?.tipo_documento === 4 && sigs[0]?.compromisso_metadados === meta, "evm: hash, scheme, type and commitment");
  check(sigs[0]?.recibo_id === BigInt(h).toString(), "evm: receipt id = token id");
  check(sigs[0]?.assinado_em === new Date(1_800_000_000_000).toISOString(), "evm: date from the event");
  check(events.map((e) => e.tipo_evento).join(",") === "emitido,controle_transferido,extinto", "evm: transferable events, mint Transfer skipped");
  check(events[1]?.dados.de === ethers.getAddress(BOB) && events[1]?.dados.para === ethers.getAddress(ALICE), "evm: transfer from/to");
  check(events[0]?.ocorrido_em === new Date((1_800_000_000 + 101) * 1000).toISOString(), "evm: block time for transferable events");
  check(checkpoints.get("sepolia-v2") === 195, "evm: checkpoint at tip − confirmations");
}

// Anchor event encoding: 8-byte discriminator + Borsh fields.
const enc = {
  pk: (k: PublicKey) => Buffer.from(k.toBytes()),
  i64: (n: number) => {
    const b = Buffer.alloc(8);
    b.writeBigInt64LE(BigInt(n));
    return b;
  },
  u64: (n: number) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(n));
    return b;
  },
};

async function solanaOffline() {
  const program = Keypair.generate().publicKey;
  const signer = Keypair.generate().publicKey;
  const asset = Keypair.generate().publicKey;
  const hash = Buffer.alloc(32, 7);
  const meta = Buffer.alloc(32, 9);
  const event = Buffer.concat([
    Buffer.from([23, 150, 17, 90, 254, 203, 21, 8]),
    hash,
    enc.pk(signer),
    Buffer.from([1]),
    Buffer.from([4, 0]),
    meta,
    enc.i64(1_800_000_000),
    enc.u64(42),
    enc.pk(asset),
  ]);
  const decoded = decodeSolanaV2Event(event.toString("base64"));
  check(decoded?.kind === "DocumentRegisteredV2" && decoded.receiptAssetId === asset.toBase58() && decoded.documentType === 4, "solana: DocumentRegisteredV2 decodes");

  // Account matching the event (RecordV2 layout).
  const account = Buffer.concat([
    Buffer.from([255, 235, 84, 155, 197, 94, 92, 26]),
    enc.pk(signer),
    hash,
    Buffer.from([1]),
    Buffer.from([4, 0]),
    meta,
    enc.i64(1_800_000_000),
    enc.u64(42),
    enc.pk(asset),
    enc.pk(Keypair.generate().publicKey),
    enc.u64(0),
    Buffer.from([255]),
  ]);
  const issued = Buffer.concat([
    Buffer.from([44, 242, 204, 114, 101, 237, 254, 224]),
    enc.pk(Keypair.generate().publicKey),
    enc.pk(signer),
    enc.pk(asset),
    hash,
    meta,
  ]);
  const logs = (payloads: Buffer[], from = program.toBase58()) => [
    `Program ${from} invoke [1]`,
    ...payloads.map((p) => `Program data: ${p.toString("base64")}`),
    `Program ${from} success`,
  ];
  const txs: Record<string, string[]> = {
    good: logs([event, issued]),
    forged: logs([event], Keypair.generate().publicKey.toBase58()),
  };
  const { db, sigs, etr } = memoryDb();
  let accountData = account;
  const idx = createSolanaV2Indexer({
    rpc: {
      async getSignaturesForAddress() {
        return [
          { signature: "forged", slot: 11, err: null },
          { signature: "good", slot: 10, err: null },
        ];
      },
      async getTransaction(sig) {
        return { blockTime: 1_800_000_005, meta: { err: null, logMessages: txs[sig] } };
      },
      async getAccountInfo(address) {
        return address.equals(recordV2Address(hash.toString("hex"), program)) ? { owner: program, data: accountData } : null;
      },
    },
    db,
    programId: program.toBase58(),
    startSlot: 0,
    backoff: noBackoff,
    sleep,
  });
  await idx.start();
  await idx.cycle();
  check(sigs.length === 1 && sigs[0].hash_registro === `0x${hash.toString("hex")}` && sigs[0].recibo_id === asset.toBase58() && sigs[0].tipo_documento === 4, "solana: v2 signature saved from the account-checked event");
  check(etr.length === 1 && etr[0].tipo_evento === "emitido" && etr[0].dados.portador === asset.toBase58(), "solana: RecordIssued saved");
  check(idx.checkpoint === 11, "solana: checkpoint = highest slot");

  // Event that disagrees with its account is ignored.
  const { db: db2, sigs: sigs2 } = memoryDb();
  accountData = Buffer.from(account);
  accountData.writeBigInt64LE(BigInt(1_700_000_000), 8 + 32 + 32 + 1 + 32);
  const idx2 = createSolanaV2Indexer({
    rpc: {
      async getSignaturesForAddress() {
        return [{ signature: "good", slot: 10, err: null }];
      },
      async getTransaction() {
        return { blockTime: null, meta: { err: null, logMessages: txs.good } };
      },
      async getAccountInfo() {
        return { owner: program, data: accountData };
      },
    },
    db: db2,
    programId: program.toBase58(),
    startSlot: 0,
    backoff: noBackoff,
    sleep,
  });
  await idx2.start();
  await idx2.cycle();
  check(sigs2.length === 0, "solana: event that does not match the account is dropped");
}

async function solanaLocal() {
  const url = process.env.SOLANA_V2_LOCAL;
  if (!url) {
    console.log("skip solana local validator test (SOLANA_V2_LOCAL not set)");
    return;
  }
  const { db, sigs, etr } = memoryDb();
  const conn = new Connection(url, "confirmed");
  const idx = createSolanaV2Indexer({
    rpc: {
      getSignaturesForAddress: (a: PublicKey, o: { before?: string; limit: number }) => conn.getSignaturesForAddress(a, o, "confirmed"),
      getTransaction: (s: string) => conn.getTransaction(s, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }),
      getAccountInfo: (a: PublicKey) => conn.getAccountInfo(a, "confirmed"),
    } as never,
    db,
    programId: "9RPHqLouFjoUbPdcmA1GyHMeDoWvjZMuCyYFPBWLmTcR",
    startSlot: 0,
    backoff: noBackoff,
    sleep,
  });
  await idx.start();
  const r = await idx.cycle();
  console.log(`local: ${r.transactions} tx, ${sigs.length} v2 signature(s), ${etr.length} transferable event(s): ${[...new Set(etr.map((e) => e.tipo_evento))].join(", ")}`);
  check(sigs.length > 0, "local: real register_v2 transactions indexed");
  check(etr.some((e) => e.tipo_evento === "emitido") && etr.some((e) => e.tipo_evento === "extinto"), "local: real transferable-record events indexed");
}

(async () => {
  await evm();
  await solanaOffline();
  await solanaLocal();
  if (failures) {
    console.error(`${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("ok - v2");
})();
