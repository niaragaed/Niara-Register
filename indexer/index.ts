import "./log-seguro";
import { ethers } from "ethers";
import { config } from "./config";
import * as db from "./db";
import { simulado } from "./db";
import { criarIndexador } from "./indexador";
import { criarIndexadorSolana, FONTE_SOLANA } from "./solana";
import { criarIndexadorAssinaturasEvm } from "./evm-assinaturas";
import { Tokens } from "./tokens";
import { Connection } from "@solana/web3.js";

// Ponto de entrada: liga o núcleo (indexador.ts) às dependências reais — RPC da
// Alchemy, Supabase, relógio de verdade — e roda o laço.

// O ethers repete HTTP 429 sozinho, em silêncio, até 12 vezes. Desligado aqui:
// o limite de taxa é tratado em limite.ts, com backoff de teto conhecido e log.
const requisicao = new ethers.FetchRequest(config.rpcUrl);
requisicao.retryFunc = async () => false;
const provider = new ethers.JsonRpcProvider(requisicao, 11155111, { staticNetwork: true });

const tokens = new Tokens(provider);
const dormir = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const indexador = criarIndexador({
  rpc: provider,
  tokens,
  banco: db,
  cfg: config,
  dormir,
});

// Solana: laço próprio, com o retry interno do web3.js desligado — o 429 passa
// pelo mesmo comBackoff da EVM (limite.ts).
const indexadorSolana = config.solana.ativo
  ? criarIndexadorSolana({
      rpc: new Connection(config.solana.rpcUrl, {
        commitment: "finalized",
        disableRetryOnRateLimit: true,
      }) as unknown as Parameters<typeof criarIndexadorSolana>[0]["rpc"],
      banco: db,
      programId: config.solana.programId,
      slotInicial: config.solana.slotInicial,
      backoff: config.backoff,
      dormir,
    })
  : null;

// Base Sepolia: provider próprio, também sem o retry silencioso do ethers.
const FONTE_BASE = "base-sepolia-assinaturas";
const indexadorBase = config.base.ativo
  ? (() => {
      const req = new ethers.FetchRequest(config.base.rpcUrl);
      req.retryFunc = async () => false;
      const providerBase = new ethers.JsonRpcProvider(req, 84532, { staticNetwork: true });
      return criarIndexadorAssinaturasEvm({
        rede: "base-sepolia",
        fonte: FONTE_BASE,
        rpc: providerBase,
        banco: db,
        endereco: config.base.endereco,
        blocoDeploy: config.base.blocoDeploy,
        chunk: config.base.chunk,
        maxPedacosPorCiclo: config.base.maxPedacosPorCiclo,
        confirmacoes: config.base.confirmacoes,
        backoff: config.backoff,
        dormir,
      });
    })()
  : null;

/** Mesmo contrato do loopSolana: nunca derruba o processo nem bloqueia a EVM. */
async function loopBase(): Promise<void> {
  if (!indexadorBase) return;
  for (;;) {
    let emDia = true;
    try {
      const r = await indexadorBase.ciclo();
      emDia = r.emDia;
      if (r.gravados > 0) {
        console.log(`[indexer] base-sepolia: ${r.gravados} documento(s) gravado(s) — checkpoint bloco ${indexadorBase.checkpoint}`);
      }
    } catch (erro) {
      console.error("[indexer] base-sepolia: erro no ciclo, tentando de novo no próximo:", erro);
    }
    // Atrasado (ex.: primeira varredura desde o deploy): segue sem esperar.
    if (emDia) await dormir(config.base.pollIntervalMs);
  }
}

/**
 * Nunca derruba o processo: erro na Solana é registrado e o ciclo seguinte
 * retoma do checkpoint. Também não bloqueia o laço EVM — roda em paralelo.
 */
async function loopSolana(): Promise<void> {
  if (!indexadorSolana) return;
  for (;;) {
    try {
      const { transacoes, gravados } = await indexadorSolana.ciclo();
      if (transacoes > 0) {
        console.log(
          `[indexer] solana: ${transacoes} transação(ões) nova(s), ${gravados} documento(s) gravado(s) — checkpoint slot ${indexadorSolana.checkpoint}`,
        );
      }
    } catch (erro) {
      console.error("[indexer] solana: erro no ciclo, tentando de novo no próximo:", erro);
    }
    await dormir(config.solana.pollIntervalMs);
  }
}

async function loop(): Promise<void> {
  await indexador.iniciar();
  if (indexadorSolana) {
    await indexadorSolana.iniciar();
    console.log(
      `[indexer] Solana: programa ${config.solana.programId} em ${config.solana.rpcUrl} — checkpoint (${FONTE_SOLANA}) slot ${indexadorSolana.checkpoint}`,
    );
  } else {
    console.log("[indexer] Solana: desativada (SOLANA_DESATIVADO=1)");
  }

  if (indexadorBase) {
    await indexadorBase.iniciar();
    console.log(
      `[indexer] Base Sepolia: RegistroAssinaturas em ${config.base.endereco} via ${config.base.rpcUrl} — checkpoint (${FONTE_BASE}) bloco ${indexadorBase.checkpoint}`,
    );
  } else {
    console.log("[indexer] Base Sepolia: desativada (BASE_DESATIVADO=1)");
  }
  if (config.dryRun && indexadorBase) {
    const r = await indexadorBase.ciclo();
    console.log(`[dry-run] base-sepolia: ${r.gravados} documento(s) seriam gravados (em dia: ${r.emDia})`);
  } else {
    void loopBase();
  }

  // Em dry-run, a Solana roda um ciclo só, antes, e imprime o que gravaria.
  if (config.dryRun && indexadorSolana) {
    const r = await indexadorSolana.ciclo();
    console.log(`[dry-run] solana: ${r.transacoes} transação(ões), ${r.gravados} documento(s) seriam gravados`);
  } else {
    void loopSolana();
  }

  if (config.dryRun) console.log("[indexer] DRY-RUN — nada será gravado no banco");
  console.log(`[indexer] Niara-Register — checkpoints: ${JSON.stringify(indexador.checkpoints)}`);
  console.log(
    `[indexer] monitorando ${indexador.ofertas.size} oferta(s) de registro_ofertas:`,
    [...indexador.ofertas.values()].map((o) => `${o.numero}:${o.endereco}`),
  );
  console.log(`[indexer] OfertaOrquestrador em ${config.orquestradorEndereco}`);
  console.log(`[indexer] RegistroAssinaturas em ${config.registroAssinaturasEndereco}`);
  console.log(
    `[indexer] pedaço de ${config.blockRangeChunk} blocos; atraso: até ${config.chunksAtrasoPorCiclo} chamadas por ciclo, a cada ${config.atrasoIntervaloMs} ms; polling a cada ${config.pollIntervalMs / 1000}s`,
  );

  while (true) {
    const { emDia, falhou } = await indexador.ciclo();

    if (config.dryRun && emDia) {
      await relatorioDryRun();
      process.exit(0);
    }

    // Em dia (ou com erro): espera o intervalo normal. Recuperando atraso: segue
    // direto para o próximo ciclo — as chamadas de atraso já são espaçadas por
    // ATRASO_INTERVALO_MS, e o lote normal roda no início de cada ciclo.
    if (emDia || falhou) await dormir(config.pollIntervalMs);
  }
}

// ── relatório do dry-run ─────────────────────────────────────────────────────────

async function relatorioDryRun(): Promise<void> {
  console.log("\n════════ DRY-RUN — o que seria gravado ════════\n");

  console.log(`registro_ofertas — ${simulado.ofertas.length} oferta(s) nova(s):`);
  for (const o of simulado.ofertas) {
    console.log(
      `  nº ${o.numero}  ${o.endereco}  ${o.simbolo ?? "?"} / ${o.empresa ?? "?"}  emissor ${o.emissor}  moeda ${o.moeda}  bloco ${o.bloco_criacao}  tx ${o.tx_criacao}`,
    );
  }

  const registros = [...simulado.registros].sort((a, b) => a.bloco - b.bloco || a.log_index - b.log_index);
  console.log(`\nregistro_transacoes — ${registros.length} linha(s) nova(s):`);
  for (const r of registros) {
    console.log(`  bloco ${r.bloco} #${r.log_index}  ${r.tipo_evento}`);
    console.log(`    descricao: ${r.descricao}`);
    console.log(`    dados:     ${JSON.stringify(r.dados)}`);
  }
  console.log(`\nlinhas com dados nulo: ${registros.filter((r) => r.dados === null).length}`);

  // Conferência por oferta: soma dos aportes = total do encerramento =
  // valor ao emissor + taxa. Em BigInt, com as casas da moeda da oferta.
  console.log("\nconferência por oferta:");
  const porOferta = new Map<string, typeof registros>();
  for (const r of registros) {
    const d = r.dados;
    if (!d || d.evento === "offering_created") continue;
    porOferta.set(d.ofertaEndereco, [...(porOferta.get(d.ofertaEndereco) ?? []), r]);
  }
  for (const [endereco, linhas] of porOferta) {
    const casas = await tokens.daMoeda(endereco);
    const u = (v: string) => ethers.parseUnits(v, casas);
    const f = (v: bigint) => ethers.formatUnits(v, casas);
    let aportes = BigInt(0);
    let encerrado: bigint | null = null;
    let liberado: { emissor: bigint; taxa: bigint } | null = null;
    for (const { dados: d } of linhas) {
      if (d?.evento === "investment") aportes += u(d.valor);
      if (d?.evento === "offering_closed") encerrado = u(d.totalArrecadado);
      if (d?.evento === "funds_released") liberado = { emissor: u(d.valorEmissor), taxa: u(d.taxa) };
    }
    const oferta = indexador.ofertas.get(endereco);
    console.log(`  ${oferta?.apelido ?? endereco}: aportes ${f(aportes)}`);
    if (encerrado !== null) {
      console.log(`    encerrada com ${f(encerrado)} — ${encerrado === aportes ? "bate com os aportes" : "NÃO BATE com os aportes"}`);
    }
    if (liberado) {
      const soma = liberado.emissor + liberado.taxa;
      console.log(
        `    liberado ${f(liberado.emissor)} + taxa ${f(liberado.taxa)} = ${f(soma)} — ${soma === encerrado ? "bate com o total encerrado" : "NÃO BATE com o total encerrado"}`,
      );
    }
  }
}

process.on("SIGINT", () => {
  console.log("\n[indexer] encerrando (SIGINT)...");
  process.exit(0);
});
process.on("SIGTERM", () => {
  console.log("[indexer] encerrando (SIGTERM)...");
  process.exit(0);
});

loop();
