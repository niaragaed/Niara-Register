import { createClient } from "@supabase/supabase-js";
import { config } from "./config";

// Client com a service role key — o indexer precisa gravar direto no Postgres,
// contornando qualquer RLS que exista pro client público do site. Nunca reusar
// esta chave no front do Niara-Register (lib/supabase.ts lá usa a anon key).
export const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);

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
};

// onConflict em (tx_hash, log_index) — garante idempotência: se o indexer cair e
// reprocessar um range de blocos já gravado, não duplica a linha no ledger.
export async function gravarRegistro(registro: NovoRegistro): Promise<void> {
  const { error } = await supabase
    .from("registro_transacoes")
    .upsert(registro, { onConflict: "tx_hash,log_index", ignoreDuplicates: true });

  if (error) {
    throw new Error(`Falha ao gravar registro (${registro.tx_hash}#${registro.log_index}): ${error.message}`);
  }
}

export async function lerCheckpoint(fonte: string, fallback: number): Promise<number> {
  const { data, error } = await supabase
    .from("registro_checkpoints")
    .select("ultimo_bloco")
    .eq("fonte", fonte)
    .maybeSingle();

  if (error) {
    throw new Error(`Falha ao ler checkpoint (${fonte}): ${error.message}`);
  }

  return data?.ultimo_bloco ?? fallback;
}

export async function salvarCheckpoint(fonte: string, bloco: number): Promise<void> {
  const { error } = await supabase
    .from("registro_checkpoints")
    .upsert({ fonte, ultimo_bloco: bloco, atualizado_em: new Date().toISOString() });

  if (error) {
    throw new Error(`Falha ao salvar checkpoint (${fonte}): ${error.message}`);
  }
}
