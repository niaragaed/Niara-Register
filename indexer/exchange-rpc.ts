/**
 * Minimal JSON-RPC over fetch, for the Exchange settlement sources.
 *
 * Raw JSON-RPC instead of ethers / web3.js providers on purpose: the decoders
 * take the exact JSON the node returns, so the test fixtures (saved responses)
 * are the same input as production. No silent retries here: rate limits go
 * through withBackoff (rate-limit.ts), which recognises the errors thrown below.
 *
 * Errors never include the RPC URL (it may carry a provider key).
 */

export class RpcError extends Error {
  /** JSON-RPC error object, or { code: httpStatus } for an HTTP failure (read by isRateLimit). */
  readonly error: { code: number; message: string };
  constructor(method: string, code: number, message: string) {
    super(`${method}: ${code} ${message}`);
    this.name = "RpcError";
    this.error = { code, message };
  }
}

export type JsonRpc = <T = unknown>(method: string, params: unknown[]) => Promise<T>;

export function createJsonRpc(url: string, options: { timeoutMs?: number } = {}): JsonRpc {
  let id = 0;
  return async <T,>(method: string, params: unknown[]): Promise<T> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
        signal: controller.signal,
      });
    } catch (error) {
      throw new RpcError(method, 0, (error as Error).name === "AbortError" ? "timeout" : "network error");
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      throw new RpcError(method, response.status, response.status === 429 ? "Too Many Requests" : `HTTP ${response.status}`);
    }
    const body = (await response.json()) as { result?: T; error?: { code: number; message: string } };
    if (body.error) throw new RpcError(method, body.error.code, body.error.message);
    return body.result as T;
  };
}
