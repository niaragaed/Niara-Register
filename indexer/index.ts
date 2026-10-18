import "./safe-log";
import { ethers } from "ethers";
import { config } from "./config";
import * as db from "./db";
import { simulated } from "./db";
import { createIndexer } from "./indexer";
import { createSolanaIndexer, SOURCE_SOLANA } from "./solana";
import { createPmesSolanaIndexer, SOURCE_PMES_SOLANA } from "./pmes-solana";
import { createEvmSignatureIndexer } from "./evm-signatures";
import { Tokens } from "./tokens";
import { Connection } from "@solana/web3.js";

// Entry point: wires the core (indexer.ts) to the real dependencies (Alchemy
// RPC, Supabase, the real clock) and runs the loop.

// ethers retries HTTP 429 on its own, silently, up to 12 times. Turned off
// here: the rate limit is handled in rate-limit.ts, with a known-cap backoff and logs.
const request = new ethers.FetchRequest(config.rpcUrl);
request.retryFunc = async () => false;
const provider = new ethers.JsonRpcProvider(request, 11155111, { staticNetwork: true });

const tokens = new Tokens(provider);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const indexer = createIndexer({
  rpc: provider,
  tokens,
  db,
  cfg: config,
  sleep,
});

// Solana: its own loop, with web3.js's internal retry turned off; a 429 goes
// through the same withBackoff as the EVM (rate-limit.ts).
const solanaIndexer = config.solana.enabled
  ? createSolanaIndexer({
      rpc: new Connection(config.solana.rpcUrl, {
        commitment: "finalized",
        disableRetryOnRateLimit: true,
      }) as unknown as Parameters<typeof createSolanaIndexer>[0]["rpc"],
      db,
      programId: config.solana.programId,
      startSlot: config.solana.startSlot,
      backoff: config.backoff,
      sleep,
    })
  : null;

// Niara-PMEs on Solana: another program, same Solana RPC, its own loop and checkpoint.
const pmesSolanaIndexer = config.pmesSolana.enabled
  ? createPmesSolanaIndexer({
      rpc: new Connection(config.solana.rpcUrl, {
        commitment: "finalized",
        disableRetryOnRateLimit: true,
      }) as unknown as Parameters<typeof createPmesSolanaIndexer>[0]["rpc"],
      db,
      programId: config.pmesSolana.programId,
      startSlot: config.pmesSolana.startSlot,
      backoff: config.backoff,
      sleep,
    })
  : null;

// Additional EVM networks (Base Sepolia, Robinhood Chain Testnet, HyperEVM
// Testnet, Tempo Testnet): the same RegistroAssinaturas, each with its own
// provider (without ethers' silent retry), checkpoint and loop.
const extraEvmIndexers = config.extraEvmNetworks
  .filter((n) => n.enabled)
  .map((n) => {
    const req = new ethers.FetchRequest(n.rpcUrl);
    req.retryFunc = async () => false;
    const networkProvider = new ethers.JsonRpcProvider(req, n.chainId, { staticNetwork: true });
    return {
      cfg: n,
      idx: createEvmSignatureIndexer({
        network: n.network,
        source: n.source,
        rpc: networkProvider,
        db,
        address: n.address,
        deployBlock: n.deployBlock,
        chunk: n.chunk,
        maxChunksPerCycle: n.maxChunksPerCycle,
        confirmations: n.confirmations,
        chunkIntervalMs: n.chunkIntervalMs,
        backoff: config.backoff,
        sleep,
      }),
    };
  });

/** Same contract as solanaLoop: never brings the process down or blocks the other networks. */
async function extraEvmLoop({ cfg, idx }: (typeof extraEvmIndexers)[number]): Promise<void> {
  for (;;) {
    let upToDate = true;
    try {
      const r = await idx.cycle();
      upToDate = r.upToDate;
      if (r.saved > 0) {
        console.log(`[indexer] ${cfg.network}: ${r.saved} document(s) saved — checkpoint block ${idx.checkpoint}`);
      }
    } catch (error) {
      console.error(`[indexer] ${cfg.network}: cycle error, retrying in the next one:`, error);
    }
    // Behind (e.g. the first scan since the deploy): carry on without waiting.
    if (upToDate) await sleep(cfg.pollIntervalMs);
  }
}

/**
 * Never brings the process down: a Solana error is logged and the next cycle
 * resumes from the checkpoint. It does not block the EVM loop either; it runs
 * in parallel.
 */
async function solanaLoop(): Promise<void> {
  if (!solanaIndexer) return;
  for (;;) {
    try {
      const { transactions, saved } = await solanaIndexer.cycle();
      if (transactions > 0) {
        console.log(
          `[indexer] solana: ${transactions} new transaction(s), ${saved} document(s) saved — checkpoint slot ${solanaIndexer.checkpoint}`,
        );
      }
    } catch (error) {
      console.error("[indexer] solana: cycle error, retrying in the next one:", error);
    }
    await sleep(config.solana.pollIntervalMs);
  }
}

/** Same contract as solanaLoop: never brings the process down or blocks the other loops. */
async function pmesSolanaLoop(): Promise<void> {
  if (!pmesSolanaIndexer) return;
  for (;;) {
    try {
      const { transactions, saved } = await pmesSolanaIndexer.cycle();
      if (transactions > 0) {
        console.log(
          `[indexer] pmes-solana: ${transactions} new transaction(s), ${saved} event(s) saved — checkpoint slot ${pmesSolanaIndexer.checkpoint}`,
        );
      }
    } catch (error) {
      console.error("[indexer] pmes-solana: cycle error, retrying in the next one:", error);
    }
    await sleep(config.pmesSolana.pollIntervalMs);
  }
}

async function loop(): Promise<void> {
  await indexer.start();
  if (solanaIndexer) {
    await solanaIndexer.start();
    console.log(
      `[indexer] Solana: program ${config.solana.programId} at ${config.solana.rpcUrl} — checkpoint (${SOURCE_SOLANA}) slot ${solanaIndexer.checkpoint}`,
    );
  } else {
    console.log("[indexer] Solana: disabled (SOLANA_DESATIVADO=1)");
  }

  for (const n of config.extraEvmNetworks.filter((n) => !n.enabled)) {
    console.log(`[indexer] ${n.network}: disabled`);
  }
  for (const extra of extraEvmIndexers) {
    await extra.idx.start();
    console.log(
      `[indexer] ${extra.cfg.network}: RegistroAssinaturas at ${extra.cfg.address} via ${extra.cfg.rpcUrl} — checkpoint (${extra.cfg.source}) block ${extra.idx.checkpoint}`,
    );
    if (config.dryRun) {
      const r = await extra.idx.cycle();
      console.log(`[dry-run] ${extra.cfg.network}: ${r.saved} document(s) would be saved (up to date: ${r.upToDate})`);
    } else {
      void extraEvmLoop(extra);
    }
  }

  // In dry-run, Solana runs a single cycle first and prints what it would save.
  if (config.dryRun && solanaIndexer) {
    const r = await solanaIndexer.cycle();
    console.log(`[dry-run] solana: ${r.transactions} transaction(s), ${r.saved} document(s) would be saved`);
  } else {
    void solanaLoop();
  }

  if (pmesSolanaIndexer) {
    try {
      await pmesSolanaIndexer.start();
      console.log(
        `[indexer] PMEs Solana: program ${config.pmesSolana.programId} — checkpoint (${SOURCE_PMES_SOLANA}) slot ${pmesSolanaIndexer.checkpoint}, ${pmesSolanaIndexer.offerings.size} offering(s)`,
      );
      if (config.dryRun) {
        const r = await pmesSolanaIndexer.cycle();
        console.log(`[dry-run] pmes-solana: ${r.transactions} transaction(s), ${r.saved} event(s) would be saved`);
      } else {
        void pmesSolanaLoop();
      }
    } catch (error) {
      // E.g. migration 010 has not run yet. Does not bring the rest of the indexer down.
      console.error("[indexer] PMEs Solana: did not start — source off until the next deploy:", error);
    }
  } else {
    console.log("[indexer] PMEs Solana: disabled (PMES_SOLANA_DESATIVADO=1)");
  }

  if (config.dryRun) console.log("[indexer] DRY-RUN — nothing will be written to the database");
  console.log(`[indexer] Niara-Register — checkpoints: ${JSON.stringify(indexer.checkpoints)}`);
  console.log(
    `[indexer] tracking ${indexer.offerings.size} offering(s) from registro_ofertas:`,
    [...indexer.offerings.values()].map((o) => `${o.number}:${o.address}`),
  );
  console.log(`[indexer] OfertaOrquestrador at ${config.orchestratorAddress}`);
  console.log(`[indexer] RegistroAssinaturas at ${config.signatureRegistryAddress}`);
  console.log(
    `[indexer] chunk of ${config.blockRangeChunk} blocks; backlog: up to ${config.backlogChunksPerCycle} calls per cycle, every ${config.backlogIntervalMs} ms; polling every ${config.pollIntervalMs / 1000}s`,
  );

  while (true) {
    const { upToDate, failed } = await indexer.cycle();

    if (config.dryRun && upToDate) {
      await dryRunReport();
      process.exit(0);
    }

    // Up to date (or with an error): wait the normal interval. Catching up:
    // go straight to the next cycle; backlog calls are already spaced by
    // ATRASO_INTERVALO_MS, and the normal batch runs at the start of every cycle.
    if (upToDate || failed) await sleep(config.pollIntervalMs);
  }
}

// ── dry-run report ───────────────────────────────────────────────────────────────

async function dryRunReport(): Promise<void> {
  console.log("\n════════ DRY-RUN — what would be written ════════\n");

  console.log(`registro_ofertas — ${simulated.offerings.length} new offering(s):`);
  for (const o of simulated.offerings) {
    console.log(
      `  no. ${o.numero}  ${o.endereco}  ${o.simbolo ?? "?"} / ${o.empresa ?? "?"}  issuer ${o.emissor}  currency ${o.moeda}  block ${o.bloco_criacao}  tx ${o.tx_criacao}`,
    );
  }

  const entries = [...simulated.entries].sort((a, b) => (a.bloco ?? 0) - (b.bloco ?? 0) || a.log_index - b.log_index);
  console.log(`\nregistro_transacoes — ${entries.length} new row(s):`);
  for (const r of entries) {
    console.log(`  block ${r.bloco} #${r.log_index}  ${r.tipo_evento}`);
    console.log(`    descricao: ${r.descricao}`);
    console.log(`    dados:     ${JSON.stringify(r.dados)}`);
  }
  console.log(`\nrows with null dados: ${entries.filter((r) => r.dados === null).length}`);

  // Per-offering check: sum of investments = closing total = amount to the
  // issuer + fee. In BigInt, with the offering currency's decimals.
  console.log("\nper-offering check:");
  const byOffering = new Map<string, typeof entries>();
  for (const r of entries) {
    const d = r.dados;
    if (!d || d.evento === "offering_created") continue;
    byOffering.set(d.ofertaEndereco, [...(byOffering.get(d.ofertaEndereco) ?? []), r]);
  }
  for (const [address, rows] of byOffering) {
    const decimals = await tokens.currencyDecimals(address);
    const u = (v: string) => ethers.parseUnits(v, decimals);
    const f = (v: bigint) => ethers.formatUnits(v, decimals);
    let investments = BigInt(0);
    let closed: bigint | null = null;
    let released: { issuer: bigint; fee: bigint } | null = null;
    for (const { dados: d } of rows) {
      if (d?.evento === "investment") investments += u(d.valor);
      if (d?.evento === "offering_closed") closed = u(d.totalArrecadado);
      if (d?.evento === "funds_released") released = { issuer: u(d.valorEmissor), fee: u(d.taxa) };
    }
    const offering = indexer.offerings.get(address);
    console.log(`  ${offering?.label ?? address}: investments ${f(investments)}`);
    if (closed !== null) {
      console.log(`    closed with ${f(closed)} — ${closed === investments ? "matches the investments" : "DOES NOT MATCH the investments"}`);
    }
    if (released) {
      const sum = released.issuer + released.fee;
      console.log(
        `    released ${f(released.issuer)} + fee ${f(released.fee)} = ${f(sum)} — ${sum === closed ? "matches the closing total" : "DOES NOT MATCH the closing total"}`,
      );
    }
  }
}

process.on("SIGINT", () => {
  console.log("\n[indexer] shutting down (SIGINT)...");
  process.exit(0);
});
process.on("SIGTERM", () => {
  console.log("[indexer] shutting down (SIGTERM)...");
  process.exit(0);
});

loop();
