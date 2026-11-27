# Niara Register: Indexer

A long-running worker that reads real on-chain events from every network Niara Register supports and writes them to the Register's Postgres database (Supabase). It is **not a source of truth**. It only mirrors what has already happened on-chain.

## What it indexes

Each source has its own checkpoint in `registro_checkpoints`:

| Source | Network | What |
|---|---|---|
| **`pmes`** | Ethereum Sepolia | Events of the Niara SMEs `OfertaCaptacao` contracts listed in `registro_ofertas` (see `niara-contracts-PMEs/src/captacao/OfertaCaptacao.sol`): `Aporte` (investment), `OfertaEncerrada` (offering closed), `OfertaCancelada` (cancelled), `CotasResgatadas` (shares redeemed), `RecursosLiberados` (funds released), `Reembolso` (refund). |
| **`orquestrador`** | Ethereum Sepolia | `OfertaCompletaCriada` from the `OfertaOrquestrador` (self-service offering creation, `src/orquestracao/OfertaOrquestrador.sol`). Each new offering is saved to `registro_ofertas` with the next number (12, 13… in creation order), becomes an "Offering created" row in the ledger and joins the `pmes` batch. Its earlier events are fetched by a backfill, which stores its progress in the same table and resumes if the process stops. |
| **`assinaturas`** | Ethereum Sepolia | `DocumentoRegistrado` (document registered) from `RegistroAssinaturas`. |
| **`base-sepolia-assinaturas`**, **`robinhood-testnet-assinaturas`**, **`hyperevm-testnet-assinaturas`**, **`tempo-testnet-assinaturas`** | Base Sepolia, Robinhood Chain Testnet, HyperEVM Testnet, Tempo Testnet | `DocumentoRegistrado` from the same `RegistroAssinaturas`, deployed at the same address. See [Additional EVM networks](#additional-evm-networks-evm-signaturests). |
| **`solana-assinaturas`** | Solana devnet | `DocumentoRegistrado` from the `niara-register-solana` program (`9RPHqLou…`). See [Solana sources](#solana-sources-solanats-and-pmes-solanats). |
| **`pmes-solana`** | Solana devnet | Offering and investment events from the `niara-pmes-solana` program (`FKefGFhU…`), written to the same SMEs ledger as Sepolia. See [Solana sources](#solana-sources-solanats-and-pmes-solanats). |

The list of Sepolia offerings comes from the database (`registro_ofertas`, migration 004), not from an environment variable. The 11 legacy offerings are added by the migration's seed, and the orchestrator's offerings are added by the indexer itself. `OFERTAS_ONCHAIN` is no longer read.

Each event becomes a row in `registro_transacoes` (SMEs ledger) or `registro_assinaturas` (document ledger). Writes are idempotent per `(tx_hash, log_index)`, or per `(network, hash_sha256)` for documents, so the worker can stop and restart without duplicating or losing anything.

### RPC usage (Sepolia)

In normal operation, the three Sepolia sources are at the same block, and each cycle makes **one** `eth_getLogs` call covering every address. Events are split by address, and the three checkpoints are saved together.

A source that is behind (the orchestrator's initial scan, or a backfill) is caught up in separate calls, **after** each cycle's normal batch: at most `CHUNKS_ATRASO_POR_CICLO` calls, spaced by `ATRASO_INTERVALO_MS`. An error during catch-up does not affect the normal batch. New events keep coming in every cycle, and catch-up resumes from the saved point on the next cycle.

Rate limits (HTTP 429 / "compute units per second"): ethers' silent retry is turned off. Every RPC call goes through `rate-limit.ts`, which waits 1 s, 2 s, 4 s… (capped at 30 s, up to 6 attempts) and logs one line per wait. Once the attempts run out, only that part of the cycle is aborted.

## Additional EVM networks (`evm-signatures.ts`)

The same `RegistroAssinaturas` (`0x5627…d93a`) on **Base Sepolia**, **Robinhood Chain Testnet** (chain ID 46630), **HyperEVM Testnet** (chain ID 998) and **Tempo Testnet** (chain ID 42431). Each network has its own provider (without ethers' silent retry), its own checkpoint (`<network>-assinaturas`) and its own loop, running in parallel with Sepolia and Solana. Each cycle goes from the checkpoint up to `head − confirmations`, in chunks, up to 20 chunks, saving the checkpoint after each chunk. The date comes from the event's own `timestamp` field.

| Network | Default RPC | Chunk | Confirmations | Migration |
|---|---|---|---|---|
| `base-sepolia` | `https://sepolia.base.org` (limit of 200 blocks per `eth_getLogs`) | 200 | 5 | 006 |
| `robinhood-testnet` | `https://rpc.testnet.chain.robinhood.com` | 2000 | 20 (~250 ms blocks) | 007 |
| `hyperevm-testnet` | `https://rpc.hyperliquid-testnet.xyz/evm` (limit of 50 blocks per `eth_getLogs` and a per-IP rate limit; 1 s between chunks) | 50 | 2 | 008 |
| `tempo-testnet` | `https://rpc.moderato.tempo.xyz` (~0.5 s blocks, deterministic finality) | 5000 | 2 | 009 |

Run a network's migration **before** deploying the indexer with that network.

Per-network variables, prefixed with `BASE_`, `ROBINHOOD_`, `HYPEREVM_` or `TEMPO_`: `REGISTRO_ASSINATURAS_ENDERECO`, `START_BLOCK`, `BLOCK_RANGE_CHUNK`, `PEDACOS_POR_CICLO`, `INTERVALO_PEDACOS_MS`, `CONFIRMACOES`, `POLL_INTERVAL_MS`, `DESATIVADO=1`. RPC: `BASE_SEPOLIA_RPC_URL` / `ROBINHOOD_RPC_URL` / `HYPEREVM_RPC_URL` / `TEMPO_RPC_URL`.

## Solana sources (`solana.ts` and `pmes-solana.ts`)

Each Solana source has its own loop, in parallel with the EVM sources. An error or a slow response from one RPC never delays another, and an error on Solana never brings the process down. Every poll interval:

1. `getSignaturesForAddress(program)` (commitment `finalized`), back to the checkpoint slot.
2. For each successful transaction, it extracts the program's events from the logs, **only** when the `Program data:` line was emitted inside our own program's frame (tracked through the `invoke` stack). Another program cannot forge a ledger row by citing our address.
3. **Documents (`solana-assinaturas`):** it checks the event against the PDA account `["assinatura", hash]` and writes what is **in the account** to `registro_assinaturas`, with `rede = 'solana-devnet'`, the `slot`, `bloco = null` and the hash as `0x…` (the same format as Sepolia).
   **SMEs (`pmes-solana`):** it decodes the offering events (`OfertaCriada`, `Aporte`, `OfertaEncerrada`, `OfertaCancelada`, `CotasResgatadas`, `RecursosLiberados`, `Reembolso`) and writes them to the same SMEs ledger (`registro_transacoes`, source `pmes`, `rede = 'solana-devnet'`). Offerings go to `registro_ofertas`, numbered separately per network. Amounts use the same format as Sepolia: MockBRL with 6 decimals, whole shares, base58 addresses.
4. It saves the checkpoint as the highest processed slot.

Documents are idempotent per `(rede, hash_sha256)`, which requires `supabase/migrations_005_signatures_multichain.sql`. SMEs on Solana require `supabase/migrations_010_pmes_solana.sql`. **Deploy order:** run the migration in Supabase **before** deploying the indexer with that source. The Sepolia upsert also uses `rede,hash_sha256` since migration 005.

| Variable | Default | |
|---|---|---|
| `SOLANA_RPC_URL` | `https://api.devnet.solana.com` | The public RPC has a low rate limit; a free Helius or QuickNode endpoint works better. Shared by both Solana sources. |
| `SOLANA_PROGRAM_ID` | `9RPHqLouFjoUbPdcmA1GyHMeDoWvjZMuCyYFPBWLmTcR` | Register program |
| `SOLANA_START_SLOT` | `509235000` | Deploy slot; starting point when there is no checkpoint |
| `SOLANA_POLL_INTERVAL_MS` | `30000` | |
| `SOLANA_DESATIVADO` | (unset) | `1` turns off only the document source |
| `SOLANA_V2_START_SLOT` | `514107228` | Slot of the devnet upgrade that added `register_v2`; starting point of the v2 source when there is no checkpoint |
| `SOLANA_V2_DESATIVADO` | (unset) | `1` turns off only the v2 source (records + transferable records) |
| `<PREFIX>_V3_REGISTRY` | (unset) | `SignatureRegistryV3` address on that EVM network (`SEPOLIA`, `BASE`, `ROBINHOOD`, `HYPEREVM`, `TEMPO`). Scanned by the same `<network>-v2` loop. Set it before the first v3 registration; otherwise lower that source's checkpoint to the v3 deploy block once. Solana v3 events (`DocumentRegisteredV3`) need no variable. v3 rows have `versao_contrato = 3` and `hash_relatorio_orb`: run `supabase/migrations_014_v3_commit_reveal_orb.sql` and `015` first (v3 rows are one per hash and signer). |
| `<PREFIX>_V2_RETIRED_AT` | (unset) | Unix time of the v3 deploy block on that EVM network (same value as `V2_RETIRED_AT` in the site). v2 rows after it get `apos_aposentadoria_v2 = true` (possible mempool copies; not counted). |
| `PMES_SOLANA_PROGRAM_ID` | `FKefGFhUmgXBM1xCtSFBWpoNnp3wuPJs6Yddpsp67J2y` | Niara SMEs program |
| `PMES_SOLANA_START_SLOT` | `0` | With no checkpoint, reads the program's whole history (it has few transactions) |
| `PMES_SOLANA_POLL_INTERVAL_MS` | `30000` | |
| `PMES_SOLANA_DESATIVADO` | (unset) | `1` turns off only the SMEs source |

## Exchange settlements (`exchange-*.ts`)

The Global Registry (`/global-registry` in the site) is an independent on-chain record of Niara Exchange settlements. Every row is read **directly from each network** by this indexer; nothing comes from the Exchange's database (`niara-exchange-dev`) or its order service API.

Sources (read-only; never edit those repositories):

| Network (slug) | What is read | Where the address and start point come from |
|---|---|---|
| `solana-devnet` | `Settled` event of the `niara_exchange` program, emitted with `emit_cpi!` (an inner instruction of the program to itself, signed by its `__event_authority` PDA) | niara-exchange-solana: `declare_id!` in `programs/niara_exchange/src/lib.rs`; deploy slot in `docs/devnet-deploy.md` |
| `base-sepolia`, `robinhood-testnet`, `tempo-testnet` | `Settled` from `NiaraSettlement` (matchId is `bytes16`, not indexed) and the `FeeRecorded` that `CashbackDistributor.recordFee` emits in the same transaction (the cashback; `Settled` has no cashback field) | niara-contracts: `broadcast/Deploy.s.sol/<chainId>/run-latest.json` (CREATE receipts) and the README "v1 deployments" section |
| `hyperevm-testnet` | same as the other EVM networks | **not deployed** (niara-contracts has only a dry run for chain 998): in the config, off until `EXCHANGE_HYPEREVM_ENABLED=1` |

Values at the time of writing (2026-11-25), to copy into the Railway variables:

| Variable | Value | Source |
|---|---|---|
| `EXCHANGE_SOLANA_PROGRAM_ID` | `B311xH3PcEx86gdRbuinrGrh1r9G2qzjDCji8uc6eD9v` | niara-exchange-solana `ed7d32c`, `lib.rs` and `Anchor.toml` |
| `EXCHANGE_SOLANA_START_SLOT` | `521888257` | deploy transaction slot, `docs/devnet-deploy.md` |
| `EXCHANGE_BASE_SEPOLIA_SETTLEMENT` / `_CASHBACK_DISTRIBUTOR` | `0x14C6F9DeD6C97F67149B4305c57331F9d3820B6F` / `0x4b10fF1a44Aca4118F75b1f326cC2EE46b73ADD4` | niara-contracts `ffbfa68`, `broadcast/Deploy.s.sol/84532/run-latest.json` |
| `EXCHANGE_BASE_SEPOLIA_START_BLOCK` | `59342270` | NiaraSettlement CREATE receipt (84532) |
| `EXCHANGE_ROBINHOOD_SETTLEMENT` / `_CASHBACK_DISTRIBUTOR` | same two addresses | `broadcast/Deploy.s.sol/46630/run-latest.json` |
| `EXCHANGE_ROBINHOOD_START_BLOCK` | `153889914` | NiaraSettlement CREATE receipt (46630) |
| `EXCHANGE_TEMPO_SETTLEMENT` / `_CASHBACK_DISTRIBUTOR` | same two addresses | `broadcast/Deploy.s.sol/42431/run-latest.json` |
| `EXCHANGE_TEMPO_START_BLOCK` | `44456032` | NiaraSettlement CREATE receipt (42431) |

Required per network (a network with any of them missing is logged as "not configured" and skipped; nothing is guessed):

- Solana: `EXCHANGE_SOLANA_RPC_URL`, `EXCHANGE_SOLANA_PROGRAM_ID`, `EXCHANGE_SOLANA_START_SLOT`.
- EVM, with the prefixes `EXCHANGE_BASE_SEPOLIA_`, `EXCHANGE_ROBINHOOD_`, `EXCHANGE_TEMPO_`, `EXCHANGE_HYPEREVM_`: `RPC_URL`, `SETTLEMENT`, `CASHBACK_DISTRIBUTOR`, `START_BLOCK`.

RPC URLs are Railway secrets (they may carry a provider key).

**Finality.** Solana reads everything at commitment `finalized`. EVM networks scan up to the RPC's `finalized` block (Base Sepolia, Robinhood Chain testnet, Tempo testnet and HyperEVM testnet all answered the tag on 2026-11-25); if an RPC rejects it, that cycle uses latest − `CONFIRMATIONS`.

**EVM scan.** One `eth_getLogs` per range over both addresses with topic0 `Settled` OR `FeeRecorded`. Each `Settled` is paired with the first later `FeeRecorded` of the same transaction, from the configured distributor, with the same asset, payment token and fee (`settle` reverts unless `recordFee` succeeds when the fee is above zero). A `Settled` with a fee and no such `FeeRecorded` stops that network with an error instead of storing a guessed cashback. When an RPC refuses a range, the range is halved (down to one block) and grows back after five successes. Block time comes from the block; symbol and decimals from the token (`symbol()`, `decimals()`).

**Solana scan.** `getSignaturesForAddress(program)` back to the cursor slot, then `getTransaction` (encoding `json`) for each successful transaction. The program emits `Settled` with `emit_cpi!`, so the event is an inner instruction of the program to itself (`EVENT_IX_TAG` + discriminator + Borsh fields) whose only account is the `__event_authority` PDA; only those are read, so a log line or another program cannot fake one. Symbol and decimals come from the mint (Token-2022 metadata extension).

**Stored** in `exchange_settlements` (`supabase/migrations_016_exchange_settlements.sql`): network, tx hash / signature, log index, block / slot, block time, match id, asset (address, symbol, decimals), payment token, base quantity, lots, price, notional, fee, cashback, buyer, seller. Unique on `(network, tx_hash, log_index)`; writes are upserts, so a re-scan changes nothing. Amounts are integers in base units. The lot size is an off-chain Exchange market parameter and is not in any event, so **one lot = one whole token** (`base quantity / 10^decimals`), the lot of every Exchange market so far; **price** = notional per lot, in payment base units. Cursors: `registro_checkpoints`, `fonte = 'exchange-<network>'`.

**One network never blocks another:** each has its own loop, cursor and RPC; an error is logged and retried next cycle.

**Single instance.** Railway can run several replicas and overlaps deployments. Only the holder of the `exchange_indexer_lease` row (taken and renewed every TTL/3 through `exchange_indexer_try_lease`, freed on SIGTERM) runs the settlement sources; the read API runs on every replica.

### Public read API (`exchange-api.ts`)

The same process serves a read-only HTTP API on `PORT` (Railway sets it once the service has a public domain; 8080 otherwise), on every replica:

| Route | Returns |
|---|---|
| `GET /v1/settlements?network=&limit=&cursor=` | `{ items, nextCursor }`, newest first (block time, then id). `network` is a slug, `limit` 1–100 (default 50), `cursor` the previous page's `nextCursor` (opaque). |
| `GET /v1/settlements/{network}/{tx}` | `{ network, txHash, indexed, items }`: every settlement of that transaction; **404** with `indexed: false` when it is not indexed (yet). |
| `GET /v1/networks` | per network: `indexed` (configured and on), `contract`, `unit` (`block`/`slot`), `lastSynced`, `syncedAt`. |
| `GET /health` | `{ ok: true }` |

Amounts are integers in base units, as strings (`baseQuantity`, `notional`, `fee`, `cashback`, `sellerReceives`), plus `lots` and `price` as above and the asset / payment token with `symbol` and `decimals`. CORS allows only the origins in `API_CORS_ORIGINS` (comma-separated; default `https://register.niaraglobal.com,https://niara-register.vercel.app`). GET and OPTIONS only, no credentials. `EXCHANGE_API_DISABLED=1` turns it off.

Run migration 016 in the Register's Supabase project (`niara-register-dev`) **before** deploying this version. Without it the settlement sources log "did not start" every minute; the other sources are unaffected.

Optional: `<PREFIX>FINALITY` (`finalized`, the default, or `depth`), `<PREFIX>CONFIRMATIONS` (depth mode, and the fallback when an RPC rejects the `finalized` tag), `<PREFIX>MAX_BLOCK_RANGE`, `<PREFIX>RANGES_PER_CYCLE`, `<PREFIX>RANGE_INTERVAL_MS`, `<PREFIX>POLL_INTERVAL_MS`, `<PREFIX>DISABLED=1`; `EXCHANGE_SOLANA_POLL_INTERVAL_MS`, `EXCHANGE_SOLANA_DISABLED=1`; `EXCHANGE_POLL_INTERVAL_MS` (all networks, default 30 s); `EXCHANGE_INDEXER_DISABLED=1` (every settlement source off; the API keeps running); `EXCHANGE_LEASE_TTL_SECONDS` (default 90).

## Tests

`npm test` runs `test/backlog.test.ts`, `test/solana.test.ts`, `test/evm-signatures.test.ts` and `test/pmes-solana.test.ts`.

- **`solana.test.ts`** tests event decoding and attribution offline (an event forged by another program is ignored), then runs one cycle against the real devnet with an in-memory database. `SOLANA_TEST_NETWORK=0` skips the devnet part.
- **`evm-signatures.test.ts`** tests the additional EVM networks' loop with an in-memory RPC and database: chunks, the confirmation margin, the address filter and resuming after an error.
- **`pmes-solana.test.ts`** tests the SMEs-on-Solana event decoding offline; set `PMES_SOLANA_TEST_RPC` to also run cycles against a real RPC.
- **`backlog.test.ts`** uses a fake RPC, fake tokens and an in-memory database, so it touches neither the network nor Supabase. It simulates a long catch-up with intermittent 429s and a burst that exhausts the backoff, and checks that the normal batch keeps writing new events during catch-up and that, at the end, there are no gaps and no duplicates.

## Running

```bash
cd indexer
npm install
# create .env with: ALCHEMY_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
npm start
```

Before running, apply `../supabase/schema.sql` and the `../supabase/migrations_0*.sql` files, in order, to the Register's Supabase project (Supabase SQL editor). Without migration 004 the indexer does not start, because the offering list lives there.

### Dry run

`npx tsx index.ts --dry-run` (or `DRY_RUN=1`) reads the chain and the database for real but writes nothing, not even checkpoints. It runs until it catches up with the chain and prints the offerings and the rows it would insert, with a per-offering reconciliation (investments = total at closing = amount to the issuer + fee).

### Backfilling `dados`

### Integrity check

`scripts/verify-integrity.ts` checks the public mirror against the chains, read-only, with the **public** read key (never the service-role key):

```bash
SUPABASE_URL=https://<project>.supabase.co SUPABASE_READ_KEY=<anon / publishable key> \
  npx tsx scripts/verify-integrity.ts --report=integrity.json
```

It re-derives the rows with the indexer's own sources (in-memory database) and reports every row that the chain does not produce (**FORGED**), whose fields differ (**ALTERED**) or that the chain produces but the database lacks (**MISSING**). Solana programs are re-read in full; EVM networks at the blocks the rows point to, so a forged or altered row is always caught, while a deleted EVM row in another block is not (re-index from the deploy blocks if in doubt). Sepolia offerings must be in the versioned seed or created on-chain by the orchestrator. Checkpoints are compared with the chain tips when readable. Exit code 0 = everything matches. `--self-test` checks, without any database, that a forged, an altered and a deleted row are all caught.

`npx tsx scripts/backfill-data.ts` fills the `dados` column of rows written before migration 003, always reading from the chain. It is a dry run by default; `--write` applies it. `--sample=N` and `--numbers=12,8,7` choose which rows are printed.

### Optional variables

Environment variable names are kept as they were (some are in Portuguese, e.g. `CHUNKS_ATRASO_POR_CICLO`) so existing deployments keep working.

| Variable | Default | |
|---|---|---|
| `POLL_INTERVAL_MS` | `30000` | Interval between cycles |
| `BLOCK_RANGE_CHUNK` | `500` | Blocks per `eth_getLogs` (10 on Alchemy's free plan) |
| `CHUNKS_ATRASO_POR_CICLO` | `60` | Max calls per cycle for catch-up and backfill |
| `ATRASO_INTERVALO_MS` | `300` | Pause between catch-up calls (~3/s, ~250 CU/s) |
| `BACKOFF_TENTATIVAS` / `BACKOFF_BASE_MS` / `BACKOFF_TETO_MS` | `6` / `1000` / `30000` | Backoff on 429 |
| `START_BLOCK` | `0` | Starting block of the `pmes` source when there is no checkpoint |
| `ORQUESTRADOR_ENDERECO` / `START_BLOCK_ORQUESTRADOR` | `0xde9c…96e5` / `11733723` | |
| `REGISTRO_ASSINATURAS_ENDERECO` / `START_BLOCK_ASSINATURAS` | `0x5627…d93a` / `11691290` | |

## Continuous operation (production)

This process must always be running (a `while (true)` polling loop). It is not serverless or a cron job, so it does not run on Vercel, which does not support long-running processes. In production it runs on **Railway** as a worker service (Root Directory `/indexer`, start command `npm start`). Other options:

- **Render** (worker service)
- **Fly.io** (`fly launch` with a minimal `Dockerfile`, not included yet)
- A VM with `systemd` or `pm2` restarting the process if it stops

Whichever option you choose, set the same variables as the `.env` file in the service environment.

## Polling interval

`POLL_INTERVAL_MS` (30 s by default) does not need to be aggressive. Sepolia produces a block about every 12 s, and the Register has no real-time requirement. Each Sepolia cycle costs one `eth_getLogs` call (plus one `eth_blockNumber`), so the interval sets the monthly Alchemy usage.

## Future extensions (out of scope for this version)

- Index `EmissaoGateway` (share minting) and `LiquidacaoSecundaria` (secondary market): same logic, different ABI and address.
