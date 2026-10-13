import { PublicKey } from "@solana/web3.js";
import type { EventData, OfferingCreatedData } from "./events";
import type { NewLedgerEntry } from "./db";
import { withBackoff, type BackoffOptions } from "./rate-limit";
import { programDataPayloads, BorshReader } from "./solana";

/**
 * Source `pmes-solana`: events from the niara-pmes-solana program (Niara-PMEs
 * on Solana devnet, niaragaed/niara-pmes-solana) written to the SAME PMEs
 * ledger (registro_transacoes with fonte 'pmes' and rede 'solana-devnet'), and
 * the offerings to registro_ofertas with rede 'solana-devnet' (each network
 * has its own numbering, migration 010).
 *
 * Same design as the signatures source (solana.ts): its own loop, commitment
 * "finalized", getSignaturesForAddress down to the checkpoint, events accepted
 * only when emitted by our program (invoke stack), checkpoint = highest
 * processed slot, idempotent writes by (tx_hash, log_index) (here log_index is
 * the event's position in the transaction).
 *
 * The `dados` follow the same format as the Sepolia offerings (events.ts):
 * amounts as decimal strings with the SPL MockBRL's 6 decimals, whole shares
 * (0 decimals), addresses in base58.
 *
 * Decoded event fields keep their on-chain names (oferta, emissor, mintCota,
 * ...), like `parsed.args` on the EVM side. `tipo_evento` and `descricao` are
 * stored in Portuguese, as in indexer.ts.
 */

// Stored values (checkpoint source and network): they stay as they are.
export const SOURCE_PMES_SOLANA = "pmes-solana";
export const PMES_SOLANA_NETWORK = "solana-devnet" as const;
const CURRENCY_SYMBOL = "mBRL";
const CURRENCY_DECIMALS = 6;
const PAGE_SIZE = 1000;

// IDL discriminators (niara-pmes-solana/idl/niara_pmes_solana.json), keyed by
// on-chain event name.
const DISC = {
  OfertaCriada: [222, 254, 62, 245, 66, 12, 74, 233],
  Aporte: [154, 197, 120, 78, 134, 58, 222, 5],
  OfertaEncerrada: [8, 156, 165, 151, 234, 80, 111, 106],
  OfertaCancelada: [194, 98, 10, 152, 228, 86, 49, 245],
  CotasResgatadas: [135, 207, 249, 5, 245, 173, 16, 162],
  RecursosLiberados: [13, 126, 25, 251, 85, 75, 82, 25],
  Reembolso: [199, 238, 120, 84, 69, 111, 131, 211],
} as const;
const OFFERING_ACCOUNT_DISC = Buffer.from([230, 49, 46, 160, 215, 0, 131, 110]);

type EventName = keyof typeof DISC;

// ── decoding (Borsh, same layouts as state.rs) ───────────────────────────────────

const pk = (r: BorshReader) => new PublicKey(r.bytes(32)).toBase58();
const u16 = (r: BorshReader) => r.bytes(2).readUInt16LE();
const u32 = (r: BorshReader) => r.bytes(4).readUInt32LE();
const bool = (r: BorshReader) => r.bytes(1)[0] !== 0;

export function formatCurrency(v: bigint): string {
  const negative = v < BigInt(0);
  const abs = negative ? -v : v;
  const base = BigInt(10) ** BigInt(CURRENCY_DECIMALS);
  const whole = abs / base;
  const fraction = (abs % base).toString().padStart(CURRENCY_DECIMALS, "0").replace(/0+$/, "");
  // Same format as the ethers.formatUnits used on Sepolia ("100.0", "118.8").
  return `${negative ? "-" : ""}${whole}.${fraction || "0"}`;
}

export type PmesSolanaEvent =
  | {
      name: "OfertaCriada";
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
  | { name: "Aporte"; oferta: string; investidor: string; valor: bigint; totalArrecadado: bigint }
  | { name: "OfertaEncerrada"; oferta: string; sucesso: boolean; totalArrecadado: bigint }
  | { name: "OfertaCancelada"; oferta: string }
  | { name: "CotasResgatadas"; oferta: string; investidor: string; cotas: bigint }
  | { name: "RecursosLiberados"; oferta: string; emissor: string; valorEmissor: bigint; protocolo: string; taxa: bigint }
  | { name: "Reembolso"; oferta: string; investidor: string; valor: bigint };

export function decodePmesEvent(base64: string): PmesSolanaEvent | null {
  const buf = Buffer.from(base64, "base64");
  if (buf.length < 8) return null;
  const disc = buf.subarray(0, 8);
  const name = (Object.keys(DISC) as EventName[]).find((n) => disc.equals(Buffer.from(DISC[n])));
  if (!name) return null;
  try {
    const r = new BorshReader(buf.subarray(8));
    switch (name) {
      case "OfertaCriada": {
        const oferta = pk(r);
        const emissor = pk(r);
        const mintCota = pk(r);
        const empresa = r.string();
        r.bytes(32); // cnpj_ref
        const serie = r.string();
        return {
          name,
          oferta,
          emissor,
          mintCota,
          empresa,
          serie,
          metaMinima: r.u64(),
          metaMaxima: r.u64(),
          precoPorCota: r.u64(),
          prazo: r.i64(),
          taxaBps: u16(r),
        };
      }
      case "Aporte":
        return { name, oferta: pk(r), investidor: pk(r), valor: r.u64(), totalArrecadado: r.u64() };
      case "OfertaEncerrada":
        return { name, oferta: pk(r), sucesso: bool(r), totalArrecadado: r.u64() };
      case "OfertaCancelada":
        return { name, oferta: pk(r) };
      case "CotasResgatadas":
        return { name, oferta: pk(r), investidor: pk(r), cotas: r.u64() };
      case "RecursosLiberados":
        return { name, oferta: pk(r), emissor: pk(r), valorEmissor: r.u64(), protocolo: pk(r), taxa: r.u64() };
      case "Reembolso":
        return { name, oferta: pk(r), investidor: pk(r), valor: r.u64() };
    }
  } catch {
    return null;
  }
}

/** Start of the offering account (state.rs): what the ledger needs to catalog it. */
export type OfferingAccountSummary = { issuer: string; shareMint: string; name: string; symbol: string; company: string };

export function decodeOfferingAccount(data: Buffer): OfferingAccountSummary | null {
  if (data.length < 8 || !data.subarray(0, 8).equals(OFFERING_ACCOUNT_DISC)) return null;
  try {
    const r = new BorshReader(data.subarray(8));
    const issuer = pk(r);
    u32(r); // indice
    const shareMint = pk(r);
    r.bytes(32); // cofre (vault)
    return { issuer, shareMint, name: r.string(), symbol: r.string(), company: r.string() };
  } catch {
    return null;
  }
}

// ── loop ─────────────────────────────────────────────────────────────────────────

export type PmesSolanaRpc = {
  getSignaturesForAddress(
    address: PublicKey,
    options: { before?: string; limit: number },
    commitment: "finalized",
  ): Promise<{ signature: string; slot: number; err: unknown }[]>;
  getTransaction(
    signature: string,
    options: { commitment: "finalized"; maxSupportedTransactionVersion: 0 },
  ): Promise<{ slot: number; blockTime?: number | null; meta: { err: unknown; logMessages?: string[] | null } | null } | null>;
  getAccountInfo(address: PublicKey, commitment: "finalized"): Promise<{ owner: PublicKey; data: Buffer } | null>;
};

/** A registro_ofertas row (Solana) as read back from the database. */
export type RegisteredSolanaOffering = { endereco: string; numero: number; empresa: string | null };

/** A registro_ofertas row (Solana) to insert. */
export type NewSolanaOffering = {
  endereco: string;
  token: string;
  emissor: string;
  moeda: string;
  nome: string | null;
  simbolo: string | null;
  empresa: string | null;
  bloco_criacao: number;
  criada_em: string;
  /** null when the offering was cataloged from a later event (see ensureOffering). */
  tx_criacao: string | null;
};

export type PmesSolanaDb = {
  saveLedgerEntry(entry: NewLedgerEntry): Promise<void>;
  readCheckpoint(source: string, fallback: number): Promise<number>;
  saveCheckpoints(sources: string[], block: number): Promise<void>;
  /** Solana offerings already registered (rede = 'solana-devnet'). */
  loadSolanaOfferings(): Promise<RegisteredSolanaOffering[]>;
  /** Saves (idempotent by address) and returns the assigned number. */
  registerSolanaOffering(offering: NewSolanaOffering): Promise<number>;
};

function shortAddress(e: string) {
  return `${e.slice(0, 4)}...${e.slice(-4)}`;
}

export function createPmesSolanaIndexer(deps: {
  rpc: PmesSolanaRpc;
  db: PmesSolanaDb;
  programId: string;
  /** The program's MockBRL mint (PDA ["mbrl"]), stored as the offering's `moeda`. */
  currencyMint?: string;
  startSlot: number;
  backoff: Omit<BackoffOptions, "sleep">;
  sleep: (ms: number) => Promise<void>;
}) {
  const { rpc, db } = deps;
  const program = new PublicKey(deps.programId);
  const currencyMint =
    deps.currencyMint ?? PublicKey.findProgramAddressSync([Buffer.from("mbrl")], program)[0].toBase58();
  const options: BackoffOptions = { ...deps.backoff, sleep: deps.sleep };
  const net = <T,>(fn: () => Promise<T>, context: string) => withBackoff(fn, `pmes-solana: ${context}`, options);

  let checkpoint = 0;
  const offerings = new Map<string, RegisteredSolanaOffering>();

  async function start(): Promise<void> {
    checkpoint = await db.readCheckpoint(SOURCE_PMES_SOLANA, deps.startSlot);
    for (const o of await db.loadSolanaOfferings()) offerings.set(o.endereco, o);
  }

  async function newSignatures() {
    const found: { signature: string; slot: number; err: unknown }[] = [];
    let before: string | undefined;
    for (;;) {
      const page = await net(() => rpc.getSignaturesForAddress(program, { before, limit: PAGE_SIZE }, "finalized"), "getSignaturesForAddress");
      let reached = false;
      for (const s of page) {
        if (s.slot <= checkpoint) {
          reached = true;
          break;
        }
        found.push(s);
      }
      if (reached || page.length < PAGE_SIZE) break;
      before = page[page.length - 1].signature;
    }
    return found.reverse();
  }

  async function readAccount(address: string): Promise<OfferingAccountSummary | null> {
    const account = await net(() => rpc.getAccountInfo(new PublicKey(address), "finalized"), `getAccountInfo ${address.slice(0, 8)}`);
    return account && account.owner.equals(program) ? decodeOfferingAccount(Buffer.from(account.data)) : null;
  }

  async function register(address: string, row: Omit<NewSolanaOffering, "endereco" | "moeda">) {
    const number = await db.registerSolanaOffering({ endereco: address, moeda: currencyMint, ...row });
    const registered = { endereco: address, numero: number, empresa: row.empresa };
    offerings.set(address, registered);
    return registered;
  }

  async function registerCreation(ev: Extract<PmesSolanaEvent, { name: "OfertaCriada" }>, signature: string, slot: number, when: string) {
    const existing = offerings.get(ev.oferta);
    if (existing) return existing;
    const meta = await readAccount(ev.oferta);
    return register(ev.oferta, {
      token: ev.mintCota,
      emissor: ev.emissor,
      nome: meta?.name ?? null,
      simbolo: meta?.symbol ?? null,
      empresa: ev.empresa || null,
      bloco_criacao: slot,
      criada_em: when,
      tx_criacao: signature,
    });
  }

  /**
   * Event of an offering whose creation the ledger did not see (e.g. created
   * before the configured start slot, or history pruned by the RPC): catalogs
   * the offering from its own account on the network, only if the owner is the
   * program. Without a valid account, the event gets no number (the display
   * shows only the address).
   */
  async function ensureOffering(address: string, slot: number, when: string) {
    const existing = offerings.get(address);
    if (existing) return existing;
    const account = await readAccount(address);
    if (!account) return undefined;
    return register(address, {
      token: account.shareMint,
      emissor: account.issuer,
      nome: account.name,
      simbolo: account.symbol,
      empresa: account.company || null,
      bloco_criacao: slot,
      criada_em: when,
      tx_criacao: null,
    });
  }

  function build(ev: PmesSolanaEvent, offering: RegisteredSolanaOffering | undefined): { type: string; description: string; data: EventData } {
    const base = { ofertaNumero: offering?.numero ?? null, ofertaEndereco: ev.oferta };
    const label = `oferta-solana-${offering?.numero ?? "?"} (${shortAddress(ev.oferta)})`;
    switch (ev.name) {
      case "OfertaCriada": {
        const data: OfferingCreatedData = {
          ...base,
          evento: "offering_created",
          emissor: ev.emissor,
          token: ev.mintCota,
          metaMinima: formatCurrency(ev.metaMinima),
          metaMaxima: formatCurrency(ev.metaMaxima),
          precoPorCota: formatCurrency(ev.precoPorCota),
          prazo: ev.prazo.toString(),
          moeda: CURRENCY_SYMBOL,
        };
        return {
          type: "Oferta criada",
          description: `${label} — criada pelo emissor ${shortAddress(ev.emissor)}${ev.empresa ? ` (${ev.empresa})` : ""}, meta ${data.metaMinima}–${data.metaMaxima} ${CURRENCY_SYMBOL}, ${data.precoPorCota} ${CURRENCY_SYMBOL} por cota`,
          data,
        };
      }
      case "Aporte":
        return {
          type: "Aporte",
          description: `${label} — investidor ${shortAddress(ev.investidor)} aportou ${formatCurrency(ev.valor)} ${CURRENCY_SYMBOL}`,
          data: { ...base, evento: "investment", investidor: ev.investidor, valor: formatCurrency(ev.valor), moeda: CURRENCY_SYMBOL, totalArrecadadoAtual: formatCurrency(ev.totalArrecadado) },
        };
      case "OfertaEncerrada":
        return {
          type: "Oferta encerrada",
          description: `${label} — encerrada (${ev.sucesso ? "EncerradaSucesso" : "EncerradaFalha"}), total arrecadado ${formatCurrency(ev.totalArrecadado)} ${CURRENCY_SYMBOL}`,
          data: { ...base, evento: "offering_closed", desfecho: ev.sucesso ? "success" : "failure", totalArrecadado: formatCurrency(ev.totalArrecadado), moeda: CURRENCY_SYMBOL },
        };
      case "OfertaCancelada":
        return { type: "Oferta cancelada", description: `${label} — oferta cancelada`, data: { ...base, evento: "offering_cancelled" } };
      case "CotasResgatadas":
        return {
          type: "Resgate de cotas",
          description: `${label} — investidor ${shortAddress(ev.investidor)} resgatou ${ev.cotas} cotas`,
          data: { ...base, evento: "shares_redeemed", investidor: ev.investidor, cotas: ev.cotas.toString() },
        };
      case "RecursosLiberados":
        return {
          type: "Recursos liberados",
          description: `${label} — ${formatCurrency(ev.valorEmissor)} ${CURRENCY_SYMBOL} liberados ao emissor`,
          data: {
            ...base,
            evento: "funds_released",
            emissor: ev.emissor,
            valorEmissor: formatCurrency(ev.valorEmissor),
            protocolo: ev.protocolo,
            taxa: formatCurrency(ev.taxa),
            moeda: CURRENCY_SYMBOL,
          },
        };
      case "Reembolso":
        return {
          type: "Reembolso",
          description: `${label} — investidor ${shortAddress(ev.investidor)} reembolsado em ${formatCurrency(ev.valor)} ${CURRENCY_SYMBOL}`,
          data: { ...base, evento: "refund", investidor: ev.investidor, valor: formatCurrency(ev.valor), moeda: CURRENCY_SYMBOL },
        };
    }
  }

  async function processTransaction(signature: string, txSlot: number): Promise<number> {
    const tx = await net(
      () => rpc.getTransaction(signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 }),
      `getTransaction ${signature.slice(0, 8)}`,
    );
    // A transaction that was listed but not returned (lagging/load-balanced RPC
    // node): throw so the whole cycle repeats WITHOUT moving the checkpoint;
    // never skip an event silently. Only a transaction that failed on-chain
    // (meta.err) is skipped on purpose.
    if (!tx?.meta) throw new Error(`getTransaction ${signature} not yet available on the RPC`);
    if (tx.meta.err) return 0;
    const slot = tx.slot ?? txSlot;
    const when = new Date((tx.blockTime ?? Math.floor(Date.now() / 1000)) * 1000).toISOString();

    let saved = 0;
    const payloads = programDataPayloads(tx.meta.logMessages ?? [], deps.programId);
    for (const [index, base64] of payloads.entries()) {
      const ev = decodePmesEvent(base64);
      if (!ev) continue; // EmissorDefinido, QualificacaoAlterada, OfertaPausadaAlterada: administrative, not in the ledger
      const offering =
        ev.name === "OfertaCriada" ? await registerCreation(ev, signature, slot, when) : await ensureOffering(ev.oferta, slot, when);
      const { type, description, data } = build(ev, offering);
      await db.saveLedgerEntry({
        fonte: "pmes",
        rede: PMES_SOLANA_NETWORK,
        tipo_evento: type,
        descricao: description,
        tx_hash: signature,
        log_index: index,
        endereco_contrato: deps.programId,
        bloco: null,
        slot,
        ocorrido_em: when,
        // commitment "finalized": the ledger only receives what can no longer be reverted.
        confirmado: true,
        dados: data,
      });
      saved++;
      console.log(`[indexer] pmes-solana: ${type} — ${description} — slot ${slot} — ${signature}`);
    }
    return saved;
  }

  /** A full cycle. Throws on error; the checkpoint only moves if everything worked. */
  async function cycle(): Promise<{ transactions: number; saved: number }> {
    const found = await newSignatures();
    let saved = 0;
    for (const s of found) {
      if (s.err) continue;
      saved += await processTransaction(s.signature, s.slot);
    }
    if (found.length > 0) {
      const highestSlot = Math.max(...found.map((s) => s.slot));
      await db.saveCheckpoints([SOURCE_PMES_SOLANA], highestSlot);
      checkpoint = highestSlot;
    }
    return { transactions: found.length, saved };
  }

  return {
    start,
    cycle,
    get checkpoint() {
      return checkpoint;
    },
    get offerings() {
      return offerings;
    },
  };
}
