import "dotenv/config";

// Configuração do indexer. A lista de ofertas NÃO vem mais daqui: vive na
// tabela registro_ofertas (ver supabase/migrations_004_registro_ofertas.sql),
// semeada com as 11 legadas e alimentada pelo próprio indexer quando o
// OfertaOrquestrador emite OfertaCompletaCriada. Ver db.ts / carregarOfertas.

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return value;
}

export type { OfertaMonitorada } from "./ofertas";

export const config = {
  rpcUrl: `https://eth-sepolia.g.alchemy.com/v2/${required("ALCHEMY_API_KEY")}`,
  supabaseUrl: required("SUPABASE_URL"),
  supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  // Bloco a partir do qual começar a fonte pmes se não houver checkpoint salvo.
  startBlock: Number(process.env.START_BLOCK ?? 0),
  // Uma chamada eth_getLogs por ciclo em regime normal (ver index.ts); 30s
  // corresponde a ~2,5 blocos da Sepolia, ainda dentro de um único pedaço.
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 30_000),
  // eth_getLogs tem limite de range no plano gratuito da Alchemy (10 blocos) —
  // processamos em pedaços pra nunca estourar o limite.
  blockRangeChunk: Number(process.env.BLOCK_RANGE_CHUNK ?? 500),
  // Trabalho atrasado (varredura do orquestrador, backfill de ofertas novas):
  // no máximo CHUNKS_ATRASO_POR_CICLO chamadas por ciclo, espaçadas por
  // ATRASO_INTERVALO_MS. O lote normal roda antes, em todo ciclo, e não depende
  // disso. 300 ms ≈ 3 chamadas/s ≈ 250 CU/s, abaixo do limite de taxa do plano
  // free da Alchemy mesmo somando o lote normal.
  chunksAtrasoPorCiclo: Number(process.env.CHUNKS_ATRASO_POR_CICLO ?? 60),
  atrasoIntervaloMs: Number(process.env.ATRASO_INTERVALO_MS ?? 300),
  // Backoff em limite de taxa (429): 1s, 2s, 4s, 8s, 16s, 30s… até 6 tentativas.
  backoff: {
    tentativas: Number(process.env.BACKOFF_TENTATIVAS ?? 6),
    baseMs: Number(process.env.BACKOFF_BASE_MS ?? 1_000),
    tetoMs: Number(process.env.BACKOFF_TETO_MS ?? 30_000),
  },

  // Contrato próprio do Register (não do PMEs) — endereço fixo, deployado em
  // niaragaed/niara-contracts-Register. A env var só existe para o caso raro de
  // um redeploy do contrato.
  registroAssinaturasEndereco: (process.env.REGISTRO_ASSINATURAS_ENDERECO ??
    "0x5627857ee73f37d6da96530ed08c07339dd9d93a") as `0x${string}`,
  // Bloco do deploy do RegistroAssinaturas na Sepolia (ver
  // niara-contracts-Register/broadcast/DeployRegistro.s.sol/11155111/run-latest.json).
  startBlockAssinaturas: Number(process.env.START_BLOCK_ASSINATURAS ?? 11691290),

  // OfertaOrquestrador do niara-contracts-PMEs (criação self-service de ofertas).
  // Bloco do deploy: broadcast/DeployFase2Sepolia.s.sol/11155111/run-latest.json.
  orquestradorEndereco: (process.env.ORQUESTRADOR_ENDERECO ??
    "0xde9cc84d1300b57f640f2d1862900393b82796e5").toLowerCase() as `0x${string}`,
  startBlockOrquestrador: Number(process.env.START_BLOCK_ORQUESTRADOR ?? 11733723),

  // Modo de validação: lê a chain e o banco, mas não grava nada (nem
  // checkpoint). Imprime o que seria inserido e encerra ao alcançar a chain.
  dryRun: process.argv.includes("--dry-run") || process.env.DRY_RUN === "1",
};
