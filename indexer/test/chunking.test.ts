/**
 * Adaptive eth_getLogs ranges (chunking.ts): provider-timeout and range-refusal
 * classification, the chunk controller (grow, halve, floor) and fetchAdaptive
 * (halve and retry, backoff after timeouts, give up at the floor). The time
 * budget of the Exchange cycle is tested in exchange.test.ts.
 */
import { ethers } from "ethers";
import { createChunkController, fetchAdaptive, isRangeRefusal, isTimeout, isUnreachable, providerRangeLimit } from "../chunking";
import { createJsonRpc, RpcError as JsonRpcError } from "../exchange-rpc";
import { RpcError } from "../exchange-rpc";

let failures = 0;
function check(c: boolean, d: string) {
  console.log(`${c ? "ok  " : "FAIL"} ${d}`);
  if (!c) failures++;
}

(async () => {
  console.log("\n— classification —");
  // The shape ethers gives to HyperEVM's JSON-RPC error.
  const hyper = ethers.makeError('could not coalesce error (error={ "code": -32000, "message": "execution aborted (timeout = 5s)" }, payload={ "method": "eth_getLogs" })', "UNKNOWN_ERROR", {
    error: { code: -32000, message: "execution aborted (timeout = 5s)" },
  } as never);
  check(isTimeout(hyper) && isRangeRefusal(hyper), "HyperEVM: -32000 execution aborted (timeout = 5s) is a timeout and a range refusal");
  check(isTimeout(new RpcError("eth_getLogs", 0, "timeout")), "client-side abort (RpcError timeout)");
  check(isTimeout(new RpcError("eth_getLogs", 504, "HTTP 504")), "HTTP 504");
  check(isTimeout(ethers.makeError("request timeout", "TIMEOUT", { operation: "request", reason: "timeout" } as never)), "ethers TIMEOUT");
  check(isTimeout(new Error("query timeout exceeded")), "query timeout exceeded");
  check(isRangeRefusal(new RpcError("eth_getLogs", 413, "HTTP 413")), "HTTP 413");
  check(isRangeRefusal(new RpcError("eth_getLogs", -32602, "query returned more than 10000 results")), "too many results");
  check(isRangeRefusal(new RpcError("eth_getLogs", -32600, "eth_getLogs is limited to a 10,000 range")), "block range cap");
  check(isRangeRefusal(new RpcError("eth_getLogs", -32005, "Log response size exceeded")) === false, "-32005 is treated as a rate limit, not a range problem");
  check(isRangeRefusal(new Error("block range too large")), "block range too large");
  check(!isRangeRefusal(new RpcError("eth_getLogs", 429, "Too Many Requests")) && !isTimeout(new RpcError("eth_getLogs", 429, "Too Many Requests")), "429 is neither (it goes through the backoff)");
  check(!isRangeRefusal(new RpcError("eth_getLogs", 0, "network error")) && !isRangeRefusal(new Error("invalid argument")), "other errors are not range refusals");
  const wrapped = new Error("Failed to read logs", { cause: hyper });
  check(isTimeout(wrapped), "a wrapped error is classified by its cause");

  console.log("\n— controller —");
  const c = createChunkController({ min: 4, max: 64, initial: 8, growAfter: 3 });
  check(c.size === 8, "starts at initial");
  c.success();
  c.success();
  check(c.size === 8, "no growth before growAfter successes");
  c.success();
  check(c.size === 16, "doubles after growAfter successes");
  for (let i = 0; i < 30; i++) c.success();
  check(c.size === 64, "never above max");
  check(c.refused() === 32 && c.size === 32, "halves on a refusal");
  c.success();
  c.success();
  c.refused();
  c.success();
  c.success();
  check(c.size === 16, "a refusal resets the success streak");
  c.refused(10);
  check(c.size === 5, "halves the range actually attempted when it was clipped");
  c.refused();
  c.refused();
  check(c.size === 4, "never below the floor");
  check(createChunkController({ min: 1, max: 10 }).size === 10, "initial defaults to max");
  const capped = createChunkController({ min: 1, max: 10000, growAfter: 3 });
  check(capped.refused(10000, 10) === 10 && capped.ceiling === 10, "a stated provider limit: jumps straight to it (10000 → 10)");
  for (let i = 0; i < 30; i++) capped.success();
  check(capped.size === 10, "and never grows back into the refusal");
  check(capped.refused(10, 10) === 5, "a refusal at the stated limit itself halves");
  check(createChunkController({ min: 20, max: 10 }).size === 20, "max below min is lifted to min");

  console.log("\n— fetchAdaptive —");
  const sleeps: number[] = [];
  const sleep = async (ms: number) => {
    sleeps.push(ms);
  };
  const opts = (controller: ReturnType<typeof createChunkController>) => ({ controller, timeoutBackoff: { baseMs: 100, capMs: 300 }, sleep, label: "test" });

  // The provider times out above 12 blocks.
  const calls: [number, number][] = [];
  const picky = async (from: number, to: number) => {
    calls.push([from, to]);
    if (to - from + 1 > 12) throw new RpcError("eth_getLogs", -32000, "execution aborted (timeout = 5s)");
    return "ok";
  };
  const ctl = createChunkController({ min: 1, max: 50, growAfter: 3 });
  const r1 = await fetchAdaptive(1000, 1_000_000, picky, opts(ctl));
  check(r1.to === 1000 + 12 - 1 && ctl.size === 12 && calls.length === 3, `50 → 25 → 12, then accepted (to ${r1.to}, calls ${JSON.stringify(calls)})`);
  check(sleeps.join() === "100,200", `waits after each timeout, doubling (${sleeps.join()})`);

  sleeps.length = 0;
  const flaky = createChunkController({ min: 1, max: 1000 });
  let n = 0;
  const alwaysTimeout = async () => {
    n++;
    throw new RpcError("eth_getLogs", -32000, "execution aborted (timeout = 5s)");
  };
  let threw = false;
  try {
    await fetchAdaptive(1, 1_000_000, alwaysTimeout, opts(flaky));
  } catch {
    threw = true;
  }
  check(threw && flaky.size === 1 && n === 10, `gives up at the floor: 1000 → … → 1 is ${n} attempts, then the error goes up`);
  check(sleeps.every((s) => s <= 300) && sleeps.length === 9 && sleeps[sleeps.length - 1] === 300, "timeout wait is capped");

  const floored = createChunkController({ min: 8, max: 64 });
  let attempts = 0;
  try {
    await fetchAdaptive(1, 1_000_000, async () => {
      attempts++;
      throw new RpcError("eth_getLogs", 413, "HTTP 413");
    }, opts(floored));
  } catch {
    /* expected */
  }
  check(floored.size === 8 && attempts === 4, `floor of 8: 64 → 32 → 16 → 8, then gives up (${attempts} attempts)`);

  let down = 0;
  try {
    await fetchAdaptive(1, 100, async () => {
      down++;
      throw new TypeError("fetch failed");
    }, opts(createChunkController({ min: 1, max: 50 })));
  } catch {
    /* expected */
  }
  check(down === 1, "an unreachable node is not retried with smaller ranges");

  // An unrecognized error still shrinks the range: an identical retry can never succeed.
  const unknown = createChunkController({ min: 1, max: 40 });
  const seen: number[] = [];
  const r2 = await fetchAdaptive(1, 1000, async (f, t) => {
    seen.push(t - f + 1);
    if (t - f + 1 > 10) throw new RpcError("eth_getLogs", 400, "something new from a provider", 400);
    return "ok";
  }, opts(unknown));
  check(r2.to === 10 && seen.join() === "40,20,10", `unrecognized error: 40 → 20 → 10, then accepted (${seen.join()})`);


  const clipped = await fetchAdaptive(90, 100, async (f, t) => [f, t], opts(createChunkController({ min: 1, max: 50 })));
  check(clipped.to === 100 && clipped.result.join() === "90,100", "the range is clipped to the limit");

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nall checks passed");
})();
