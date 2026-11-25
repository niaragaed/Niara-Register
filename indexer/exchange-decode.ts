import { createHash } from "node:crypto";
import { ethers } from "ethers";
import { PublicKey } from "@solana/web3.js";
import type { ExchangeNetwork } from "./exchange-config";

/**
 * Decoders for Niara Exchange settlements. Pure functions over the JSON the
 * nodes return (eth_getLogs entries; Solana getTransaction with encoding
 * "json"), so tests run them on saved real responses.
 *
 * Amounts stay integers in base units (decimal strings, never floats).
 */

/** What one settlement says on-chain, before token metadata and block time. */
export type DecodedSettlement = {
  network: ExchangeNetwork;
  txHash: string;
  /** EVM: the log's index in the block. Solana: position of the Settled event in the transaction. */
  logIndex: number;
  /** 32 lowercase hex characters (the match UUID's 16 bytes), no 0x. */
  matchId: string;
  /** NiaraSettlement address (lowercase) or program id. */
  contract: string;
  asset: string;
  payment: string;
  buyer: string;
  seller: string;
  /** Base units of the asset. */
  baseQuantity: bigint;
  /** Base units of the payment token the buyer paid (fee included). */
  notional: bigint;
  fee: bigint;
  cashback: bigint;
};

// ── EVM ──────────────────────────────────────────────────────────────────────────

/** niara-contracts src/NiaraSettlement.sol and src/CashbackDistributor.sol. */
export const EXCHANGE_EVM_ABI = [
  "event Settled(bytes16 matchId, address indexed assetToken, address indexed paymentToken, address indexed buyer, address seller, uint256 assetAmount, uint256 paymentAmount, uint256 feeCharged)",
  "event FeeRecorded(address indexed assetToken, address indexed paymentToken, uint256 feeAmount, uint256 cashbackAmount, bool eligible)",
];
const evmIface = new ethers.Interface(EXCHANGE_EVM_ABI);
export const SETTLED_TOPIC = evmIface.getEvent("Settled")!.topicHash;
export const FEE_RECORDED_TOPIC = evmIface.getEvent("FeeRecorded")!.topicHash;

/** An eth_getLogs entry as the node returns it (hex quantities). */
export type RawLog = {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
  removed?: boolean;
};

/**
 * Settlements in a set of logs from NiaraSettlement and its CashbackDistributor
 * (one eth_getLogs over both addresses). `Settled` carries no cashback: it is
 * taken from the `FeeRecorded` that `recordFee` emits later in the same
 * transaction, from the configured distributor, for the same asset, payment
 * token and fee. `settle` reverts unless `recordFee` succeeds whenever the fee
 * is above zero, so a missing `FeeRecorded` means a wrong distributor address
 * in the configuration: that throws instead of storing a guessed cashback.
 */
export function decodeEvmSettlements(
  logs: RawLog[],
  opts: { network: ExchangeNetwork; settlement: string; cashbackDistributor: string },
): (DecodedSettlement & { blockNumber: number })[] {
  const settlement = opts.settlement.toLowerCase();
  const distributor = opts.cashbackDistributor.toLowerCase();
  const live = logs.filter((l) => !l.removed);

  type Fee = { logIndex: number; asset: string; payment: string; fee: bigint; cashback: bigint; used: boolean };
  const feesByTx = new Map<string, Fee[]>();
  for (const log of live) {
    if (log.address.toLowerCase() !== distributor || log.topics[0] !== FEE_RECORDED_TOPIC) continue;
    const parsed = evmIface.parseLog({ topics: log.topics, data: log.data });
    if (!parsed) continue;
    const tx = log.transactionHash.toLowerCase();
    const list = feesByTx.get(tx) ?? [];
    list.push({
      logIndex: Number(BigInt(log.logIndex)),
      asset: (parsed.args.assetToken as string).toLowerCase(),
      payment: (parsed.args.paymentToken as string).toLowerCase(),
      fee: parsed.args.feeAmount as bigint,
      cashback: parsed.args.cashbackAmount as bigint,
      used: false,
    });
    feesByTx.set(tx, list);
  }

  const out: (DecodedSettlement & { blockNumber: number })[] = [];
  const settled = live
    .filter((l) => l.address.toLowerCase() === settlement && l.topics[0] === SETTLED_TOPIC)
    .sort((a, b) => Number(BigInt(a.blockNumber) - BigInt(b.blockNumber)) || Number(BigInt(a.logIndex) - BigInt(b.logIndex)));

  for (const log of settled) {
    const parsed = evmIface.parseLog({ topics: log.topics, data: log.data });
    if (!parsed) continue;
    const tx = log.transactionHash.toLowerCase();
    const logIndex = Number(BigInt(log.logIndex));
    const asset = (parsed.args.assetToken as string).toLowerCase();
    const payment = (parsed.args.paymentToken as string).toLowerCase();
    const fee = parsed.args.feeCharged as bigint;

    let cashback = BigInt(0);
    if (fee > BigInt(0)) {
      const match = (feesByTx.get(tx) ?? [])
        .filter((f) => !f.used && f.logIndex > logIndex && f.asset === asset && f.payment === payment && f.fee === fee)
        .sort((a, b) => a.logIndex - b.logIndex)[0];
      if (!match) {
        throw new Error(
          `${opts.network}: Settled at ${tx}#${logIndex} has fee ${fee} but no matching FeeRecorded from ${distributor}; check the CASHBACK_DISTRIBUTOR variable`,
        );
      }
      match.used = true;
      cashback = match.cashback;
    }

    out.push({
      network: opts.network,
      txHash: tx,
      logIndex,
      blockNumber: Number(BigInt(log.blockNumber)),
      matchId: (parsed.args.matchId as string).slice(2).toLowerCase(),
      contract: settlement,
      asset,
      payment,
      buyer: (parsed.args.buyer as string).toLowerCase(),
      seller: (parsed.args.seller as string).toLowerCase(),
      baseQuantity: parsed.args.assetAmount as bigint,
      notional: parsed.args.paymentAmount as bigint,
      fee,
      cashback,
    });
  }
  return out;
}

/** ERC-20 symbol() return data: ABI string, or bytes32 on some old tokens. */
export function decodeErc20Symbol(hex: string): string | null {
  if (!hex || hex === "0x") return null;
  try {
    return ethers.AbiCoder.defaultAbiCoder().decode(["string"], hex)[0] as string;
  } catch {
    try {
      const text = ethers.decodeBytes32String(hex.slice(0, 66));
      return text || null;
    } catch {
      return null;
    }
  }
}

export function decodeErc20Decimals(hex: string): number {
  const value = Number(BigInt(hex));
  if (!Number.isInteger(value) || value < 0 || value > 36) throw new Error(`unexpected decimals() result ${hex}`);
  return value;
}

// ── Solana ───────────────────────────────────────────────────────────────────────

const anchorDisc = (preimage: string) => createHash("sha256").update(preimage).digest().subarray(0, 8);

/**
 * Anchor's EVENT_IX_TAG_LE: `0x1d9acb512ea545e4u64.to_le_bytes()` (anchor-lang
 * event.rs), the first bytes of every `emit_cpi!` instruction.
 */
export const ANCHOR_EVENT_IX_TAG = Buffer.from("e445a52e51cb9a1d", "hex");
/** Discriminator of `Settled` (programs/niara_exchange/src/events.rs). */
export const SETTLED_EVENT_DISC = anchorDisc("event:Settled");

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_MAP = new Map([...BASE58].map((c, i) => [c, i]));

export function base58Decode(text: string): Buffer {
  let value = BigInt(0);
  for (const c of text) {
    const digit = BASE58_MAP.get(c);
    if (digit === undefined) throw new Error("invalid base58");
    value = value * BigInt(58) + BigInt(digit);
  }
  const bytes: number[] = [];
  while (value > BigInt(0)) {
    bytes.unshift(Number(value & BigInt(0xff)));
    value >>= BigInt(8);
  }
  let zeros = 0;
  while (zeros < text.length && text[zeros] === "1") zeros++;
  return Buffer.from([...new Array(zeros).fill(0), ...bytes]);
}

export function eventAuthority(programId: string): string {
  return PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], new PublicKey(programId))[0].toBase58();
}

/** getTransaction(signature, { encoding: "json", maxSupportedTransactionVersion: 0 }) result. */
export type RawSolanaTransaction = {
  slot: number;
  blockTime: number | null;
  transaction: {
    signatures: string[];
    message: { accountKeys: string[] };
  };
  meta: {
    err: unknown;
    loadedAddresses?: { writable: string[]; readonly: string[] } | null;
    innerInstructions?: { index: number; instructions: { programIdIndex: number; accounts: number[]; data: string }[] }[] | null;
    preTokenBalances?: RawTokenBalance[] | null;
    postTokenBalances?: RawTokenBalance[] | null;
  } | null;
};

export type RawTokenBalance = {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string; decimals: number };
};

/**
 * `Settled` events of `programId` in a transaction. The program emits them with
 * `emit_cpi!`: an inner instruction to itself whose data is EVENT_IX_TAG +
 * event discriminator + Borsh fields, with the `__event_authority` PDA as its
 * only account, signed by the program. Another program cannot produce one in
 * a successful transaction (it cannot sign for that PDA, and the program's
 * event handler rejects an unsigned call), so only successful transactions are
 * read and the PDA is checked too.
 */
export function decodeSolanaSettlements(tx: RawSolanaTransaction, programId: string): DecodedSettlement[] {
  if (!tx.meta || tx.meta.err) return [];
  const keys = [
    ...tx.transaction.message.accountKeys,
    ...(tx.meta.loadedAddresses?.writable ?? []),
    ...(tx.meta.loadedAddresses?.readonly ?? []),
  ];
  const authority = eventAuthority(programId);
  const signature = tx.transaction.signatures[0];

  const groups = [...(tx.meta.innerInstructions ?? [])].sort((a, b) => a.index - b.index);
  const out: DecodedSettlement[] = [];
  for (const group of groups) {
    for (const ix of group.instructions) {
      if (keys[ix.programIdIndex] !== programId) continue;
      if (keys[ix.accounts[0]] !== authority) continue;
      const data = base58Decode(ix.data);
      if (data.length < 16 || !data.subarray(0, 8).equals(ANCHOR_EVENT_IX_TAG) || !data.subarray(8, 16).equals(SETTLED_EVENT_DISC)) continue;
      const body = data.subarray(16);
      if (body.length !== 16 + 32 * 4 + 8 * 4) throw new Error(`Settled in ${signature}: unexpected length ${body.length}`);
      const key = (offset: number) => new PublicKey(body.subarray(offset, offset + 32)).toBase58();
      const u64 = (offset: number) => body.readBigUInt64LE(offset);
      out.push({
        network: "solana-devnet",
        txHash: signature,
        logIndex: out.length,
        matchId: body.subarray(0, 16).toString("hex"),
        contract: programId,
        asset: key(16),
        payment: key(48),
        buyer: key(80),
        seller: key(112),
        baseQuantity: u64(144),
        notional: u64(152),
        fee: u64(160),
        cashback: u64(168),
      });
    }
  }
  return out;
}

/** Mint account with encoding "jsonParsed": decimals and the Token-2022 metadata symbol. */
export function decodeSolanaMint(value: unknown): { decimals: number; symbol: string | null } {
  const parsed = (value as { data?: { parsed?: { type?: string; info?: Record<string, unknown> } } })?.data?.parsed;
  if (parsed?.type !== "mint" || typeof parsed.info?.decimals !== "number") throw new Error("not a mint account");
  const extensions = (parsed.info.extensions ?? []) as { extension: string; state?: { symbol?: string } }[];
  const symbol = extensions.find((e) => e.extension === "tokenMetadata")?.state?.symbol?.trim() || null;
  return { decimals: parsed.info.decimals, symbol };
}

// ── amounts ──────────────────────────────────────────────────────────────────────

/** Exact decimal string of `value / 10^decimals`, trailing zeros trimmed. */
export function formatUnits(value: bigint, decimals: number): string {
  const negative = value < BigInt(0);
  const abs = negative ? -value : value;
  const base = BigInt(10) ** BigInt(decimals);
  const whole = abs / base;
  const fraction = (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

const PRICE_EXTRA_DIGITS = 18;

/**
 * Lots and price, in the Exchange's terms. The lot size is an off-chain market
 * parameter (niara-exchange-solana EXCHANGE-MULTICHAIN-DESIGN.md §5) and is not
 * in any on-chain event, so the Register uses one whole token
 * (10^asset decimals base units) per lot: the lot of every Exchange market so
 * far. lots = baseQuantity / 10^assetDecimals (exact); price = notional per lot,
 * in payment base units, truncated after 18 extra digits if it is not whole.
 */
export function lotsAndPrice(baseQuantity: bigint, notional: bigint, assetDecimals: number) {
  const lots = formatUnits(baseQuantity, assetDecimals);
  if (baseQuantity === BigInt(0)) return { lots, price: "0" };
  const scaled = (notional * BigInt(10) ** BigInt(assetDecimals + PRICE_EXTRA_DIGITS)) / baseQuantity;
  return { lots, price: formatUnits(scaled, PRICE_EXTRA_DIGITS) };
}
