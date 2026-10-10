/**
 * Teste da fonte do Niara-PMEs na Solana (pmes-solana.ts).
 *
 * Parte 1 (offline): decodificação Borsh dos eventos, formatação de valores com as 6 casas do
 * MockBRL SPL e atribuição pela pilha de invoke (evento de outro programa é ignorado).
 *
 * Parte 2 (rede, opcional): roda ciclos contra um RPC de verdade (PMES_SOLANA_TESTE_RPC, ex.:
 * http://127.0.0.1:8899 com o programa carregado, ou a devnet) com banco em memória: confere que
 * as ofertas ganham número próprio da Solana, que cada evento vira uma linha com `dados` válidos e
 * que um segundo ciclo não grava nada de novo. Pula se PMES_SOLANA_TESTE_RPC não estiver definido.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import type { NovoRegistro } from "../db";
import {
  criarIndexadorPmesSolana,
  decodificarEventoPmes,
  emMoeda,
  FONTE_PMES_SOLANA,
  type NovaOfertaSolana,
  type OfertaSolanaRegistrada,
} from "../pmes-solana";
import { dadosDoPrograma } from "../solana";

const PROGRAMA = "FKefGFhUmgXBM1xCtSFBWpoNnp3wuPJs6Yddpsp67J2y";
let falhas = 0;
function verificar(condicao: boolean, descricao: string) {
  console.log(`${condicao ? "ok  " : "FALHA"} ${descricao}`);
  if (!condicao) falhas++;
}

// ── Parte 1 ──────────────────────────────────────────────────────────────────────

const u64 = (v: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
};
const OFERTA = new PublicKey("5tTbyjnjWSefYSSuLrnpNj7RXFfrt6oB3FddR8cDWSxp");
const INVESTIDOR = new PublicKey("bFc9manVzJ72vdSRu5fgv872KNe4J8aus3wsnknTNY3");

const aporte = Buffer.concat([
  Buffer.from([154, 197, 120, 78, 134, 58, 222, 5]),
  OFERTA.toBuffer(),
  INVESTIDOR.toBuffer(),
  u64(BigInt(120_000_000)),
  u64(BigInt(120_000_000)),
]).toString("base64");

const ev = decodificarEventoPmes(aporte);
verificar(ev?.nome === "Aporte", "Aporte reconhecido pelo discriminador");
verificar(ev?.nome === "Aporte" && ev.investidor === INVESTIDOR.toBase58() && ev.valor === BigInt(120_000_000), "Aporte decodificado (investidor, valor)");
verificar(emMoeda(BigInt(120_000_000)) === "120.0", "120 mBRL → '120.0' (mesmo formato do formatUnits)");
verificar(emMoeda(BigInt(118_800_000)) === "118.8", "118,8 mBRL → '118.8'");
verificar(emMoeda(BigInt(1)) === "0.000001", "menor unidade → '0.000001'");
verificar(decodificarEventoPmes(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9]).toString("base64")) === null, "discriminador desconhecido → null");

const logs = [
  `Program ${PROGRAMA} invoke [1]`,
  `Program data: ${aporte}`,
  "Program Outro11111111111111111111111111111111 invoke [2]",
  `Program data: ${aporte}`,
  "Program Outro11111111111111111111111111111111 success",
  `Program ${PROGRAMA} success`,
];
verificar(dadosDoPrograma(logs, PROGRAMA).length === 1, "evento emitido por outro programa (CPI) é ignorado");

// ── Parte 2 ──────────────────────────────────────────────────────────────────────

async function parteRede(rpcUrl: string) {
  const registros: NovoRegistro[] = [];
  const ofertas: (NovaOfertaSolana & { numero: number })[] = [];
  const checkpoints = new Map<string, number>();
  const banco = {
    async gravarRegistro(r: NovoRegistro) {
      if (!registros.some((x) => x.tx_hash === r.tx_hash && x.log_index === r.log_index)) registros.push(r);
    },
    async lerCheckpoint(fonte: string, fallback: number) {
      return checkpoints.get(fonte) ?? fallback;
    },
    async salvarCheckpoints(fontes: string[], bloco: number) {
      for (const f of fontes) checkpoints.set(f, bloco);
    },
    async carregarOfertasSolana(): Promise<OfertaSolanaRegistrada[]> {
      return ofertas.map((o) => ({ endereco: o.endereco, numero: o.numero, empresa: o.empresa }));
    },
    async registrarOfertaSolana(o: NovaOfertaSolana) {
      const ja = ofertas.find((x) => x.endereco === o.endereco);
      if (ja) return ja.numero;
      const numero = ofertas.length + 1;
      ofertas.push({ ...o, numero });
      return numero;
    },
  };
  const idx = criarIndexadorPmesSolana({
    rpc: new Connection(rpcUrl, { commitment: "finalized" }) as never,
    banco,
    programId: PROGRAMA,
    slotInicial: 0,
    backoff: { tentativas: 3, baseMs: 500, tetoMs: 2000 },
    dormir: (ms) => new Promise((r) => setTimeout(r, ms)),
  });
  await idx.iniciar();
  const r1 = await idx.ciclo();
  console.log(`     ciclo 1: ${r1.transacoes} transação(ões), ${r1.gravados} evento(s); ${ofertas.length} oferta(s)`);
  verificar(r1.transacoes > 0, "ciclo 1 encontrou transações do programa");
  verificar(ofertas.length > 0 && ofertas.every((o, i) => o.numero === i + 1), "ofertas numeradas 1, 2, 3… na Solana");
  verificar(ofertas.every((o) => o.nome !== null && o.simbolo !== null), "nome e símbolo lidos da conta da oferta");
  const criadas = registros.filter((r) => r.tipo_evento === "Oferta criada");
  verificar(criadas.length === ofertas.filter((o) => o.tx_criacao !== null).length, "uma linha 'Oferta criada' por oferta criada dentro da janela");
  verificar(
    registros.every((r) => r.rede === "solana-devnet" && r.bloco === null && typeof r.slot === "number" && r.confirmado && r.dados !== null),
    "toda linha com rede solana-devnet, slot, confirmada e com dados",
  );
  const comNumero = registros.filter((r) => r.dados && (r.dados as { ofertaNumero: number | null }).ofertaNumero !== null);
  verificar(comNumero.length === registros.length, "todo evento aponta para uma oferta numerada");
  for (const r of registros.slice(0, 8)) console.log(`     ${r.tipo_evento}: ${r.descricao}`);
  verificar(checkpoints.get(FONTE_PMES_SOLANA) === idx.checkpoint && idx.checkpoint > 0, "checkpoint salvo com o maior slot");

  const antes = registros.length;
  const r2 = await idx.ciclo();
  verificar(r2.transacoes === 0 && registros.length === antes, "ciclo 2 não grava nada de novo");
}

(async () => {
  const rpc = process.env.PMES_SOLANA_TESTE_RPC;
  if (rpc) await parteRede(rpc);
  else console.log("--   parte 2 pulada (defina PMES_SOLANA_TESTE_RPC para rodar contra um RPC)");
  if (falhas > 0) {
    console.error(`\n${falhas} verificação(ões) falharam`);
    process.exit(1);
  }
  console.log("\npmes-solana: tudo ok");
})();
