import { ethers } from "ethers";
import {
  OFERTA_CAPTACAO_ABI,
  OFERTA_ORQUESTRADOR_ABI,
  REGISTRO_ASSINATURAS_ABI,
  ESTADO_LABELS,
} from "./abi";
import type { NovaAssinatura, NovaOferta, NovoRegistro } from "./db";
import { montarDados, montarDadosCriacao } from "./eventos";
import { comBackoff, type OpcoesBackoff } from "./limite";
import { paraMonitorada, type OfertaMonitorada } from "./ofertas";
import type { LeitorTokens } from "./tokens";

/**
 * Núcleo do indexer, com as dependências injetadas (RPC, tokens, banco,
 * relógio) — index.ts liga as reais; teste/atraso.teste.ts liga falsas.
 *
 * Três fontes, cada uma com seu checkpoint em registro_checkpoints:
 *
 * - pmes: eventos das OfertaCaptacao listadas em registro_ofertas
 * - assinaturas: DocumentoRegistrado do RegistroAssinaturas
 * - orquestrador: OfertaCompletaCriada do OfertaOrquestrador
 *
 * Cada ciclo tem duas partes independentes:
 *
 * 1. LOTE NORMAL — sempre primeiro, em todo ciclo. As fontes que estão no
 *    bloco mais à frente (em regime normal, as três) andam juntas até o topo
 *    da chain com UMA chamada eth_getLogs por pedaço, com todos os endereços;
 *    os eventos são separados pelo endereço e os checkpoints salvos juntos.
 *
 * 2. ATRASO — fonte atrás das outras (a varredura do orquestrador desde o
 *    deploy) e backfill de ofertas novas. Orçamento próprio por ciclo
 *    (CHUNKS_ATRASO_POR_CICLO), chamadas espaçadas por ATRASO_INTERVALO_MS. O
 *    backfill só começa quando a varredura alcança a fonte pmes, para que todas
 *    as ofertas descobertas nela andem juntas (uma chamada com vários
 *    endereços por pedaço). Erro aqui não afeta o lote normal: é registrado e
 *    a recuperação continua do ponto salvo no ciclo seguinte.
 *
 * Toda chamada ao RPC passa por comBackoff: limite de taxa (429) vira espera
 * exponencial com teto e log, não erro imediato.
 */

export const FONTE_PMES = "pmes";
export const FONTE_ASSINATURAS = "assinaturas";
export const FONTE_ORQUESTRADOR = "orquestrador";
export type Fonte = typeof FONTE_PMES | typeof FONTE_ASSINATURAS | typeof FONTE_ORQUESTRADOR;
const FONTES: Fonte[] = [FONTE_PMES, FONTE_ASSINATURAS, FONTE_ORQUESTRADOR];

export type Rpc = {
  getBlockNumber(): Promise<number>;
  getLogs(filtro: { address: string[]; fromBlock: number; toBlock: number }): Promise<ethers.Log[]>;
  getBlock(numero: number): Promise<{ timestamp: number } | null>;
};

export type Banco = {
  carregarOfertas(): Promise<OfertaMonitorada[]>;
  gravarRegistro(registro: NovoRegistro): Promise<void>;
  gravarAssinatura(assinatura: NovaAssinatura): Promise<void>;
  gravarOferta(oferta: NovaOferta): Promise<void>;
  salvarBackfill(endereco: string, ate: number): Promise<void>;
  lerCheckpoint(fonte: string, fallback: number): Promise<number>;
  salvarCheckpoints(fontes: string[], bloco: number): Promise<void>;
};

export type ConfigIndexador = {
  blockRangeChunk: number;
  chunksAtrasoPorCiclo: number;
  atrasoIntervaloMs: number;
  backoff: Omit<OpcoesBackoff, "dormir">;
  startBlock: number;
  startBlockAssinaturas: number;
  startBlockOrquestrador: number;
  orquestradorEndereco: string;
  registroAssinaturasEndereco: string;
};

export type ResultadoCiclo = {
  /** Sem fonte atrasada nem backfill pendente. */
  emDia: boolean;
  /** Alguma das partes do ciclo terminou em erro. */
  falhou: boolean;
  /** O lote normal especificamente terminou em erro (só após esgotar o backoff). */
  falhouLoteNormal: boolean;
};

const interfaceOferta = new ethers.Interface(OFERTA_CAPTACAO_ABI);
const interfaceAssinaturas = new ethers.Interface(REGISTRO_ASSINATURAS_ABI);
const interfaceOrquestrador = new ethers.Interface(OFERTA_ORQUESTRADOR_ABI);

function enderecoCurto(endereco: string): string {
  return `${endereco.slice(0, 6)}...${endereco.slice(-4)}`;
}

export function criarIndexador(deps: {
  rpc: Rpc;
  tokens: LeitorTokens;
  banco: Banco;
  cfg: ConfigIndexador;
  dormir: (ms: number) => Promise<void>;
}) {
  const { rpc, banco, cfg, dormir } = deps;
  const orquestrador = cfg.orquestradorEndereco.toLowerCase();
  const enderecoAssinaturas = cfg.registroAssinaturasEndereco.toLowerCase();
  const opcoesBackoff: OpcoesBackoff = { ...cfg.backoff, dormir };
  const rede = <T,>(fn: () => Promise<T>, contexto: string) => comBackoff(fn, contexto, opcoesBackoff);

  // Leituras de token (decimals, symbol, moeda(), token(), name/empresa) são
  // eth_call no mesmo RPC: passam pelo mesmo backoff que getLogs e blockNumber.
  // O cache de Tokens descarta a leitura que falhou, então a nova tentativa
  // pergunta de novo à chain.
  const tokens: LeitorTokens = {
    daMoeda: (o) => rede(() => deps.tokens.daMoeda(o), `decimals da moeda de ${o}`),
    simboloDaMoeda: (o) => rede(() => deps.tokens.simboloDaMoeda(o), `symbol da moeda de ${o}`),
    moedaDaOferta: (o) => rede(() => deps.tokens.moedaDaOferta(o), `moeda() de ${o}`),
    doTokenDeCotas: (o, t) => rede(() => deps.tokens.doTokenDeCotas(o, t), `decimals do token de ${o}`),
    metadados: (t) => rede(() => deps.tokens.metadados(t), `metadados do token ${t}`),
  };

  // Lista de ofertas monitoradas — carregada de registro_ofertas ao iniciar e
  // acrescida quando o orquestrador cria uma oferta nova.
  const ofertas = new Map<string, OfertaMonitorada>();
  const checkpoints: Record<Fonte, number> = { pmes: 0, assinaturas: 0, orquestrador: 0 };

  const lider = () => Math.max(...FONTES.map((f) => checkpoints[f]));

  function enderecosDaFonte(fonte: Fonte): string[] {
    switch (fonte) {
      case FONTE_PMES:
        return [...ofertas.keys()];
      case FONTE_ASSINATURAS:
        return [enderecoAssinaturas];
      case FONTE_ORQUESTRADOR:
        return [orquestrador];
    }
  }

  // Cache local ao pedaço de blocos sendo processado — timestamp de bloco
  // minerado nunca muda; escopo local mantém a memória limitada.
  async function timestampDoBloco(numeroBloco: number, cache: Map<number, number>): Promise<string> {
    let timestamp = cache.get(numeroBloco);
    if (timestamp === undefined) {
      const bloco = await rede(() => rpc.getBlock(numeroBloco), `getBlock ${numeroBloco}`);
      timestamp = bloco?.timestamp ?? 0;
      cache.set(numeroBloco, timestamp);
    }
    return new Date(timestamp * 1000).toISOString();
  }

  // ── pmes ───────────────────────────────────────────────────────────────────────

  // A `descricao` segue em português. O valor usa as casas decimais e o symbol()
  // da moeda() da própria oferta.
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

    await banco.gravarRegistro({
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

  // ── assinaturas ────────────────────────────────────────────────────────────────

  async function processarLogAssinatura(log: ethers.Log, cache: Map<number, number>): Promise<void> {
    let parsed: ethers.LogDescription | null;
    try {
      parsed = interfaceAssinaturas.parseLog(log);
    } catch {
      return;
    }
    if (!parsed || parsed.name !== "DocumentoRegistrado") return;

    await banco.gravarAssinatura({
      documento_nome: parsed.args.nomeDocumento as string,
      tipo_documento: parsed.args.tipoDocumento as string,
      hash_sha256: parsed.args.hashDocumento as string,
      assinante_endereco: parsed.args.assinante as string,
      tx_hash: log.transactionHash,
      log_index: log.index,
      endereco_contrato: cfg.registroAssinaturasEndereco,
      bloco: log.blockNumber,
      assinado_em: await timestampDoBloco(log.blockNumber, cache),
      status: "assinado_onchain",
    });

    console.log(
      `[indexer] Documento registrado — "${parsed.args.nomeDocumento}" (${parsed.args.tipoDocumento}) — assinante ${enderecoCurto(parsed.args.assinante as string)} — bloco ${log.blockNumber} — ${log.transactionHash}`,
    );
  }

  // ── orquestrador ───────────────────────────────────────────────────────────────

  /**
   * OfertaCompletaCriada: registra a oferta (número = maior + 1, na ordem dos
   * eventos), grava a linha `offering_created` e põe a oferta no lote da fonte
   * pmes. Os eventos dela anteriores à entrada no lote ficam para o backfill,
   * de bloco_criacao até `alvoBackfill`.
   *
   * Ordem pensada para queda no meio: a oferta é gravada antes da linha do
   * ledger e as duas antes do checkpoint do orquestrador. Se o processo cair, o
   * evento é reprocessado; a oferta já existe (carregada do banco), então
   * mantém número e estado de backfill, e a linha do ledger é idempotente.
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
      await banco.gravarOferta(nova);
      oferta = paraMonitorada(nova);
      ofertas.set(endereco, oferta);
      console.log(
        `[indexer] oferta nova — ${oferta.apelido} — ${meta.empresa ?? "(sem empresa)"} — criada no bloco ${log.blockNumber}; backfill até ${nova.backfill_alvo}`,
      );
    }

    const dados = await montarDadosCriacao(parsed, oferta, tokens);
    await banco.gravarRegistro({
      fonte: FONTE_PMES,
      tipo_evento: "Oferta criada",
      descricao: `${oferta.apelido} — criada pelo emissor ${enderecoCurto(dados.emissor)}${oferta.empresa ? ` (${oferta.empresa})` : ""}, meta ${dados.metaMinima}–${dados.metaMaxima} ${dados.moeda}, ${dados.precoPorCota} ${dados.moeda} por cota`,
      tx_hash: log.transactionHash,
      log_index: log.index,
      endereco_contrato: orquestrador,
      bloco: log.blockNumber,
      ocorrido_em: ocorridoEm,
      confirmado: true,
      dados,
    });

    console.log(`[indexer] Oferta criada — ${oferta.apelido} — bloco ${log.blockNumber} — ${log.transactionHash}`);
  }

  // ── despacho ───────────────────────────────────────────────────────────────────

  /**
   * Busca os logs de um pedaço para as fontes indicadas — uma chamada só, com
   * os endereços de todas elas — e entrega cada log ao processador da sua fonte.
   */
  async function processarPedaco(fontes: Fonte[], de: number, ate: number, origem: string): Promise<void> {
    const enderecos = [...new Set(fontes.flatMap(enderecosDaFonte))];
    if (enderecos.length === 0) return;

    // Fotografia da lista antes da chamada: uma oferta registrada no meio deste
    // pedaço não estava no filtro, então os eventos dela aqui ficam com o backfill.
    const ofertasDaChamada = fontes.includes(FONTE_PMES) ? new Map(ofertas) : new Map();
    const cache = new Map<number, number>();
    const logs = await rede(
      () => rpc.getLogs({ address: enderecos, fromBlock: de, toBlock: ate }),
      `getLogs ${de}–${ate} (${origem})`,
    );

    for (const log of logs) {
      const endereco = log.address.toLowerCase();
      if (endereco === orquestrador && fontes.includes(FONTE_ORQUESTRADOR)) {
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

  // ── lote normal ────────────────────────────────────────────────────────────────

  /** Leva as fontes que estão à frente até o topo da chain, juntas. */
  async function loteNormal(blocoAtual: number): Promise<void> {
    const frente = lider();
    const emDia = FONTES.filter((f) => checkpoints[f] === frente);
    let de = frente + 1;
    while (de <= blocoAtual) {
      const ate = Math.min(de + cfg.blockRangeChunk - 1, blocoAtual);
      await processarPedaco(emDia, de, ate, "lote normal");
      await banco.salvarCheckpoints(emDia, ate);
      for (const f of emDia) checkpoints[f] = ate;
      de = ate + 1;
    }
  }

  // ── atraso e backfill ──────────────────────────────────────────────────────────

  /**
   * Leva uma fonte atrasada até `alvo`, gastando no máximo `orcamento` chamadas,
   * espaçadas por ATRASO_INTERVALO_MS. O checkpoint é salvo ao fim do lote (e
   * não a cada pedaço) para não multiplicar as escritas no banco; se algo falhar
   * no meio, o progresso até o último pedaço completo é salvo e o reprocessamento
   * é idempotente.
   */
  async function recuperarAtraso(fonte: Fonte, alvo: number, orcamento: { restante: number }): Promise<void> {
    let feito = checkpoints[fonte];
    try {
      while (feito < alvo && orcamento.restante > 0) {
        const de = feito + 1;
        const ate = Math.min(de + cfg.blockRangeChunk - 1, alvo);
        await processarPedaco([fonte], de, ate, `atraso ${fonte}`);
        feito = ate;
        orcamento.restante--;
        await dormir(cfg.atrasoIntervaloMs);
      }
    } finally {
      if (feito > checkpoints[fonte]) {
        await banco.salvarCheckpoints([fonte], feito);
        checkpoints[fonte] = feito;
        console.log(`[indexer] fonte "${fonte}" recuperando atraso — bloco ${feito} de ${alvo}`);
      }
    }
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
  async function avancarBackfill(orcamento: { restante: number }): Promise<void> {
    const inicio = (o: OfertaMonitorada) => (o.backfill_ate ?? o.bloco_criacao - 1) + 1;
    const tocadas = new Set<OfertaMonitorada>();

    try {
      while (orcamento.restante > 0) {
        const ativas = backfillsPendentes();
        if (ativas.length === 0) break;

        const de = Math.min(...ativas.map(inicio));
        const ate = Math.min(de + cfg.blockRangeChunk - 1, Math.max(...ativas.map((o) => o.backfill_alvo!)));
        const doPedaco = ativas.filter((o) => inicio(o) <= ate);

        const cache = new Map<number, number>();
        const logs = await rede(
          () => rpc.getLogs({ address: doPedaco.map((o) => o.endereco), fromBlock: de, toBlock: ate }),
          `getLogs ${de}–${ate} (backfill)`,
        );
        for (const log of logs) {
          const oferta = doPedaco.find((o) => o.endereco === log.address.toLowerCase());
          if (!oferta || log.blockNumber < inicio(oferta) || log.blockNumber > oferta.backfill_alvo!) continue;
          await processarLogPmes(log, oferta, cache);
        }

        for (const o of doPedaco) {
          o.backfill_ate = Math.min(ate, o.backfill_alvo!);
          tocadas.add(o);
        }
        orcamento.restante--;
        await dormir(cfg.atrasoIntervaloMs);
      }
    } finally {
      for (const o of tocadas) {
        await banco.salvarBackfill(o.endereco, o.backfill_ate!);
        const concluido = o.backfill_ate! >= o.backfill_alvo!;
        console.log(
          `[indexer] backfill ${o.apelido} — bloco ${o.backfill_ate} de ${o.backfill_alvo}${concluido ? " (concluído)" : ""}`,
        );
      }
    }
  }

  /** Fontes atrasadas primeiro; o backfill só depois que o orquestrador alcançou o pmes. */
  async function trabalhoAtrasado(): Promise<void> {
    const orcamento = { restante: cfg.chunksAtrasoPorCiclo };
    const alvo = lider();
    for (const fonte of FONTES) {
      if (checkpoints[fonte] < alvo && orcamento.restante > 0) {
        await recuperarAtraso(fonte, alvo, orcamento);
      }
    }
    if (checkpoints.orquestrador >= checkpoints.pmes && orcamento.restante > 0) {
      await avancarBackfill(orcamento);
    }
  }

  // ── ciclo ──────────────────────────────────────────────────────────────────────

  function emDia(): boolean {
    const frente = lider();
    return FONTES.every((f) => checkpoints[f] === frente) && backfillsPendentes().length === 0;
  }

  async function ciclo(): Promise<ResultadoCiclo> {
    let falhou = false;
    let falhouLoteNormal = false;

    // 1. Lote normal: eventos novos de todas as fontes em dia, todo ciclo.
    try {
      const blocoAtual = await rede(() => rpc.getBlockNumber(), "getBlockNumber");
      await loteNormal(blocoAtual);
    } catch (erro) {
      falhou = true;
      falhouLoteNormal = true;
      console.error("[indexer] erro no lote normal, tentando de novo no próximo ciclo:", erro);
    }

    // 2. Atraso e backfill, com orçamento próprio. Uma falha aqui não desfaz nem
    //    atrasa o lote normal; o progresso salvo é retomado no próximo ciclo.
    if (!emDia()) {
      try {
        await trabalhoAtrasado();
      } catch (erro) {
        falhou = true;
        console.error("[indexer] erro na recuperação de atraso, retomando no próximo ciclo:", erro);
      }
    }

    return { emDia: emDia(), falhou, falhouLoteNormal };
  }

  async function iniciar(): Promise<void> {
    for (const o of await banco.carregarOfertas()) ofertas.set(o.endereco, o);
    checkpoints.pmes = await banco.lerCheckpoint(FONTE_PMES, cfg.startBlock);
    checkpoints.assinaturas = await banco.lerCheckpoint(FONTE_ASSINATURAS, cfg.startBlockAssinaturas);
    checkpoints.orquestrador = await banco.lerCheckpoint(FONTE_ORQUESTRADOR, cfg.startBlockOrquestrador - 1);
  }

  return { iniciar, ciclo, ofertas, checkpoints };
}
