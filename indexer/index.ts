import { ethers } from "ethers";
import { config, type OfertaMonitorada } from "./config";
import { OFERTA_CAPTACAO_ABI, REGISTRO_ASSINATURAS_ABI, ESTADO_LABELS } from "./abi";
import {
  gravarRegistro,
  gravarAssinatura,
  lerCheckpoint,
  salvarCheckpoint,
} from "./db";
import { Decimais } from "./decimais";
import { montarDados } from "./eventos";

const FONTE_PMES = "pmes";
const FONTE_ASSINATURAS = "assinaturas";

const provider = new ethers.JsonRpcProvider(config.rpcUrl);
const interfaceOferta = new ethers.Interface(OFERTA_CAPTACAO_ABI);
const interfaceAssinaturas = new ethers.Interface(REGISTRO_ASSINATURAS_ABI);

// Vive pelo processo inteiro: cada token é consultado uma vez só.
const decimais = new Decimais(provider);

function enderecoCurto(endereco: string): string {
  return `${endereco.slice(0, 6)}...${endereco.slice(-4)}`;
}

// Cache local ao range de blocos sendo processado — timestamp de bloco
// minerado nunca muda, então evita reconsultar o RPC pra cada log do mesmo
// bloco. Escopo local (não global ao processo) mantém o consumo de memória
// limitado ao tamanho do pedaço (BLOCK_RANGE_CHUNK), mesmo em backfills
// longos de milhares de blocos.
async function timestampDoBloco(
  numeroBloco: number,
  cache: Map<number, number>,
): Promise<number> {
  const emCache = cache.get(numeroBloco);
  if (emCache !== undefined) return emCache;

  const bloco = await provider.getBlock(numeroBloco);
  const timestamp = bloco?.timestamp ?? 0;
  cache.set(numeroBloco, timestamp);
  return timestamp;
}

// O texto gerado aqui é exatamente o de antes. O que mudou é a origem do número
// de casas decimais: vem de decimals() do próprio token, não de um 18 fixo.
// Como MockBRL e os 11 ParticipacaoToken usam 18, a saída é idêntica hoje — a
// diferença só apareceria num token futuro com outra precisão, que antes seria
// formatado errado em silêncio.
async function descreverEventoPmes(
  parsed: ethers.LogDescription,
  oferta: OfertaMonitorada,
  decimais: Decimais,
): Promise<{ tipoEvento: string; descricao: string }> {
  const emMoeda = async (v: unknown) =>
    ethers.formatUnits(v as bigint, await decimais.daMoeda(oferta.endereco));

  switch (parsed.name) {
    case "Aporte": {
      const valor = await emMoeda(parsed.args.valor);
      return {
        tipoEvento: "Aporte",
        descricao: `${oferta.apelido} — investidor ${enderecoCurto(parsed.args.investidor as string)} aportou ${valor} MockBRL`,
      };
    }
    case "OfertaEncerrada": {
      const resultado = ESTADO_LABELS[Number(parsed.args.resultado)] ?? "Desconhecido";
      const total = await emMoeda(parsed.args.totalArrecadado);
      return {
        tipoEvento: "Oferta encerrada",
        descricao: `${oferta.apelido} — encerrada (${resultado}), total arrecadado ${total} MockBRL`,
      };
    }
    case "OfertaCancelada":
      return { tipoEvento: "Oferta cancelada", descricao: `${oferta.apelido} — oferta cancelada` };
    case "CotasResgatadas": {
      const casas = await decimais.doTokenDeCotas(oferta.endereco, oferta.token);
      const cotas = ethers.formatUnits(parsed.args.cotas as bigint, casas);
      return {
        tipoEvento: "Resgate de cotas",
        descricao: `${oferta.apelido} — investidor ${enderecoCurto(parsed.args.investidor as string)} resgatou ${cotas} cotas`,
      };
    }
    case "RecursosLiberados": {
      const valorEmissor = await emMoeda(parsed.args.valorEmissor);
      return {
        tipoEvento: "Recursos liberados",
        descricao: `${oferta.apelido} — ${valorEmissor} MockBRL liberados ao emissor`,
      };
    }
    case "Reembolso": {
      const valor = await emMoeda(parsed.args.valor);
      return {
        tipoEvento: "Reembolso",
        descricao: `${oferta.apelido} — investidor ${enderecoCurto(parsed.args.investidor as string)} reembolsado em ${valor} MockBRL`,
      };
    }
    default:
      return { tipoEvento: parsed.name, descricao: `${oferta.apelido} — ${parsed.name}` };
  }
}

async function processarRangeDeBlocosPmes(fromBlock: number, toBlock: number): Promise<void> {
  // Uma chamada só para todas as ofertas — eth_getLogs aceita uma lista de
  // endereços. Evita N chamadas por range de blocos (uma por oferta), o que
  // no plano gratuito da Alchemy (10 blocos por chamada) tornaria o backfill
  // N vezes mais lento e mais sujeito a limite de requisições por segundo.
  const enderecoParaOferta = new Map(config.ofertas.map((o) => [o.endereco.toLowerCase(), o]));
  const cacheTimestamp = new Map<number, number>();

  const logs = await provider.getLogs({
    address: config.ofertas.map((o) => o.endereco),
    fromBlock,
    toBlock,
  });

  for (const log of logs) {
    const oferta = enderecoParaOferta.get(log.address.toLowerCase());
    if (!oferta) continue; // não deveria acontecer, mas não confia cegamente no retorno do RPC

    let parsed: ethers.LogDescription | null;
    try {
      parsed = interfaceOferta.parseLog(log);
    } catch {
      continue; // log de um evento fora da nossa ABI mínima — ignora
    }
    if (!parsed) continue;

    const timestamp = await timestampDoBloco(log.blockNumber, cacheTimestamp);
    const ocorridoEm = new Date(timestamp * 1000).toISOString();
    const { tipoEvento, descricao } = await descreverEventoPmes(parsed, oferta, decimais);
    const dados = await montarDados(parsed, oferta, decimais);

    await gravarRegistro({
      fonte: FONTE_PMES,
      tipo_evento: tipoEvento,
      descricao,
      tx_hash: log.transactionHash,
      log_index: log.index,
      endereco_contrato: oferta.endereco,
      bloco: log.blockNumber,
      ocorrido_em: ocorridoEm,
      confirmado: true, // só chegamos aqui com o log já minerado (getLogs, não pending)
      dados,
    });

    console.log(
      `[indexer] ${tipoEvento} — ${oferta.apelido} — bloco ${log.blockNumber} — ${log.transactionHash}`,
    );
  }
}

async function processarRangeDeBlocosAssinaturas(
  fromBlock: number,
  toBlock: number,
): Promise<void> {
  const cacheTimestamp = new Map<number, number>();

  const logs = await provider.getLogs({
    address: config.registroAssinaturasEndereco,
    fromBlock,
    toBlock,
  });

  for (const log of logs) {
    let parsed: ethers.LogDescription | null;
    try {
      parsed = interfaceAssinaturas.parseLog(log);
    } catch {
      continue;
    }
    if (!parsed || parsed.name !== "DocumentoRegistrado") continue;

    const timestamp = await timestampDoBloco(log.blockNumber, cacheTimestamp);
    const assinadoEm = new Date(timestamp * 1000).toISOString();

    await gravarAssinatura({
      documento_nome: parsed.args.nomeDocumento as string,
      tipo_documento: parsed.args.tipoDocumento as string,
      hash_sha256: parsed.args.hashDocumento as string,
      assinante_endereco: parsed.args.assinante as string,
      tx_hash: log.transactionHash,
      log_index: log.index,
      endereco_contrato: config.registroAssinaturasEndereco,
      bloco: log.blockNumber,
      assinado_em: assinadoEm,
      status: "assinado_onchain",
    });

    console.log(
      `[indexer] Documento registrado — "${parsed.args.nomeDocumento}" (${parsed.args.tipoDocumento}) — assinante ${enderecoCurto(parsed.args.assinante as string)} — bloco ${log.blockNumber} — ${log.transactionHash}`,
    );
  }
}

// Avança uma fonte (checkpoint independente) em pedaços de config.blockRangeChunk,
// do último bloco processado até blocoAtual. Genérico o suficiente para PMEs e
// Assinaturas — e para uma futura terceira fonte (Exchange), quando existir.
async function avancarFonte(
  fonte: string,
  blocoAtual: number,
  ultimoProcessado: number,
  processar: (de: number, ate: number) => Promise<void>,
): Promise<number> {
  let atual = ultimoProcessado;
  let de = atual + 1;

  while (de <= blocoAtual) {
    const ate = Math.min(de + config.blockRangeChunk - 1, blocoAtual);
    await processar(de, ate);
    await salvarCheckpoint(fonte, ate);
    atual = ate;
    de = ate + 1;
  }

  return atual;
}

async function loop(): Promise<void> {
  let ultimoPmes = await lerCheckpoint(FONTE_PMES, config.startBlock);
  let ultimoAssinaturas = await lerCheckpoint(
    FONTE_ASSINATURAS,
    config.startBlockAssinaturas,
  );

  console.log(
    `[indexer] Niara-Register — fonte "${FONTE_PMES}" — retomando a partir do bloco ${ultimoPmes}`,
  );
  console.log(
    `[indexer] monitorando ${config.ofertas.length} oferta(s):`,
    config.ofertas.map((o) => o.endereco),
  );
  console.log(
    `[indexer] Niara-Register — fonte "${FONTE_ASSINATURAS}" — retomando a partir do bloco ${ultimoAssinaturas}`,
  );
  console.log(
    `[indexer] monitorando RegistroAssinaturas em ${config.registroAssinaturasEndereco}`,
  );

  while (true) {
    try {
      const blocoAtual = await provider.getBlockNumber();

      if (blocoAtual > ultimoPmes) {
        ultimoPmes = await avancarFonte(
          FONTE_PMES,
          blocoAtual,
          ultimoPmes,
          processarRangeDeBlocosPmes,
        );
      }

      if (blocoAtual > ultimoAssinaturas) {
        ultimoAssinaturas = await avancarFonte(
          FONTE_ASSINATURAS,
          blocoAtual,
          ultimoAssinaturas,
          processarRangeDeBlocosAssinaturas,
        );
      }
    } catch (erro) {
      // Nunca derruba o processo por um erro de rede/RPC pontual — o checkpoint
      // garante que a próxima iteração retoma do ponto certo, sem duplicar nem
      // perder eventos.
      console.error("[indexer] erro no ciclo de polling, tentando de novo no próximo ciclo:", erro);
    }

    await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
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
