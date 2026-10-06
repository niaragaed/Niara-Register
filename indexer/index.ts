import "./log-seguro";
import { ethers } from "ethers";
import { config, type OfertaMonitorada } from "./config";
import {
  OFERTA_CAPTACAO_ABI,
  OFERTA_ORQUESTRADOR_ABI,
  REGISTRO_ASSINATURAS_ABI,
  ESTADO_LABELS,
} from "./abi";
import {
  carregarOfertas,
  gravarAssinatura,
  gravarOferta,
  gravarRegistro,
  lerCheckpoint,
  novaOfertaParaMonitorada,
  salvarBackfill,
  salvarCheckpoints,
  simulado,
  type NovaOferta,
} from "./db";
import { Tokens } from "./tokens";
import { montarDados, montarDadosCriacao } from "./eventos";

/**
 * Três fontes, cada uma com seu checkpoint em registro_checkpoints:
 *
 * - pmes: eventos das OfertaCaptacao listadas em registro_ofertas
 * - assinaturas: DocumentoRegistrado do RegistroAssinaturas
 * - orquestrador: OfertaCompletaCriada do OfertaOrquestrador
 *
 * Regime normal: as três estão no mesmo bloco e cada ciclo faz UMA chamada
 * eth_getLogs com todos os endereços (ofertas + orquestrador + assinaturas),
 * separa os eventos pelo endereço e salva os três checkpoints juntos. É o que
 * mantém o consumo da Alchemy igual ao de uma fonte só.
 *
 * Atraso: uma fonte atrás das outras (a varredura inicial do orquestrador,
 * desde o deploy) é recuperada em chamadas próprias, no máximo
 * CHUNKS_ATRASO_POR_CICLO por ciclo, para o lote normal não ficar parado. O
 * mesmo teto vale para o backfill de ofertas novas, que só roda quando a
 * varredura do orquestrador já alcançou a fonte pmes — assim todas as ofertas
 * descobertas na varredura entram no mesmo backfill (uma chamada com vários
 * endereços por pedaço), em vez de um backfill inteiro para cada uma.
 */

const FONTE_PMES = "pmes";
const FONTE_ASSINATURAS = "assinaturas";
const FONTE_ORQUESTRADOR = "orquestrador";
type Fonte = typeof FONTE_PMES | typeof FONTE_ASSINATURAS | typeof FONTE_ORQUESTRADOR;
const FONTES: Fonte[] = [FONTE_PMES, FONTE_ASSINATURAS, FONTE_ORQUESTRADOR];

const provider = new ethers.JsonRpcProvider(config.rpcUrl);
const interfaceOferta = new ethers.Interface(OFERTA_CAPTACAO_ABI);
const interfaceAssinaturas = new ethers.Interface(REGISTRO_ASSINATURAS_ABI);
const interfaceOrquestrador = new ethers.Interface(OFERTA_ORQUESTRADOR_ABI);

// Vive pelo processo inteiro: cada leitura de token é feita uma vez só.
const tokens = new Tokens(provider);

// Lista de ofertas monitoradas — carregada de registro_ofertas ao iniciar e
// acrescida quando o orquestrador cria uma oferta nova.
const ofertas = new Map<string, OfertaMonitorada>();
const checkpoints: Record<Fonte, number> = { pmes: 0, assinaturas: 0, orquestrador: 0 };

const enderecoAssinaturas = config.registroAssinaturasEndereco.toLowerCase();

function enderecoCurto(endereco: string): string {
  return `${endereco.slice(0, 6)}...${endereco.slice(-4)}`;
}

function enderecosDaFonte(fonte: Fonte): string[] {
  switch (fonte) {
    case FONTE_PMES:
      return [...ofertas.keys()];
    case FONTE_ASSINATURAS:
      return [enderecoAssinaturas];
    case FONTE_ORQUESTRADOR:
      return [config.orquestradorEndereco];
  }
}

// Cache local ao pedaço de blocos sendo processado — timestamp de bloco
// minerado nunca muda, então evita reconsultar o RPC pra cada log do mesmo
// bloco. Escopo local (não global ao processo) mantém a memória limitada.
async function timestampDoBloco(numeroBloco: number, cache: Map<number, number>): Promise<string> {
  let timestamp = cache.get(numeroBloco);
  if (timestamp === undefined) {
    const bloco = await provider.getBlock(numeroBloco);
    timestamp = bloco?.timestamp ?? 0;
    cache.set(numeroBloco, timestamp);
  }
  return new Date(timestamp * 1000).toISOString();
}

// ── pmes ─────────────────────────────────────────────────────────────────────────

// A `descricao` segue em português, como antes. O valor usa as casas decimais e o
// symbol() da moeda() da própria oferta.
async function descreverEventoPmes(
  parsed: ethers.LogDescription,
  oferta: OfertaMonitorada,
): Promise<{ tipoEvento: string; descricao: string }> {
  const emMoeda = async (v: unknown) =>
    `${ethers.formatUnits(v as bigint, await tokens.daMoeda(oferta.endereco))} ${await tokens.simboloDaMoeda(oferta.endereco)}`;

  switch (parsed.name) {
    case "Aporte":
      return {
        tipoEvento: "Aporte",
        descricao: `${oferta.apelido} — investidor ${enderecoCurto(parsed.args.investidor as string)} aportou ${await emMoeda(parsed.args.valor)}`,
      };
    case "OfertaEncerrada": {
      const resultado = ESTADO_LABELS[Number(parsed.args.resultado)] ?? "Desconhecido";
      return {
        tipoEvento: "Oferta encerrada",
        descricao: `${oferta.apelido} — encerrada (${resultado}), total arrecadado ${await emMoeda(parsed.args.totalArrecadado)}`,
      };
    }
    case "OfertaCancelada":
      return { tipoEvento: "Oferta cancelada", descricao: `${oferta.apelido} — oferta cancelada` };
    case "CotasResgatadas": {
      const casas = await tokens.doTokenDeCotas(oferta.endereco, oferta.token);
      const cotas = ethers.formatUnits(parsed.args.cotas as bigint, casas);
      return {
        tipoEvento: "Resgate de cotas",
        descricao: `${oferta.apelido} — investidor ${enderecoCurto(parsed.args.investidor as string)} resgatou ${cotas} cotas`,
      };
    }
    case "RecursosLiberados":
      return {
        tipoEvento: "Recursos liberados",
        descricao: `${oferta.apelido} — ${await emMoeda(parsed.args.valorEmissor)} liberados ao emissor`,
      };
    case "Reembolso":
      return {
        tipoEvento: "Reembolso",
        descricao: `${oferta.apelido} — investidor ${enderecoCurto(parsed.args.investidor as string)} reembolsado em ${await emMoeda(parsed.args.valor)}`,
      };
    default:
      return { tipoEvento: parsed.name, descricao: `${oferta.apelido} — ${parsed.name}` };
  }
}

async function processarLogPmes(
  log: ethers.Log,
  oferta: OfertaMonitorada,
  cache: Map<number, number>,
): Promise<void> {
  let parsed: ethers.LogDescription | null;
  try {
    parsed = interfaceOferta.parseLog(log);
  } catch {
    return; // log de um evento fora da nossa ABI mínima — ignora
  }
  if (!parsed) return;

  const { tipoEvento, descricao } = await descreverEventoPmes(parsed, oferta);
  const dados = await montarDados(parsed, oferta, tokens);

  await gravarRegistro({
    fonte: FONTE_PMES,
    tipo_evento: tipoEvento,
    descricao,
    tx_hash: log.transactionHash,
    log_index: log.index,
    endereco_contrato: oferta.endereco,
    bloco: log.blockNumber,
    ocorrido_em: await timestampDoBloco(log.blockNumber, cache),
    confirmado: true, // só chegamos aqui com o log já minerado (getLogs, não pending)
    dados,
  });

  console.log(`[indexer] ${tipoEvento} — ${oferta.apelido} — bloco ${log.blockNumber} — ${log.transactionHash}`);
}

// ── assinaturas ──────────────────────────────────────────────────────────────────

async function processarLogAssinatura(log: ethers.Log, cache: Map<number, number>): Promise<void> {
  let parsed: ethers.LogDescription | null;
  try {
    parsed = interfaceAssinaturas.parseLog(log);
  } catch {
    return;
  }
  if (!parsed || parsed.name !== "DocumentoRegistrado") return;

  await gravarAssinatura({
    documento_nome: parsed.args.nomeDocumento as string,
    tipo_documento: parsed.args.tipoDocumento as string,
    hash_sha256: parsed.args.hashDocumento as string,
    assinante_endereco: parsed.args.assinante as string,
    tx_hash: log.transactionHash,
    log_index: log.index,
    endereco_contrato: config.registroAssinaturasEndereco,
    bloco: log.blockNumber,
    assinado_em: await timestampDoBloco(log.blockNumber, cache),
    status: "assinado_onchain",
  });

  console.log(
    `[indexer] Documento registrado — "${parsed.args.nomeDocumento}" (${parsed.args.tipoDocumento}) — assinante ${enderecoCurto(parsed.args.assinante as string)} — bloco ${log.blockNumber} — ${log.transactionHash}`,
  );
}

// ── orquestrador ─────────────────────────────────────────────────────────────────

/**
 * OfertaCompletaCriada: registra a oferta (número = maior + 1, na ordem dos
 * eventos), grava a linha `offering_created` e põe a oferta no lote da fonte
 * pmes. Os eventos dela anteriores à entrada no lote ficam para o backfill,
 * de bloco_criacao até `alvoBackfill`.
 *
 * Ordem pensada para queda no meio: a oferta é gravada antes da linha do ledger
 * e as duas antes do checkpoint do orquestrador. Se o processo cair, o evento é
 * reprocessado; a oferta já existe (carregada do banco), então mantém número e
 * estado de backfill, e a linha do ledger é idempotente.
 */
async function processarLogOrquestrador(
  log: ethers.Log,
  alvoBackfill: number,
  cache: Map<number, number>,
): Promise<void> {
  let parsed: ethers.LogDescription | null;
  try {
    parsed = interfaceOrquestrador.parseLog(log);
  } catch {
    return; // EmissorAutorizado, timelock etc. — não viram linha no ledger
  }
  if (!parsed || parsed.name !== "OfertaCompletaCriada") return;

  const ocorridoEm = await timestampDoBloco(log.blockNumber, cache);
  const endereco = (parsed.args.oferta as string).toLowerCase();
  let oferta = ofertas.get(endereco);

  if (!oferta) {
    const token = (parsed.args.token as string).toLowerCase();
    const numero = Math.max(0, ...[...ofertas.values()].map((o) => o.numero)) + 1;
    const meta = await tokens.metadados(token);
    const nova: NovaOferta = {
      endereco,
      token,
      emissor: (parsed.args.emissor as string).toLowerCase(),
      moeda: (await tokens.moedaDaOferta(endereco)).toLowerCase(),
      origem: "orquestrador",
      numero,
      nome: meta.nome,
      simbolo: meta.simbolo,
      empresa: meta.empresa,
      bloco_criacao: log.blockNumber,
      criada_em: ocorridoEm,
      tx_criacao: log.transactionHash,
      backfill_alvo: Math.max(alvoBackfill, log.blockNumber - 1),
      backfill_ate: log.blockNumber - 1,
    };
    await gravarOferta(nova);
    oferta = novaOfertaParaMonitorada(nova);
    ofertas.set(endereco, oferta);
    console.log(
      `[indexer] oferta nova — ${oferta.apelido} — ${meta.empresa ?? "(sem empresa)"} — criada no bloco ${log.blockNumber}; backfill até ${nova.backfill_alvo}`,
    );
  }

  const dados = await montarDadosCriacao(parsed, oferta, tokens);
  await gravarRegistro({
    fonte: FONTE_PMES,
    tipo_evento: "Oferta criada",
    descricao: `${oferta.apelido} — criada pelo emissor ${enderecoCurto(dados.emissor)}${oferta.empresa ? ` (${oferta.empresa})` : ""}, meta ${dados.metaMinima}–${dados.metaMaxima} ${dados.moeda}, ${dados.precoPorCota} ${dados.moeda} por cota`,
    tx_hash: log.transactionHash,
    log_index: log.index,
    endereco_contrato: config.orquestradorEndereco,
    bloco: log.blockNumber,
    ocorrido_em: ocorridoEm,
    confirmado: true,
    dados,
  });

  console.log(`[indexer] Oferta criada — ${oferta.apelido} — bloco ${log.blockNumber} — ${log.transactionHash}`);
}

// ── despacho ─────────────────────────────────────────────────────────────────────

/**
 * Busca os logs de um pedaço para as fontes indicadas — uma chamada só, com os
 * endereços de todas elas — e entrega cada log ao processador da sua fonte.
 */
async function processarPedaco(fontes: Fonte[], de: number, ate: number): Promise<void> {
  const enderecos = [...new Set(fontes.flatMap(enderecosDaFonte))];
  if (enderecos.length === 0) return;

  // Fotografia da lista antes da chamada: uma oferta registrada no meio deste
  // pedaço não estava no filtro, então os eventos dela aqui ficam com o backfill.
  const ofertasDaChamada = fontes.includes(FONTE_PMES) ? new Map(ofertas) : new Map();
  const cache = new Map<number, number>();
  const logs = await provider.getLogs({ address: enderecos, fromBlock: de, toBlock: ate });

  for (const log of logs) {
    const endereco = log.address.toLowerCase();
    if (endereco === config.orquestradorEndereco && fontes.includes(FONTE_ORQUESTRADOR)) {
      await processarLogOrquestrador(log, Math.max(checkpoints.pmes, ate), cache);
    } else if (endereco === enderecoAssinaturas && fontes.includes(FONTE_ASSINATURAS)) {
      await processarLogAssinatura(log, cache);
    } else {
      const oferta = ofertasDaChamada.get(endereco);
      if (oferta) await processarLogPmes(log, oferta, cache);
      // senão: não deveria acontecer, mas não confia cegamente no retorno do RPC
    }
  }
}

// ── atraso e backfill ────────────────────────────────────────────────────────────

/**
 * Leva uma fonte atrasada até `alvo`, gastando no máximo `orcamento` chamadas.
 * O checkpoint é salvo ao fim do lote (e não a cada pedaço) para não multiplicar
 * as escritas no banco durante uma varredura longa; uma queda no meio só
 * repete pedaços, e o reprocessamento é idempotente.
 */
async function recuperarAtraso(fonte: Fonte, alvo: number, orcamento: number): Promise<number> {
  let feito = checkpoints[fonte];
  try {
    while (feito < alvo && orcamento > 0) {
      const de = feito + 1;
      const ate = Math.min(de + config.blockRangeChunk - 1, alvo);
      await processarPedaco([fonte], de, ate);
      feito = ate;
      orcamento--;
    }
  } finally {
    if (feito > checkpoints[fonte]) {
      await salvarCheckpoints([fonte], feito);
      checkpoints[fonte] = feito;
      console.log(`[indexer] fonte "${fonte}" recuperando atraso — bloco ${feito} de ${alvo}`);
    }
  }
  return orcamento;
}

function backfillsPendentes(): OfertaMonitorada[] {
  return [...ofertas.values()].filter(
    (o) => o.backfill_alvo !== null && (o.backfill_ate ?? o.bloco_criacao - 1) < o.backfill_alvo,
  );
}

/**
 * Varre os eventos das ofertas novas anteriores à entrada delas no lote. Todas
 * as pendentes andam juntas: cada pedaço é uma chamada com os endereços das
 * ofertas cujo intervalo cobre aquele pedaço.
 */
async function avancarBackfill(orcamento: number): Promise<number> {
  const pendentes = backfillsPendentes();
  if (pendentes.length === 0) return orcamento;

  const inicio = (o: OfertaMonitorada) => (o.backfill_ate ?? o.bloco_criacao - 1) + 1;
  const tocadas = new Set<OfertaMonitorada>();

  try {
    while (orcamento > 0) {
      const ativas = backfillsPendentes();
      if (ativas.length === 0) break;

      const de = Math.min(...ativas.map(inicio));
      const ate = Math.min(de + config.blockRangeChunk - 1, Math.max(...ativas.map((o) => o.backfill_alvo!)));
      const doPedaco = ativas.filter((o) => inicio(o) <= ate);

      const cache = new Map<number, number>();
      const logs = await provider.getLogs({
        address: doPedaco.map((o) => o.endereco),
        fromBlock: de,
        toBlock: ate,
      });
      for (const log of logs) {
        const oferta = doPedaco.find((o) => o.endereco === log.address.toLowerCase());
        if (!oferta || log.blockNumber < inicio(oferta) || log.blockNumber > oferta.backfill_alvo!) continue;
        await processarLogPmes(log, oferta, cache);
      }

      for (const o of doPedaco) {
        o.backfill_ate = Math.min(ate, o.backfill_alvo!);
        tocadas.add(o);
      }
      orcamento--;
    }
  } finally {
    for (const o of tocadas) {
      await salvarBackfill(o.endereco, o.backfill_ate!);
      const concluido = o.backfill_ate! >= o.backfill_alvo!;
      console.log(
        `[indexer] backfill ${o.apelido} — bloco ${o.backfill_ate} de ${o.backfill_alvo}${concluido ? " (concluído)" : ""}`,
      );
    }
  }
  return orcamento;
}

// ── ciclo ────────────────────────────────────────────────────────────────────────

/** Devolve true quando não sobrou atraso nem backfill (usado pelo dry-run). */
async function ciclo(): Promise<boolean> {
  const blocoAtual = await provider.getBlockNumber();
  const lider = Math.max(...FONTES.map((f) => checkpoints[f]));
  let orcamento = config.chunksAtrasoPorCiclo;

  // 1. Fontes atrasadas em relação à que está mais à frente.
  for (const fonte of FONTES) {
    if (checkpoints[fonte] < lider && orcamento > 0) {
      orcamento = await recuperarAtraso(fonte, lider, orcamento);
    }
  }

  // 2. Backfill das ofertas novas — só depois que a varredura do orquestrador
  //    alcançou a fonte pmes, para agrupar as ofertas descobertas nela.
  if (checkpoints.orquestrador >= checkpoints.pmes && orcamento > 0) {
    orcamento = await avancarBackfill(orcamento);
  }

  // 3. Lote normal: uma chamada por pedaço com todas as fontes em dia.
  const emDia = FONTES.filter((f) => checkpoints[f] === lider);
  let de = lider + 1;
  while (de <= blocoAtual) {
    const ate = Math.min(de + config.blockRangeChunk - 1, blocoAtual);
    await processarPedaco(emDia, de, ate);
    await salvarCheckpoints(emDia, ate);
    for (const f of emDia) checkpoints[f] = ate;
    de = ate + 1;
  }

  const atrasadas = FONTES.some((f) => checkpoints[f] < Math.max(...FONTES.map((g) => checkpoints[g])));
  return !atrasadas && backfillsPendentes().length === 0;
}

async function loop(): Promise<void> {
  for (const o of await carregarOfertas()) ofertas.set(o.endereco, o);
  checkpoints.pmes = await lerCheckpoint(FONTE_PMES, config.startBlock);
  checkpoints.assinaturas = await lerCheckpoint(FONTE_ASSINATURAS, config.startBlockAssinaturas);
  checkpoints.orquestrador = await lerCheckpoint(FONTE_ORQUESTRADOR, config.startBlockOrquestrador - 1);

  if (config.dryRun) console.log("[indexer] DRY-RUN — nada será gravado no banco");
  console.log(`[indexer] Niara-Register — checkpoints: ${JSON.stringify(checkpoints)}`);
  console.log(
    `[indexer] monitorando ${ofertas.size} oferta(s) de registro_ofertas:`,
    [...ofertas.values()].map((o) => `${o.numero}:${o.endereco}`),
  );
  console.log(`[indexer] OfertaOrquestrador em ${config.orquestradorEndereco}`);
  console.log(`[indexer] RegistroAssinaturas em ${config.registroAssinaturasEndereco}`);
  console.log(
    `[indexer] pedaço de ${config.blockRangeChunk} blocos, até ${config.chunksAtrasoPorCiclo} chamadas de atraso por ciclo, polling a cada ${config.pollIntervalMs / 1000}s`,
  );

  while (true) {
    try {
      const emDia = await ciclo();
      if (config.dryRun && emDia) {
        await relatorioDryRun();
        process.exit(0);
      }
    } catch (erro) {
      // Nunca derruba o processo por um erro de rede/RPC pontual — o checkpoint
      // garante que a próxima iteração retoma do ponto certo, sem duplicar nem
      // perder eventos.
      console.error("[indexer] erro no ciclo de polling, tentando de novo no próximo ciclo:", erro);
    }

    // Em dry-run não há por que esperar: o objetivo é chegar ao fim.
    if (!config.dryRun) {
      await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
    }
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
    const oferta = ofertas.get(endereco);
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
