import { ethers } from "ethers";
import {
  REDES_EVM,
  REGISTRO_ASSINATURAS_ABI,
  type RedeEvm,
} from "@/lib/registro-contract";

/**
 * Leitor próprio de transações e endereços EVM, direto do RPC oficial da rede.
 *
 * Existe porque a HyperEVM Testnet não tem um explorador público que funcione
 * (out/2026: o Purrsec dá 404, testnet.hyperevmscan.io não existe, o Blockscout
 * comunitário está milhões de blocos atrás e o explorador da própria Hyperliquid
 * fica em branco). Em vez de apontar o livro para um link quebrado, o site mostra
 * a transação lendo a rede na hora — nada aqui vem do banco do Register.
 *
 * Só para server components (as páginas /explorer/...): o RPC é chamado do
 * servidor, com tempo limite, e uma falha vira um estado explícito na tela.
 */

const TEMPO_LIMITE_MS = 10_000;
const iface = new ethers.Interface(REGISTRO_ASSINATURAS_ABI);

export function ehRedeEvm(rede: string): rede is RedeEvm {
  return Object.prototype.hasOwnProperty.call(REDES_EVM, rede);
}

function provedor(rede: RedeEvm): ethers.JsonRpcProvider {
  const cfg = REDES_EVM[rede];
  const req = new ethers.FetchRequest(cfg.rpcUrl);
  req.timeout = TEMPO_LIMITE_MS;
  // staticNetwork: não gasta uma chamada de eth_chainId a cada página.
  // batchMaxCount 1: nem todo RPC público aceita lote JSON-RPC.
  return new ethers.JsonRpcProvider(req, Number(cfg.chainIdHex), {
    staticNetwork: true,
    batchMaxCount: 1,
  });
}

/** Leitura atual de verificar(hash) no contrato. */
export type EstadoNoContrato = {
  existe: boolean;
  assinante: string;
  timestamp: number;
  nomeDocumento: string;
  tipoDocumento: string;
};

export type RegistroNaTx = {
  logIndex: number;
  hashDocumento: string;
  assinante: string;
  nomeDocumento: string;
  tipoDocumento: string;
  timestamp: number;
  /** null quando a chamada a verificar() falhou (RPC), não quando o hash não existe. */
  noContrato: EstadoNoContrato | null;
  /** O contrato devolve hoje exatamente o que o evento registrou. */
  confere: boolean;
};

export type LeituraTx =
  | { tipo: "nao-encontrada" }
  | { tipo: "pendente"; de: string; para: string | null }
  | {
      tipo: "incluida";
      de: string;
      para: string | null;
      sucesso: boolean;
      bloco: number;
      confirmacoes: number;
      /** Timestamp do bloco (unix, segundos). */
      dataBloco: number | null;
      gasUsado: string;
      /** Endereço criado, quando a transação é um deploy. */
      contratoCriado: string | null;
      registros: RegistroNaTx[];
    };

export class RpcIndisponivel extends Error {}

async function lerNoContrato(
  contrato: ethers.Contract,
  hashDocumento: string,
): Promise<EstadoNoContrato | null> {
  try {
    const r = await contrato.verificar(hashDocumento);
    return {
      existe: r[0] as boolean,
      assinante: r[1] as string,
      timestamp: Number(r[2] as bigint),
      nomeDocumento: r[3] as string,
      tipoDocumento: r[4] as string,
    };
  } catch (erro) {
    console.warn(`[leitor-evm] verificar(${hashDocumento}) falhou:`, erro);
    return null;
  }
}

export async function lerTransacao(rede: RedeEvm, hash: string): Promise<LeituraTx> {
  const cfg = REDES_EVM[rede];
  const p = provedor(rede);
  try {
    const tx = await p.getTransaction(hash);
    if (!tx) return { tipo: "nao-encontrada" };

    const recibo = await p.getTransactionReceipt(hash);
    if (!recibo) return { tipo: "pendente", de: tx.from, para: tx.to };

    // Em sequência, não em paralelo: o RPC da HyperEVM limita por IP.
    const bloco = await p.getBlock(recibo.blockNumber);
    const topo = await p.getBlockNumber();

    const contrato = new ethers.Contract(cfg.endereco, REGISTRO_ASSINATURAS_ABI, p);
    const registros: RegistroNaTx[] = [];
    for (const log of recibo.logs) {
      // Só eventos emitidos pelo contrato da Niara: outro contrato pode emitir
      // um evento com a mesma assinatura e não pode virar registro aqui.
      if (log.address.toLowerCase() !== cfg.endereco.toLowerCase()) continue;
      let evento: ethers.LogDescription | null = null;
      try {
        evento = iface.parseLog(log);
      } catch {
        continue;
      }
      if (!evento || evento.name !== "DocumentoRegistrado") continue;

      const hashDocumento = (evento.args.hashDocumento as string).toLowerCase();
      const assinante = evento.args.assinante as string;
      const timestamp = Number(evento.args.timestamp as bigint);
      const noContrato = await lerNoContrato(contrato, hashDocumento);
      registros.push({
        logIndex: log.index,
        hashDocumento,
        assinante,
        nomeDocumento: evento.args.nomeDocumento as string,
        tipoDocumento: evento.args.tipoDocumento as string,
        timestamp,
        noContrato,
        confere: Boolean(
          noContrato?.existe &&
            noContrato.assinante.toLowerCase() === assinante.toLowerCase() &&
            noContrato.timestamp === timestamp,
        ),
      });
    }

    return {
      tipo: "incluida",
      de: tx.from,
      para: tx.to,
      sucesso: recibo.status === 1,
      bloco: recibo.blockNumber,
      confirmacoes: Math.max(topo - recibo.blockNumber + 1, 1),
      dataBloco: bloco?.timestamp ?? null,
      gasUsado: recibo.gasUsed.toString(),
      contratoCriado: recibo.contractAddress,
      registros,
    };
  } catch (erro) {
    console.error(`[leitor-evm] ${rede}: leitura de ${hash} falhou:`, erro);
    throw new RpcIndisponivel(String(erro));
  } finally {
    p.destroy();
  }
}

export type LeituraEndereco = {
  /** Tamanho do bytecode em bytes; 0 = conta comum (sem código). */
  tamanhoCodigo: number;
  nonce: number;
};

export async function lerEndereco(rede: RedeEvm, endereco: string): Promise<LeituraEndereco> {
  const p = provedor(rede);
  try {
    const codigo = await p.getCode(endereco);
    const nonce = await p.getTransactionCount(endereco);
    return { tamanhoCodigo: ethers.dataLength(codigo), nonce };
  } catch (erro) {
    console.error(`[leitor-evm] ${rede}: leitura de ${endereco} falhou:`, erro);
    throw new RpcIndisponivel(String(erro));
  } finally {
    p.destroy();
  }
}
