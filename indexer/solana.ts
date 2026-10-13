import { PublicKey } from "@solana/web3.js";
import type { NewSignature } from "./db";
import { withBackoff, type BackoffOptions } from "./rate-limit";

/**
 * Source `solana-assinaturas`: records of the niara-register-solana (Anchor)
 * program on Solana devnet, written to the SAME registro_assinaturas table as
 * Sepolia, with rede = 'solana-devnet'.
 *
 * Runs in its own loop, independent of the EVM batch (indexer.ts): an error or
 * slowness in one RPC never delays the other.
 *
 * Each cycle:
 * 1. Lists the transaction signatures that touch the program
 *    (getSignaturesForAddress, newest to oldest), until it reaches the
 *    checkpoint slot.
 * 2. Oldest to newest, for each successful transaction, reads the logs and
 *    extracts the DocumentoRegistrado event, only when the one that emitted the
 *    "Program data:" was OUR program (invoke stack), so another program cannot
 *    forge a ledger row just by mentioning our address.
 * 3. Checks the event against the on-chain ["assinatura", hash] PDA account and
 *    stores what is IN THE ACCOUNT (the source of truth), not what came in the log.
 * 4. Saves the checkpoint = highest processed slot.
 *
 * Idempotent writes by (rede, hash_sha256): reprocessing a slot does not
 * duplicate. Commitment "finalized": the ledger only shows what can no longer
 * be reverted.
 */

// Stored values (checkpoint source and network): they stay as they are.
export const SOURCE_SOLANA = "solana-assinaturas";
export const SOLANA_NETWORK = "solana-devnet" as const;

// On-chain PDA seed of the program.
const SIGNATURE_SEED = Buffer.from("assinatura");
// Discriminators from the program IDL (target/idl/niara_register_solana.json).
const EVENT_DISC = Buffer.from([206, 226, 126, 15, 74, 52, 33, 1]);
const ACCOUNT_DISC = Buffer.from([68, 120, 123, 196, 84, 89, 85, 188]);

const PAGE_SIZE = 1000; // getSignaturesForAddress maximum

// ── decoding (Borsh) ─────────────────────────────────────────────────────────────

export class BorshReader {
  private pos = 0;
  constructor(private readonly buf: Buffer) {}
  bytes(n: number): Buffer {
    if (this.pos + n > this.buf.length) throw new Error("truncated data");
    const slice = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return slice;
  }
  i64(): bigint {
    return this.bytes(8).readBigInt64LE();
  }
  u64(): bigint {
    return this.bytes(8).readBigUInt64LE();
  }
  string(): string {
    const length = this.bytes(4).readUInt32LE();
    return this.bytes(length).toString("utf8");
  }
}

export type SolanaDocument = {
  hashHex: string; // 64 characters, lowercase, no 0x
  signer: string; // base58
  documentName: string;
  documentType: string;
  timestamp: number; // unix, seconds
  slot: number;
};

/** DocumentoRegistrado event from a "Program data:" payload (base64). */
export function decodeEvent(base64: string): SolanaDocument | null {
  const buf = Buffer.from(base64, "base64");
  if (buf.length < 8 || !buf.subarray(0, 8).equals(EVENT_DISC)) return null;
  try {
    const r = new BorshReader(buf.subarray(8));
    const hash = r.bytes(32);
    const signer = new PublicKey(r.bytes(32)).toBase58();
    const documentName = r.string();
    const documentType = r.string();
    const timestamp = Number(r.i64());
    const slot = Number(r.u64());
    return { hashHex: hash.toString("hex"), signer, documentName, documentType, timestamp, slot };
  } catch {
    return null;
  }
}

/** Assinatura account (PDA). Same layout as state.rs. */
export function decodeAccount(data: Buffer): SolanaDocument | null {
  if (data.length < 8 || !data.subarray(0, 8).equals(ACCOUNT_DISC)) return null;
  try {
    const r = new BorshReader(data.subarray(8));
    const signer = new PublicKey(r.bytes(32)).toBase58();
    const hash = r.bytes(32);
    const timestamp = Number(r.i64());
    const slot = Number(r.u64());
    const documentName = r.string();
    const documentType = r.string();
    return { hashHex: hash.toString("hex"), signer, documentName, documentType, timestamp, slot };
  } catch {
    return null;
  }
}

/**
 * Our program's events in a transaction's logs. Follows the
 * invoke/success/failed stack to attribute each "Program data:" to the program
 * that was running at that moment.
 */
export function extractEvents(logs: string[], programId: string): SolanaDocument[] {
  const events: SolanaDocument[] = [];
  for (const base64 of programDataPayloads(logs, programId)) {
    const event = decodeEvent(base64);
    if (event) events.push(event);
  }
  return events;
}

/**
 * Base64 "Program data:" payloads emitted by `programId`, only when it is at
 * the top of the invoke stack at that moment (another program cannot forge an
 * event of ours). Also used by the PMEs source on Solana (pmes-solana.ts).
 */
export function programDataPayloads(logs: string[], programId: string): string[] {
  const stack: string[] = [];
  const payloads: string[] = [];
  for (const line of logs) {
    const invoke = /^Program (\S+) invoke \[\d+\]$/.exec(line);
    if (invoke) {
      stack.push(invoke[1]);
      continue;
    }
    // Anchored to a base58 address: "Program log: success…" must not pop the stack.
    if (/^Program [1-9A-HJ-NP-Za-km-z]{32,44} (success|failed)/.test(line)) {
      stack.pop();
      continue;
    }
    if (line.startsWith("Program data: ") && stack[stack.length - 1] === programId) {
      payloads.push(line.slice("Program data: ".length).trim());
    }
  }
  return payloads;
}

export function recordAddress(hashHex: string, program: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [SIGNATURE_SEED, Buffer.from(hashHex, "hex")],
    program,
  )[0];
}

// ── loop ─────────────────────────────────────────────────────────────────────────

/** The part of @solana/web3.js's Connection this source uses (injectable in tests). */
export type SolanaRpc = {
  getSignaturesForAddress(
    address: PublicKey,
    options: { before?: string; limit: number },
    commitment: "finalized",
  ): Promise<{ signature: string; slot: number; err: unknown }[]>;
  getTransaction(
    signature: string,
    options: { commitment: "finalized"; maxSupportedTransactionVersion: 0 },
  ): Promise<{ meta: { err: unknown; logMessages?: string[] | null } | null } | null>;
  getAccountInfo(address: PublicKey, commitment: "finalized"): Promise<{ owner: PublicKey; data: Buffer } | null>;
};

export type SolanaDb = {
  saveSignature(signature: NewSignature): Promise<void>;
  readCheckpoint(source: string, fallback: number): Promise<number>;
  saveCheckpoints(sources: string[], block: number): Promise<void>;
};

export function createSolanaIndexer(deps: {
  rpc: SolanaRpc;
  db: SolanaDb;
  programId: string;
  startSlot: number;
  backoff: Omit<BackoffOptions, "sleep">;
  sleep: (ms: number) => Promise<void>;
}) {
  const { rpc, db } = deps;
  const program = new PublicKey(deps.programId);
  const options: BackoffOptions = { ...deps.backoff, sleep: deps.sleep };
  const net = <T,>(fn: () => Promise<T>, context: string) =>
    withBackoff(fn, `solana: ${context}`, options);

  let checkpoint = 0;

  async function start(): Promise<void> {
    checkpoint = await db.readCheckpoint(SOURCE_SOLANA, deps.startSlot);
  }

  /** Signatures with slot > checkpoint, oldest to newest. */
  async function newSignatures() {
    const found: { signature: string; slot: number; err: unknown }[] = [];
    let before: string | undefined;
    for (;;) {
      const page = await net(
        () => rpc.getSignaturesForAddress(program, { before, limit: PAGE_SIZE }, "finalized"),
        "getSignaturesForAddress",
      );
      let reached = false;
      for (const s of page) {
        if (s.slot <= checkpoint) {
          reached = true;
          break;
        }
        found.push(s);
      }
      if (reached || page.length < PAGE_SIZE) break;
      before = page[page.length - 1].signature;
    }
    return found.reverse();
  }

  async function processTransaction(signature: string, txSlot: number): Promise<number> {
    const tx = await net(
      () => rpc.getTransaction(signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 }),
      `getTransaction ${signature.slice(0, 8)}`,
    );
    if (!tx?.meta || tx.meta.err) return 0;

    const events = extractEvents(tx.meta.logMessages ?? [], deps.programId);
    let saved = 0;
    for (const [index, event] of events.entries()) {
      const pda = recordAddress(event.hashHex, program);
      const account = await net(() => rpc.getAccountInfo(pda, "finalized"), `getAccountInfo ${pda.toBase58().slice(0, 8)}`);
      const doc = account && account.owner.equals(program) ? decodeAccount(Buffer.from(account.data)) : null;

      // The account is the source of truth. If it does not match the event, do not save.
      if (!doc || doc.hashHex !== event.hashHex || doc.signer !== event.signer || doc.timestamp !== event.timestamp) {
        console.warn(
          `[indexer] solana: event in ${signature} does not match account ${pda.toBase58()}; ignored`,
        );
        continue;
      }

      await db.saveSignature({
        rede: SOLANA_NETWORK,
        documento_nome: doc.documentName,
        tipo_documento: doc.documentType,
        hash_sha256: `0x${doc.hashHex}`,
        assinante_endereco: doc.signer,
        tx_hash: signature,
        log_index: index,
        endereco_contrato: deps.programId,
        bloco: null,
        slot: doc.slot || txSlot,
        assinado_em: new Date(doc.timestamp * 1000).toISOString(),
        status: "assinado_onchain",
      });
      saved++;
      console.log(
        `[indexer] solana: Document recorded — "${doc.documentName}" (${doc.documentType}) — signer ${doc.signer.slice(0, 4)}...${doc.signer.slice(-4)} — slot ${doc.slot} — ${signature}`,
      );
    }
    return saved;
  }

  /** A full cycle. Throws on error; the checkpoint only moves if everything worked. */
  async function cycle(): Promise<{ transactions: number; saved: number }> {
    const found = await newSignatures();
    let saved = 0;
    for (const s of found) {
      if (s.err) continue; // a transaction that failed on-chain recorded nothing
      saved += await processTransaction(s.signature, s.slot);
    }
    if (found.length > 0) {
      const highestSlot = Math.max(...found.map((s) => s.slot));
      await db.saveCheckpoints([SOURCE_SOLANA], highestSlot);
      checkpoint = highestSlot;
    }
    return { transactions: found.length, saved };
  }

  return {
    start,
    cycle,
    get checkpoint() {
      return checkpoint;
    },
  };
}
