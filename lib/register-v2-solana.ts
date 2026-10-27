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
  // v3 (commit-reveal and ORB attestation)
  6019: "InvalidCommitment",
  6020: "RevealTooEarly",
  6021: "CommitmentExpired",
  6022: "AlreadyRegisteredV2",
  6023: "OrbDisabled",
  6024: "InvalidOrbAttestation",
  6025: "NotOrbAuthority",
  6026: "CommitmentMismatch",
  6027: "ReceiptUriTooLong",
  // Anchor: the commitment account does not exist (no commit, or wrong nonce/signer).
  3012: "NoCommitment",
};

const pda = (seeds: Uint8Array[], program = SOLANA_PROGRAM_ID) =>
  PublicKey.findProgramAddressSync(seeds, program)[0];

export const configAddress = () => pda([enc.encode("config")]);
export const receiptAuthorityAddress = () => pda([enc.encode("receipt_authority")]);
export const recordV2Address = (hashHex: string) => pda([enc.encode("record_v2"), fromHex(hashHex)]);
/** v3 records are one per (hash, signer). */
export const recordV3Address = (hashHex: string, signer: PublicKey) =>
  pda([enc.encode("record_v3"), fromHex(hashHex), signer.toBytes()]);
export const commitmentAddress = (signer: PublicKey, commitmentHex: string) =>
  pda([enc.encode("commitment"), signer.toBytes(), fromHex(commitmentHex)]);
export const orbConfigAddress = () => pda([enc.encode("orb_config")]);
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

// --- v3: commit-reveal and ORB attestation -----------------------------------
//
// register_v2 is removed from the program once v3 is deployed (it was
// front-runnable). Until Niara upgrades the devnet program, the site keeps
// using register_v2; set NEXT_PUBLIC_SOLANA_REGISTER_V3=1 in the same deploy
// that follows the program upgrade.

export const SOLANA_REGISTER_V3 = process.env.NEXT_PUBLIC_SOLANA_REGISTER_V3 === "1";

export const DISC_V3 = {
  commit: [223, 140, 142, 165, 229, 208, 156, 74],
  cancelCommitment: [36, 39, 70, 137, 71, 179, 88, 232],
  registerV3: [158, 43, 192, 255, 225, 42, 188, 131],
} as const;
export const ACCOUNT_DISC_V3 = {
  recordV3: [219, 193, 191, 49, 92, 106, 138, 205],
  commitment: [61, 112, 129, 128, 24, 147, 77, 87],
} as const;

const INSTRUCTIONS_SYSVAR = new PublicKey("Sysvar1nstructions1111111111111111111111111");

export type SolanaRecordV3 = SolanaRecordV2 & { orbReportHash: string | null };

function decodeRecordV3(data: Uint8Array): SolanaRecordV3 | null {
  const rd = readerFor(data, ACCOUNT_DISC_V3.recordV3);
  if (!rd) return null;
  const signer = rd.pubkey().toBase58();
  const recordHash = toHex(rd.bytes(32));
  const scheme = rd.u8();
  const typeBytes = rd.bytes(2);
  const documentType = typeBytes[0] | (typeBytes[1] << 8);
  const metadataCommitment = toHex(rd.bytes(32));
  const orb = toHex(rd.bytes(32));
  const timestamp = rd.i64();
  const slot = Number(rd.u64());
  const receiptAssetId = rd.pubkey().toBase58();
  return {
    signer,
    recordHash,
    scheme,
    documentType,
    metadataCommitment,
    orbReportHash: /^0+$/.test(orb) ? null : orb,
    timestamp,
    slot,
    receiptAssetId,
  };
}

/** `signer`'s v3 record of a hash, or null. */
export async function fetchRecordV3(connection: Connection, hashHex: string, signer: PublicKey): Promise<SolanaRecordV3 | null> {
  const acc = await connection.getAccountInfo(recordV3Address(hashHex, signer));
  if (!acc || !acc.owner.equals(SOLANA_PROGRAM_ID)) return null;
  return decodeRecordV3(Uint8Array.from(acc.data));
}

/**
 * Every v3 record of a hash (one per signer), oldest first. Uses
 * getProgramAccounts filtered on the discriminator and on record_hash
 * (offset 8 + 32): the program does not keep a list per hash.
 */
export async function fetchRecordsV3(connection: Connection, hashHex: string): Promise<SolanaRecordV3[]> {
  const bs58 = (bytes: Uint8Array) => new PublicKey(bytes).toBase58(); // 32 bytes -> base58
  const accounts = await connection.getProgramAccounts(SOLANA_PROGRAM_ID, {
    filters: [
      { memcmp: { offset: 0, bytes: base58Of(Uint8Array.from(ACCOUNT_DISC_V3.recordV3)) } },
      { memcmp: { offset: 40, bytes: bs58(fromHex(hashHex)) } },
    ],
  });
  return accounts
    .map((a) => decodeRecordV3(Uint8Array.from(a.account.data)))
    .filter((r): r is SolanaRecordV3 => r !== null && r.recordHash === hashHex.toLowerCase())
    .sort((a, b) => a.slot - b.slot || a.timestamp - b.timestamp);
}

/** All records of a hash: v3 (one per signer) and the single v2 one, if any. */
export async function fetchRecordsAll(
  connection: Connection,
  hashHex: string,
): Promise<(SolanaRecordV3 & { version: 2 | 3 })[]> {
  const [v3, v2] = await Promise.all([fetchRecordsV3(connection, hashHex), fetchRecordV2(connection, hashHex)]);
  const out: (SolanaRecordV3 & { version: 2 | 3 })[] = [];
  if (v2) out.push({ ...v2, orbReportHash: null, version: 2 });
  for (const r of v3) out.push({ ...r, version: 3 });
  return out;
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** Base58 of a short byte string (the 8-byte discriminator; PublicKey only takes 32 bytes). */
function base58Of(bytes: Uint8Array): string {
  let n = BigInt(`0x${toHex(bytes) || "0"}`);
  let out = "";
  while (n > BigInt(0)) {
    out = B58[Number(n % BigInt(58))] + out;
    n /= BigInt(58);
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}

/** Slot in which `signer` committed, or null if there is no pending commitment. */
export async function fetchCommitmentSlot(
  connection: Connection,
  signer: PublicKey,
  commitmentHex: string,
): Promise<number | null> {
  const acc = await connection.getAccountInfo(commitmentAddress(signer, commitmentHex), "confirmed");
  if (!acc || !acc.owner.equals(SOLANA_PROGRAM_ID)) return null;
  const rd = readerFor(Uint8Array.from(acc.data), ACCOUNT_DISC_V3.commitment);
  if (!rd) return null;
  rd.pubkey();
  return Number(rd.u64());
}

export function commitInstruction(signer: PublicKey, commitmentHex: string): TransactionInstruction {
  return ix(
    [w(signer, true), w(commitmentAddress(signer, commitmentHex)), r(SystemProgram.programId)],
    concat(DISC_V3.commit, fromHex(commitmentHex)),
  );
}

export function registerV3Instruction(
  signer: PublicKey,
  cfg: ReceiptConfig,
  commitmentHex: string,
  recordHashHex: string,
  scheme: number,
  documentType: number,
  metadataCommitmentHex: string,
  nonceHex: string,
  orbReportHashHex: string | null = null,
): TransactionInstruction {
  const treeConfig = pda([cfg.merkleTree.toBytes()], MPL_BUBBLEGUM_ID);
  const coreCpiSigner = pda([enc.encode("mpl_core_cpi_signer")], MPL_BUBBLEGUM_ID);
  return ix(
    [
      w(signer, true),
      w(commitmentAddress(signer, commitmentHex)),
      r(configAddress()),
      w(recordV3Address(recordHashHex, signer)),
      // Optional account: the program id stands for "none" (Anchor convention).
      r(orbReportHashHex ? orbConfigAddress() : SOLANA_PROGRAM_ID),
      r(INSTRUCTIONS_SYSVAR),
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
      DISC_V3.registerV3,
      fromHex(recordHashHex),
      [scheme],
      [documentType & 0xff, (documentType >> 8) & 0xff],
      fromHex(metadataCommitmentHex),
      fromHex(nonceHex),
      fromHex(orbReportHashHex ?? "0".repeat(64)),
    ),
  );
}
