import { ethers } from "ethers";
import {
  OFERTA_CAPTACAO_ABI,
  OFERTA_ORQUESTRADOR_ABI,
  REGISTRO_ASSINATURAS_ABI,
  STATE_LABELS,
} from "./abi";
import type { NewSignature, NewOffering, NewLedgerEntry } from "./db";
import { buildEventData, buildCreationData } from "./events";
import { withBackoff, type BackoffOptions } from "./rate-limit";
import { toTracked, type TrackedOffering } from "./offerings";
import type { TokenReader } from "./tokens";

/**
 * The indexer core, with its dependencies injected (RPC, tokens, database,
 * clock): index.ts wires the real ones; test/backlog.test.ts wires fakes.
 *
 * Three sources, each with its own checkpoint in registro_checkpoints:
 *
 * - pmes: events from the OfertaCaptacao contracts listed in registro_ofertas
 * - assinaturas: DocumentoRegistrado from RegistroAssinaturas
 * - orquestrador: OfertaCompletaCriada from OfertaOrquestrador
 *
 * Each cycle has two independent parts:
 *
 * 1. NORMAL BATCH: always first, every cycle. The sources at the furthest
 *    block (in steady state, all three) move together to the chain tip with
 *    ONE eth_getLogs call per chunk, with every address; events are split by
 *    address and the checkpoints saved together.
 *
 * 2. BACKLOG: a source behind the others (the orchestrator scan since its
 *    deploy) and the backfill of new offerings. Its own per-cycle budget
 *    (CHUNKS_ATRASO_POR_CICLO), calls spaced by ATRASO_INTERVALO_MS. The
 *    backfill only starts once the scan catches up with the pmes source, so
 *    every offering discovered in it moves together (one call with several
 *    addresses per chunk). An error here does not affect the normal batch: it
 *    is logged and recovery resumes from the saved point in the next cycle.
 *
 * Every RPC call goes through withBackoff: a rate limit (429) becomes a capped
 * exponential wait with a log line, not an immediate error.
 */

// Stored values (registro_checkpoints.fonte): they stay as they are.
export const SOURCE_PMES = "pmes";
export const SOURCE_SIGNATURES = "assinaturas";
export const SOURCE_ORCHESTRATOR = "orquestrador";
export type Source = typeof SOURCE_PMES | typeof SOURCE_SIGNATURES | typeof SOURCE_ORCHESTRATOR;
const SOURCES: Source[] = [SOURCE_PMES, SOURCE_SIGNATURES, SOURCE_ORCHESTRATOR];

export type Rpc = {
  getBlockNumber(): Promise<number>;
  getLogs(filter: { address: string[]; fromBlock: number; toBlock: number }): Promise<ethers.Log[]>;
  getBlock(number: number): Promise<{ timestamp: number } | null>;
};

export type Db = {
  loadOfferings(): Promise<TrackedOffering[]>;
  saveLedgerEntry(entry: NewLedgerEntry): Promise<void>;
  saveSignature(signature: NewSignature): Promise<void>;
  saveOffering(offering: NewOffering): Promise<void>;
  saveBackfill(address: string, until: number): Promise<void>;
  readCheckpoint(source: string, fallback: number): Promise<number>;
  saveCheckpoints(sources: string[], block: number): Promise<void>;
};

export type IndexerConfig = {
  blockRangeChunk: number;
  backlogChunksPerCycle: number;
  backlogIntervalMs: number;
  backoff: Omit<BackoffOptions, "sleep">;
  startBlock: number;
  startBlockSignatures: number;
  startBlockOrchestrator: number;
  orchestratorAddress: string;
  signatureRegistryAddress: string;
};

export type CycleResult = {
  /** No source behind and no pending backfill. */
  upToDate: boolean;
  /** One of the parts of the cycle ended in error. */
  failed: boolean;
  /** The normal batch specifically ended in error (only after exhausting the backoff). */
  normalBatchFailed: boolean;
};

const offeringInterface = new ethers.Interface(OFERTA_CAPTACAO_ABI);
const signaturesInterface = new ethers.Interface(REGISTRO_ASSINATURAS_ABI);
const orchestratorInterface = new ethers.Interface(OFERTA_ORQUESTRADOR_ABI);

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function createIndexer(deps: {
  rpc: Rpc;
  tokens: TokenReader;
  db: Db;
  cfg: IndexerConfig;
  sleep: (ms: number) => Promise<void>;
}) {
  const { rpc, db, cfg, sleep } = deps;
  const orchestrator = cfg.orchestratorAddress.toLowerCase();
  const signaturesAddress = cfg.signatureRegistryAddress.toLowerCase();
  const backoffOptions: BackoffOptions = { ...cfg.backoff, sleep };
  const net = <T,>(fn: () => Promise<T>, context: string) => withBackoff(fn, context, backoffOptions);

  // Token reads (decimals, symbol, moeda(), token(), name/empresa) are
  // eth_calls on the same RPC: they go through the same backoff as getLogs and
  // blockNumber. The Tokens cache drops the read that failed, so the retry
  // asks the chain again.
  const tokens: TokenReader = {
    currencyDecimals: (o) => net(() => deps.tokens.currencyDecimals(o), `currency decimals of ${o}`),
    currencySymbol: (o) => net(() => deps.tokens.currencySymbol(o), `currency symbol of ${o}`),
    offeringCurrency: (o) => net(() => deps.tokens.offeringCurrency(o), `moeda() of ${o}`),
    shareTokenDecimals: (o, t) => net(() => deps.tokens.shareTokenDecimals(o, t), `share token decimals of ${o}`),
    metadata: (t) => net(() => deps.tokens.metadata(t), `metadata of token ${t}`),
  };

  // List of tracked offerings: loaded from registro_ofertas at startup and
  // extended when the orchestrator creates a new offering.
  const offerings = new Map<string, TrackedOffering>();
  const checkpoints: Record<Source, number> = { pmes: 0, assinaturas: 0, orquestrador: 0 };

  const leader = () => Math.max(...SOURCES.map((s) => checkpoints[s]));

  function sourceAddresses(source: Source): string[] {
    switch (source) {
      case SOURCE_PMES:
        return [...offerings.keys()];
      case SOURCE_SIGNATURES:
        return [signaturesAddress];
      case SOURCE_ORCHESTRATOR:
        return [orchestrator];
    }
  }

  // Cache local to the block chunk being processed: a mined block's timestamp
  // never changes; the local scope keeps memory bounded.
  async function blockTimestamp(blockNumber: number, cache: Map<number, number>): Promise<string> {
    let timestamp = cache.get(blockNumber);
    if (timestamp === undefined) {
      const block = await net(() => rpc.getBlock(blockNumber), `getBlock ${blockNumber}`);
      timestamp = block?.timestamp ?? 0;
      cache.set(blockNumber, timestamp);
    }
    return new Date(timestamp * 1000).toISOString();
  }

  // ── pmes ─────────────────────────────────────────────────────────────────────────

  // `tipo_evento` and `descricao` are stored in Portuguese (data already in the
  // ledger; the site translates by tipo_evento). The amount uses the decimals
  // and symbol() of the offering's own moeda().
  async function describePmesEvent(
    parsed: ethers.LogDescription,
    offering: TrackedOffering,
  ): Promise<{ eventType: string; description: string }> {
    const inCurrency = async (v: unknown) =>
      `${ethers.formatUnits(v as bigint, await tokens.currencyDecimals(offering.address))} ${await tokens.currencySymbol(offering.address)}`;

    switch (parsed.name) {
      case "Aporte":
        return {
          eventType: "Aporte",
          description: `${offering.label} — investidor ${shortAddress(parsed.args.investidor as string)} aportou ${await inCurrency(parsed.args.valor)}`,
        };
      case "OfertaEncerrada": {
        const result = STATE_LABELS[Number(parsed.args.resultado)] ?? "Desconhecido";
        return {
          eventType: "Oferta encerrada",
          description: `${offering.label} — encerrada (${result}), total arrecadado ${await inCurrency(parsed.args.totalArrecadado)}`,
        };
      }
      case "OfertaCancelada":
        return { eventType: "Oferta cancelada", description: `${offering.label} — oferta cancelada` };
      case "CotasResgatadas": {
        const decimals = await tokens.shareTokenDecimals(offering.address, offering.token);
        const shares = ethers.formatUnits(parsed.args.cotas as bigint, decimals);
        return {
          eventType: "Resgate de cotas",
          description: `${offering.label} — investidor ${shortAddress(parsed.args.investidor as string)} resgatou ${shares} cotas`,
        };
      }
      case "RecursosLiberados":
        return {
          eventType: "Recursos liberados",
          description: `${offering.label} — ${await inCurrency(parsed.args.valorEmissor)} liberados ao emissor`,
        };
      case "Reembolso":
        return {
          eventType: "Reembolso",
          description: `${offering.label} — investidor ${shortAddress(parsed.args.investidor as string)} reembolsado em ${await inCurrency(parsed.args.valor)}`,
        };
      default:
        return { eventType: parsed.name, description: `${offering.label} — ${parsed.name}` };
    }
  }

  async function processPmesLog(
    log: ethers.Log,
    offering: TrackedOffering,
    cache: Map<number, number>,
  ): Promise<void> {
    let parsed: ethers.LogDescription | null;
    try {
      parsed = offeringInterface.parseLog(log);
    } catch {
      return; // log of an event outside our minimal ABI: ignore it
    }
    if (!parsed) return;

    const { eventType, description } = await describePmesEvent(parsed, offering);
    const data = await buildEventData(parsed, offering, tokens);

    await db.saveLedgerEntry({
      fonte: SOURCE_PMES,
      tipo_evento: eventType,
      descricao: description,
      tx_hash: log.transactionHash,
      log_index: log.index,
      endereco_contrato: offering.address,
      bloco: log.blockNumber,
      ocorrido_em: await blockTimestamp(log.blockNumber, cache),
      confirmado: true, // we only get here with the log already mined (getLogs, not pending)
      dados: data,
    });

    console.log(`[indexer] ${eventType} — ${offering.label} — block ${log.blockNumber} — ${log.transactionHash}`);
  }

  // ── signatures ───────────────────────────────────────────────────────────────────

  async function processSignatureLog(log: ethers.Log, cache: Map<number, number>): Promise<void> {
    let parsed: ethers.LogDescription | null;
    try {
      parsed = signaturesInterface.parseLog(log);
    } catch {
      return;
    }
    if (!parsed || parsed.name !== "DocumentoRegistrado") return;

    await db.saveSignature({
      rede: "sepolia",
      documento_nome: parsed.args.nomeDocumento as string,
      tipo_documento: parsed.args.tipoDocumento as string,
      hash_sha256: parsed.args.hashDocumento as string,
      assinante_endereco: parsed.args.assinante as string,
      tx_hash: log.transactionHash,
      log_index: log.index,
      endereco_contrato: cfg.signatureRegistryAddress,
      bloco: log.blockNumber,
      assinado_em: await blockTimestamp(log.blockNumber, cache),
      status: "assinado_onchain",
    });

    console.log(
      `[indexer] Document recorded — "${parsed.args.nomeDocumento}" (${parsed.args.tipoDocumento}) — signer ${shortAddress(parsed.args.assinante as string)} — block ${log.blockNumber} — ${log.transactionHash}`,
    );
  }

  // ── orchestrator ─────────────────────────────────────────────────────────────────

  /**
   * OfertaCompletaCriada: registers the offering (number = highest + 1, in
   * event order), writes the `offering_created` row and adds the offering to
   * the pmes source batch. Its events from before it joined the batch are left
   * to the backfill, from bloco_criacao up to `backfillTarget`.
   *
   * Order designed for a crash in the middle: the offering is saved before the
   * ledger row and both before the orchestrator checkpoint. If the process
   * crashes, the event is reprocessed; the offering already exists (loaded
   * from the database), so it keeps its number and backfill state, and the
   * ledger row is idempotent.
   */
  async function processOrchestratorLog(
    log: ethers.Log,
    backfillTarget: number,
    cache: Map<number, number>,
  ): Promise<void> {
    let parsed: ethers.LogDescription | null;
    try {
      parsed = orchestratorInterface.parseLog(log);
    } catch {
      return; // EmissorAutorizado, timelock etc.: they do not become ledger rows
    }
    if (!parsed || parsed.name !== "OfertaCompletaCriada") return;

    const occurredAt = await blockTimestamp(log.blockNumber, cache);
    const address = (parsed.args.oferta as string).toLowerCase();
    let offering = offerings.get(address);

    if (!offering) {
      const token = (parsed.args.token as string).toLowerCase();
      const number = Math.max(0, ...[...offerings.values()].map((o) => o.number)) + 1;
      const meta = await tokens.metadata(token);
      const created: NewOffering = {
        endereco: address,
        token,
        emissor: (parsed.args.emissor as string).toLowerCase(),
        moeda: (await tokens.offeringCurrency(address)).toLowerCase(),
        origem: "orquestrador",
        numero: number,
        nome: meta.name,
        simbolo: meta.symbol,
        empresa: meta.company,
        bloco_criacao: log.blockNumber,
        criada_em: occurredAt,
        tx_criacao: log.transactionHash,
        backfill_alvo: Math.max(backfillTarget, log.blockNumber - 1),
        backfill_ate: log.blockNumber - 1,
      };
      await db.saveOffering(created);
      offering = toTracked(created);
      offerings.set(address, offering);
      console.log(
        `[indexer] new offering — ${offering.label} — ${meta.company ?? "(no company)"} — created at block ${log.blockNumber}; backfill up to ${created.backfill_alvo}`,
      );
    }

    const data = await buildCreationData(parsed, offering, tokens);
    await db.saveLedgerEntry({
      fonte: SOURCE_PMES,
      tipo_evento: "Oferta criada",
      descricao: `${offering.label} — criada pelo emissor ${shortAddress(data.emissor)}${offering.company ? ` (${offering.company})` : ""}, meta ${data.metaMinima}–${data.metaMaxima} ${data.moeda}, ${data.precoPorCota} ${data.moeda} por cota`,
      tx_hash: log.transactionHash,
      log_index: log.index,
      endereco_contrato: orchestrator,
      bloco: log.blockNumber,
      ocorrido_em: occurredAt,
      confirmado: true,
      dados: data,
    });

    console.log(`[indexer] Offering created — ${offering.label} — block ${log.blockNumber} — ${log.transactionHash}`);
  }

  // ── dispatch ─────────────────────────────────────────────────────────────────────

  /**
   * Fetches the logs of a chunk for the given sources (a single call, with the
   * addresses of all of them) and hands each log to its source's processor.
   */
  async function processChunk(sources: Source[], from: number, to: number, origin: string): Promise<void> {
    const addresses = [...new Set(sources.flatMap(sourceAddresses))];
    if (addresses.length === 0) return;

    // Snapshot of the list before the call: an offering registered in the
    // middle of this chunk was not in the filter, so its events here are left
    // to the backfill.
    const callOfferings = sources.includes(SOURCE_PMES) ? new Map(offerings) : new Map();
    const cache = new Map<number, number>();
    const logs = await net(
      () => rpc.getLogs({ address: addresses, fromBlock: from, toBlock: to }),
      `getLogs ${from}–${to} (${origin})`,
    );

    for (const log of logs) {
      const address = log.address.toLowerCase();
      if (address === orchestrator && sources.includes(SOURCE_ORCHESTRATOR)) {
        await processOrchestratorLog(log, Math.max(checkpoints.pmes, to), cache);
      } else if (address === signaturesAddress && sources.includes(SOURCE_SIGNATURES)) {
        await processSignatureLog(log, cache);
      } else {
        const offering = callOfferings.get(address);
        if (offering) await processPmesLog(log, offering, cache);
        // otherwise: should not happen, but do not blindly trust what the RPC returns
      }
    }
  }

  // ── normal batch ─────────────────────────────────────────────────────────────────

  /** Brings the sources that are ahead up to the chain tip, together. */
  async function normalBatch(currentBlock: number): Promise<void> {
    const front = leader();
    const upToDate = SOURCES.filter((s) => checkpoints[s] === front);
    let from = front + 1;
    while (from <= currentBlock) {
      const to = Math.min(from + cfg.blockRangeChunk - 1, currentBlock);
      await processChunk(upToDate, from, to, "normal batch");
      await db.saveCheckpoints(upToDate, to);
      for (const s of upToDate) checkpoints[s] = to;
      from = to + 1;
    }
  }

  // ── backlog and backfill ─────────────────────────────────────────────────────────

  /**
   * Brings a lagging source up to `target`, spending at most `budget` calls,
   * spaced by ATRASO_INTERVALO_MS. The checkpoint is saved at the end of the
   * batch (not on every chunk) so as not to multiply database writes; if
   * something fails in the middle, progress up to the last complete chunk is
   * saved and reprocessing is idempotent.
   */
  async function catchUp(source: Source, target: number, budget: { remaining: number }): Promise<void> {
    let done = checkpoints[source];
    try {
      while (done < target && budget.remaining > 0) {
        const from = done + 1;
        const to = Math.min(from + cfg.blockRangeChunk - 1, target);
        await processChunk([source], from, to, `backlog ${source}`);
        done = to;
        budget.remaining--;
        await sleep(cfg.backlogIntervalMs);
      }
    } finally {
      if (done > checkpoints[source]) {
        await db.saveCheckpoints([source], done);
        checkpoints[source] = done;
        console.log(`[indexer] source "${source}" catching up — block ${done} of ${target}`);
      }
    }
  }

  function pendingBackfills(): TrackedOffering[] {
    return [...offerings.values()].filter(
      (o) => o.backfillTarget !== null && (o.backfillUntil ?? o.creationBlock - 1) < o.backfillTarget,
    );
  }

  /**
   * Scans the events of new offerings from before they joined the batch. All
   * pending ones move together: each chunk is a call with the addresses of the
   * offerings whose range covers that chunk.
   */
  async function advanceBackfill(budget: { remaining: number }): Promise<void> {
    const start = (o: TrackedOffering) => (o.backfillUntil ?? o.creationBlock - 1) + 1;
    const touched = new Set<TrackedOffering>();

    try {
      while (budget.remaining > 0) {
        const active = pendingBackfills();
        if (active.length === 0) break;

        const from = Math.min(...active.map(start));
        const to = Math.min(from + cfg.blockRangeChunk - 1, Math.max(...active.map((o) => o.backfillTarget!)));
        const inChunk = active.filter((o) => start(o) <= to);

        const cache = new Map<number, number>();
        const logs = await net(
          () => rpc.getLogs({ address: inChunk.map((o) => o.address), fromBlock: from, toBlock: to }),
          `getLogs ${from}–${to} (backfill)`,
        );
        for (const log of logs) {
          const offering = inChunk.find((o) => o.address === log.address.toLowerCase());
          if (!offering || log.blockNumber < start(offering) || log.blockNumber > offering.backfillTarget!) continue;
          await processPmesLog(log, offering, cache);
        }

        for (const o of inChunk) {
          o.backfillUntil = Math.min(to, o.backfillTarget!);
          touched.add(o);
        }
        budget.remaining--;
        await sleep(cfg.backlogIntervalMs);
      }
    } finally {
      for (const o of touched) {
        await db.saveBackfill(o.address, o.backfillUntil!);
        const finished = o.backfillUntil! >= o.backfillTarget!;
        console.log(
          `[indexer] backfill ${o.label} — block ${o.backfillUntil} of ${o.backfillTarget}${finished ? " (done)" : ""}`,
        );
      }
    }
  }

  /** Lagging sources first; the backfill only after the orchestrator has caught up with pmes. */
  async function backlogWork(): Promise<void> {
    const budget = { remaining: cfg.backlogChunksPerCycle };
    const target = leader();
    for (const source of SOURCES) {
      if (checkpoints[source] < target && budget.remaining > 0) {
        await catchUp(source, target, budget);
      }
    }
    if (checkpoints.orquestrador >= checkpoints.pmes && budget.remaining > 0) {
      await advanceBackfill(budget);
    }
  }

  // ── cycle ────────────────────────────────────────────────────────────────────────

  function upToDate(): boolean {
    const front = leader();
    return SOURCES.every((s) => checkpoints[s] === front) && pendingBackfills().length === 0;
  }

  async function cycle(): Promise<CycleResult> {
    let failed = false;
    let normalBatchFailed = false;

    // 1. Normal batch: new events from every up-to-date source, every cycle.
    try {
      const currentBlock = await net(() => rpc.getBlockNumber(), "getBlockNumber");
      await normalBatch(currentBlock);
    } catch (error) {
      failed = true;
      normalBatchFailed = true;
      console.error("[indexer] error in the normal batch, retrying in the next cycle:", error);
    }

    // 2. Backlog and backfill, with their own budget. A failure here neither
    //    undoes nor delays the normal batch; saved progress resumes next cycle.
    if (!upToDate()) {
      try {
        await backlogWork();
      } catch (error) {
        failed = true;
        console.error("[indexer] error while catching up, resuming in the next cycle:", error);
      }
    }

    return { upToDate: upToDate(), failed, normalBatchFailed };
  }

  async function start(): Promise<void> {
    for (const o of await db.loadOfferings()) offerings.set(o.address, o);
    checkpoints.pmes = await db.readCheckpoint(SOURCE_PMES, cfg.startBlock);
    checkpoints.assinaturas = await db.readCheckpoint(SOURCE_SIGNATURES, cfg.startBlockSignatures);
    checkpoints.orquestrador = await db.readCheckpoint(SOURCE_ORCHESTRATOR, cfg.startBlockOrchestrator - 1);
  }

  return { start, cycle, offerings, checkpoints };
}
