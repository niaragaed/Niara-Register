import { ethers } from "ethers";

/**
 * Everything the indexer needs to know about an offering's tokens, read from
 * the chain, never assumed.
 *
 * Decimals: treating 18 as a constant worked by accident. Nothing in the
 * contract guarantees it, and a future token with 6 decimals would record
 * values a trillion times off with no visible error. Here it comes from
 * `decimals()`.
 *
 * Currency: each OfertaCaptacao declares its own payment token in `moeda()`.
 * The 11 legacy offerings use one MockBRL and the OfertaOrquestrador ones
 * another, so the address is asked for each offering, and the symbol stored in
 * `dados` is that token's `symbol()` (currently "mBRL" in both), not a literal.
 *
 * Each read happens at most once per process: the result is cached, and so is
 * the in-flight promise, so simultaneous calls do not fire two requests at the
 * RPC. On error the entry leaves the cache, so the next attempt asks again.
 */

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

// OfertaCaptacao exposes the payment token through `moeda()` and the
// participation token through `token()`.
const OFFERING_TOKENS_ABI = [
  "function moeda() view returns (address)",
  "function token() view returns (address)",
];

// ParticipacaoToken: on top of ERC-20, it stores the issuing company.
const SHARE_TOKEN_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function empresa() view returns (string)",
];

export type TokenMetadata = {
  name: string | null;
  symbol: string | null;
  company: string | null;
};

/** What the indexer uses from the tokens; the test injects a fake version. */
export type TokenReader = Pick<
  Tokens,
  "currencyDecimals" | "currencySymbol" | "offeringCurrency" | "shareTokenDecimals" | "metadata"
>;

export class Tokens {
  private readonly cache = new Map<string, Promise<unknown>>();

  constructor(private readonly provider: ethers.Provider) {}

  private remember<T>(key: string, read: () => Promise<T>, description: string): Promise<T> {
    const cached = this.cache.get(key);
    if (cached) return cached as Promise<T>;

    const promise = read().catch((error: unknown) => {
      // Without the data there is no way to format without making things up:
      // let the error go up for the caller to decide (the indexer logs it and
      // tries again in the next cycle).
      this.cache.delete(key);
      throw new Error(`Failed to read ${description}: ${(error as Error).message}`, { cause: error });
    });
    this.cache.set(key, promise);
    return promise;
  }

  /** Decimals of any ERC-20. */
  decimals(address: string): Promise<number> {
    return this.remember(
      `decimals:${address.toLowerCase()}`,
      async () => Number(await new ethers.Contract(address, ERC20_ABI, this.provider).decimals()),
      `decimals() of ${address}`,
    );
  }

  /** symbol() of any ERC-20. */
  symbol(address: string): Promise<string> {
    return this.remember(
      `symbol:${address.toLowerCase()}`,
      async () => String(await new ethers.Contract(address, ERC20_ABI, this.provider).symbol()),
      `symbol() of ${address}`,
    );
  }

  /** Address of the payment token declared by the offering itself (moeda()). */
  offeringCurrency(offering: string): Promise<string> {
    return this.remember(
      `moeda:${offering.toLowerCase()}`,
      async () => String(await new ethers.Contract(offering, OFFERING_TOKENS_ABI, this.provider).moeda()),
      `moeda() of offering ${offering}`,
    );
  }

  /** Decimals of the payment token used by an offering. */
  async currencyDecimals(offering: string): Promise<number> {
    return this.decimals(await this.offeringCurrency(offering));
  }

  /** symbol() of the payment token used by an offering. */
  async currencySymbol(offering: string): Promise<string> {
    return this.symbol(await this.offeringCurrency(offering));
  }

  /**
   * Decimals of an offering's participation (share) token. Uses the known
   * address when there is one; otherwise asks the offering itself.
   */
  async shareTokenDecimals(offering: string, knownToken: string | null): Promise<number> {
    const token =
      knownToken ??
      (await this.remember(
        `token:${offering.toLowerCase()}`,
        async () => String(await new ethers.Contract(offering, OFFERING_TOKENS_ABI, this.provider).token()),
        `token() of offering ${offering}`,
      ));
    return this.decimals(token);
  }

  /**
   * name(), symbol() and empresa() of the ParticipacaoToken. Each field is
   * optional: a token that does not expose empresa() (the call reverts) does
   * not block registering the offering. A network error, on the other hand,
   * goes up; otherwise the offering would be stored without a company because
   * of a momentary failure.
   */
  async metadata(token: string): Promise<TokenMetadata> {
    const c = new ethers.Contract(token, SHARE_TOKEN_ABI, this.provider);
    const read = async (f: "name" | "symbol" | "empresa") => {
      try {
        return String(await c[f]());
      } catch (error) {
        if (ethers.isError(error, "CALL_EXCEPTION") || ethers.isError(error, "BAD_DATA")) return null;
        throw error;
      }
    };
    return { name: await read("name"), symbol: await read("symbol"), company: await read("empresa") };
  }
}
