import { createClient } from "@supabase/supabase-js";
import { config } from "./config";
import { paraMonitorada, type LinhaOferta, type OfertaMonitorada } from "./ofertas";
import type { DadosEvento } from "./eventos";

// Client com a service role key — o indexer precisa gravar direto no Postgres,
// contornando qualquer RLS que exista pro client público do site. Nunca reusar
// esta chave no front do Niara-Register (lib/supabase.ts lá usa a anon key).
export const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);

/**
 * Em dry-run nada é gravado: cada escrita vira um registro em memória, que o
 * index.ts imprime ao final. As leituras (checkpoints, ofertas) continuam indo
 * ao banco de verdade.
 */
export const simulado = {
  registros: [] as NovoRegistro[],
  ofertas: [] as NovaOferta[],
};

export type NovoRegistro = {
  fonte: "pmes";
  tipo_evento: string;
  descricao: string;
  tx_hash: string;
  log_index: number;
  endereco_contrato: string;
  bloco: number;
  ocorrido_em: string;
  confirmado: boolean;
  /**
   * Forma estruturada do evento (ver eventos.ts). Null para evento fora da ABI
   * mínima — a exibição tem fallback. A `descricao` continua sendo gravada do
   * mesmo jeito, em paralelo.
   */
  dados: DadosEvento | null;
};

// onConflict em (tx_hash, log_index) — garante idempotência: se o indexer cair e
// reprocessar um range de blocos já gravado, não duplica a linha no ledger.
export async function gravarRegistro(registro: NovoRegistro): Promise<void> {
  if (config.dryRun) {
    const chave = `${registro.tx_hash}#${registro.log_index}`;
    if (!simulado.registros.some((r) => `${r.tx_hash}#${r.log_index}` === chave)) {
      simulado.registros.push(registro);
    }
    return;
  }

  const { error } = await supabase
    .from("registro_transacoes")
    .upsert(registro, { onConflict: "tx_hash,log_index", ignoreDuplicates: true });

  if (error) {
    throw new Error(`Falha ao gravar registro (${registro.tx_hash}#${registro.log_index}): ${error.message}`);
  }
}

export type NovaAssinatura = {
  /** Rede de origem (migration 005). */
  rede: "sepolia" | "base-sepolia" | "robinhood-testnet" | "solana-devnet";
  documento_nome: string;
  tipo_documento: string;
  /** Sempre "0x" + 64 hex minúsculos, nas duas redes. */
  hash_sha256: string;
  /** EVM: endereço 0x…; Solana: chave pública base58. */
  assinante_endereco: string;
  /** EVM: hash da transação; Solana: assinatura da transação (base58). */
  tx_hash: string;
  log_index: number;
  /** EVM: contrato RegistroAssinaturas; Solana: program ID. */
  endereco_contrato: string;
  /** Bloco EVM (null na Solana). */
  bloco: number | null;
  /** Slot da Solana (ausente na EVM). */
  slot?: number;
  assinado_em: string;
  status: "assinado_onchain";
};

// onConflict em (rede, hash_sha256) — cada contrato/programa só deixa registrar
// um hash uma vez NA SUA REDE, então essa trava replica a mesma garantia no
// banco (evita duplicar se o indexer reprocessar blocos/slots depois de
// reiniciar), sem impedir o mesmo documento de ter prova em duas redes.
export async function gravarAssinatura(registro: NovaAssinatura): Promise<void> {
  if (config.dryRun) {
    console.log(
      `[dry-run] assinatura que seria gravada (${registro.rede}): ${registro.hash_sha256} — "${registro.documento_nome}" — ${registro.assinante_endereco}`,
    );
    return;
  }

  const { error } = await supabase
    .from("registro_assinaturas")
    .upsert(registro, { onConflict: "rede,hash_sha256", ignoreDuplicates: true });

  if (error) {
    throw new Error(`Falha ao gravar assinatura (${registro.hash_sha256}): ${error.message}`);
  }
}

// ── Ofertas (registro_ofertas, migration 004) ──────────────────────────────────

/**
 * A lista de ofertas monitoradas, lida do banco a cada início do processo — é o
 * que faz uma oferta descoberta sobreviver a reinícios. Vazia significa que a
 * migration 004 não rodou (o seed traz as 11 legadas): falha alto em vez de
 * indexar nada em silêncio.
 */
export async function carregarOfertas(): Promise<OfertaMonitorada[]> {
  const { data, error } = await supabase
    .from("registro_ofertas")
    .select("endereco,token,numero,origem,empresa,bloco_criacao,backfill_alvo,backfill_ate")
    .order("numero");

  if (error) {
    throw new Error(`Falha ao carregar registro_ofertas (a migration 004 rodou?): ${error.message}`);
  }
  if (!data || data.length === 0) {
    throw new Error("registro_ofertas está vazia — rode supabase/migrations_004_registro_ofertas.sql.");
  }
  return (data as LinhaOferta[]).map(paraMonitorada);
}

export type NovaOferta = {
  endereco: string;
  token: string;
  emissor: string;
  moeda: string;
  origem: "orquestrador";
  numero: number;
  nome: string | null;
  simbolo: string | null;
  empresa: string | null;
  bloco_criacao: number;
  criada_em: string;
  tx_criacao: string;
  backfill_alvo: number;
  backfill_ate: number;
};

/**
 * Grava uma oferta descoberta pelo OfertaCompletaCriada. O número já vem
 * decidido pelo chamador (max + 1, na ordem dos eventos); a unique em `numero`
 * e a PK em `endereco` impedem que um reprocessamento duplique ou renumere.
 */
export async function gravarOferta(oferta: NovaOferta): Promise<void> {
  if (config.dryRun) {
    simulado.ofertas.push(oferta);
    return;
  }

  const { error } = await supabase
    .from("registro_ofertas")
    .upsert(oferta, { onConflict: "endereco", ignoreDuplicates: true });

  if (error) {
    throw new Error(`Falha ao gravar oferta ${oferta.endereco}: ${error.message}`);
  }
}

export function novaOfertaParaMonitorada(o: NovaOferta): OfertaMonitorada {
  return paraMonitorada(o);
}

/** Progresso do backfill de uma oferta (último bloco já varrido). */
export async function salvarBackfill(endereco: string, ate: number): Promise<void> {
  if (config.dryRun) return;

  const { error } = await supabase
    .from("registro_ofertas")
    .update({ backfill_ate: ate })
    .eq("endereco", endereco.toLowerCase());

  if (error) {
    throw new Error(`Falha ao salvar backfill de ${endereco}: ${error.message}`);
  }
}

// ── Checkpoints ────────────────────────────────────────────────────────────────

export async function lerCheckpoint(fonte: string, fallback: number): Promise<number> {
  const { data, error } = await supabase
    .from("registro_checkpoints")
    .select("ultimo_bloco")
    .eq("fonte", fonte)
    .maybeSingle();

  if (error) {
    throw new Error(`Falha ao ler checkpoint (${fonte}): ${error.message}`);
  }

  return data?.ultimo_bloco === undefined || data?.ultimo_bloco === null
    ? fallback
    : Number(data.ultimo_bloco);
}

/** Salva o checkpoint de várias fontes numa única escrita. */
export async function salvarCheckpoints(fontes: string[], bloco: number): Promise<void> {
  if (config.dryRun || fontes.length === 0) return;

  const agora = new Date().toISOString();
  const { error } = await supabase
    .from("registro_checkpoints")
    .upsert(fontes.map((fonte) => ({ fonte, ultimo_bloco: bloco, atualizado_em: agora })));

  if (error) {
    throw new Error(`Falha ao salvar checkpoint (${fontes.join(", ")}): ${error.message}`);
  }
}
