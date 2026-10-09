/**
 * Teste da fonte Solana (solana.ts).
 *
 * Parte 1 (offline): decodificação e atribuição de eventos pela pilha de
 * invoke — um "Program data:" emitido por OUTRO programa não pode virar linha
 * no livro, mesmo com o nosso discriminador.
 *
 * Parte 2 (rede, opcional): roda um ciclo contra a devnet de verdade com banco
 * em memória e confere que os registros reais do programa são lidos e que um
 * segundo ciclo não grava nada de novo. Pula se SOLANA_TESTE_REDE=0.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import type { NovaAssinatura } from "../db";
import {
  criarIndexadorSolana,
  decodificarConta,
  enderecoDoRegistro,
  extrairEventos,
  FONTE_SOLANA,
} from "../solana";

const PROGRAMA = "9RPHqLouFjoUbPdcmA1GyHMeDoWvjZMuCyYFPBWLmTcR";
let falhas = 0;
function verificar(condicao: boolean, descricao: string) {
  console.log(`${condicao ? "ok  " : "FALHA"} ${descricao}`);
  if (!condicao) falhas++;
}

// ── Parte 1 ──────────────────────────────────────────────────────────────────────

function payloadEvento(): string {
  const partes: Buffer[] = [
    Buffer.from([206, 226, 126, 15, 74, 52, 33, 1]),
    Buffer.alloc(32, 7), // hash
    new PublicKey(PROGRAMA).toBuffer(), // assinante qualquer
  ];
  for (const t of ["Ata de sócios", "ata"]) {
    const b = Buffer.from(t, "utf8");
    const len = Buffer.alloc(4);
    len.writeUInt32LE(b.length);
    partes.push(len, b);
  }
  const ts = Buffer.alloc(8);
  ts.writeBigInt64LE(1791496391n);
  const slot = Buffer.alloc(8);
  slot.writeBigUInt64LE(586n);
  partes.push(ts, slot);
  return Buffer.concat(partes).toString("base64");
}

const dados = payloadEvento();
const OUTRO = "Fake111111111111111111111111111111111111111";

const legitimo = extrairEventos(
  [
    `Program ${PROGRAMA} invoke [1]`,
    "Program log: Instruction: Registrar",
    "Program 11111111111111111111111111111111 invoke [2]",
    "Program 11111111111111111111111111111111 success",
    `Program data: ${dados}`,
    `Program ${PROGRAMA} consumed 12345 of 200000 compute units`,
    `Program ${PROGRAMA} success`,
  ],
  PROGRAMA,
);
verificar(legitimo.length === 1, "evento emitido pelo nosso programa é extraído");
verificar(legitimo[0]?.nomeDocumento === "Ata de sócios" && legitimo[0]?.tipoDocumento === "ata", "nome/tipo UTF-8 decodificados");
verificar(legitimo[0]?.timestamp === 1791496391 && legitimo[0]?.slot === 586, "timestamp e slot decodificados");
verificar(legitimo[0]?.hashHex === "07".repeat(32), "hash em hex minúsculo");

const forjado = extrairEventos(
  [
    `Program ${OUTRO} invoke [1]`,
    `Program data: ${dados}`,
    `Program ${OUTRO} success`,
  ],
  PROGRAMA,
);
verificar(forjado.length === 0, "evento com nosso discriminador emitido por OUTRO programa é ignorado");

const aninhado = extrairEventos(
  [
    `Program ${OUTRO} invoke [1]`,
    `Program ${PROGRAMA} invoke [2]`,
    `Program data: ${dados}`,
    `Program ${PROGRAMA} success`,
    `Program data: ${dados}`,
    `Program ${OUTRO} success`,
  ],
  PROGRAMA,
);
verificar(aninhado.length === 1, "CPI: só o evento dentro do frame do nosso programa conta");

verificar(extrairEventos([`Program ${PROGRAMA} invoke [1]`, "Program data: AAAA", `Program ${PROGRAMA} success`], PROGRAMA).length === 0, "payload curto/estranho é ignorado sem lançar");
verificar(decodificarConta(Buffer.alloc(10)) === null, "conta com discriminador errado → null");

// ── Parte 2 ──────────────────────────────────────────────────────────────────────

async function parteRede() {
  if (process.env.SOLANA_TESTE_REDE === "0") {
    console.log("(parte de rede pulada)");
    return;
  }
  const conexao = new Connection(process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com", {
    commitment: "finalized",
    disableRetryOnRateLimit: true,
  });
  const gravadas = new Map<string, NovaAssinatura>();
  let tentativas = 0;
  const checkpoints = new Map<string, number>();
  const banco = {
    async gravarAssinatura(a: NovaAssinatura) {
      tentativas++;
      const chave = `${a.rede}|${a.hash_sha256}`;
      if (!gravadas.has(chave)) gravadas.set(chave, a);
    },
    lerCheckpoint: async (f: string, fallback: number) => checkpoints.get(f) ?? fallback,
    async salvarCheckpoints(fontes: string[], bloco: number) {
      for (const f of fontes) checkpoints.set(f, bloco);
    },
  };
  const idx = criarIndexadorSolana({
    rpc: conexao as never,
    banco,
    programId: PROGRAMA,
    slotInicial: 509235000,
    backoff: { tentativas: 6, baseMs: 1000, tetoMs: 30000 },
    dormir: (ms) => new Promise((r) => setTimeout(r, ms)),
  });
  await idx.iniciar();
  const r1 = await idx.ciclo();
  console.log(`  devnet: ${r1.transacoes} transação(ões), ${r1.gravados} gravado(s), checkpoint ${idx.checkpoint}`);
  for (const a of gravadas.values()) console.log(`   - ${a.documento_nome} · ${a.tipo_documento} · ${a.assinante_endereco} · ${a.assinado_em} · ${a.tx_hash.slice(0, 12)}…`);
  verificar(r1.gravados >= 1, "ciclo real na devnet grava ao menos 1 documento");
  verificar([...gravadas.values()].every((a) => a.rede === "solana-devnet" && /^0x[0-9a-f]{64}$/.test(a.hash_sha256)), "rede e formato do hash corretos");
  verificar(checkpoints.get(FONTE_SOLANA) === idx.checkpoint && idx.checkpoint > 509235000, "checkpoint salvo com o maior slot");
  for (const a of gravadas.values()) {
    const pda = enderecoDoRegistro(a.hash_sha256.slice(2), new PublicKey(PROGRAMA));
    const conta = await conexao.getAccountInfo(pda, "finalized");
    const doc = conta ? decodificarConta(Buffer.from(conta.data)) : null;
    verificar(doc?.assinante === a.assinante_endereco && doc?.nomeDocumento === a.documento_nome, `linha "${a.documento_nome}" bate com a conta PDA on-chain`);
  }
  const antes = tentativas;
  const r2 = await idx.ciclo();
  verificar(r2.transacoes === 0 && tentativas === antes, "segundo ciclo sem novidades não regrava nada");
}

parteRede()
  .catch((e) => {
    console.error(e);
    falhas++;
  })
  .finally(() => {
    console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} FALHA(S)`);
    process.exit(falhas === 0 ? 0 : 1);
  });
