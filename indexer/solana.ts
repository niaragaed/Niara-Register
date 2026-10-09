import { PublicKey } from "@solana/web3.js";
import type { NovaAssinatura } from "./db";
import { comBackoff, type OpcoesBackoff } from "./limite";

/**
 * Fonte `solana-assinaturas`: registros do programa niara-register-solana
 * (Anchor) na Solana devnet, gravados na MESMA tabela registro_assinaturas que
 * a Sepolia, com rede = 'solana-devnet'.
 *
 * Roda num laço próprio, independente do lote EVM (indexador.ts): erro ou
 * lentidão de um RPC nunca atrasa o outro.
 *
 * Cada ciclo:
 * 1. Lista as assinaturas de transação que tocam o programa
 *    (getSignaturesForAddress, da mais nova para a mais antiga), até chegar ao
 *    slot do checkpoint.
 * 2. Da mais antiga para a mais nova, para cada transação bem-sucedida, lê os
 *    logs e extrai o evento DocumentoRegistrado — só quando quem emitiu o
 *    "Program data:" foi o NOSSO programa (pilha de invoke), para que outro
 *    programa não consiga forjar uma linha no livro só citando nosso endereço.
 * 3. Confere o evento contra a conta PDA ["assinatura", hash] on-chain e grava
 *    o que está NA CONTA (fonte de verdade), não o que veio no log.
 * 4. Salva o checkpoint = maior slot processado.
 *
 * Gravação idempotente por (rede, hash_sha256): reprocessar um slot não duplica.
 * Commitment "finalized": o livro só mostra o que não pode mais ser revertido.
 */

export const FONTE_SOLANA = "solana-assinaturas";
export const REDE_SOLANA = "solana-devnet" as const;

const SEED_ASSINATURA = Buffer.from("assinatura");
// Discriminadores do IDL do programa (target/idl/niara_register_solana.json).
const DISC_EVENTO = Buffer.from([206, 226, 126, 15, 74, 52, 33, 1]);
const DISC_CONTA = Buffer.from([68, 120, 123, 196, 84, 89, 85, 188]);

const PAGINA = 1000; // máximo do getSignaturesForAddress

// ── decodificação (Borsh) ────────────────────────────────────────────────────────

class Leitor {
  private pos = 0;
  constructor(private readonly buf: Buffer) {}
  bytes(n: number): Buffer {
    if (this.pos + n > this.buf.length) throw new Error("dados truncados");
    const fatia = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return fatia;
  }
  i64(): bigint {
    return this.bytes(8).readBigInt64LE();
  }
  u64(): bigint {
    return this.bytes(8).readBigUInt64LE();
  }
  string(): string {
    const tamanho = this.bytes(4).readUInt32LE();
    return this.bytes(tamanho).toString("utf8");
  }
}

export type DocumentoSolana = {
  hashHex: string; // 64 caracteres, minúsculo, sem 0x
  assinante: string; // base58
  nomeDocumento: string;
  tipoDocumento: string;
  timestamp: number; // unix, segundos
  slot: number;
};

/** Evento DocumentoRegistrado a partir do payload de "Program data:" (base64). */
export function decodificarEvento(base64: string): DocumentoSolana | null {
  const buf = Buffer.from(base64, "base64");
  if (buf.length < 8 || !buf.subarray(0, 8).equals(DISC_EVENTO)) return null;
  try {
    const l = new Leitor(buf.subarray(8));
    const hash = l.bytes(32);
    const assinante = new PublicKey(l.bytes(32)).toBase58();
    const nomeDocumento = l.string();
    const tipoDocumento = l.string();
    const timestamp = Number(l.i64());
    const slot = Number(l.u64());
    return { hashHex: hash.toString("hex"), assinante, nomeDocumento, tipoDocumento, timestamp, slot };
  } catch {
    return null;
  }
}

/** Conta Assinatura (PDA). Mesmo layout de state.rs. */
export function decodificarConta(dados: Buffer): DocumentoSolana | null {
  if (dados.length < 8 || !dados.subarray(0, 8).equals(DISC_CONTA)) return null;
  try {
    const l = new Leitor(dados.subarray(8));
    const assinante = new PublicKey(l.bytes(32)).toBase58();
    const hash = l.bytes(32);
    const timestamp = Number(l.i64());
    const slot = Number(l.u64());
    const nomeDocumento = l.string();
    const tipoDocumento = l.string();
    return { hashHex: hash.toString("hex"), assinante, nomeDocumento, tipoDocumento, timestamp, slot };
  } catch {
    return null;
  }
}

/**
 * Eventos do nosso programa nos logs de uma transação. Acompanha a pilha de
 * invoke/success/failed para atribuir cada "Program data:" ao programa que
 * estava executando naquele momento.
 */
export function extrairEventos(logs: string[], programId: string): DocumentoSolana[] {
  const pilha: string[] = [];
  const eventos: DocumentoSolana[] = [];
  for (const linha of logs) {
    const invoke = /^Program (\S+) invoke \[\d+\]$/.exec(linha);
    if (invoke) {
      pilha.push(invoke[1]);
      continue;
    }
    if (/^Program \S+ (success|failed)/.test(linha)) {
      pilha.pop();
      continue;
    }
    if (linha.startsWith("Program data: ") && pilha[pilha.length - 1] === programId) {
      const evento = decodificarEvento(linha.slice("Program data: ".length).trim());
      if (evento) eventos.push(evento);
    }
  }
  return eventos;
}

export function enderecoDoRegistro(hashHex: string, programa: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [SEED_ASSINATURA, Buffer.from(hashHex, "hex")],
    programa,
  )[0];
}

// ── laço ─────────────────────────────────────────────────────────────────────────

/** O pedaço do Connection do @solana/web3.js que esta fonte usa (injetável em teste). */
export type RpcSolana = {
  getSignaturesForAddress(
    endereco: PublicKey,
    opcoes: { before?: string; limit: number },
    commitment: "finalized",
  ): Promise<{ signature: string; slot: number; err: unknown }[]>;
  getTransaction(
    assinatura: string,
    opcoes: { commitment: "finalized"; maxSupportedTransactionVersion: 0 },
  ): Promise<{ meta: { err: unknown; logMessages?: string[] | null } | null } | null>;
  getAccountInfo(endereco: PublicKey, commitment: "finalized"): Promise<{ owner: PublicKey; data: Buffer } | null>;
};

export type BancoSolana = {
  gravarAssinatura(assinatura: NovaAssinatura): Promise<void>;
  lerCheckpoint(fonte: string, fallback: number): Promise<number>;
  salvarCheckpoints(fontes: string[], bloco: number): Promise<void>;
};

export function criarIndexadorSolana(deps: {
  rpc: RpcSolana;
  banco: BancoSolana;
  programId: string;
  slotInicial: number;
  backoff: Omit<OpcoesBackoff, "dormir">;
  dormir: (ms: number) => Promise<void>;
}) {
  const { rpc, banco } = deps;
  const programa = new PublicKey(deps.programId);
  const opcoes: OpcoesBackoff = { ...deps.backoff, dormir: deps.dormir };
  const rede = <T,>(fn: () => Promise<T>, contexto: string) =>
    comBackoff(fn, `solana: ${contexto}`, opcoes);

  let checkpoint = 0;

  async function iniciar(): Promise<void> {
    checkpoint = await banco.lerCheckpoint(FONTE_SOLANA, deps.slotInicial);
  }

  /** Assinaturas com slot > checkpoint, da mais antiga para a mais nova. */
  async function novasAssinaturas() {
    const novas: { signature: string; slot: number; err: unknown }[] = [];
    let before: string | undefined;
    for (;;) {
      const pagina = await rede(
        () => rpc.getSignaturesForAddress(programa, { before, limit: PAGINA }, "finalized"),
        "getSignaturesForAddress",
      );
      let chegou = false;
      for (const s of pagina) {
        if (s.slot <= checkpoint) {
          chegou = true;
          break;
        }
        novas.push(s);
      }
      if (chegou || pagina.length < PAGINA) break;
      before = pagina[pagina.length - 1].signature;
    }
    return novas.reverse();
  }

  async function processarTransacao(assinatura: string, slotTx: number): Promise<number> {
    const tx = await rede(
      () => rpc.getTransaction(assinatura, { commitment: "finalized", maxSupportedTransactionVersion: 0 }),
      `getTransaction ${assinatura.slice(0, 8)}`,
    );
    if (!tx?.meta || tx.meta.err) return 0;

    const eventos = extrairEventos(tx.meta.logMessages ?? [], deps.programId);
    let gravados = 0;
    for (const [indice, evento] of eventos.entries()) {
      const pda = enderecoDoRegistro(evento.hashHex, programa);
      const conta = await rede(() => rpc.getAccountInfo(pda, "finalized"), `getAccountInfo ${pda.toBase58().slice(0, 8)}`);
      const doc = conta && conta.owner.equals(programa) ? decodificarConta(Buffer.from(conta.data)) : null;

      // A conta é a fonte de verdade. Se não bate com o evento, não grava.
      if (!doc || doc.hashHex !== evento.hashHex || doc.assinante !== evento.assinante || doc.timestamp !== evento.timestamp) {
        console.warn(
          `[indexer] solana: evento em ${assinatura} não confere com a conta ${pda.toBase58()} — ignorado`,
        );
        continue;
      }

      await banco.gravarAssinatura({
        rede: REDE_SOLANA,
        documento_nome: doc.nomeDocumento,
        tipo_documento: doc.tipoDocumento,
        hash_sha256: `0x${doc.hashHex}`,
        assinante_endereco: doc.assinante,
        tx_hash: assinatura,
        log_index: indice,
        endereco_contrato: deps.programId,
        bloco: null,
        slot: doc.slot || slotTx,
        assinado_em: new Date(doc.timestamp * 1000).toISOString(),
        status: "assinado_onchain",
      });
      gravados++;
      console.log(
        `[indexer] solana: Documento registrado — "${doc.nomeDocumento}" (${doc.tipoDocumento}) — assinante ${doc.assinante.slice(0, 4)}...${doc.assinante.slice(-4)} — slot ${doc.slot} — ${assinatura}`,
      );
    }
    return gravados;
  }

  /** Um ciclo completo. Lança em erro; o checkpoint só avança se tudo deu certo. */
  async function ciclo(): Promise<{ transacoes: number; gravados: number }> {
    const novas = await novasAssinaturas();
    let gravados = 0;
    for (const s of novas) {
      if (s.err) continue; // transação que falhou on-chain não registrou nada
      gravados += await processarTransacao(s.signature, s.slot);
    }
    if (novas.length > 0) {
      const maiorSlot = Math.max(...novas.map((s) => s.slot));
      await banco.salvarCheckpoints([FONTE_SOLANA], maiorSlot);
      checkpoint = maiorSlot;
    }
    return { transacoes: novas.length, gravados };
  }

  return {
    iniciar,
    ciclo,
    get checkpoint() {
      return checkpoint;
    },
  };
}
