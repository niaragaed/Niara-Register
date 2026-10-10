import { ethers } from "ethers";
import { REGISTRO_ASSINATURAS_ABI } from "./abi";
import type { NovaAssinatura } from "./db";
import { comBackoff, type OpcoesBackoff } from "./limite";

/**
 * Fonte de assinaturas para uma rede EVM ADICIONAL (hoje: Base Sepolia), com
 * o mesmo contrato RegistroAssinaturas da Sepolia.
 *
 * A Sepolia continua no lote do indexador.ts (junto com PMEs e orquestrador,
 * que só existem lá). Cada rede extra roda aqui, num laço próprio, com RPC e
 * checkpoint próprios: lentidão ou erro numa rede nunca atrasa outra.
 *
 * Por ciclo: do checkpoint até (topo − confirmações), em pedaços de
 * `chunk` blocos, no máximo `maxPedacosPorCiclo` pedaços. O checkpoint é salvo
 * ao fim de cada pedaço, então uma queda no meio retoma de onde parou. A data
 * vem do próprio evento (campo `timestamp`), sem getBlock extra.
 *
 * Gravação idempotente por (rede, hash_sha256) — ver migration 005/006.
 */

export type RedeEvmExtra = "base-sepolia" | "robinhood-testnet" | "hyperevm-testnet" | "tempo-testnet";

export type RpcEvmLeve = {
  getBlockNumber(): Promise<number>;
  getLogs(filtro: { address: string[]; fromBlock: number; toBlock: number }): Promise<ethers.Log[]>;
};

export type BancoEvmLeve = {
  gravarAssinatura(assinatura: NovaAssinatura): Promise<void>;
  lerCheckpoint(fonte: string, fallback: number): Promise<number>;
  salvarCheckpoints(fontes: string[], bloco: number): Promise<void>;
};

const iface = new ethers.Interface(REGISTRO_ASSINATURAS_ABI);

export function criarIndexadorAssinaturasEvm(deps: {
  rede: RedeEvmExtra;
  fonte: string;
  rpc: RpcEvmLeve;
  banco: BancoEvmLeve;
  endereco: string;
  /** Bloco do deploy; o checkpoint inicial é este − 1. */
  blocoDeploy: number;
  chunk: number;
  maxPedacosPorCiclo: number;
  /** Blocos de margem atrás do topo, contra reorganização. */
  confirmacoes: number;
  /** Pausa entre pedaços no mesmo ciclo (RPC com limite de taxa apertado). */
  intervaloEntrePedacosMs?: number;
  backoff: Omit<OpcoesBackoff, "dormir">;
  dormir: (ms: number) => Promise<void>;
}) {
  const { rpc, banco } = deps;
  const endereco = deps.endereco.toLowerCase();
  const opcoes: OpcoesBackoff = { ...deps.backoff, dormir: deps.dormir };
  const rede = <T,>(fn: () => Promise<T>, contexto: string) =>
    comBackoff(fn, `${deps.rede}: ${contexto}`, opcoes);

  let checkpoint = 0;

  async function iniciar(): Promise<void> {
    checkpoint = await banco.lerCheckpoint(deps.fonte, deps.blocoDeploy - 1);
  }

  async function processarLog(log: ethers.Log): Promise<boolean> {
    if (log.address.toLowerCase() !== endereco) return false;
    let parsed: ethers.LogDescription | null;
    try {
      parsed = iface.parseLog(log);
    } catch {
      return false;
    }
    if (!parsed || parsed.name !== "DocumentoRegistrado") return false;

    const timestamp = Number(parsed.args.timestamp as bigint);
    await banco.gravarAssinatura({
      rede: deps.rede,
      documento_nome: parsed.args.nomeDocumento as string,
      tipo_documento: parsed.args.tipoDocumento as string,
      hash_sha256: (parsed.args.hashDocumento as string).toLowerCase(),
      assinante_endereco: parsed.args.assinante as string,
      tx_hash: log.transactionHash,
      log_index: log.index,
      endereco_contrato: deps.endereco,
      bloco: log.blockNumber,
      assinado_em: new Date(timestamp * 1000).toISOString(),
      status: "assinado_onchain",
    });
    console.log(
      `[indexer] ${deps.rede}: Documento registrado — "${parsed.args.nomeDocumento}" (${parsed.args.tipoDocumento}) — bloco ${log.blockNumber} — ${log.transactionHash}`,
    );
    return true;
  }

  /** Lança em erro; o que já foi processado fica salvo no checkpoint. */
  async function ciclo(): Promise<{ gravados: number; emDia: boolean }> {
    const topo = (await rede(() => rpc.getBlockNumber(), "getBlockNumber")) - deps.confirmacoes;
    let gravados = 0;
    for (let i = 0; i < deps.maxPedacosPorCiclo && checkpoint < topo; i++) {
      if (i > 0 && deps.intervaloEntrePedacosMs) await deps.dormir(deps.intervaloEntrePedacosMs);
      const de = checkpoint + 1;
      const ate = Math.min(checkpoint + deps.chunk, topo);
      const logs = await rede(
        () => rpc.getLogs({ address: [endereco], fromBlock: de, toBlock: ate }),
        `getLogs ${de}–${ate}`,
      );
      const ordenados = [...logs].sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
      for (const log of ordenados) if (await processarLog(log)) gravados++;
      await banco.salvarCheckpoints([deps.fonte], ate);
      checkpoint = ate;
    }
    return { gravados, emDia: checkpoint >= topo };
  }

  return {
    iniciar,
    ciclo,
    get checkpoint() {
      return checkpoint;
    },
  };
}
