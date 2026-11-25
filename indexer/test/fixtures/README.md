# Exchange settlement fixtures

Real JSON-RPC responses, fetched once on 2026-11-25 from the public RPCs
(`https://api.devnet.solana.com`, `https://sepolia.base.org`) and saved as
returned. `test/exchange.test.ts` decodes them offline. Do not edit them by hand:
re-fetch with the same method and parameters if one ever needs replacing.

| File | Method | What it is |
|---|---|---|
| `solana-devnet-settle.raw.json` | `getTransaction` (`encoding: "json"`, `finalized`, `maxSupportedTransactionVersion: 0`) | `settle` `v1Nij84hHVBHWsRJaZ5rQ9wEMaiQ8A3o9LVZqpjKFDZ9V1Z9mMD6KtYV7v7iQ7vJowJEL47TRLQQhEXNiczKQ8y`, slot 525867867: 5 tEQTY for 125 mockUSDT |
| `solana-devnet-settle-e2e.raw.json` | same | `settle` `CqwNyj2qMUwxpqGDXaeYU3VetRvUC3AKx2xj1uRUQz9ZXJ5K6ypmFwW8kJKJYw8weJeLCRVAwRmY7V5uD8tAYy9`, the first end-to-end trade (2026-11-20, niara-exchange-engine `docs/devnet-e2e-2026-11-20.md`): 10 tEQTY at 25 mockUSDT |
| `solana-devnet-mint-<mint>.raw.json` | `getAccountInfo` (`encoding: "jsonParsed"`, `finalized`) | the tEQTY and mockUSDT mints (Token-2022 metadata) |
| `base-sepolia-settle-receipt.raw.json` | `eth_getTransactionReceipt` | `settle` `0x1afcbb05c0317704200ea6ee1a114ad6c59f636137ceee24382eef4cb700b85d`, block 62176172, the Base Sepolia end-to-end trade (2026-11-22, niara-exchange-engine `docs/base-sepolia-e2e-2026-11-22.md`): 10 tEQTY at 25 mockUSDT |
| `base-sepolia-settle-block.raw.json` | `eth_getBlockByNumber(0x3b4bbac, false)` | number, hash and timestamp of that block (other fields dropped) |
| `base-sepolia-tokens.raw.json` | `eth_call` `symbol()` / `decimals()` | tEQTY and mockUSDT on Base Sepolia |

Testnet only: test tokens, no real value. Public addresses and transaction ids only.
