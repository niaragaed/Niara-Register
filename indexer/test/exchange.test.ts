/**
 * Exchange settlements (exchange-*.ts): decoders on real fixtures
 * (test/fixtures, see its README), cross-checked against the token movements
 * in the same transactions and against the Exchange's recorded e2e results
 * (fee 1.25, cashback 0.25, seller 248.75); the EVM and Solana loops with
 * in-memory RPCs; the read API; the configuration. Offline: no network, no database.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import { loadExchangeConfig, type EvmExchangeConfig, type SolanaExchangeConfig } from "../exchange-config";
import {
  ANCHOR_EVENT_IX_TAG,
  base58Decode,
  decodeErc20Decimals,
  decodeErc20Symbol,
  decodeEvmSettlements,
  decodeSolanaMint,
  decodeSolanaSettlements,
  eventAuthority,
  FEE_RECORDED_TOPIC,
  formatUnits,
  lotsAndPrice,
  SETTLED_TOPIC,
  type RawLog,
  type RawSolanaTransaction,
} from "../exchange-decode";
import type { ExchangeDb, SettlementRow, StoredSettlement } from "../exchange-db";
import { createEvmSettlementSource } from "../exchange-evm";
import { createSolanaSettlementSource } from "../exchange-solana";
import { createApiHandler, decodeCursor, encodeCursor } from "../exchange-api";
import { RpcError, type JsonRpc } from "../exchange-rpc";
import { createHeadReader } from "../exchange-head";

let failures = 0;
function check(c: boolean, d: string) {
  console.log(`${c ? "ok  " : "FAIL"} ${d}`);
  if (!c) failures++;
}
function throws(fn: () => unknown, d: string) {
  try {
    fn();
    check(false, d);
  } catch {
    check(true, d);
  }
}

const fixture = <T,>(name: string): T =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8")).result as T;

const PROGRAM = "B311xH3PcEx86gdRbuinrGrh1r9G2qzjDCji8uc6eD9v";
const SETTLEMENT = "0x14C6F9DeD6C97F67149B4305c57331F9d3820B6F";
const DISTRIBUTOR = "0x4b10fF1a44Aca4118F75b1f326cC2EE46b73ADD4";
const TEQTY_SOL = "8LjQkS1rTJGpzz9wbyAmqJk7oZgDsZS6vhPBv2BhzsTo";
const USDT_SOL = "8iWQ7VxYrkUv471vEoZ664eLwDzWinPiCJpRvcTUA24y";
const VAULT_AUTHORITY = "84kn8YgJXxTVSRkBuNXLtxmeHDUiBMSSVzfgqzGmuu8U"; // owner of the fee vault (docs/devnet-deploy.md)
const TEQTY_BASE = "0x0f1c771c8943cd7ec2b4c654ceea49b41336bdd7";
const USDT_BASE = "0x4ed579b02b53d050624c0f04fb1f4d9b1d347457";
const B = (v: string | number) => BigInt(v);

/** Change of `owner`'s balance of `mint` in a Solana transaction (post − pre). */
function delta(tx: RawSolanaTransaction, owner: string, mint: string): bigint {
  const sum = (list: { owner?: string; mint: string; uiTokenAmount: { amount: string } }[] | null | undefined) =>
    (list ?? []).filter((b) => b.owner === owner && b.mint === mint).reduce((acc, b) => acc + B(b.uiTokenAmount.amount), B(0));
  return sum(tx.meta?.postTokenBalances) - sum(tx.meta?.preTokenBalances);
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

(async () => {
  // ── Solana: decoder on real transactions ────────────────────────────────────────
  console.log("\n— Solana devnet decoder —");
  check(ANCHOR_EVENT_IX_TAG.toString("hex") === "e445a52e51cb9a1d", "Anchor EVENT_IX_TAG_LE bytes");
  check(eventAuthority(PROGRAM) !== PROGRAM, "event authority PDA derived");

  const settleTx = fixture<RawSolanaTransaction>("solana-devnet-settle.raw.json");
  const [s1, ...more1] = decodeSolanaSettlements(settleTx, PROGRAM);
  check(Boolean(s1) && more1.length === 0, "v1Nij84…: exactly one Settled event");
  check(s1.txHash === "v1Nij84hHVBHWsRJaZ5rQ9wEMaiQ8A3o9LVZqpjKFDZ9V1Z9mMD6KtYV7v7iQ7vJowJEL47TRLQQhEXNiczKQ8y", "signature");
  check(s1.matchId === "9cc26b018c5841e28a0729233cbd6a9e", `match id ${s1.matchId}`);
  check(s1.asset === TEQTY_SOL && s1.payment === USDT_SOL, "asset tEQTY, payment mockUSDT");
  check(s1.baseQuantity === B(5) && s1.notional === B(125_000_000), "5 tEQTY for 125 mockUSDT");
  check(s1.fee === B(625_000) && s1.cashback === B(125_000), "fee 0.625, cashback 0.125 (50 bps; 20% of the fee)");
  check(s1.fee === (s1.notional * B(50) + B(9_999)) / B(10_000), "fee = ceil(notional × 50 bps)");
  // Cross-check with the token balances of the same transaction.
  check(delta(settleTx, s1.seller, USDT_SOL) === s1.notional - s1.fee, "seller's mockUSDT +124.375 = notional − fee");
  check(delta(settleTx, s1.buyer, USDT_SOL) === -s1.notional, "buyer's mockUSDT −125 = notional");
  check(delta(settleTx, VAULT_AUTHORITY, USDT_SOL) === s1.fee, "fee vault +0.625 = fee");
  check(delta(settleTx, s1.buyer, TEQTY_SOL) === s1.baseQuantity && delta(settleTx, s1.seller, TEQTY_SOL) === -s1.baseQuantity, "5 tEQTY seller → buyer");

  const e2eTx = fixture<RawSolanaTransaction>("solana-devnet-settle-e2e.raw.json");
  const [e2e] = decodeSolanaSettlements(e2eTx, PROGRAM);
  check(e2e?.matchId === "75d83b70b7b641038b79aa7f55ef5b77", "e2e 2026-11-20: match 75d83b70-b7b6-4103-8b79-aa7f55ef5b77");
  check(e2e.seller === "6j5KAzm8hRWgKrMW1CvmA6NZrQP3n9bTvqbNaz1iPEzH" && e2e.buyer === "FDqCi6tY2htop1LSuDB2c2t5B9zSw7RVHJ9BK32g9Q4x", "e2e seller and buyer as recorded");
  check(formatUnits(e2e.fee, 6) === "1.25", "e2e fee 1.25 (Exchange's known result)");
  check(formatUnits(e2e.cashback, 6) === "0.25", "e2e cashback 0.25 (Exchange's known result)");
  check(formatUnits(e2e.notional - e2e.fee, 6) === "248.75", "e2e seller received 248.75 (Exchange's known result)");
  check(delta(e2eTx, e2e.seller, USDT_SOL) === B(248_750_000), "e2e: seller's balance really moved by 248.75");
  check(delta(e2eTx, VAULT_AUTHORITY, USDT_SOL) === B(1_250_000), "e2e: fee vault really moved by 1.25");
  const e2eLots = lotsAndPrice(e2e.baseQuantity, e2e.notional, 0);
  check(e2eLots.lots === "10" && e2eLots.price === "25000000", "e2e: 10 lots at 25 mockUSDT");

  // Only our program's emit_cpi, signed by its event authority, in a successful transaction.
  check(decodeSolanaSettlements(settleTx, "11111111111111111111111111111111").length === 0, "another program id: nothing");
  const failed = clone(settleTx);
  failed.meta!.err = { InstructionError: [0, "Custom"] };
  check(decodeSolanaSettlements(failed, PROGRAM).length === 0, "failed transaction: nothing");
  const wrongAuthority = clone(settleTx);
  for (const g of wrongAuthority.meta!.innerInstructions!) {
    for (const ix of g.instructions) if (ix.accounts.length === 1) ix.accounts = [0];
  }
  check(decodeSolanaSettlements(wrongAuthority, PROGRAM).length === 0, "event instruction without the event-authority PDA: ignored");
  const truncated = clone(settleTx);
  for (const g of truncated.meta!.innerInstructions!) {
    for (const ix of g.instructions) {
      const data = base58Decode(ix.data);
      if (data.subarray(0, 8).equals(ANCHOR_EVENT_IX_TAG)) ix.data = ethers.encodeBase58(data.subarray(0, data.length - 8));
    }
  }
  throws(() => decodeSolanaSettlements(truncated, PROGRAM), "Settled with a wrong length: error, never a partial row");
  check(base58Decode("1112").equals(Buffer.from([0, 0, 0, 1])), "base58 keeps leading zero bytes");

  const teqty = decodeSolanaMint(fixture<{ value: unknown }>(`solana-devnet-mint-${TEQTY_SOL}.raw.json`).value);
  const usdt = decodeSolanaMint(fixture<{ value: unknown }>(`solana-devnet-mint-${USDT_SOL}.raw.json`).value);
  check(teqty.symbol === "tEQTY" && teqty.decimals === 0, "tEQTY mint: symbol from Token-2022 metadata, 0 decimals");
  check(usdt.symbol === "mockUSDT" && usdt.decimals === 6, "mockUSDT mint: 6 decimals");

  // ── EVM: decoder on the Base Sepolia e2e receipt ───────────────────────────────
  console.log("\n— Base Sepolia decoder —");
  const receipt = fixture<{ logs: RawLog[]; blockHash: string; blockNumber: string }>("base-sepolia-settle-receipt.raw.json");
  const block = fixture<{ hash: string; number: string; timestamp: string }>("base-sepolia-settle-block.raw.json");
  check(block.hash === receipt.blockHash && block.number === receipt.blockNumber, "block fixture is the receipt's block");
  const opts = { network: "base-sepolia" as const, settlement: SETTLEMENT, cashbackDistributor: DISTRIBUTOR };
  const [b1, ...moreB] = decodeEvmSettlements(receipt.logs, opts);
  check(Boolean(b1) && moreB.length === 0, "one Settled in the receipt");
  check(b1.txHash === "0x1afcbb05c0317704200ea6ee1a114ad6c59f636137ceee24382eef4cb700b85d" && b1.logIndex === 8 && b1.blockNumber === 62176172, "tx, log index 8, block 62176172");
  check(b1.matchId === "ee361b38fd934c24b1e079b399f31b7d", "matchId = the match UUID ee361b38-fd93-4c24-b1e0-79b399f31b7d (bytes16)");
  check(b1.asset === TEQTY_BASE && b1.payment === USDT_BASE, "asset tEQTY, payment mockUSDT");
  check(b1.buyer === "0x20ffbc64d8b8941003e0b10e07a4e0bfacecae85" && b1.seller === "0xeda1a2ed4b76c8f0ee471b4db750cadbf6fd9e06", "buyer investor A, seller investor B");
  check(b1.baseQuantity === ethers.parseUnits("10", 18), "10 tEQTY (18 decimals)");
  check(formatUnits(b1.notional, 6) === "250", "notional 250");
  check(formatUnits(b1.fee, 6) === "1.25", "fee 1.25 (Exchange's known result)");
  check(formatUnits(b1.cashback, 6) === "0.25", "cashback 0.25 from FeeRecorded (Exchange's known result)");
  check(formatUnits(b1.notional - b1.fee, 6) === "248.75", "seller received 248.75 (Exchange's known result)");
  // Cross-check with the ERC-20 Transfer logs of the same receipt.
  const transfer = new ethers.Interface(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
  const moves = receipt.logs
    .filter((l) => l.topics[0] === ethers.id("Transfer(address,address,uint256)"))
    .map((l) => ({ token: l.address.toLowerCase(), ...transfer.parseLog(l)!.args.toObject() }) as { token: string; from: string; to: string; value: bigint });
  const moved = (token: string, from: string, to: string) =>
    moves.filter((m) => m.token === token && m.from.toLowerCase() === from && m.to.toLowerCase() === to).reduce((a, m) => a + m.value, B(0));
  check(moved(USDT_BASE, b1.buyer, b1.seller) === b1.notional - b1.fee, "Transfer buyer → seller = 248.75");
  check(moved(USDT_BASE, b1.buyer, DISTRIBUTOR.toLowerCase()) === b1.fee, "Transfer buyer → distributor = fee");
  check(moved(TEQTY_BASE, b1.seller, b1.buyer) === b1.baseQuantity, "Transfer of 10 tEQTY seller → buyer");
  const lp = lotsAndPrice(b1.baseQuantity, b1.notional, 18);
  check(lp.lots === "10" && lp.price === "25000000", "10 lots at 25 mockUSDT per lot");

  const tokens = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/base-sepolia-tokens.raw.json", import.meta.url)), "utf8")).tokens;
  check(decodeErc20Symbol(tokens[TEQTY_BASE].symbol) === "tEQTY" && decodeErc20Decimals(tokens[TEQTY_BASE].decimals) === 18, "tEQTY symbol() / decimals()");
  check(decodeErc20Symbol(tokens[USDT_BASE].symbol) === "mockUSDT" && decodeErc20Decimals(tokens[USDT_BASE].decimals) === 6, "mockUSDT symbol() / decimals()");
  check(decodeErc20Symbol(ethers.encodeBytes32String("OLD")) === "OLD", "bytes32 symbol()");

  const noFee = receipt.logs.filter((l) => l.topics[0] !== FEE_RECORDED_TOPIC);
  throws(() => decodeEvmSettlements(noFee, opts), "fee > 0 without FeeRecorded: error, never a guessed cashback");
  throws(() => decodeEvmSettlements(receipt.logs, { ...opts, cashbackDistributor: "0x000000000000000000000000000000000000dead" }), "FeeRecorded from another address: not accepted");
  check(decodeEvmSettlements(receipt.logs.map((l) => ({ ...l, removed: true })), opts).length === 0, "removed (reorged) logs ignored");
  const forged = receipt.logs.map((l) => (l.topics[0] === SETTLED_TOPIC ? { ...l, address: "0x000000000000000000000000000000000000beef" } : l));
  check(decodeEvmSettlements(forged, opts).length === 0, "Settled from another contract ignored");

  // ── amounts ─────────────────────────────────────────────────────────────────────
  check(formatUnits(B(625_000), 6) === "0.625" && formatUnits(B(0), 6) === "0" && formatUnits(B(10), 0) === "10", "formatUnits");
  check(lotsAndPrice(B(3), B(100), 0).price === "33.333333333333333333", "price of an uneven fill keeps 18 decimals");
  check(lotsAndPrice(B("1500000000000000000"), B(30_000_000), 18).lots === "1.5", "fractional lots are exact");

  // ── EVM loop: finalized head, adaptive ranges, cursor ───────────────────────────
  console.log("\n— EVM source loop —");
  const env = {
    EXCHANGE_BASE_SEPOLIA_RPC_URL: "http://rpc.invalid",
    EXCHANGE_BASE_SEPOLIA_SETTLEMENT: SETTLEMENT,
    EXCHANGE_BASE_SEPOLIA_CASHBACK_DISTRIBUTOR: DISTRIBUTOR,
    EXCHANGE_BASE_SEPOLIA_START_BLOCK: "62176000",
    EXCHANGE_BASE_SEPOLIA_MAX_BLOCK_RANGE: "1000",
  };
  const baseCfg = loadExchangeConfig(env).sources.find((s) => s.network === "base-sepolia") as EvmExchangeConfig;
  const memory = () => {
    const rows = new Map<string, SettlementRow>();
    const cursors = new Map<string, number>();
    const db: ExchangeDb = {
      async saveSettlements(r) {
        for (const x of r) rows.set(`${x.network}:${x.tx_hash}:${x.log_index}`, x);
      },
      async readCursor(s, f) {
        return cursors.get(s) ?? f;
      },
      async saveCursor(s, v) {
        cursors.set(s, v);
      },
    };
    return { rows, cursors, db };
  };
  const FINALIZED = 62176400;
  const calls: string[] = [];
  let finalizedTag = true;
  const evmRpc: JsonRpc = async <T,>(method: string, params: unknown[]): Promise<T> => {
    calls.push(method);
    const hexBlock = (n: number) => `0x${n.toString(16)}`;
    if (method === "eth_getBlockByNumber" && params[0] === "finalized") {
      if (!finalizedTag) throw new RpcError(method, -32602, "invalid block tag");
      return { number: hexBlock(FINALIZED) } as T;
    }
    if (method === "eth_blockNumber") return hexBlock(FINALIZED + 50) as T;
    if (method === "eth_getBlockByNumber") return { timestamp: block.timestamp } as T;
    if (method === "eth_call") {
      const [{ to, data }] = params as [{ to: string; data: string }];
      return (data === "0x95d89b41" ? tokens[to].symbol : tokens[to].decimals) as T;
    }
    if (method === "eth_getLogs") {
      const [f] = params as [{ fromBlock: string; toBlock: string; address: string[]; topics: string[][] }];
      const from = Number(f.fromBlock);
      const to = Number(f.toBlock);
      if (to - from + 1 > 200) throw new RpcError(method, 413, "HTTP 413");
      const addresses = f.address.map((a) => a.toLowerCase());
      return receipt.logs.filter(
        (l) => Number(l.blockNumber) >= from && Number(l.blockNumber) <= to && addresses.includes(l.address.toLowerCase()) && f.topics[0].includes(l.topics[0]),
      ) as T;
    }
    throw new Error(`unexpected ${method}`);
  };
  const sleep = async () => {};
  const backoff = { attempts: 3, baseMs: 1, capMs: 1 };
  const m1 = memory();
  const evm = createEvmSettlementSource({ cfg: baseCfg, rpc: evmRpc, db: m1.db, backoff, sleep });
  await evm.start();
  check(evm.cursor === 62175999, "starts at START_BLOCK − 1");
  let r = await evm.cycle();
  // The first range is clipped to the finalized head (401 blocks): refused, halved once to 200, accepted.
  check(evm.range === 400 && calls.filter((c) => c === "eth_getLogs").length === 4, `range over 200 refused → halved to 200, then 200 + 200 + 1 blocks; doubled after 3 successes (${evm.range})`);
  check(r.upToDate && evm.cursor === FINALIZED, `scanned up to the finalized block, not latest (${evm.cursor})`);
  check(m1.cursors.get("exchange-base-sepolia") === FINALIZED, "cursor saved");
  const row = [...m1.rows.values()][0];
  check(m1.rows.size === 1 && row.cashback === "250000" && row.fee === "1250000" && row.lots === "10" && row.price === "25000000", "row stored with fee, cashback, lots, price");
  check(row.asset_symbol === "tEQTY" && row.asset_decimals === 18 && row.payment_symbol === "mockUSDT" && row.payment_decimals === 6, "token metadata read from the chain");
  check(row.block_time === "2026-11-22T14:18:23.000Z" && row.block_number === 62176172 && row.slot === null, "block time from the block");
  const again = createEvmSettlementSource({ cfg: { ...baseCfg }, rpc: evmRpc, db: m1.db, backoff, sleep });
  m1.cursors.set("exchange-base-sepolia", 62175999);
  await again.start();
  await again.cycle();
  check(m1.rows.size === 1, "re-scan: idempotent, no duplicate");
  finalizedTag = false;
  const m2 = memory();
  const depth = createEvmSettlementSource({ cfg: { ...baseCfg, maxBlockRange: 100 }, rpc: evmRpc, db: m2.db, backoff, sleep });
  await depth.start();
  r = await depth.cycle();
  check(depth.cursor === FINALIZED + 50 - baseCfg.confirmations, `no finalized tag → latest − ${baseCfg.confirmations}`);
  finalizedTag = true;
  const m3 = memory();
  const limited = createEvmSettlementSource({ cfg: { ...baseCfg, maxBlockRange: 100, maxRangesPerCycle: 2 }, rpc: evmRpc, db: m3.db, backoff, sleep });
  await limited.start();
  r = await limited.cycle();
  check(!r.upToDate && limited.cursor === 62176199, "at most RANGES_PER_CYCLE ranges per cycle, cursor after each");

  // A cycle keeps fetching ranges until the head (no per-poll cap) and stops at the time budget.
  const m5 = memory();
  const many = createEvmSettlementSource({ cfg: { ...baseCfg, maxBlockRange: 10, minBlockRange: 10 }, rpc: evmRpc, db: m5.db, backoff, sleep });
  await many.start();
  r = await many.cycle();
  check(r.upToDate && many.cursor === FINALIZED && many.head === FINALIZED, "one cycle drains 400 blocks in ranges of 10, up to the head");
  let clock = 0;
  const m6 = memory();
  const ticking: JsonRpc = async <T,>(method: string, params: unknown[]): Promise<T> => {
    if (method === "eth_getLogs") clock += 1000;
    return evmRpc<T>(method, params);
  };
  const budgetedSource = createEvmSettlementSource({
    cfg: { ...baseCfg, maxBlockRange: 10, minBlockRange: 10, cycleBudgetMs: 5000 },
    rpc: ticking,
    db: m6.db,
    backoff,
    sleep,
    now: () => clock,
  });
  await budgetedSource.start();
  r = await budgetedSource.cycle();
  check(!r.upToDate && budgetedSource.cursor === 62175999 + 50, `time budget: 5 s at 1 s per range stops after 5 ranges (cursor +${budgetedSource.cursor - 62175999})`);
  r = await budgetedSource.cycle();
  check(budgetedSource.cursor === 62175999 + 100, "the next cycle resumes from the cursor");
  // Regression, production 2026-11-27: Alchemy's free tier answers any eth_getLogs
  // over 10 blocks with HTTP 400 and a JSON-RPC body. The source used to see a bare
  // "HTTP 400", never shrink the range and never save the cursor again.
  const alchemyRpc: JsonRpc = async <T,>(method: string, params: unknown[]): Promise<T> => {
    if (method === "eth_getLogs") {
      const [f] = params as [{ fromBlock: string; toBlock: string }];
      const from = Number(f.fromBlock);
      if (Number(f.toBlock) - from + 1 > 10) {
        throw new RpcError(
          method,
          -32600,
          `Under the Free tier plan, you can make eth_getLogs requests with up to a 10 block range. Based on your parameters, this block range should work: [0x${from.toString(16)}, 0x${(from + 9).toString(16)}]. Upgrade to PAYG for expanded block range.`,
          400,
        );
      }
    }
    return evmRpc<T>(method, params);
  };
  const m8 = memory();
  const saves: number[] = [];
  const db8: ExchangeDb = { ...m8.db, saveCursor: async (src, v) => { saves.push(v); await m8.db.saveCursor(src, v); } };
  const alchemyCfg = { ...baseCfg, maxBlockRange: 10000 };
  const viaAlchemy = createEvmSettlementSource({ cfg: alchemyCfg, rpc: alchemyRpc, db: db8, backoff, sleep });
  await viaAlchemy.start();
  r = await viaAlchemy.cycle();
  check(r.upToDate && viaAlchemy.cursor === FINALIZED && viaAlchemy.range === 10, `Alchemy 10-block cap: 10000 → 10 at once, scanned to the head (range ${viaAlchemy.range})`);
  check(saves.length === 41 && saves[0] === 62176009 && saves.every((v, i) => i === 0 || v - saves[i - 1] <= 10), `cursor saved after every successful range (${saves.length} saves)`);
  check(m8.rows.size === 1, "the settlement inside the scanned blocks is stored");
  // A later failure in the same cycle keeps every range already done.
  let okRanges = 0;
  const dying: JsonRpc = async <T,>(method: string, params: unknown[]): Promise<T> => {
    if (method === "eth_getLogs" && ++okRanges > 3) throw new TypeError("fetch failed");
    return alchemyRpc<T>(method, params);
  };
  const m9 = memory();
  const viaDying = createEvmSettlementSource({ cfg: alchemyCfg, rpc: dying, db: m9.db, backoff, sleep });
  await viaDying.start();
  let died = false;
  try {
    await viaDying.cycle();
  } catch {
    died = true;
  }
  // Calls: 1 refused (10000) + 2 accepted, then the node dies.
  check(died && m9.cursors.get("exchange-base-sepolia") === 62175999 + 20, `node dies mid-cycle: the 2 ranges done stay saved (${m9.cursors.get("exchange-base-sepolia")})`);

  // A provider timeout halves the range (with a floor) instead of retrying the same one.
  const timeoutRpc: JsonRpc = async <T,>(method: string, params: unknown[]): Promise<T> => {
    if (method === "eth_getLogs") {
      const [f] = params as [{ fromBlock: string; toBlock: string }];
      if (Number(f.toBlock) - Number(f.fromBlock) + 1 > 25) throw new RpcError(method, -32000, "execution aborted (timeout = 5s)");
    }
    return evmRpc<T>(method, params);
  };
  const m7 = memory();
  const slow = createEvmSettlementSource({ cfg: { ...baseCfg, maxBlockRange: 400 }, rpc: timeoutRpc, db: m7.db, backoff, sleep });
  await slow.start();
  r = await slow.cycle();
  check(r.upToDate && slow.cursor === FINALIZED && slow.range <= 25 * 2, `provider timeouts halve the range until it fits (${slow.range}) and the source moves on`);

  // ── Solana loop ─────────────────────────────────────────────────────────────────
  console.log("\n— Solana source loop —");
  const solCfg = loadExchangeConfig({
    EXCHANGE_SOLANA_RPC_URL: "http://rpc.invalid",
    EXCHANGE_SOLANA_PROGRAM_ID: PROGRAM,
    EXCHANGE_SOLANA_START_SLOT: "524000000",
  }).sources[0] as SolanaExchangeConfig;
  const txs = new Map([
    [settleTx.transaction.signatures[0], settleTx],
    [e2eTx.transaction.signatures[0], e2eTx],
  ]);
  const signatures = [
    { signature: settleTx.transaction.signatures[0], slot: settleTx.slot, err: null },
    { signature: "5failedfailedfailedfailedfailedfailedfailedfailedfailedfailedfailedfai", slot: 525000000, err: { InstructionError: [0, "x"] } },
    { signature: e2eTx.transaction.signatures[0], slot: e2eTx.slot, err: null },
  ]; // newest first, as the RPC returns them
  const solCalls: string[] = [];
  const solRpc: JsonRpc = async <T,>(method: string, params: unknown[]): Promise<T> => {
    solCalls.push(method);
    if (method === "getSlot") return 526000000 as T;
    if (method === "getSignaturesForAddress") return signatures as T;
    if (method === "getTransaction") return (txs.get(params[0] as string) ?? null) as T;
    if (method === "getAccountInfo") return fixture(`solana-devnet-mint-${params[0]}.raw.json`) as T;
    throw new Error(`unexpected ${method}`);
  };
  const m4 = memory();
  const sol = createSolanaSettlementSource({ cfg: solCfg, rpc: solRpc, db: m4.db, backoff, sleep });
  await sol.start();
  const sr = await sol.cycle();
  check(sr.transactions === 3 && sr.saved === 2, "3 signatures, 2 settlements (failed one skipped)");
  check(solCalls.filter((c) => c === "getTransaction").length === 2, "the failed transaction is not fetched");
  check(sol.cursor === 526000000 - 150, `cursor = finalized slot − margin (${sol.cursor})`);
  const e2eRow = [...m4.rows.values()].find((x) => x.match_id === "75d83b70b7b641038b79aa7f55ef5b77")!;
  check(e2eRow.slot === e2eTx.slot && e2eRow.block_number === null && e2eRow.block_time === new Date(e2eTx.blockTime! * 1000).toISOString(), "slot and block time from the transaction");
  check(e2eRow.asset_symbol === "tEQTY" && e2eRow.lots === "10" && e2eRow.fee === "1250000" && e2eRow.cashback === "250000", "e2e row: 10 lots, fee 1.25, cashback 0.25");
  const sr2 = await sol.cycle();
  check(sr2.transactions === 0 && m4.rows.size === 2, "next cycle: nothing new below the cursor");

  // ── API ─────────────────────────────────────────────────────────────────────────
  console.log("\n— read API —");
  const stored: StoredSettlement[] = [...m4.rows.values(), ...m1.rows.values()].map((x, i) => ({ ...x, id: i + 1, indexed_at: "" }));
  const sorted = [...stored].sort((a, b) => b.block_time.localeCompare(a.block_time) || b.id - a.id);
  const cfg = loadExchangeConfig({ ...env, EXCHANGE_SOLANA_RPC_URL: "x", EXCHANGE_SOLANA_PROGRAM_ID: PROGRAM, EXCHANGE_SOLANA_START_SLOT: "1" });
  const handle = createApiHandler({
    cfg,
    db: {
      async listSettlements(q) {
        return sorted
          .filter((x) => !q.network || x.network === q.network)
          .filter((x) => !q.wallet || x.buyer === q.wallet || x.seller === q.wallet)
          .filter((x) => !q.before || x.block_time < q.before.blockTime || (x.block_time === q.before.blockTime && x.id < q.before.id))
          .slice(0, q.limit);
      },
      async settlementsOfTx(n, tx) {
        return stored.filter((x) => x.network === n && x.tx_hash === tx);
      },
      async readCursors() {
        return new Map([["exchange-base-sepolia", { value: FINALIZED, updatedAt: "2026-11-25T00:00:00Z" }]]);
      },
    },
  });
  const OK_ORIGIN = "https://register.niaraglobal.com";
  const p1 = await handle("GET", "/v1/settlements?limit=2", OK_ORIGIN);
  const body1 = JSON.parse(p1.body);
  check(p1.status === 200 && body1.items.length === 2 && body1.nextCursor, "page 1: 2 items and a cursor");
  check(p1.headers["access-control-allow-origin"] === OK_ORIGIN, "CORS: register.niaraglobal.com allowed");
  const p2 = JSON.parse((await handle("GET", `/v1/settlements?limit=2&cursor=${body1.nextCursor}`, "https://niara-register.vercel.app")).body);
  check(p2.items.length === 1 && p2.nextCursor === null, "page 2: the last item, no cursor");
  const all = [...body1.items, ...p2.items].map((x: { txHash: string }) => x.txHash);
  check(new Set(all).size === 3, "pagination: no duplicate, no gap");
  const evil = await handle("GET", "/v1/settlements", "https://evil.example");
  check(evil.status === 200 && !evil.headers["access-control-allow-origin"], "CORS: other origins get no allow header");
  const filtered = JSON.parse((await handle("GET", "/v1/settlements?network=base-sepolia", undefined)).body);
  check(filtered.items.length === 1 && filtered.items[0].network === "base-sepolia", "network filter");
  const one = await handle("GET", `/v1/settlements/base-sepolia/${b1.txHash.toUpperCase().replace("0X", "0x")}`, undefined);
  const oneBody = JSON.parse(one.body);
  check(one.status === 200 && oneBody.items[0].sellerReceives === "248750000" && oneBody.items[0].cashback === "250000", "GET one (any hex case): sellerReceives 248.75, cashback 0.25");
  const missing = await handle("GET", "/v1/settlements/tempo-testnet/0x" + "ab".repeat(32), undefined);
  check(missing.status === 404 && JSON.parse(missing.body).indexed === false, "not indexed: 404 with indexed false");
  check((await handle("GET", "/v1/settlements/solana-devnet/0x1234", undefined)).status === 400, "wrong tx format for the network: 400");
  check((await handle("GET", "/v1/settlements?network=mainnet", undefined)).status === 400, "unknown network: 400");
  check((await handle("GET", "/v1/settlements?cursor=nope", undefined)).status === 400, "bad cursor: 400");
  check((await handle("GET", "/v1/settlements?limit=1000", undefined)).status === 400, "limit over 100: 400");
  check((await handle("POST", "/v1/settlements", undefined)).status === 405, "POST: 405");
  const pre = await handle("OPTIONS", "/v1/settlements", OK_ORIGIN);
  check(pre.status === 204 && pre.headers["access-control-allow-methods"] === "GET, OPTIONS", "preflight");
  const handleWithHead = createApiHandler({
    cfg,
    db: { listSettlements: async () => [], settlementsOfTx: async () => [], readCursors: async () => new Map([["exchange-base-sepolia", { value: FINALIZED - 5000, updatedAt: "2026-11-25T00:00:00Z" }]]) },
    head: async (n) => (n === "base-sepolia" ? FINALIZED : null),
  });
  const withHead = JSON.parse((await handleWithHead("GET", "/v1/networks", undefined)).body).networks;
  const baseHead = withHead.find((n: { network: string }) => n.network === "base-sepolia");
  check(baseHead.head === FINALIZED && baseHead.lag === 5000, "networks: head and lag (head − last synced)");
  check(withHead.find((n: { network: string }) => n.network === "tempo-testnet").lag === null, "networks: unknown head → lag null");
  // Head reader: cached, shared between callers, stale value kept when the RPC fails.
  let headCalls = 0;
  let headFails = false;
  let headClock = 0;
  const reader = createHeadReader(cfg, {
    ttlMs: 30_000,
    now: () => headClock,
    rpcFor: () => (async <T,>(method: string): Promise<T> => {
      headCalls++;
      if (headFails) throw new RpcError(method, 0, "timeout");
      return { number: `0x${FINALIZED.toString(16)}` } as T;
    }) as JsonRpc,
  });
  const [h1, h2] = await Promise.all([reader("base-sepolia"), reader("base-sepolia")]);
  check(h1 === FINALIZED && h2 === FINALIZED && headCalls === 1, "head reader: concurrent calls share one RPC request");
  await reader("base-sepolia");
  check(headCalls === 1, "head reader: cached within the ttl");
  headClock = 31_000;
  headFails = true;
  check((await reader("base-sepolia")) === FINALIZED, "head reader: stale value kept when the RPC fails");
  check((await reader("hyperevm-testnet")) === null, "head reader: a network that is not indexed has no head");
  const nets = JSON.parse((await handle("GET", "/v1/networks", undefined)).body).networks;
  const baseNet = nets.find((n: { network: string }) => n.network === "base-sepolia");
  const hyper = nets.find((n: { network: string }) => n.network === "hyperevm-testnet");
  check(nets.length === 5 && baseNet.lastSynced === FINALIZED && baseNet.unit === "block" && hyper.indexed === false, "networks: last synced block, HyperEVM not indexed");
  // Wallet filter: buyer or seller, EVM in any hex case, Solana base58 as is.
  const anyRow = stored.find((x) => x.network === "base-sepolia")!;
  const evmBuyer = JSON.parse((await handle("GET", `/v1/settlements?wallet=${anyRow.buyer.toUpperCase().replace("0X", "0x")}`, undefined)).body);
  check(evmBuyer.items.length >= 1 && evmBuyer.items.every((x: { buyer: string; seller: string }) => x.buyer === anyRow.buyer || x.seller === anyRow.buyer), "wallet (EVM, any case): only that wallet's settlements");
  const solRow = stored.find((x) => x.network === "solana-devnet")!;
  const bySeller = JSON.parse((await handle("GET", `/v1/settlements?network=solana-devnet&wallet=${solRow.seller}`, undefined)).body);
  check(bySeller.items.length >= 1 && bySeller.items.every((x: { seller: string; buyer: string }) => x.seller === solRow.seller || x.buyer === solRow.seller), "wallet (Solana seller) + network");
  const nobody = JSON.parse((await handle("GET", `/v1/settlements?wallet=0x${"00".repeat(20)}`, undefined)).body);
  check(nobody.items.length === 0 && nobody.nextCursor === null, "wallet with no settlements: empty page");
  check((await handle("GET", "/v1/settlements?wallet=nope", undefined)).status === 400, "malformed wallet: 400");
  check((await handle("GET", "/v1/settlements?wallet=0x1234%27%29", undefined)).status === 400, "wallet cannot inject into the filter: 400");
  const c = decodeCursor(encodeCursor({ block_time: "2026-11-22T14:18:23+00:00", id: 7 }));
  check(c?.id === 7 && c.blockTime === "2026-11-22T14:18:23+00:00", "cursor round trip");

  // ── config ──────────────────────────────────────────────────────────────────────
  console.log("\n— config —");
  const empty = loadExchangeConfig({});
  check(empty.sources.every((s) => s.missing.length > 0), "no variables: every network reports what is missing (nothing guessed)");
  check(!empty.sources.find((s) => s.network === "hyperevm-testnet")!.enabled, "HyperEVM off by default");
  check(loadExchangeConfig({ EXCHANGE_HYPEREVM_ENABLED: "1" }).sources.find((s) => s.network === "hyperevm-testnet")!.enabled, "EXCHANGE_HYPEREVM_ENABLED=1 turns it on");
  check(loadExchangeConfig({ ...env, EXCHANGE_BASE_SEPOLIA_SETTLEMENT: "0x1234" }).sources[1].missing.includes("EXCHANGE_BASE_SEPOLIA_SETTLEMENT"), "a malformed address counts as missing");
  check(empty.api.corsOrigins.join(",") === "https://register.niaraglobal.com,https://niara-register.vercel.app", "default CORS origins");

  console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})();
