/**
 * Parallel eth_getLogs (parallel-scan.ts + the Register's EVM sources): the
 * checkpoint only moves over a contiguous prefix of completed ranges, the
 * concurrency steps down on 429 and timeouts and recovers, ranges halve on
 * timeouts, and the backfill line reports blocks/s and an ETA.
 */
import { ethers } from "ethers";
import { createChunkController, createConcurrencyController } from "../chunking";
import { backfillLine, formatEta, scanParallel } from "../parallel-scan";
import { createEvmSignatureIndexer } from "../evm-signatures";
import { RpcError } from "../exchange-rpc";

let failures = 0;
function check(c: boolean, d: string) {
  console.log(`${c ? "ok  " : "FAIL"} ${d}`);
  if (!c) failures++;
}

const timeout = () => new RpcError("eth_getLogs", -32000, "execution aborted (timeout = 5s)");
const limited = () => new RpcError("eth_getLogs", 429, "Too Many Requests");

(async () => {
  console.log("\n— concurrency controller —");
  const cc = createConcurrencyController({ max: 4, growAfter: 2 });
  check(cc.size === 4, "starts at the maximum");
  check(cc.stepDown() === 2 && cc.stepDown() === 1 && cc.stepDown() === 1, "halves on trouble, never below 1");
  cc.ok();
  check(cc.size === 1, "needs growAfter clean rounds before growing");
  cc.ok();
  check(cc.size === 2, "grows by one after growAfter clean rounds");
  for (let i = 0; i < 20; i++) cc.ok();
  check(cc.size === 4, "and never above the maximum");

  const sleeps: number[] = [];
  const sleep = async (ms: number) => {
    sleeps.push(ms);
  };
  const base = { sleep, intervalMs: 0, backoff: { baseMs: 100, capMs: 400, attempts: 4 }, label: "test" };

  console.log("\n— contiguous prefix —");
  {
    // 4 ranges of 10 at once; the 3rd fails once (timeout). Only ranges 1–2 may move the checkpoint that round.
    const handled: number[] = [];
    const calls: string[] = [];
    let failedOnce = false;
    const r = await scanParallel({
      ...base,
      checkpoint: 0,
      tip: 40,
      controller: createChunkController({ min: 1, max: 10 }),
      concurrency: createConcurrencyController({ max: 4 }),
      maxRanges: 100,
      fetchRange: async (from, to) => {
        calls.push(`${from}-${to}`);
        if (from === 21 && !failedOnce) {
          failedOnce = true;
          throw timeout();
        }
        return [from];
      },
      handle: async (to) => {
        handled.push(to);
      },
    });
    check(handled.slice(0, 2).join() === "10,20", `round 1: only the prefix before the failed range is handled (${handled.slice(0, 2).join()})`);
    check(handled.join() === "10,20,25,30,35,40", `the failed range was re-planned at half the size; handled in order (${handled.join()})`);
    check(r.checkpoint === 40, "reaches the tip");
    check(handled.every((b, i) => i === 0 || b > handled[i - 1]), "the checkpoint never goes backwards or skips");
  }

  console.log("\n— a range that never completes blocks everything after it —");
  {
    const handled: number[] = [];
    let threw = false;
    try {
      await scanParallel({
        ...base,
        checkpoint: 0,
        tip: 100,
        controller: createChunkController({ min: 5, max: 10 }),
        concurrency: createConcurrencyController({ max: 4 }),
        maxRanges: 100,
        fetchRange: async (from) => {
          if (from >= 11) throw timeout();
          return [];
        },
        handle: async (to) => {
          handled.push(to);
        },
      });
    } catch {
      threw = true;
    }
    check(threw, "gives up at the floor with concurrency 1");
    check(handled.join() === "10", `nothing after the failing range was handled (${handled.join()})`);
  }

  console.log("\n— 429 and timeouts step the concurrency down —");
  {
    const cc2 = createConcurrencyController({ max: 4, growAfter: 3 });
    let n = 0;
    await scanParallel({
      ...base,
      checkpoint: 0,
      tip: 80,
      controller: createChunkController({ min: 1, max: 10 }),
      concurrency: cc2,
      maxRanges: 100,
      fetchRange: async () => {
        if (n++ === 0) throw limited();
        return [];
      },
      handle: async () => {},
    });
    check(sleeps.length >= 1 && sleeps[0] === 100, `429: waits the backoff (${sleeps[0]} ms) and retries the same ranges`);
    check(cc2.size <= 4 && cc2.size >= 2, `429: the concurrency stepped down (4 → 2) and is growing back (${cc2.size})`);

    let seen = 0;
    const sizes: number[] = [];
    const cc3 = createConcurrencyController({ max: 4, growAfter: 100 });
    const ch3 = createChunkController({ min: 1, max: 10 });
    await scanParallel({
      ...base,
      checkpoint: 0,
      tip: 400,
      controller: ch3,
      concurrency: cc3,
      maxRanges: 100,
      fetchRange: async (from, to) => {
        if (seen++ === 0) throw timeout();
        sizes.push(to - from + 1);
        return [];
      },
      handle: async () => {},
    });
    check(cc3.size === 2, `timeout: the concurrency halved (${cc3.size})`);
    check(ch3.size === 5 && sizes[sizes.length - 1] === 5, `timeout: the range halved too (${ch3.size}, last ${sizes[sizes.length - 1]})`);
  }

  console.log("\n— a persistent 429 gives up —");
  {
    let threw = false;
    try {
      await scanParallel({
        ...base,
        checkpoint: 0,
        tip: 100,
        controller: createChunkController({ min: 1, max: 10 }),
        concurrency: createConcurrencyController({ max: 4 }),
        maxRanges: 100,
        fetchRange: async () => {
          throw limited();
        },
        handle: async () => {},
      });
    } catch (e) {
      threw = (e as RpcError).message.includes("429");
    }
    check(threw, "a 429 that never clears ends the cycle with the error");
  }

  console.log("\n— an unreachable node ends the cycle at once, keeping the saved prefix —");
  {
    const handled: number[] = [];
    let threw = false;
    try {
      await scanParallel({
        ...base,
        checkpoint: 0,
        tip: 100,
        controller: createChunkController({ min: 1, max: 10 }),
        concurrency: createConcurrencyController({ max: 3 }),
        maxRanges: 100,
        fetchRange: async (from) => {
          if (from === 11) throw new TypeError("fetch failed");
          return [];
        },
        handle: async (to) => {
          handled.push(to);
        },
      });
    } catch {
      threw = true;
    }
    check(threw && handled.join() === "10", `throws; the range before it stays saved (${handled.join()})`);
  }

  console.log("\n— maxRanges and rounds —");
  {
    let rounds = 0;
    const handled: number[] = [];
    await scanParallel({
      ...base,
      intervalMs: 1000,
      checkpoint: 0,
      tip: 10_000,
      controller: createChunkController({ min: 1, max: 10 }),
      concurrency: createConcurrencyController({ max: 4 }),
      maxRanges: 6,
      fetchRange: async () => {
        rounds++;
        return [];
      },
      handle: async (to) => {
        handled.push(to);
      },
    });
    check(handled.length === 6 && rounds === 6, `stops after maxRanges ranges (${handled.length})`);
    check(sleeps.filter((s) => s === 1000).length === 1, "pauses between rounds, not before the first or inside one");
  }

  console.log("\n— the Register's HyperEVM source, 4 at once —");
  {
    const { createServer } = await import("node:http");
    const START = 1000;
    const TIP = START + 400;
    let inflight = 0;
    let maxInflight = 0;
    const spans: number[] = [];
    let timeouts = 0;
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", async () => {
        const r = JSON.parse(body) as { id: number; method: string; params: { fromBlock: string; toBlock: string }[] };
        let out: object;
        if (r.method === "eth_chainId") out = { jsonrpc: "2.0", id: r.id, result: "0x3e6" };
        else if (r.method === "eth_blockNumber") out = { jsonrpc: "2.0", id: r.id, result: ethers.toQuantity(TIP) };
        else {
          const span = Number(r.params[0].toBlock) - Number(r.params[0].fromBlock) + 1;
          spans.push(span);
          inflight++;
          maxInflight = Math.max(maxInflight, inflight);
          await new Promise((ok) => setTimeout(ok, 15));
          inflight--;
          if (span > 6) {
            timeouts++;
            out = { jsonrpc: "2.0", id: r.id, error: { code: -32000, message: "execution aborted (timeout = 5s)" } };
          } else out = { jsonrpc: "2.0", id: r.id, result: [] };
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(out));
      });
    });
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    const port = (server.address() as { port: number }).port;
    const req = new ethers.FetchRequest(`http://127.0.0.1:${port}/evm`);
    req.retryFunc = async () => false;
    const provider = new ethers.JsonRpcProvider(req, 998, { staticNetwork: true, batchMaxCount: 1 });
    const saves: number[] = [];
    const lines: string[] = [];
    const log = console.log;
    console.log = (...a: unknown[]) => {
      const t = a.join(" ");
      if (t.includes("blocks/s")) lines.push(t);
      else log(...a);
    };
    const idx = createEvmSignatureIndexer({
      network: "hyperevm-testnet",
      source: "test-parallel",
      rpc: provider,
      db: {
        readCheckpoint: async (_s: string, fallback: number) => fallback,
        saveCheckpoints: async (_s: string[], b: number) => {
          saves.push(b);
        },
        saveSignature: async () => {},
      } as never,
      address: "0x5627857ee73f37d6da96530ed08c07339dd9d93a",
      deployBlock: START,
      chunk: 10,
      concurrency: 4,
      maxChunksPerCycle: 12,
      confirmations: 0,
      backoff: { attempts: 3, baseMs: 1, capMs: 1 },
      sleep: async () => {},
    });
    await idx.start();
    const first = await idx.cycle();
    let guard = 0;
    while (!(await idx.cycle()).upToDate && guard++ < 50);
    console.log = log;
    provider.destroy();
    server.close();
    check(!first.upToDate, "a cycle stops after maxChunksPerCycle ranges when behind");
    check(idx.checkpoint === TIP, `reaches the tip (${idx.checkpoint})`);
    check(maxInflight > 1 && maxInflight <= 4, `ranges run in parallel, never more than 4 at once (${maxInflight})`);
    check(saves.every((b, i) => i === 0 || b > saves[i - 1]) && saves[saves.length - 1] === TIP, `checkpoint saved after every range, strictly increasing (${saves.length} saves)`);
    check(spans.includes(5) && timeouts >= 1, `timeouts halved the range (${[...new Set(spans)].join(",")})`);
    check(lines.length >= 1 && /blocks\/s, [\d,]+ blocks behind, ETA /.test(lines[0]), `logs blocks/s and ETA (${lines[0] ?? "none"})`);
  }

  console.log("\n— progress line —");
  check(formatEta(40) === "40 s" && formatEta(3600) === "60 min" && formatEta(5 * 3600 + 600) === "5 h 10 min" && formatEta(3.5 * 86400) === "3 d 12 h", "ETA formats");
  check(backfillLine("x", { checkpoint: 900, ranges: 1, blocksPerSecond: 11 }, 1000, 1).endsWith("ETA 10 s"), "ETA subtracts the chain's own block rate");
  check(backfillLine("x", { checkpoint: 0, ranges: 1, blocksPerSecond: 0.5 }, 1000, 1).endsWith("not catching up"), "says so when it is not catching up");

  console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})();
