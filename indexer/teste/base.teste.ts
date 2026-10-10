/**
 * Teste da fonte de assinaturas EVM adicional (evm-assinaturas.ts), com RPC e
 * banco em memória: pedaços, margem de confirmações, filtro de endereço,
 * retomada após erro sem lacuna nem duplicata, e 429 absorvido pelo backoff.
 */
import { ethers } from "ethers";
import { REGISTRO_ASSINATURAS_ABI } from "../abi";
import type { NovaAssinatura } from "../db";
import { criarIndexadorAssinaturasEvm, type RpcEvmLeve } from "../evm-assinaturas";

let falhas = 0;
function verificar(c: boolean, d: string) {
  console.log(`${c ? "ok  " : "FALHA"} ${d}`);
  if (!c) falhas++;
}

const CONTRATO = "0x1111111111111111111111111111111111111111";
const OUTRO = "0x2222222222222222222222222222222222222222";
const PESSOA = "0x4369000000000000000000000000000000035dc0";
const iface = new ethers.Interface(REGISTRO_ASSINATURAS_ABI);

const logs: ethers.Log[] = [];
let seq = 0;
function documento(endereco: string, bloco: number, nome: string, ts: number) {
  const { topics, data } = iface.encodeEventLog("DocumentoRegistrado", [ethers.id(nome), PESSOA, nome, "ata", ts]);
  logs.push({
    address: endereco,
    blockNumber: bloco,
    index: logs.filter((l) => l.blockNumber === bloco).length,
    transactionHash: ethers.zeroPadValue(ethers.toBeHex(++seq), 32),
    topics,
    data,
  } as unknown as ethers.Log);
}

documento(CONTRATO, 1000, "deploy-block", 1_700_000_000); // no bloco do deploy
documento(CONTRATO, 1499, "fim-do-pedaco", 1_700_000_100);
documento(CONTRATO, 1500, "inicio-do-pedaco", 1_700_000_200);
documento(OUTRO, 1600, "outro-contrato", 1_700_000_300); // não pode entrar
documento(CONTRATO, 2400, "perto-do-topo", 1_700_000_400);
documento(CONTRATO, 2497, "dentro-da-margem", 1_700_000_500); // topo 2500 − 5 → fica para depois

let topo = 2500;
let falharProximoGetLogs = false;
let erros429 = 2;
const rpc: RpcEvmLeve = {
  async getBlockNumber() {
    if (erros429-- > 0) {
      throw ethers.makeError("server response 429 Too Many Requests", "SERVER_ERROR", {
        request: undefined as never,
        response: undefined as never,
        info: { responseStatus: "429 Too Many Requests" } as never,
      });
    }
    return topo;
  },
  async getLogs({ address, fromBlock, toBlock }) {
    if (falharProximoGetLogs) {
      falharProximoGetLogs = false;
      throw new Error("RPC caiu");
    }
    if (toBlock - fromBlock + 1 > 500) throw new Error(`range grande demais: ${fromBlock}-${toBlock}`);
    return logs.filter(
      (l) => address.includes(l.address.toLowerCase()) && l.blockNumber >= fromBlock && l.blockNumber <= toBlock,
    );
  },
};

const gravadas = new Map<string, NovaAssinatura>();
let tentativas = 0;
const checkpoints = new Map<string, number>();
const banco = {
  async gravarAssinatura(a: NovaAssinatura) {
    tentativas++;
    const k = `${a.rede}|${a.hash_sha256}`;
    if (!gravadas.has(k)) gravadas.set(k, a);
  },
  lerCheckpoint: async (f: string, fb: number) => checkpoints.get(f) ?? fb,
  async salvarCheckpoints(fs: string[], b: number) {
    for (const f of fs) checkpoints.set(f, b);
  },
};

const novo = () =>
  criarIndexadorAssinaturasEvm({
    rede: "base-sepolia",
    fonte: "base-sepolia-assinaturas",
    rpc,
    banco,
    endereco: CONTRATO,
    blocoDeploy: 1000,
    chunk: 500,
    maxPedacosPorCiclo: 2,
    confirmacoes: 5,
    backoff: { tentativas: 6, baseMs: 1, tetoMs: 1 },
    dormir: async () => {},
  });

(async () => {
  let idx = novo();
  await idx.iniciar();
  verificar(idx.checkpoint === 999, "sem checkpoint, começa no bloco anterior ao deploy");

  const r1 = await idx.ciclo(); // 429 duas vezes no getBlockNumber, absorvido
  verificar(r1.gravados === 3 && idx.checkpoint === 1999 && !r1.emDia, `ciclo 1: 2 pedaços (1000–1999), 3 docs (${r1.gravados}), atrasado`);

  falharProximoGetLogs = true;
  let lancou = false;
  try {
    await idx.ciclo();
  } catch {
    lancou = true;
  }
  verificar(lancou && checkpoint() === 1999, "erro no getLogs: ciclo lança e o checkpoint não anda");

  idx = novo(); // simula reinício do processo
  await idx.iniciar();
  verificar(idx.checkpoint === 1999, "reinício retoma do checkpoint salvo");
  const r3 = await idx.ciclo();
  verificar(r3.gravados === 1 && idx.checkpoint === 2495 && r3.emDia, `ciclo 3: até topo − 5 (2495), 1 doc (${r3.gravados}), em dia`);

  topo = 2510;
  const r4 = await idx.ciclo();
  verificar(r4.gravados === 1 && idx.checkpoint === 2505, "documento dentro da margem entra quando ganha confirmações");

  const nomes = [...gravadas.values()].map((a) => a.documento_nome);
  verificar(!nomes.includes("outro-contrato"), "evento de outro contrato é ignorado");
  verificar(gravadas.size === 5 && tentativas === 5, `5 documentos, sem duplicata (${gravadas.size}/${tentativas})`);
  const um = gravadas.get(`base-sepolia|${ethers.id("deploy-block")}`);
  verificar(um?.rede === "base-sepolia" && um.assinado_em === new Date(1_700_000_000_000).toISOString() && um.bloco === 1000, "rede, data (do evento) e bloco corretos");
  verificar(/^0x[0-9a-f]{64}$/.test(um?.hash_sha256 ?? ""), "hash 0x + 64 hex minúsculo, mesmo formato das outras redes");

  console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} FALHA(S)`);
  process.exit(falhas === 0 ? 0 : 1);
})();

function checkpoint() {
  return checkpoints.get("base-sepolia-assinaturas");
}
