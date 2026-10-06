/**
 * Teste do indexador sob recuperação longa com limite de taxa (429), sem rede
 * e sem banco: RPC, tokens, banco e relógio são falsos, em memória.
 *
 * Cenário: as fontes pmes e assinaturas estão em dia; o orquestrador está
 * 1.000 blocos atrás (100 pedaços de 10, com orçamento de 20 por ciclo) e, no
 * meio desse trecho, criou duas ofertas com eventos espalhados — inclusive
 * nas bordas de pedaço e depois do ponto em que entram no lote. O RPC devolve
 * 429 em ~1 de cada 5 chamadas e, para um pedaço específico do atraso, 7
 * vezes seguidas (mais que as 6 tentativas do backoff), derrubando aquela
 * parte do ciclo. Também respondem 429, de forma intermitente, eth_blockNumber
 * (1 em 3), getBlock (1 em 4) e as leituras de token (1 em 3; metade delas
 * embrulhada como tokens.ts faz, com o 429 em `cause`). A chain cresce 3
 * blocos a cada ciclo.
 *
 * Verifica:
 *  (a) um evento novo no topo da chain, criado durante a recuperação, é
 *      gravado no ciclo seguinte, com o orquestrador ainda atrasado;
 *  (b) ao fim, todo evento esperado está gravado uma única vez, nada a mais,
 *      e a cobertura de blocos de cada endereço é contínua (sem lacuna).
 *
 * Uso (a partir de indexer/): npx tsx teste/atraso.teste.ts
 */
import "../log-seguro";
import { ethers } from "ethers";
import { OFERTA_CAPTACAO_ABI, OFERTA_ORQUESTRADOR_ABI, REGISTRO_ASSINATURAS_ABI } from "../abi";
import type { NovaAssinatura, NovaOferta, NovoRegistro } from "../db";
import { criarIndexador, type Banco, type Rpc } from "../indexador";
import { paraMonitorada, type OfertaMonitorada } from "../ofertas";
import type { LeitorTokens } from "../tokens";

// Chave falsa: aparece na URL dos erros 429 simulados, para provar a máscara.
const CHAVE = "chaveFalsaDoTeste0123456789abcdef";
process.env.ALCHEMY_API_KEY = CHAVE;

// Silencia o progresso normal do indexador ([indexer] … gravado); avisos de
// backoff e erros continuam aparecendo.
const logOriginal = console.log;
console.log = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].startsWith("[indexer]")) return;
  logOriginal(...args);
};

const end = (n: number) => ethers.getAddress(`0x${n.toString(16).padStart(40, "0")}`).toLowerCase();
const ORQ = end(0x0de9c);
const ASSIN = end(0x5627);
const LEGADA = end(0xd4ac);
const N1 = end(0x6587);
const N2 = end(0x50e4);
const MOEDA = end(0xec37);
const PESSOA = end(0x47d9);

const iOferta = new ethers.Interface(OFERTA_CAPTACAO_ABI);
const iOrq = new ethers.Interface(OFERTA_ORQUESTRADOR_ABI);
const iAssin = new ethers.Interface(REGISTRO_ASSINATURAS_ABI);
const mBRL = (v: number) => ethers.parseUnits(String(v), 18);

// ── chain falsa ──────────────────────────────────────────────────────────────────

type LogFalso = ethers.Log;
const logs: LogFalso[] = [];
let txSeq = 0;
function emitir(endereco: string, bloco: number, iface: ethers.Interface, evento: string, args: unknown[]) {
  const { topics, data } = iface.encodeEventLog(evento, args);
  const log = {
    address: endereco,
    blockNumber: bloco,
    index: logs.filter((l) => l.blockNumber === bloco).length,
    transactionHash: ethers.zeroPadValue(ethers.toBeHex(++txSeq), 32),
    topics,
    data,
  } as unknown as LogFalso;
  logs.push(log);
  return log;
}

const criacao = (oferta: string, bloco: number) =>
  emitir(ORQ, bloco, iOrq, "OfertaCompletaCriada", [PESSOA, end(0x7000 + bloco), oferta, mBRL(500000), mBRL(600000), mBRL(1000), 1797698979]);
const aporte = (oferta: string, bloco: number, valor: number) =>
  emitir(oferta, bloco, iOferta, "Aporte", [PESSOA, mBRL(valor), mBRL(valor)]);

// Eventos já no histórico (antes do início do teste):
const esperados: LogFalso[] = [
  criacao(N1, 1203),
  aporte(N1, 1250, 250000),
  criacao(N2, 1510), // última linha de um pedaço (1501–1510)
  aporte(N2, 1511, 1000), // primeira linha do pedaço seguinte
  emitir(N2, 1800, iOferta, "RecursosLiberados", [PESSOA, mBRL(594000), end(0x9780), mBRL(6000)]),
  aporte(N1, 1990, 350000),
  aporte(N1, 2000, 1), // exatamente no checkpoint pmes inicial
];
// Já gravado antes (abaixo do checkpoint pmes = 2000): NÃO pode reaparecer.
const jaGravado = aporte(LEGADA, 1500, 777);

// Eventos futuros, que "acontecem" conforme a chain cresce:
const futuros: { bloco: number; criar: () => LogFalso }[] = [
  { bloco: 2003, criar: () => emitir(ASSIN, 2003, iAssin, "DocumentoRegistrado", [ethers.id("doc"), PESSOA, "Ata", "Ata", 1]) },
  { bloco: 2007, criar: () => aporte(N1, 2007, 5) }, // depois do alvo de backfill de N1
];

let topo = 2000;
let chamadasGetLogs = 0;
let erros429 = 0;
const erros429PorTipo = { getLogs: 0, getBlockNumber: 0, getBlock: 0, tokens: 0 };
let chamadasBlockNumber = 0;
let chamadasGetBlock = 0;
let chamadasTokens = 0;
const cobertura = new Map<string, [number, number][]>();
const falhasPorPedaco = new Map<string, number>();

function erro429(): Error {
  return ethers.makeError("server response 429 Too Many Requests", "SERVER_ERROR", {
    request: undefined as never,
    response: undefined as never,
    info: {
      requestUrl: `https://eth-sepolia.g.alchemy.com/v2/${CHAVE}`,
      responseBody: '{"jsonrpc":"2.0","id":1,"error":{"code":429,"message":"Your app has exceeded its compute units per second capacity"}}',
      responseStatus: "429 Too Many Requests",
    },
  });
}

const rpc: Rpc = {
  async getBlockNumber() {
    if (++chamadasBlockNumber % 3 === 1) {
      erros429PorTipo.getBlockNumber++;
      throw erro429();
    }
    topo += 3; // a chain anda entre um ciclo e outro
    for (const f of futuros.filter((f) => f.bloco <= topo)) esperados.push(f.criar());
    futuros.splice(0, futuros.length, ...futuros.filter((f) => f.bloco > topo));
    return topo;
  },
  async getLogs({ address, fromBlock, toBlock }) {
    chamadasGetLogs++;
    if (toBlock - fromBlock + 1 > 10) throw new Error(`range de ${toBlock - fromBlock + 1} blocos (plano free: 10)`);
    if (toBlock > topo) throw new Error(`toBlock ${toBlock} acima do topo ${topo}`);

    // Rajada: este pedaço do atraso falha 7 vezes seguidas (backoff tem 6).
    const chave = `${fromBlock}-${toBlock}-${address.join()}`;
    if (fromBlock === 1301 && address.includes(ORQ)) {
      const n = falhasPorPedaco.get(chave) ?? 0;
      if (n < 7) {
        falhasPorPedaco.set(chave, n + 1);
        erros429++;
        erros429PorTipo.getLogs++;
        throw erro429();
      }
    }
    // Intermitente: ~1 em cada 5 chamadas.
    if (chamadasGetLogs % 5 === 2) {
      erros429++;
      erros429PorTipo.getLogs++;
      throw erro429();
    }

    for (const a of address) {
      cobertura.set(a, [...(cobertura.get(a) ?? []), [fromBlock, toBlock]]);
    }
    const alvo = new Set(address.map((a) => a.toLowerCase()));
    return logs.filter((l) => alvo.has(l.address) && l.blockNumber >= fromBlock && l.blockNumber <= toBlock);
  },
  async getBlock(numero) {
    if (++chamadasGetBlock % 4 === 1) {
      erros429PorTipo.getBlock++;
      throw erro429();
    }
    return { timestamp: 1_790_000_000 + numero * 12 };
  },
};

// 1 em cada 3 leituras de token responde 429 — alternando entre o erro cru do
// ethers e o erro embrulhado por tokens.ts ("Falha ao ler …", com o 429 em cause).
function talvez429<T>(descricao: string, valor: T): Promise<T> {
  const n = ++chamadasTokens;
  if (n % 3 === 1) {
    erros429PorTipo.tokens++;
    if (n % 2 === 0) return Promise.reject(erro429());
    return Promise.reject(new Error(`Falha ao ler ${descricao}: limite`, { cause: erro429() }));
  }
  return Promise.resolve(valor);
}
const tokens: LeitorTokens = {
  daMoeda: () => talvez429("decimals()", 18),
  simboloDaMoeda: () => talvez429("symbol()", "mBRL"),
  moedaDaOferta: () => talvez429("moeda()", MOEDA),
  doTokenDeCotas: () => talvez429("decimals() do token", 18),
  metadados: () => talvez429("metadados", { nome: "Teste Participações", simbolo: "TST", empresa: "Empresa Teste" }),
};

// ── banco falso ──────────────────────────────────────────────────────────────────

const registros = new Map<string, NovoRegistro>();
const assinaturas = new Map<string, NovaAssinatura>();
const ofertasGravadas = new Map<string, NovaOferta>();
const checkpointsBanco = new Map<string, number>([["pmes", 2000], ["assinaturas", 2000]]);
let tentativasDeGravacao = 0;

const legada: OfertaMonitorada = paraMonitorada({
  endereco: LEGADA, token: end(0x4ddd), numero: 1, origem: "legado", empresa: "Empresa Demo",
  bloco_criacao: 900, backfill_alvo: null, backfill_ate: null,
});

const banco: Banco = {
  carregarOfertas: async () => [legada],
  async gravarRegistro(r) {
    tentativasDeGravacao++;
    const k = `${r.tx_hash}#${r.log_index}`;
    if (!registros.has(k)) registros.set(k, r); // ignoreDuplicates, como o upsert real
  },
  async gravarAssinatura(a) {
    tentativasDeGravacao++;
    if (!assinaturas.has(a.hash_sha256)) assinaturas.set(a.hash_sha256, a);
  },
  async gravarOferta(o) {
    if (!ofertasGravadas.has(o.endereco)) ofertasGravadas.set(o.endereco, o);
  },
  async salvarBackfill(endereco, ate) {
    const o = ofertasGravadas.get(endereco);
    if (o) o.backfill_ate = ate;
  },
  lerCheckpoint: async (fonte, fallback) => checkpointsBanco.get(fonte) ?? fallback,
  async salvarCheckpoints(fontes, bloco) {
    for (const f of fontes) checkpointsBanco.set(f, bloco);
  },
};

let esperaBackoffMs = 0;
let esperaEspacamentoMs = 0;
const dormir = async (ms: number) => {
  if (ms === 300) esperaEspacamentoMs += ms;
  else esperaBackoffMs += ms;
};

// ── execução ─────────────────────────────────────────────────────────────────────

const indexador = criarIndexador({
  rpc,
  tokens,
  banco,
  dormir,
  cfg: {
    blockRangeChunk: 10,
    chunksAtrasoPorCiclo: 20,
    atrasoIntervaloMs: 300,
    backoff: { tentativas: 6, baseMs: 1_000, tetoMs: 30_000 },
    startBlock: 0,
    startBlockAssinaturas: 0,
    startBlockOrquestrador: 1001,
    orquestradorEndereco: ORQ,
    registroAssinaturasEndereco: ASSIN,
  },
});

const falhas: string[] = [];
const verificar = (ok: boolean, texto: string) => {
  logOriginal(`${ok ? "  ✔" : "  ✘"} ${texto}`);
  if (!ok) falhas.push(texto);
};

await indexador.iniciar();
logOriginal(`início: checkpoints ${JSON.stringify(indexador.checkpoints)}, topo ${topo}\n`);

// (a) evento novo no topo, criado no meio da recuperação
let eventoTopo: LogFalso | null = null;
let cicloDoEventoTopo = 0;
let cicloEmQueApareceu = 0;
let orqNoMomento = 0;
let pmesNoMomento = 0;

let ciclo = 0;
let ciclosComFalha = 0;
let ciclosComFalhaNoLoteNormal = 0;
const ciclosAbortados: { ciclo: number; pmesAntes: number; pmesDepois: number; topo: number }[] = [];
while (ciclo < 500) {
  ciclo++;
  const pmesAntes = indexador.checkpoints.pmes;
  const r = await indexador.ciclo();
  if (r.falhouLoteNormal) ciclosComFalhaNoLoteNormal++;
  if (r.falhou) {
    ciclosComFalha++;
    ciclosAbortados.push({ ciclo, pmesAntes, pmesDepois: indexador.checkpoints.pmes, topo });
  }

  if (ciclo === 2) {
    // Depois do 2º ciclo, a recuperação ainda está longe do fim: cria um
    // aporte na oferta legada no próximo bloco da chain.
    eventoTopo = aporte(LEGADA, topo + 1, 4242);
    esperados.push(eventoTopo);
    cicloDoEventoTopo = ciclo;
  }
  if (eventoTopo && !cicloEmQueApareceu && registros.has(`${eventoTopo.transactionHash}#${eventoTopo.index}`)) {
    cicloEmQueApareceu = ciclo;
    orqNoMomento = indexador.checkpoints.orquestrador;
    pmesNoMomento = indexador.checkpoints.pmes;
  }
  if (r.emDia && futuros.length === 0) break;
}

// ── verificação ──────────────────────────────────────────────────────────────────

logOriginal(`\nfim: ${ciclo} ciclos (${ciclosComFalha} com alguma parte abortada pelo 429), checkpoints ${JSON.stringify(indexador.checkpoints)}, topo ${topo}`);
logOriginal(`getLogs: ${chamadasGetLogs} chamadas, ${erros429} respondidas com 429; espera simulada: backoff ${(esperaBackoffMs / 1000).toFixed(0)}s, espaçamento ${(esperaEspacamentoMs / 1000).toFixed(0)}s\n`);

logOriginal(`429 por tipo de chamada: ${JSON.stringify(erros429PorTipo)}\n`);

logOriginal("429 fora do getLogs");
verificar(
  erros429PorTipo.getBlockNumber > 0 && erros429PorTipo.getBlock > 0 && erros429PorTipo.tokens > 0,
  `houve 429 em eth_blockNumber (${erros429PorTipo.getBlockNumber}), getBlock (${erros429PorTipo.getBlock}) e leituras de token (${erros429PorTipo.tokens})`,
);
verificar(
  ciclosComFalhaNoLoteNormal === 0,
  `nenhum ciclo teve o lote normal abortado (${ciclosComFalhaNoLoteNormal}) — todos esses 429 foram absorvidos pelo backoff`,
);
verificar(
  ciclosComFalha === 1,
  `o único ciclo com alguma parte abortada é o da rajada de 7× 429 no getLogs do atraso (${ciclosComFalha})`,
);

logOriginal("\n(a) evento novo no topo durante a recuperação");
verificar(cicloEmQueApareceu === cicloDoEventoTopo + 1, `criado depois do ciclo ${cicloDoEventoTopo}, gravado no ciclo ${cicloEmQueApareceu}`);
verificar(orqNoMomento < pmesNoMomento, `naquele momento o orquestrador ainda estava atrasado (orquestrador ${orqNoMomento} < pmes ${pmesNoMomento})`);

for (const c of ciclosAbortados) {
  verificar(
    c.pmesDepois === c.topo && c.pmesDepois > c.pmesAntes,
    `ciclo ${c.ciclo}: a recuperação abortou pelo 429, mas o lote normal levou o pmes de ${c.pmesAntes} a ${c.pmesDepois} (topo ${c.topo})`,
  );
}
verificar(
  ciclosAbortados.length > 0,
  `houve ${ciclosAbortados.length} ciclo(s) com a recuperação abortada (a rajada de 7× 429 esgota as 6 tentativas)`,
);

logOriginal("\n(b) recuperação completa, sem lacuna nem duplicata");
const chave = (l: LogFalso) => `${l.transactionHash}#${l.index}`;
const esperadosRegistro = esperados.filter((l) => l.address !== ASSIN);
const faltando = esperadosRegistro.filter((l) => !registros.has(chave(l)));
const esperadosChaves = new Set(esperadosRegistro.map(chave));
const extras = [...registros.keys()].filter((k) => !esperadosChaves.has(k));
verificar(faltando.length === 0, `todos os ${esperadosRegistro.length} eventos esperados gravados (faltando: ${faltando.length})`);
verificar(extras.length === 0, `nenhuma linha a mais (extras: ${extras.length}; o aporte do bloco 1500, já gravado antes, não reaparece: ${!registros.has(chave(jaGravado))})`);
verificar(registros.size === esperadosRegistro.length, `linhas únicas no banco = ${registros.size}; tentativas de gravação = ${tentativasDeGravacao} (reprocessamento após 429 é absorvido pela chave tx_hash+log_index)`);
verificar(assinaturas.size === 1, `assinatura do bloco 2003 gravada (${assinaturas.size})`);
const ofertasNovas = [...ofertasGravadas.values()].sort((a, b) => a.numero - b.numero);
verificar(
  ofertasNovas.map((o) => `${o.numero}:${o.endereco}`).join() === `2:${N1},3:${N2}`,
  `ofertas novas numeradas na ordem de criação: ${ofertasNovas.map((o) => `nº ${o.numero} bloco ${o.bloco_criacao}`).join(", ")}`,
);
verificar(
  ofertasNovas.every((o) => o.backfill_ate === o.backfill_alvo),
  `backfill concluído nas duas: ${ofertasNovas.map((o) => `${o.backfill_ate}/${o.backfill_alvo}`).join(", ")}`,
);

const final = indexador.checkpoints.pmes;
function semLacuna(endereco: string, desde: number): { ok: boolean; texto: string } {
  const faixas = [...(cobertura.get(endereco) ?? [])].sort((a, b) => a[0] - b[0]);
  let ate = desde - 1;
  for (const [de, fim] of faixas) {
    if (de > ate + 1) return { ok: false, texto: `lacuna ${ate + 1}–${de - 1}` };
    ate = Math.max(ate, fim);
  }
  return ate >= final ? { ok: true, texto: `${desde}–${ate} contínuo` } : { ok: false, texto: `parou em ${ate}` };
}
for (const [nome, endereco, desde] of [
  ["orquestrador", ORQ, 1001],
  ["oferta nova 2", N1, 1203],
  ["oferta nova 3", N2, 1510],
  ["oferta legada 1", LEGADA, 2001],
  ["assinaturas", ASSIN, 2001],
] as const) {
  const r = semLacuna(endereco, desde);
  verificar(r.ok, `cobertura de blocos — ${nome}: ${r.texto}`);
}
verificar(
  indexador.checkpoints.pmes === indexador.checkpoints.assinaturas &&
    indexador.checkpoints.assinaturas === indexador.checkpoints.orquestrador,
  `três checkpoints juntos no fim (${indexador.checkpoints.pmes})`,
);

logOriginal(falhas.length === 0 ? "\nRESULTADO: OK" : `\nRESULTADO: FALHOU (${falhas.length})`);
process.exit(falhas.length === 0 ? 0 : 1);
