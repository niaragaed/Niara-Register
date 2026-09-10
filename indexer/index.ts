import { ethers } from "ethers";
import { config, type OfertaMonitorada } from "./config";
import { OFERTA_CAPTACAO_ABI, ESTADO_LABELS } from "./abi";
import { gravarRegistro, lerCheckpoint, salvarCheckpoint } from "./db";

const FONTE = "pmes";

const provider = new ethers.JsonRpcProvider(config.rpcUrl);
const interfaceOferta = new ethers.Interface(OFERTA_CAPTACAO_ABI);

function enderecoCurto(endereco: string): string {
  return `${endereco.slice(0, 6)}...${endereco.slice(-4)}`;
}

function descreverEvento(
  parsed: ethers.LogDescription,
  oferta: OfertaMonitorada,
): { tipoEvento: string; descricao: string } {
  switch (parsed.name) {
    case "Aporte": {
      const valor = ethers.formatUnits(parsed.args.valor as bigint, 18);
      return {
        tipoEvento: "Aporte",
        descricao: `${oferta.apelido} — investidor ${enderecoCurto(parsed.args.investidor as string)} aportou ${valor} MockBRL`,
      };
    }
    case "OfertaEncerrada": {
      const resultado = ESTADO_LABELS[Number(parsed.args.resultado)] ?? "Desconhecido";
      const total = ethers.formatUnits(parsed.args.totalArrecadado as bigint, 18);
      return {
        tipoEvento: "Oferta encerrada",
        descricao: `${oferta.apelido} — encerrada (${resultado}), total arrecadado ${total} MockBRL`,
      };
    }
    case "OfertaCancelada":
      return { tipoEvento: "Oferta cancelada", descricao: `${oferta.apelido} — oferta cancelada` };
    case "CotasResgatadas": {
      const cotas = ethers.formatUnits(parsed.args.cotas as bigint, 18);
      return {
        tipoEvento: "Resgate de cotas",
        descricao: `${oferta.apelido} — investidor ${enderecoCurto(parsed.args.investidor as string)} resgatou ${cotas} cotas`,
      };
    }
    case "RecursosLiberados": {
      const valorEmissor = ethers.formatUnits(parsed.args.valorEmissor as bigint, 18);
      return {
        tipoEvento: "Recursos liberados",
        descricao: `${oferta.apelido} — ${valorEmissor} MockBRL liberados ao emissor`,
      };
    }
    case "Reembolso": {
      const valor = ethers.formatUnits(parsed.args.valor as bigint, 18);
      return {
        tipoEvento: "Reembolso",
        descricao: `${oferta.apelido} — investidor ${enderecoCurto(parsed.args.investidor as string)} reembolsado em ${valor} MockBRL`,
      };
    }
    default:
      return { tipoEvento: parsed.name, descricao: `${oferta.apelido} — ${parsed.name}` };
  }
}

async function processarRangeDeBlocos(fromBlock: number, toBlock: number): Promise<void> {
  for (const oferta of config.ofertas) {
    const logs = await provider.getLogs({
      address: oferta.endereco,
      fromBlock,
      toBlock,
    });

    for (const log of logs) {
      let parsed: ethers.LogDescription | null;
      try {
        parsed = interfaceOferta.parseLog(log);
      } catch {
        continue; // log de um evento fora da nossa ABI mínima — ignora
      }
      if (!parsed) continue;

      const bloco = await provider.getBlock(log.blockNumber);
      const ocorridoEm = new Date((bloco?.timestamp ?? 0) * 1000).toISOString();
      const { tipoEvento, descricao } = descreverEvento(parsed, oferta);

      await gravarRegistro({
        fonte: FONTE,
        tipo_evento: tipoEvento,
        descricao,
        tx_hash: log.transactionHash,
        log_index: log.index,
        endereco_contrato: oferta.endereco,
        bloco: log.blockNumber,
        ocorrido_em: ocorridoEm,
        confirmado: true, // só chegamos aqui com o log já minerado (getLogs, não pending)
      });

      console.log(
        `[indexer] ${tipoEvento} — ${oferta.apelido} — bloco ${log.blockNumber} — ${log.transactionHash}`,
      );
    }
  }
}

async function loop(): Promise<void> {
  let ultimoProcessado = await lerCheckpoint(FONTE, config.startBlock);
  console.log(`[indexer] Niara-Register — fonte "${FONTE}" — retomando a partir do bloco ${ultimoProcessado}`);
  console.log(`[indexer] monitorando ${config.ofertas.length} oferta(s):`, config.ofertas.map((o) => o.endereco));

  while (true) {
    try {
      const blocoAtual = await provider.getBlockNumber();

      if (blocoAtual > ultimoProcessado) {
        let de = ultimoProcessado + 1;
        while (de <= blocoAtual) {
          const ate = Math.min(de + config.blockRangeChunk - 1, blocoAtual);
          await processarRangeDeBlocos(de, ate);
          await salvarCheckpoint(FONTE, ate);
          ultimoProcessado = ate;
          de = ate + 1;
        }
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
