import { PublicKey } from "@solana/web3.js";
import type { DadosEvento, DadosOfferingCreated } from "./eventos";
import type { NovoRegistro } from "./db";
import { comBackoff, type OpcoesBackoff } from "./limite";
import { dadosDoPrograma, Leitor } from "./solana";

/**
 * Fonte `pmes-solana`: eventos do programa niara-pmes-solana (Niara-PMEs na Solana devnet,
 * niaragaed/niara-pmes-solana) gravados no MESMO livro do PMEs — registro_transacoes com
 * fonte 'pmes' e rede 'solana-devnet' — e as ofertas em registro_ofertas com rede
 * 'solana-devnet' (numeração própria por rede, migration 010).
 *
 * Mesmo desenho da fonte de assinaturas (solana.ts): laço próprio, commitment "finalized",
 * getSignaturesForAddress até o checkpoint, eventos aceitos só quando emitidos pelo nosso
 * programa (pilha de invoke), checkpoint = maior slot processado, gravação idempotente por
 * (tx_hash, log_index) — aqui log_index é a posição do evento na transação.
 *
 * Os `dados` seguem o mesmo formato das ofertas da Sepolia (eventos.ts): valores como string
 * decimal com as 6 casas do MockBRL SPL, cotas inteiras (0 casas), endereços em base58.
 */

export const FONTE_PMES_SOLANA = "pmes-solana";
export const REDE_PMES_SOLANA = "solana-devnet" as const;
const SIMBOLO_MOEDA = "mBRL";
const CASAS_MOEDA = 6;
const PAGINA = 1000;

// Discriminadores do IDL (niara-pmes-solana/idl/niara_pmes_solana.json).
const DISC = {
  OfertaCriada: [222, 254, 62, 245, 66, 12, 74, 233],
  Aporte: [154, 197, 120, 78, 134, 58, 222, 5],
  OfertaEncerrada: [8, 156, 165, 151, 234, 80, 111, 106],
  OfertaCancelada: [194, 98, 10, 152, 228, 86, 49, 245],
  CotasResgatadas: [135, 207, 249, 5, 245, 173, 16, 162],
  RecursosLiberados: [13, 126, 25, 251, 85, 75, 82, 25],
  Reembolso: [199, 238, 120, 84, 69, 111, 131, 211],
} as const;
const DISC_CONTA_OFERTA = Buffer.from([230, 49, 46, 160, 215, 0, 131, 110]);

type NomeEvento = keyof typeof DISC;

// ── decodificação (Borsh, mesmos layouts de state.rs) ───────────────────────────────────────

const pk = (l: Leitor) => new PublicKey(l.bytes(32)).toBase58();
const u16 = (l: Leitor) => l.bytes(2).readUInt16LE();
const u32 = (l: Leitor) => l.bytes(4).readUInt32LE();
const bool = (l: Leitor) => l.bytes(1)[0] !== 0;

export function emMoeda(v: bigint): string {
  const negativo = v < BigInt(0);
  const abs = negativo ? -v : v;
  const base = BigInt(10) ** BigInt(CASAS_MOEDA);
  const inteiro = abs / base;
  const fracao = (abs % base).toString().padStart(CASAS_MOEDA, "0").replace(/0+$/, "");
  // Mesmo formato do ethers.formatUnits usado na Sepolia ("100.0", "118.8").
  return `${negativo ? "-" : ""}${inteiro}.${fracao || "0"}`;
}

export type EventoPmesSolana =
  | {
      nome: "OfertaCriada";
      oferta: string;
      emissor: string;
      mintCota: string;
      empresa: string;
      serie: string;
      metaMinima: bigint;
      metaMaxima: bigint;
      precoPorCota: bigint;
      prazo: bigint;
      taxaBps: number;
    }
  | { nome: "Aporte"; oferta: string; investidor: string; valor: bigint; totalArrecadado: bigint }
  | { nome: "OfertaEncerrada"; oferta: string; sucesso: boolean; totalArrecadado: bigint }
  | { nome: "OfertaCancelada"; oferta: string }
  | { nome: "CotasResgatadas"; oferta: string; investidor: string; cotas: bigint }
  | { nome: "RecursosLiberados"; oferta: string; emissor: string; valorEmissor: bigint; protocolo: string; taxa: bigint }
  | { nome: "Reembolso"; oferta: string; investidor: string; valor: bigint };

export function decodificarEventoPmes(base64: string): EventoPmesSolana | null {
  const buf = Buffer.from(base64, "base64");
  if (buf.length < 8) return null;
  const disc = buf.subarray(0, 8);
  const nome = (Object.keys(DISC) as NomeEvento[]).find((n) => disc.equals(Buffer.from(DISC[n])));
  if (!nome) return null;
  try {
    const l = new Leitor(buf.subarray(8));
    switch (nome) {
      case "OfertaCriada": {
        const oferta = pk(l);
        const emissor = pk(l);
        const mintCota = pk(l);
        const empresa = l.string();
        l.bytes(32); // cnpj_ref
        const serie = l.string();
        return {
          nome,
          oferta,
          emissor,
          mintCota,
          empresa,
          serie,
          metaMinima: l.u64(),
          metaMaxima: l.u64(),
          precoPorCota: l.u64(),
          prazo: l.i64(),
          taxaBps: u16(l),
        };
      }
      case "Aporte":
        return { nome, oferta: pk(l), investidor: pk(l), valor: l.u64(), totalArrecadado: l.u64() };
      case "OfertaEncerrada":
        return { nome, oferta: pk(l), sucesso: bool(l), totalArrecadado: l.u64() };
      case "OfertaCancelada":
        return { nome, oferta: pk(l) };
      case "CotasResgatadas":
        return { nome, oferta: pk(l), investidor: pk(l), cotas: l.u64() };
      case "RecursosLiberados":
        return { nome, oferta: pk(l), emissor: pk(l), valorEmissor: l.u64(), protocolo: pk(l), taxa: l.u64() };
      case "Reembolso":
        return { nome, oferta: pk(l), investidor: pk(l), valor: l.u64() };
    }
  } catch {
    return null;
  }
}

/** Início da conta da oferta (state.rs): o que o livro precisa para catalogá-la. */
export type ContaOfertaResumo = { emissor: string; mintCota: string; nome: string; simbolo: string; empresa: string };

export function decodificarContaOferta(dados: Buffer): ContaOfertaResumo | null {
  if (dados.length < 8 || !dados.subarray(0, 8).equals(DISC_CONTA_OFERTA)) return null;
  try {
    const l = new Leitor(dados.subarray(8));
    const emissor = pk(l);
    u32(l); // indice
    const mintCota = pk(l);
    l.bytes(32); // cofre
    return { emissor, mintCota, nome: l.string(), simbolo: l.string(), empresa: l.string() };
  } catch {
    return null;
  }
}

// ── laço ────────────────────────────────────────────────────────────────────────────────────

export type RpcPmesSolana = {
  getSignaturesForAddress(
    endereco: PublicKey,
    opcoes: { before?: string; limit: number },
    commitment: "finalized",
  ): Promise<{ signature: string; slot: number; err: unknown }[]>;
  getTransaction(
    assinatura: string,
    opcoes: { commitment: "finalized"; maxSupportedTransactionVersion: 0 },
  ): Promise<{ slot: number; blockTime?: number | null; meta: { err: unknown; logMessages?: string[] | null } | null } | null>;
  getAccountInfo(endereco: PublicKey, commitment: "finalized"): Promise<{ owner: PublicKey; data: Buffer } | null>;
};

export type OfertaSolanaRegistrada = { endereco: string; numero: number; empresa: string | null };

export type NovaOfertaSolana = {
  endereco: string;
  token: string;
  emissor: string;
  moeda: string;
  nome: string | null;
  simbolo: string | null;
  empresa: string | null;
  bloco_criacao: number;
  criada_em: string;
  /** null quando a oferta foi catalogada a partir de um evento posterior (ver garantirOferta). */
  tx_criacao: string | null;
};

export type BancoPmesSolana = {
  gravarRegistro(registro: NovoRegistro): Promise<void>;
  lerCheckpoint(fonte: string, fallback: number): Promise<number>;
  salvarCheckpoints(fontes: string[], bloco: number): Promise<void>;
  /** Ofertas da Solana já registradas (rede = 'solana-devnet'). */
  carregarOfertasSolana(): Promise<OfertaSolanaRegistrada[]>;
  /** Grava (idempotente por endereço) e devolve o número atribuído. */
  registrarOfertaSolana(oferta: NovaOfertaSolana): Promise<number>;
};

function enderecoCurto(e: string) {
  return `${e.slice(0, 4)}...${e.slice(-4)}`;
}

export function criarIndexadorPmesSolana(deps: {
  rpc: RpcPmesSolana;
  banco: BancoPmesSolana;
  programId: string;
  /** Mint do MockBRL do programa (PDA ["mbrl"]) — gravado como `moeda` da oferta. */
  mintMoeda?: string;
  slotInicial: number;
  backoff: Omit<OpcoesBackoff, "dormir">;
  dormir: (ms: number) => Promise<void>;
}) {
  const { rpc, banco } = deps;
  const programa = new PublicKey(deps.programId);
  const mintMoeda =
    deps.mintMoeda ?? PublicKey.findProgramAddressSync([Buffer.from("mbrl")], programa)[0].toBase58();
  const opcoes: OpcoesBackoff = { ...deps.backoff, dormir: deps.dormir };
  const rede = <T,>(fn: () => Promise<T>, contexto: string) => comBackoff(fn, `pmes-solana: ${contexto}`, opcoes);

  let checkpoint = 0;
  const ofertas = new Map<string, OfertaSolanaRegistrada>();

  async function iniciar(): Promise<void> {
    checkpoint = await banco.lerCheckpoint(FONTE_PMES_SOLANA, deps.slotInicial);
    for (const o of await banco.carregarOfertasSolana()) ofertas.set(o.endereco, o);
  }

  async function novasAssinaturas() {
    const novas: { signature: string; slot: number; err: unknown }[] = [];
    let before: string | undefined;
    for (;;) {
      const pagina = await rede(() => rpc.getSignaturesForAddress(programa, { before, limit: PAGINA }, "finalized"), "getSignaturesForAddress");
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

  async function lerConta(endereco: string): Promise<ContaOfertaResumo | null> {
    const conta = await rede(() => rpc.getAccountInfo(new PublicKey(endereco), "finalized"), `getAccountInfo ${endereco.slice(0, 8)}`);
    return conta && conta.owner.equals(programa) ? decodificarContaOferta(Buffer.from(conta.data)) : null;
  }

  async function registrar(endereco: string, dados: Omit<NovaOfertaSolana, "endereco" | "moeda">) {
    const numero = await banco.registrarOfertaSolana({ endereco, moeda: mintMoeda, ...dados });
    const registrada = { endereco, numero, empresa: dados.empresa };
    ofertas.set(endereco, registrada);
    return registrada;
  }

  async function registrarCriacao(ev: Extract<EventoPmesSolana, { nome: "OfertaCriada" }>, assinatura: string, slot: number, quando: string) {
    const existente = ofertas.get(ev.oferta);
    if (existente) return existente;
    const meta = await lerConta(ev.oferta);
    return registrar(ev.oferta, {
      token: ev.mintCota,
      emissor: ev.emissor,
      nome: meta?.nome ?? null,
      simbolo: meta?.simbolo ?? null,
      empresa: ev.empresa || null,
      bloco_criacao: slot,
      criada_em: quando,
      tx_criacao: assinatura,
    });
  }

  /**
   * Evento de uma oferta cuja criação o livro não viu (ex.: criada antes do slot inicial
   * configurado, ou histórico podado pelo RPC): cataloga a oferta a partir da própria conta na
   * rede, só se o dono for o programa. Sem conta válida, o evento fica sem número (a exibição
   * mostra só o endereço).
   */
  async function garantirOferta(endereco: string, slot: number, quando: string) {
    const existente = ofertas.get(endereco);
    if (existente) return existente;
    const conta = await lerConta(endereco);
    if (!conta) return undefined;
    return registrar(endereco, {
      token: conta.mintCota,
      emissor: conta.emissor,
      nome: conta.nome,
      simbolo: conta.simbolo,
      empresa: conta.empresa || null,
      bloco_criacao: slot,
      criada_em: quando,
      tx_criacao: null,
    });
  }

  function montar(ev: EventoPmesSolana, oferta: OfertaSolanaRegistrada | undefined): { tipo: string; descricao: string; dados: DadosEvento } {
    const base = { ofertaNumero: oferta?.numero ?? null, ofertaEndereco: ev.oferta };
    const apelido = `oferta-solana-${oferta?.numero ?? "?"} (${enderecoCurto(ev.oferta)})`;
    switch (ev.nome) {
      case "OfertaCriada": {
        const dados: DadosOfferingCreated = {
          ...base,
          evento: "offering_created",
          emissor: ev.emissor,
          token: ev.mintCota,
          metaMinima: emMoeda(ev.metaMinima),
          metaMaxima: emMoeda(ev.metaMaxima),
          precoPorCota: emMoeda(ev.precoPorCota),
          prazo: ev.prazo.toString(),
          moeda: SIMBOLO_MOEDA,
        };
        return {
          tipo: "Oferta criada",
          descricao: `${apelido} — criada pelo emissor ${enderecoCurto(ev.emissor)}${ev.empresa ? ` (${ev.empresa})` : ""}, meta ${dados.metaMinima}–${dados.metaMaxima} ${SIMBOLO_MOEDA}, ${dados.precoPorCota} ${SIMBOLO_MOEDA} por cota`,
          dados,
        };
      }
      case "Aporte":
        return {
          tipo: "Aporte",
          descricao: `${apelido} — investidor ${enderecoCurto(ev.investidor)} aportou ${emMoeda(ev.valor)} ${SIMBOLO_MOEDA}`,
          dados: { ...base, evento: "investment", investidor: ev.investidor, valor: emMoeda(ev.valor), moeda: SIMBOLO_MOEDA, totalArrecadadoAtual: emMoeda(ev.totalArrecadado) },
        };
      case "OfertaEncerrada":
        return {
          tipo: "Oferta encerrada",
          descricao: `${apelido} — encerrada (${ev.sucesso ? "EncerradaSucesso" : "EncerradaFalha"}), total arrecadado ${emMoeda(ev.totalArrecadado)} ${SIMBOLO_MOEDA}`,
          dados: { ...base, evento: "offering_closed", desfecho: ev.sucesso ? "success" : "failure", totalArrecadado: emMoeda(ev.totalArrecadado), moeda: SIMBOLO_MOEDA },
        };
      case "OfertaCancelada":
        return { tipo: "Oferta cancelada", descricao: `${apelido} — oferta cancelada`, dados: { ...base, evento: "offering_cancelled" } };
      case "CotasResgatadas":
        return {
          tipo: "Resgate de cotas",
          descricao: `${apelido} — investidor ${enderecoCurto(ev.investidor)} resgatou ${ev.cotas} cotas`,
          dados: { ...base, evento: "shares_redeemed", investidor: ev.investidor, cotas: ev.cotas.toString() },
        };
      case "RecursosLiberados":
        return {
          tipo: "Recursos liberados",
          descricao: `${apelido} — ${emMoeda(ev.valorEmissor)} ${SIMBOLO_MOEDA} liberados ao emissor`,
          dados: {
            ...base,
            evento: "funds_released",
            emissor: ev.emissor,
            valorEmissor: emMoeda(ev.valorEmissor),
            protocolo: ev.protocolo,
            taxa: emMoeda(ev.taxa),
            moeda: SIMBOLO_MOEDA,
          },
        };
      case "Reembolso":
        return {
          tipo: "Reembolso",
          descricao: `${apelido} — investidor ${enderecoCurto(ev.investidor)} reembolsado em ${emMoeda(ev.valor)} ${SIMBOLO_MOEDA}`,
          dados: { ...base, evento: "refund", investidor: ev.investidor, valor: emMoeda(ev.valor), moeda: SIMBOLO_MOEDA },
        };
    }
  }

  async function processarTransacao(assinatura: string, slotTx: number): Promise<number> {
    const tx = await rede(
      () => rpc.getTransaction(assinatura, { commitment: "finalized", maxSupportedTransactionVersion: 0 }),
      `getTransaction ${assinatura.slice(0, 8)}`,
    );
    // Transação listada mas não devolvida (nó do RPC atrasado/balanceado): lança para o ciclo
    // inteiro repetir SEM avançar o checkpoint — nunca pular um evento em silêncio. Só a
    // transação que falhou on-chain (meta.err) é pulada de propósito.
    if (!tx?.meta) throw new Error(`getTransaction ${assinatura} ainda não disponível no RPC`);
    if (tx.meta.err) return 0;
    const slot = tx.slot ?? slotTx;
    const quando = new Date((tx.blockTime ?? Math.floor(Date.now() / 1000)) * 1000).toISOString();

    let gravados = 0;
    const payloads = dadosDoPrograma(tx.meta.logMessages ?? [], deps.programId);
    for (const [indice, base64] of payloads.entries()) {
      const ev = decodificarEventoPmes(base64);
      if (!ev) continue; // EmissorDefinido, QualificacaoAlterada, OfertaPausadaAlterada: administrativos, fora do livro
      const oferta =
        ev.nome === "OfertaCriada" ? await registrarCriacao(ev, assinatura, slot, quando) : await garantirOferta(ev.oferta, slot, quando);
      const { tipo, descricao, dados } = montar(ev, oferta);
      await banco.gravarRegistro({
        fonte: "pmes",
        rede: REDE_PMES_SOLANA,
        tipo_evento: tipo,
        descricao,
        tx_hash: assinatura,
        log_index: indice,
        endereco_contrato: deps.programId,
        bloco: null,
        slot,
        ocorrido_em: quando,
        // commitment "finalized": o livro só recebe o que não pode mais ser revertido.
        confirmado: true,
        dados,
      });
      gravados++;
      console.log(`[indexer] pmes-solana: ${tipo} — ${descricao} — slot ${slot} — ${assinatura}`);
    }
    return gravados;
  }

  /** Um ciclo completo. Lança em erro; o checkpoint só avança se tudo deu certo. */
  async function ciclo(): Promise<{ transacoes: number; gravados: number }> {
    const novas = await novasAssinaturas();
    let gravados = 0;
    for (const s of novas) {
      if (s.err) continue;
      gravados += await processarTransacao(s.signature, s.slot);
    }
    if (novas.length > 0) {
      const maiorSlot = Math.max(...novas.map((s) => s.slot));
      await banco.salvarCheckpoints([FONTE_PMES_SOLANA], maiorSlot);
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
    get ofertas() {
      return ofertas;
    },
  };
}
