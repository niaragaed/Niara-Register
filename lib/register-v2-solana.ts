// Client for the v2 instructions of niara-register-solana: register_v2 (with
// the soulbound cNFT receipt) and the MLETR-aligned transferable records.
//
// Encoded by hand, like lib/register-solana.ts: discriminators and layouts
// come from idl/niara_register_solana.json in niara-register-solana. If the
// program interface changes, update them here.
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { SOLANA_PROGRAM_ID } from "./register-solana";
import { fromHex, toHex } from "./commitments";

const enc = new TextEncoder();
const DISC = {
  registerV2: [225, 250, 193, 26, 37, 179, 205, 76],
  issueRecord: [52, 77, 222, 95, 135, 154, 65, 82],
  transferControl: [203, 120, 44, 119, 23, 27, 11, 129],
  proposeAmendment: [237, 97, 111, 166, 137, 200, 30, 39],
  cancelAmendment: [101, 132, 117, 54, 208, 80, 227, 248],
  acceptAmendment: [180, 212, 55, 94, 76, 191, 6, 165],
  surrender: [156, 0, 23, 44, 81, 56, 119, 164],
  terminate: [40, 31, 99, 52, 83, 243, 37, 201],
} as const;
const ACCOUNT_DISC = {
  config: [155, 12, 170, 224, 30, 250, 204, 130],
  recordV2: [255, 235, 84, 155, 197, 94, 92, 26],
  transferableRecord: [94, 249, 212, 84, 203, 21, 95, 64],
} as const;

export const MPL_BUBBLEGUM_ID = new PublicKey("BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY");
export const MPL_CORE_ID = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
export const MPL_NOOP_ID = new PublicKey("mnoopTCrg4p8ry25e4bcWA9XZjbNjMTfgYVGGEdRsf3");
export const MPL_ACCOUNT_COMPRESSION_ID = new PublicKey("mcmt6YrQEMKw8Mw43FmpRLmf7BqRnFMKmAcbxE3xkAW");

/** Program error codes added in v2 (error.rs, appended after the v1 ones). */
export const PROGRAM_ERRORS_V2: Record<number, string> = {
  6000: "HashInvalido",
  6003: "UnknownScheme",
  6004: "AlreadyRegisteredV1",
  6007: "ConfigMismatch",
  6009: "InvalidHolder",
  6010: "NotIssuer",
  6011: "NotController",
  6012: "NotActive",
  6013: "NotSurrendered",
  6014: "NoPendingAmendment",
  6015: "AmendmentMismatch",
  6016: "HashAlreadyUsed",
  6017: "UnknownTerminationReason",
  6018: "InvalidDocumentType",
};

const pda = (seeds: Uint8Array[], program = SOLANA_PROGRAM_ID) =>
  PublicKey.findProgramAddressSync(seeds, program)[0];

export const configAddress = () => pda([enc.encode("config")]);
export const receiptAuthorityAddress = () => pda([enc.encode("receipt_authority")]);
export const recordV2Address = (hashHex: string) => pda([enc.encode("record_v2"), fromHex(hashHex)]);
export const legacyRecordAddress = (hashHex: string) => pda([enc.encode("assinatura"), fromHex(hashHex)]);
export const transferableRecordAddress = (originalHashHex: string) => pda([enc.encode("etr"), fromHex(originalHashHex)]);
export const usedHashAddress = (hashHex: string) => pda([enc.encode("etr_hash"), fromHex(hashHex)]);

function concat(...parts: (Uint8Array | readonly number[])[]): Uint8Array {
  const arrays = parts.map((p) => (p instanceof Uint8Array ? p : Uint8Array.from(p)));
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let pos = 0;
  for (const a of arrays) {
    out.set(a, pos);
    pos += a.length;
  }
  return out;
}

function ix(keys: TransactionInstruction["keys"], data: Uint8Array): TransactionInstruction {
  // web3.js v1 types `data` as Buffer but only reads the bytes.
  return new TransactionInstruction({
    programId: SOLANA_PROGRAM_ID,
    keys,
    data: data as unknown as TransactionInstruction["data"],
  });
}

const w = (pubkey: PublicKey, isSigner = false) => ({ pubkey, isSigner, isWritable: true });
const r = (pubkey: PublicKey, isSigner = false) => ({ pubkey, isSigner, isWritable: false });

// --- reading ---------------------------------------------------------------

class Reader {
  pos = 0;
  constructor(private readonly data: Uint8Array) {}
  private view = () => new DataView(this.data.buffer, this.data.byteOffset, this.data.byteLength);
  bytes(n: number) {
    if (this.pos + n > this.data.length) throw new Error("truncated account");
    const out = this.data.slice(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  pubkey = () => new PublicKey(this.bytes(32));
  u8 = () => this.bytes(1)[0];
  u32 = () => {
    const v = this.view().getUint32(this.pos, true);
    this.pos += 4;
    return v;
  };
  i64 = () => {
    const v = this.view().getBigInt64(this.pos, true);
    this.pos += 8;
    return Number(v);
  };
  u64 = () => {
    const v = this.view().getBigUint64(this.pos, true);
    this.pos += 8;
    return v;
  };
  string = () => new TextDecoder().decode(this.bytes(this.u32()));
}

function readerFor(data: Uint8Array, disc: readonly number[]): Reader | null {
  if (data.length < 8 || disc.some((b, i) => data[i] !== b)) return null;
  const r = new Reader(data);
  r.pos = 8;
  return r;
}

export type ReceiptConfig = { merkleTree: PublicKey; coreCollection: PublicKey; metadataBaseUrl: string };

export async function fetchReceiptConfig(connection: Connection): Promise<ReceiptConfig | null> {
  const acc = await connection.getAccountInfo(configAddress());
  if (!acc || !acc.owner.equals(SOLANA_PROGRAM_ID)) return null;
  const rd = readerFor(Uint8Array.from(acc.data), ACCOUNT_DISC.config);
  if (!rd) return null;
  rd.pubkey(); // admin
  return { merkleTree: rd.pubkey(), coreCollection: rd.pubkey(), metadataBaseUrl: rd.string() };
}

export type SolanaRecordV2 = {
  signer: string;
  recordHash: string;
  scheme: number;
  documentType: number;
  metadataCommitment: string;
  timestamp: number;
  slot: number;
  receiptAssetId: string;
};

export async function fetchRecordV2(connection: Connection, hashHex: string): Promise<SolanaRecordV2 | null> {
  const acc = await connection.getAccountInfo(recordV2Address(hashHex));
  if (!acc || !acc.owner.equals(SOLANA_PROGRAM_ID)) return null;
  const rd = readerFor(Uint8Array.from(acc.data), ACCOUNT_DISC.recordV2);
  if (!rd) return null;
  const signer = rd.pubkey().toBase58();
  const recordHash = toHex(rd.bytes(32));
  const scheme = rd.u8();
  const typeBytes = rd.bytes(2);
  const documentType = typeBytes[0] | (typeBytes[1] << 8);
  const metadataCommitment = toHex(rd.bytes(32));
  const timestamp = rd.i64();
  const slot = Number(rd.u64());
  const receiptAssetId = rd.pubkey().toBase58();
  return { signer, recordHash, scheme, documentType, metadataCommitment, timestamp, slot, receiptAssetId };
}

export type SolanaTransferableRecord = {
  address: string;
  issuer: string;
  controller: string;
  originalHash: string;
  documentHash: string;
  metadataCommitment: string;
  version: number;
  status: "active" | "surrendered" | "terminated";
  issuedAt: number;
  pendingHash: string | null;
};

export async function fetchTransferableRecord(
  connection: Connection,
  originalHashHex: string,
): Promise<SolanaTransferableRecord | null> {
  const address = transferableRecordAddress(originalHashHex);
  const acc = await connection.getAccountInfo(address);
  if (!acc || !acc.owner.equals(SOLANA_PROGRAM_ID)) return null;
  const rd = readerFor(Uint8Array.from(acc.data), ACCOUNT_DISC.transferableRecord);
  if (!rd) return null;
  const issuer = rd.pubkey().toBase58();
  const controller = rd.pubkey().toBase58();
  const originalHash = toHex(rd.bytes(32));
  const documentHash = toHex(rd.bytes(32));
  const metadataCommitment = toHex(rd.bytes(32));
  const version = rd.u32();
  const status = (["", "active", "surrendered", "terminated"] as const)[rd.u8()] || "active";
  const issuedAt = rd.i64();
  const pending = toHex(rd.bytes(32));
  return {
    address: address.toBase58(),
    issuer,
    controller,
    originalHash,
    documentHash,
    metadataCommitment,
    version,
    status,
    issuedAt,
    pendingHash: /^0+$/.test(pending) ? null : pending,
  };
}

// --- instructions ------------------------------------------------------------

/** Bubblegum's CPI into MPL-Core needs more than the default 200k CU. */
export const computeBudgetIx = () => ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });

export function registerV2Instruction(
  signer: PublicKey,
  cfg: ReceiptConfig,
  recordHashHex: string,
  scheme: number,
  documentType: number,
  metadataCommitmentHex: string,
): TransactionInstruction {
  const treeConfig = pda([cfg.merkleTree.toBytes()], MPL_BUBBLEGUM_ID);
  const coreCpiSigner = pda([enc.encode("mpl_core_cpi_signer")], MPL_BUBBLEGUM_ID);
  return ix(
    [
      w(signer, true),
      r(configAddress()),
      w(recordV2Address(recordHashHex)),
      r(legacyRecordAddress(recordHashHex)),
      r(receiptAuthorityAddress()),
      w(treeConfig),
      w(cfg.merkleTree),
      w(cfg.coreCollection),
      r(coreCpiSigner),
      r(MPL_NOOP_ID),
      r(MPL_ACCOUNT_COMPRESSION_ID),
      r(MPL_CORE_ID),
      r(MPL_BUBBLEGUM_ID),
      r(SystemProgram.programId),
    ],
    concat(
      DISC.registerV2,
      fromHex(recordHashHex),
      [scheme],
      [documentType & 0xff, (documentType >> 8) & 0xff],
      fromHex(metadataCommitmentHex),
    ),
  );
}

export function issueRecordInstruction(
  issuer: PublicKey,
  documentHashHex: string,
  metadataCommitmentHex: string,
  holder: PublicKey,
): TransactionInstruction {
  return ix(
    [
      w(issuer, true),
      w(transferableRecordAddress(documentHashHex)),
      w(usedHashAddress(documentHashHex)),
      r(SystemProgram.programId),
    ],
    concat(DISC.issueRecord, fromHex(documentHashHex), fromHex(metadataCommitmentHex), holder.toBytes()),
  );
}

export function transferControlInstruction(controller: PublicKey, record: PublicKey, to: PublicKey) {
  return ix([r(controller, true), w(record)], concat(DISC.transferControl, to.toBytes()));
}

export function proposeAmendmentInstruction(
  issuer: PublicKey,
  record: PublicKey,
  newHashHex: string,
  newMetadataCommitmentHex: string,
) {
  return ix(
    [r(issuer, true), w(record), r(usedHashAddress(newHashHex))],
    concat(DISC.proposeAmendment, fromHex(newHashHex), fromHex(newMetadataCommitmentHex)),
  );
}

export function cancelAmendmentInstruction(issuer: PublicKey, record: PublicKey) {
  return ix([r(issuer, true), w(record)], Uint8Array.from(DISC.cancelAmendment));
}

export function acceptAmendmentInstruction(controller: PublicKey, record: PublicKey, expectedHashHex: string) {
  return ix(
    [w(controller, true), w(record), w(usedHashAddress(expectedHashHex)), r(SystemProgram.programId)],
    concat(DISC.acceptAmendment, fromHex(expectedHashHex)),
  );
}

export function surrenderInstruction(controller: PublicKey, record: PublicKey) {
  return ix([r(controller, true), w(record)], Uint8Array.from(DISC.surrender));
}

/** reason: 0 fulfilled, 1 replaced by paper, 2 other. */
export function terminateInstruction(issuer: PublicKey, record: PublicKey, reason: 0 | 1 | 2) {
  return ix([r(issuer, true), w(record)], concat(DISC.terminate, [reason]));
}

/** Readable reason from a failed transaction (program error name or "already in use"). */
export function solanaV2ErrorReason(error: unknown): string | null {
  const text =
    error instanceof Error
      ? `${error.message} ${JSON.stringify((error as { logs?: unknown }).logs ?? "")}`
      : String(error);
  if (text.includes("already in use")) return "AlreadyRegistered";
  const custom = text.match(/custom program error: 0x([0-9a-f]+)/i);
  if (custom) return PROGRAM_ERRORS_V2[parseInt(custom[1], 16)] ?? null;
  for (const name of Object.values(PROGRAM_ERRORS_V2)) if (text.includes(name)) return name;
  return null;
}
