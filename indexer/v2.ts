import { ethers } from "ethers";
import { PublicKey } from "@solana/web3.js";
import { SIGNATURE_REGISTRY_V2_ABI, SIGNATURE_REGISTRY_V3_ABI, TRANSFERABLE_RECORD_ABI } from "./abi";
import { BorshReader, programDataPayloads, type SolanaRpc } from "./solana";
import { withBackoff, type BackoffOptions } from "./rate-limit";

/**
 * v2 sources: SignatureRegistryV2 + TransferableRecordRegistry on the EVM
 * networks, and register_v2 + transferable records on the Solana program.
 *
 * v2 signatures go to registro_assinaturas_v2 (migrations 011 and 012): no
 * document name, only the record hash, the hash scheme, the public document
 * type code (fixed list), the salted metadata commitment and the receipt id. Transferable-record events
 * go to registro_transferiveis_eventos.
 *
 * Each EVM network runs its own loop and checkpoint ("<network>-v2"); the
 * Solana v2 source has its own checkpoint ("solana-v2"), separate from the
 * v1 source, so both can scan the same program history independently.
 *
 * v3 (SignatureRegistryV3 / register_v3: commit-reveal + ORB attestation) is
 * read by the same loops: on EVM the v3 registry address joins the v2 scan of
 * that network; on Solana DocumentRegisteredV3 comes from the same program.
 * v3 rows carry versao_contrato = 3 and hash_relatorio_orb (migration 014).
 */

export type V2Network = "sepolia" | "base-sepolia" | "robinhood-testnet" | "hyperevm-testnet" | "tempo-testnet" | "solana-devnet";

export type NewSignatureV2 = {
  rede: V2Network;
  /** "0x" + 64 lowercase hex. */
  hash_registro: string;
  esquema_hash: 0 | 1;
  /** Public type code from the fixed list (1..11 today; never 0). */
  tipo_documento: number;
  /** "0x" + 64 lowercase hex (all zeros = no metadata). */
  compromisso_metadados: string;
  assinante_endereco: string;
  /** EVM: token id (decimal); Solana: cNFT asset id. */
  recibo_id: string;
  tx_hash: string;
  log_index: number;
  endereco_contrato: string;
  bloco: number | null;
  slot?: number;
  assinado_em: string;
  /** 2 = SignatureRegistryV2 / register_v2; 3 = commit-reveal (v3). */
  versao_contrato: 2 | 3;
  /** v3: "0x" + 64 hex of the attested ORB report, or null. */
  hash_relatorio_orb: string | null;
  /** EVM v2 row written after v2 was retired on that network (migration 015). */
  apos_aposentadoria_v2: boolean;
};

/** Event names stored in tipo_evento (Portuguese, like the rest of the database). */
export const ETR_EVENT_TYPES = {
  RecordIssued: "emitido",
  ControlTransferred: "controle_transferido",
  AmendmentProposed: "aditamento_proposto",
  AmendmentCancelled: "aditamento_cancelado",
  RecordAmended: "aditado",
  RecordSurrendered: "apresentado",
  RecordTerminated: "extinto",
} as const;

export type NewEtrEvent = {
  rede: V2Network;
  /** EVM: token id as "0x" + hex (= original document hash); Solana: record account. */
  registro: string;
  tipo_evento: (typeof ETR_EVENT_TYPES)[keyof typeof ETR_EVENT_TYPES];
  dados: Record<string, string | number>;
  tx_hash: string;
  log_index: number;
  endereco_contrato: string;
  bloco: number | null;
  slot?: number;
  ocorrido_em: string | null;
};

export type V2Db = {
  saveSignatureV2(row: NewSignatureV2): Promise<void>;
  saveEtrEvent(row: NewEtrEvent): Promise<void>;
  readCheckpoint(source: string, fallback: number): Promise<number>;
  saveCheckpoints(sources: string[], block: number): Promise<void>;
};

const hex32 = (v: string) => `0x${v.replace(/^0x/, "").toLowerCase().padStart(64, "0")}`;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// ── EVM ──────────────────────────────────────────────────────────────────────────

const registryIface = new ethers.Interface(SIGNATURE_REGISTRY_V2_ABI);
const registryV3Iface = new ethers.Interface(SIGNATURE_REGISTRY_V3_ABI);
const ZERO32 = `0x${"0".repeat(64)}`;
const etrIface = new ethers.Interface(TRANSFERABLE_RECORD_ABI);

export type DecodedEvm = { signature?: NewSignatureV2; etr?: NewEtrEvent };

/**
 * Turns one log into a database row, or nothing. `blockTime` is used for ETR
 * events, which (unlike DocumentRegistered) carry no timestamp of their own.
 */
export function decodeEvmV2Log(
  log: ethers.Log,
  network: Exclude<V2Network, "solana-devnet">,
  addresses: { registry?: string; registryV3?: string; etr?: string; v2RetiredAt?: number },
  blockTime: number | null,
): DecodedEvm | null {
  const address = log.address.toLowerCase();
  const base = { rede: network, tx_hash: log.transactionHash, log_index: log.index, endereco_contrato: log.address, bloco: log.blockNumber };

  const isV2 = Boolean(addresses.registry && address === addresses.registry.toLowerCase());
  const isV3 = Boolean(addresses.registryV3 && address === addresses.registryV3.toLowerCase());
  if (isV2 || isV3) {
    let parsed: ethers.LogDescription | null = null;
    try {
      parsed = (isV3 ? registryV3Iface : registryIface).parseLog(log);
    } catch {
      return null;
    }
    if (parsed?.name !== "DocumentRegistered") return null;
    const hash = hex32(parsed.args.recordHash as string);
    const scheme = Number(parsed.args.scheme);
    if (scheme !== 0 && scheme !== 1) return null;
    const documentType = Number(parsed.args.documentType);
    if (!(documentType > 0)) return null;
    return {
      signature: {
        ...base,
        hash_registro: hash,
        esquema_hash: scheme,
        tipo_documento: documentType,
        compromisso_metadados: hex32(parsed.args.metadataCommitment as string),
        assinante_endereco: parsed.args.signer as string,
        // v2: token id = record hash; v3: token id = recordIdOf(hash, signer), carried by the event.
        recibo_id: isV3 ? BigInt(parsed.args.tokenId as bigint).toString() : BigInt(hash).toString(),
        assinado_em: new Date(Number(parsed.args.timestamp as bigint) * 1000).toISOString(),
        versao_contrato: isV3 ? 3 : 2,
        apos_aposentadoria_v2:
          !isV3 && addresses.v2RetiredAt !== undefined && Number(parsed.args.timestamp as bigint) > addresses.v2RetiredAt,
        hash_relatorio_orb: isV3 && hex32(parsed.args.orbReportHash as string) !== ZERO32 ? hex32(parsed.args.orbReportHash as string) : null,
      },
    };
  }

  if (addresses.etr && address === addresses.etr.toLowerCase()) {
    let parsed: ethers.LogDescription | null = null;
    try {
      parsed = etrIface.parseLog(log);
    } catch {
      return null;
    }
    if (!parsed) return null;
    const when = blockTime ? new Date(blockTime * 1000).toISOString() : null;
    const id = (v: unknown) => hex32(ethers.toBeHex(v as bigint));
    const row = (registro: string, tipo: NewEtrEvent["tipo_evento"], dados: NewEtrEvent["dados"]): DecodedEvm => ({
      etr: { ...base, registro, tipo_evento: tipo, dados, ocorrido_em: when },
    });
    const a = parsed.args;
    switch (parsed.name) {
      case "RecordIssued":
        return row(id(a.tokenId), "emitido", {
          emissor: a.issuer,
          portador: a.holder,
          hash_documento: hex32(a.documentHash),
          compromisso_metadados: hex32(a.metadataCommitment),
        });
      case "Transfer":
        // Mint and burn are covered by RecordIssued / RecordTerminated.
        if (a.from === ZERO_ADDRESS || a.to === ZERO_ADDRESS) return null;
        return row(id(a.tokenId), "controle_transferido", { de: a.from, para: a.to });
      case "AmendmentProposed":
        return row(id(a.tokenId), "aditamento_proposto", {
          novo_hash: hex32(a.newDocumentHash),
          novo_compromisso: hex32(a.newMetadataCommitment),
        });
      case "AmendmentCancelled":
        return row(id(a.tokenId), "aditamento_cancelado", {});
      case "RecordAmended":
        return row(id(a.tokenId), "aditado", {
          versao: Number(a.version),
          hash_documento: hex32(a.documentHash),
          compromisso_metadados: hex32(a.metadataCommitment),
        });
      case "RecordSurrendered":
        return row(id(a.tokenId), "apresentado", { por: a.by });
      case "RecordTerminated":
        return row(id(a.tokenId), "extinto", { motivo: Number(a.reason) });
      default:
        return null;
    }
  }
  return null;
}

export type LightEvmRpcV2 = {
  getBlockNumber(): Promise<number>;
  getLogs(filter: { address: string[]; fromBlock: number; toBlock: number }): Promise<ethers.Log[]>;
  getBlock(block: number): Promise<{ timestamp: number } | null>;
};

export function createEvmV2Indexer(deps: {
  network: Exclude<V2Network, "solana-devnet">;
  source: string;
  rpc: LightEvmRpcV2;
  db: V2Db;
  registry?: string;
  /** SignatureRegistryV3 on this network, once deployed (scanned by the same loop). */
  registryV3?: string;
  /** Unix seconds when v2 was retired there (v2 rows after it are flagged). */
  v2RetiredAt?: number;
  etr?: string;
  deployBlock: number;
  chunk: number;
  maxChunksPerCycle: number;
  confirmations: number;
  chunkIntervalMs?: number;
  backoff: Omit<BackoffOptions, "sleep">;
  sleep: (ms: number) => Promise<void>;
}) {
  const { rpc, db } = deps;
  const addresses = [deps.registry, deps.registryV3, deps.etr].filter((a): a is string => Boolean(a)).map((a) => a.toLowerCase());
  const options: BackoffOptions = { ...deps.backoff, sleep: deps.sleep };
  const net = <T,>(fn: () => Promise<T>, context: string) => withBackoff(fn, `${deps.network}-v2: ${context}`, options);
  let checkpoint = 0;

  async function start() {
    checkpoint = await db.readCheckpoint(deps.source, deps.deployBlock - 1);
  }

  async function cycle(): Promise<{ saved: number; upToDate: boolean }> {
    const tip = (await net(() => rpc.getBlockNumber(), "getBlockNumber")) - deps.confirmations;
    let saved = 0;
    for (let i = 0; i < deps.maxChunksPerCycle && checkpoint < tip; i++) {
      if (i > 0 && deps.chunkIntervalMs) await deps.sleep(deps.chunkIntervalMs);
      const from = checkpoint + 1;
      const to = Math.min(checkpoint + deps.chunk, tip);
      const logs = await net(() => rpc.getLogs({ address: addresses, fromBlock: from, toBlock: to }), `getLogs ${from}–${to}`);
      const sorted = [...logs].sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
      const times = new Map<number, number | null>();
      for (const log of sorted) {
        if (!addresses.includes(log.address.toLowerCase())) continue;
        let blockTime: number | null = null;
        if (deps.etr && log.address.toLowerCase() === deps.etr.toLowerCase()) {
          if (!times.has(log.blockNumber)) {
            const b = await net(() => rpc.getBlock(log.blockNumber), `getBlock ${log.blockNumber}`);
            times.set(log.blockNumber, b ? Number(b.timestamp) : null);
          }
          blockTime = times.get(log.blockNumber) ?? null;
        }
        const decoded = decodeEvmV2Log(
          log,
          deps.network,
          { registry: deps.registry, registryV3: deps.registryV3, etr: deps.etr, v2RetiredAt: deps.v2RetiredAt },
          blockTime,
        );
        if (decoded?.signature) {
          await db.saveSignatureV2(decoded.signature);
          saved++;
        } else if (decoded?.etr) {
          await db.saveEtrEvent(decoded.etr);
          saved++;
        }
      }
      await db.saveCheckpoints([deps.source], to);
      checkpoint = to;
    }
    return { saved, upToDate: checkpoint >= tip };
  }

  return {
    start,
    cycle,
    get checkpoint() {
      return checkpoint;
    },
  };
}

// ── Solana ───────────────────────────────────────────────────────────────────────

export const SOURCE_SOLANA_V2 = "solana-v2";

// Discriminators from niara-register-solana's IDL.
const EVENT_DISC: Record<string, number[]> = {
  DocumentRegisteredV2: [23, 150, 17, 90, 254, 203, 21, 8],
  DocumentRegisteredV3: [39, 180, 202, 184, 125, 217, 187, 244],
  RecordIssued: [44, 242, 204, 114, 101, 237, 254, 224],
  ControlTransferred: [107, 178, 53, 201, 22, 6, 115, 185],
  AmendmentProposed: [240, 0, 141, 249, 56, 195, 144, 207],
  AmendmentCancelled: [174, 89, 251, 235, 7, 164, 162, 94],
  RecordAmended: [185, 221, 124, 101, 21, 90, 240, 77],
  RecordSurrendered: [214, 82, 17, 89, 13, 179, 143, 243],
  RecordTerminated: [232, 108, 26, 67, 156, 123, 136, 73],
};
const RECORD_V2_DISC = Buffer.from([255, 235, 84, 155, 197, 94, 92, 26]);
const RECORD_V3_DISC = Buffer.from([219, 193, 191, 49, 92, 106, 138, 205]);

export type SolanaV2Event =
  | { kind: "DocumentRegisteredV2"; recordHash: string; signer: string; scheme: number; documentType: number; metadataCommitment: string; timestamp: number; slot: number; receiptAssetId: string }
  | { kind: "DocumentRegisteredV3"; recordHash: string; signer: string; scheme: number; documentType: number; metadataCommitment: string; orbReportHash: string; timestamp: number; slot: number; receiptAssetId: string }
  | { kind: "RecordIssued"; record: string; issuer: string; holder: string; documentHash: string; metadataCommitment: string }
  | { kind: "ControlTransferred"; record: string; from: string; to: string }
  | { kind: "AmendmentProposed"; record: string; newDocumentHash: string; newMetadataCommitment: string }
  | { kind: "AmendmentCancelled"; record: string }
  | { kind: "RecordAmended"; record: string; version: number; documentHash: string; metadataCommitment: string }
  | { kind: "RecordSurrendered"; record: string; by: string }
  | { kind: "RecordTerminated"; record: string; reason: number };

export function decodeSolanaV2Event(base64: string): SolanaV2Event | null {
  const buf = Buffer.from(base64, "base64");
  if (buf.length < 8) return null;
  const disc = [...buf.subarray(0, 8)];
  const kind = Object.keys(EVENT_DISC).find((k) => EVENT_DISC[k].every((b, i) => b === disc[i]));
  if (!kind) return null;
  try {
    const r = new BorshReader(buf.subarray(8));
    const pk = () => new PublicKey(r.bytes(32)).toBase58();
    const h = () => r.bytes(32).toString("hex");
    switch (kind) {
      case "DocumentRegisteredV2": {
        const recordHash = h();
        const signer = pk();
        const scheme = r.bytes(1)[0];
        const documentType = r.bytes(2).readUInt16LE(0);
        const metadataCommitment = h();
        const timestamp = Number(r.i64());
        const slot = Number(r.u64());
        return { kind, recordHash, signer, scheme, documentType, metadataCommitment, timestamp, slot, receiptAssetId: pk() };
      }
      case "DocumentRegisteredV3": {
        const recordHash = h();
        const signer = pk();
        const scheme = r.bytes(1)[0];
        const documentType = r.bytes(2).readUInt16LE(0);
        const metadataCommitment = h();
        const orbReportHash = h();
        const timestamp = Number(r.i64());
        const slot = Number(r.u64());
        return { kind, recordHash, signer, scheme, documentType, metadataCommitment, orbReportHash, timestamp, slot, receiptAssetId: pk() };
      }
      case "RecordIssued":
        return { kind, record: pk(), issuer: pk(), holder: pk(), documentHash: h(), metadataCommitment: h() };
      case "ControlTransferred":
        return { kind, record: pk(), from: pk(), to: pk() };
      case "AmendmentProposed":
        return { kind, record: pk(), newDocumentHash: h(), newMetadataCommitment: h() };
      case "AmendmentCancelled":
        return { kind, record: pk() };
      case "RecordAmended":
        return { kind, record: pk(), version: r.bytes(4).readUInt32LE(), documentHash: h(), metadataCommitment: h() };
      case "RecordSurrendered":
        return { kind, record: pk(), by: pk() };
      case "RecordTerminated":
        return { kind, record: pk(), reason: r.bytes(1)[0] };
    }
  } catch {
    return null;
  }
  return null;
}

/** The RecordV2/RecordV3 account fields the indexer cross-checks against the event. */
export function decodeRecordAccount(
  data: Buffer,
  version: 2 | 3 = 2,
): { signer: string; recordHash: string; documentType: number; orbReportHash: string | null; timestamp: number } | null {
  const disc = version === 3 ? RECORD_V3_DISC : RECORD_V2_DISC;
  if (data.length < 8 || !data.subarray(0, 8).equals(disc)) return null;
  try {
    const r = new BorshReader(data.subarray(8));
    const signer = new PublicKey(r.bytes(32)).toBase58();
    const recordHash = r.bytes(32).toString("hex");
    r.bytes(1); // scheme
    const documentType = r.bytes(2).readUInt16LE(0);
    r.bytes(32); // metadata commitment
    const orbReportHash = version === 3 ? r.bytes(32).toString("hex") : null;
    const timestamp = Number(r.i64());
    return { signer, recordHash, documentType, orbReportHash, timestamp };
  } catch {
    return null;
  }
}

/** v2 name kept for existing callers. */
export const decodeRecordV2Account = (data: Buffer) => decodeRecordAccount(data, 2);

export function recordV2Address(hashHex: string, program: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("record_v2"), Buffer.from(hashHex, "hex")], program)[0];
}

/** v3 records are one per (hash, signer). */
export function recordV3Address(hashHex: string, signer: string, program: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("record_v3"), Buffer.from(hashHex, "hex"), new PublicKey(signer).toBuffer()],
    program,
  )[0];
}

const PAGE_SIZE = 1000;

export function createSolanaV2Indexer(deps: {
  rpc: Omit<SolanaRpc, "getTransaction"> & {
    getTransaction(
      signature: string,
      options: { commitment: "finalized"; maxSupportedTransactionVersion: 0 },
    ): Promise<{ blockTime?: number | null; meta: { err: unknown; logMessages?: string[] | null } | null } | null>;
  };
  db: V2Db;
  programId: string;
  startSlot: number;
  backoff: Omit<BackoffOptions, "sleep">;
  sleep: (ms: number) => Promise<void>;
}) {
  const { rpc, db } = deps;
  const program = new PublicKey(deps.programId);
  const options: BackoffOptions = { ...deps.backoff, sleep: deps.sleep };
  const net = <T,>(fn: () => Promise<T>, context: string) => withBackoff(fn, `solana-v2: ${context}`, options);
  let checkpoint = 0;

  async function start() {
    checkpoint = await db.readCheckpoint(SOURCE_SOLANA_V2, deps.startSlot);
  }

  async function newSignatures() {
    const found: { signature: string; slot: number; err: unknown }[] = [];
    let before: string | undefined;
    for (;;) {
      const page = await net(() => rpc.getSignaturesForAddress(program, { before, limit: PAGE_SIZE }, "finalized"), "getSignaturesForAddress");
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
    const when = tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null;
    const base = { rede: "solana-devnet" as const, tx_hash: signature, endereco_contrato: deps.programId, bloco: null, slot: txSlot };
    let saved = 0;

    for (const [index, payload] of programDataPayloads(tx.meta.logMessages ?? [], deps.programId).entries()) {
      const e = decodeSolanaV2Event(payload);
      if (!e) continue;
      if (e.kind === "DocumentRegisteredV2" || e.kind === "DocumentRegisteredV3") {
        // The account is the source of truth, as in the v1 source.
        const version = e.kind === "DocumentRegisteredV3" ? 3 : 2;
        const orbHex = e.kind === "DocumentRegisteredV3" ? e.orbReportHash : null;
        const pda = version === 3 ? recordV3Address(e.recordHash, e.signer, program) : recordV2Address(e.recordHash, program);
        const account = await net(() => rpc.getAccountInfo(pda, "finalized"), `getAccountInfo ${pda.toBase58().slice(0, 8)}`);
        const acc = account && account.owner.equals(program) ? decodeRecordAccount(Buffer.from(account.data), version) : null;
        if (
          !acc ||
          acc.recordHash !== e.recordHash ||
          acc.signer !== e.signer ||
          acc.timestamp !== e.timestamp ||
          acc.documentType !== e.documentType ||
          acc.orbReportHash !== orbHex
        ) {
          console.warn(`[indexer] solana-v2: event in ${signature} does not match account ${pda.toBase58()}; ignored`);
          continue;
        }
        if ((e.scheme !== 0 && e.scheme !== 1) || !(e.documentType > 0)) continue;
        await db.saveSignatureV2({
          ...base,
          log_index: index,
          slot: e.slot || txSlot,
          hash_registro: `0x${e.recordHash}`,
          esquema_hash: e.scheme,
          tipo_documento: e.documentType,
          compromisso_metadados: `0x${e.metadataCommitment}`,
          assinante_endereco: e.signer,
          recibo_id: e.receiptAssetId,
          assinado_em: new Date(e.timestamp * 1000).toISOString(),
          versao_contrato: version,
          hash_relatorio_orb: orbHex && !/^0+$/.test(orbHex) ? `0x${orbHex}` : null,
          // register_v2 is removed by the v3 upgrade: no v2 rows can appear after it.
          apos_aposentadoria_v2: false,
        });
        saved++;
        continue;
      }
      const row = (tipo: NewEtrEvent["tipo_evento"], dados: NewEtrEvent["dados"]): NewEtrEvent => ({
        ...base,
        log_index: index,
        registro: e.record,
        tipo_evento: tipo,
        dados,
        ocorrido_em: when,
      });
      const out =
        e.kind === "RecordIssued"
          ? row("emitido", { emissor: e.issuer, portador: e.holder, hash_documento: `0x${e.documentHash}`, compromisso_metadados: `0x${e.metadataCommitment}` })
          : e.kind === "ControlTransferred"
            ? row("controle_transferido", { de: e.from, para: e.to })
            : e.kind === "AmendmentProposed"
              ? row("aditamento_proposto", { novo_hash: `0x${e.newDocumentHash}`, novo_compromisso: `0x${e.newMetadataCommitment}` })
              : e.kind === "AmendmentCancelled"
                ? row("aditamento_cancelado", {})
                : e.kind === "RecordAmended"
                  ? row("aditado", { versao: e.version, hash_documento: `0x${e.documentHash}`, compromisso_metadados: `0x${e.metadataCommitment}` })
                  : e.kind === "RecordSurrendered"
                    ? row("apresentado", { por: e.by })
                    : row("extinto", { motivo: e.reason });
      await db.saveEtrEvent(out);
      saved++;
    }
    return saved;
  }

  async function cycle(): Promise<{ transactions: number; saved: number }> {
    const found = await newSignatures();
    let saved = 0;
    for (const s of found) {
      if (s.err) continue;
      saved += await processTransaction(s.signature, s.slot);
    }
    if (found.length > 0) {
      const highest = Math.max(...found.map((s) => s.slot));
      await db.saveCheckpoints([SOURCE_SOLANA_V2], highest);
      checkpoint = highest;
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
