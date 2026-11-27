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
  /** JSON-RPC error object, or { code: httpStatus } for an HTTP failure with no JSON-RPC body (read by isRateLimit). */
  readonly error: { code: number; message: string };
  /** HTTP status when the response was not 2xx (0 for no response). */
  readonly httpStatus?: number;
  constructor(method: string, code: number, message: string, httpStatus?: number) {
    super(`${method}: ${httpStatus && httpStatus !== code ? `HTTP ${httpStatus} ` : ""}${code} ${message}`);
    this.name = "RpcError";
    this.error = { code, message };
    this.httpStatus = httpStatus;
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
      // Providers put the reason in a JSON-RPC body on 4xx/5xx (Alchemy: HTTP 400
      // "-32600 ... up to a 10 block range"; Base: HTTP 413 "-32614 eth_getLogs is
      // limited to a 200 range"). Read it, or the range limit is invisible.
      const rpcError = await response
        .json()
        .then((b: { error?: { code?: unknown; message?: unknown } }) => b?.error)
        .catch(() => undefined);
      const message = typeof rpcError?.message === "string" ? rpcError.message : response.status === 429 ? "Too Many Requests" : `HTTP ${response.status}`;
      // A 429 stays code 429 whatever the body says, so isRateLimit sees it.
      const code = response.status !== 429 && typeof rpcError?.code === "number" ? rpcError.code : response.status;
      throw new RpcError(method, code, message, response.status);
    }
    const body = (await response.json()) as { result?: T; error?: { code: number; message: string } };
    if (body.error) throw new RpcError(method, body.error.code, body.error.message);
    return body.result as T;
  };
}
