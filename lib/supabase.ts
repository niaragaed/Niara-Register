import { createClient } from "@supabase/supabase-js";

// Cliente do Supabase do Niara-Register.
// IMPORTANTE (regra de honestidade do grupo Niara): este banco é próprio do
// Register (ex.: "niara-register-dev"), separado do banco do Niara-PMEs.
// O Register é um INDEXADOR — não guarda saldo nem executa transações,
// só espelha o que já ocorreu on-chain. Nenhum dado aqui deve ser inventado
// ou usado como demonstração de algo que não aconteceu de verdade.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Enquanto as credenciais reais não estão configuradas (.env.local), o
// client aponta para um projeto inexistente — as chamadas falham de forma
// controlada (tratadas nas páginas como "indexador não conectado"), em vez
// de derrubar o build ou fingir que há dados.
export const supabaseConfigurado = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = createClient(
  supabaseUrl || "https://placeholder.supabase.co",
  supabaseAnonKey || "placeholder-anon-key"
);

// Origem de cada registro exibido — sempre explícita na UI, nunca implícita.
export type FonteRegistro = "pmes" | "exchange";

export type RegistroTransacao = {
  id: string;
  numero_sequencial: number;
  fonte: FonteRegistro;
  tipo_evento: string;
  descricao: string;
  tx_hash: string;
  log_index: number;
  endereco_contrato: string;
  bloco: number;
  ocorrido_em: string;
  confirmado: boolean;
  /**
   * Forma estruturada do evento, gravada pelo indexer (ver lib/dados-evento.ts).
   * `unknown` porque vem de uma coluna jsonb: quem consome valida com
   * `lerDadosEvento` antes de usar. Null nas linhas anteriores à migration 003.
   */
  dados: unknown;
};

export type RegistroAssinatura = {
  id: string;
  documento_nome: string;
  tipo_documento: string | null;
  hash_sha256: string;
  assinante_endereco: string;
  tx_hash: string | null;
  log_index: number | null;
  endereco_contrato: string | null;
  bloco: number | null;
  assinado_em: string | null;
  status: "pendente" | "assinado_onchain";
};
