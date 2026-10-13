# Niara Register: Indexer

A long-running worker that reads real on-chain events from every network Niara Register supports and writes them to the Register's Postgres database (Supabase). It is **not a source of truth**. It only mirrors what has already happened on-chain.

## What it indexes

Each source has its own checkpoint in `registro_checkpoints`:

| Source | Network | What |
|---|---|---|
| **`pmes`** | Ethereum Sepolia | Events of the Niara SMEs `OfertaCaptacao` contracts listed in `registro_ofertas` (see `niara-contracts-PMEs/src/captacao/OfertaCaptacao.sol`): `Aporte` (investment), `OfertaEncerrada` (offering closed), `OfertaCancelada` (cancelled), `CotasResgatadas` (shares redeemed), `RecursosLiberados` (funds released), `Reembolso` (refund). |
| **`orquestrador`** | Ethereum Sepolia | `OfertaCompletaCriada` from the `OfertaOrquestrador` (self-service offering creation, `src/orquestracao/OfertaOrquestrador.sol`). Each new offering is saved to `registro_ofertas` with the next number (12, 13… in creation order), becomes an "Offering created" row in the ledger and joins the `pmes` batch. Its earlier events are fetched by a backfill, which stores its progress in the same table and resumes if the process stops. |
| **`assinaturas`** | Ethereum Sepolia | `DocumentoRegistrado` (document registered) from `RegistroAssinaturas`. |
| **`base-sepolia-assinaturas`**, **`robinhood-testnet-assinaturas`**, **`hyperevm-testnet-assinaturas`**, **`tempo-testnet-assinaturas`** | Base Sepolia, Robinhood Chain Testnet, HyperEVM Testnet, Tempo Testnet | `DocumentoRegistrado` from the same `RegistroAssinaturas`, deployed at the same address. See [Additional EVM networks](#additional-evm-networks-evm-assinaturasts). |
| **`solana-assinaturas`** | Solana devnet | `DocumentoRegistrado` from the `niara-register-solana` program (`9RPHqLou…`). See [Solana sources](#solana-sources-solanats-and-pmes-solanats). |
| **`pmes-solana`** | Solana devnet | Offering and investment events from the `niara-pmes-solana` program (`FKefGFhU…`), written to the same SMEs ledger as Sepolia. See [Solana sources](#solana-sources-solanats-and-pmes-solanats). |

The list of Sepolia offerings comes from the database (`registro_ofertas`, migration 004), not from an environment variable. The 11 legacy offerings are added by the migration's seed, and the orchestrator's offerings are added by the indexer itself. `OFERTAS_ONCHAIN` is no longer read.

Each event becomes a row in `registro_transacoes` (SMEs ledger) or `registro_assinaturas` (document ledger). Writes are idempotent per `(tx_hash, log_index)`, or per `(network, hash_sha256)` for documents, so the worker can stop and restart without duplicating or losing anything.

### RPC usage (Sepolia)

In normal operation, the three Sepolia sources are at the same block, and each cycle makes **one** `eth_getLogs` call covering every address. Events are split by address, and the three checkpoints are saved together.

A source that is behind (the orchestrator's initial scan, or a backfill) is caught up in separate calls, **after** each cycle's normal batch: at most `CHUNKS_ATRASO_POR_CICLO` calls, spaced by `ATRASO_INTERVALO_MS`. An error during catch-up does not affect the normal batch. New events keep coming in every cycle, and catch-up resumes from the saved point on the next cycle.

Rate limits (HTTP 429 / "compute units per second"): ethers' silent retry is turned off. Every RPC call goes through `limite.ts`, which waits 1 s, 2 s, 4 s… (capped at 30 s, up to 6 attempts) and logs one line per wait. Once the attempts run out, only that part of the cycle is aborted.

## Additional EVM networks (`evm-assinaturas.ts`)

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

Documents are idempotent per `(rede, hash_sha256)`, which requires `supabase/migrations_005_assinaturas_multichain.sql`. SMEs on Solana require `supabase/migrations_010_pmes_solana.sql`. **Deploy order:** run the migration in Supabase **before** deploying the indexer with that source. The Sepolia upsert also uses `rede,hash_sha256` since migration 005.

| Variable | Default | |
|---|---|---|
| `SOLANA_RPC_URL` | `https://api.devnet.solana.com` | The public RPC has a low rate limit; a free Helius or QuickNode endpoint works better. Shared by both Solana sources. |
| `SOLANA_PROGRAM_ID` | `9RPHqLouFjoUbPdcmA1GyHMeDoWvjZMuCyYFPBWLmTcR` | Register program |
| `SOLANA_START_SLOT` | `509235000` | Deploy slot; starting point when there is no checkpoint |
| `SOLANA_POLL_INTERVAL_MS` | `30000` | |
| `SOLANA_DESATIVADO` | (unset) | `1` turns off only the document source |
| `PMES_SOLANA_PROGRAM_ID` | `FKefGFhUmgXBM1xCtSFBWpoNnp3wuPJs6Yddpsp67J2y` | Niara SMEs program |
| `PMES_SOLANA_START_SLOT` | `0` | With no checkpoint, reads the program's whole history (it has few transactions) |
| `PMES_SOLANA_POLL_INTERVAL_MS` | `30000` | |
| `PMES_SOLANA_DESATIVADO` | (unset) | `1` turns off only the SMEs source |

## Tests

`npm run teste` runs `teste/atraso.teste.ts`, `teste/solana.teste.ts`, `teste/base.teste.ts` and `teste/pmes-solana.teste.ts`.

- **`solana.teste.ts`** tests event decoding and attribution offline (an event forged by another program is ignored), then runs one cycle against the real devnet with an in-memory database. `SOLANA_TESTE_REDE=0` skips the devnet part.
- **`atraso.teste.ts`** uses a fake RPC, fake tokens and an in-memory database, so it touches neither the network nor Supabase. It simulates a long catch-up with intermittent 429s and a burst that exhausts the backoff, and checks that the normal batch keeps writing new events during catch-up and that, at the end, there are no gaps and no duplicates.

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

### Optional variables

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
- The Global Registry area (Niara Exchange) is waiting for the Exchange to have real transactions before any indexer is written for it (see `app/global-registry/page.tsx` in the site).
