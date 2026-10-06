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

export type OfertaMonitorada = {
  /** Sempre minúsculo — é a chave usada para casar com log.address. */
  endereco: `0x${string}`;
  token: `0x${string}` | null;
  /** De registro_ofertas: 1–11 legadas, 12+ do orquestrador, em ordem de criação. */
  numero: number;
  apelido: string;
  origem: "legado" | "orquestrador";
  empresa: string | null;
  bloco_criacao: number;
  /**
   * Backfill dos eventos anteriores à entrada da oferta no lote (só
   * orquestrador). Pendente enquanto backfill_ate < backfill_alvo.
   */
  backfill_alvo: number | null;
  backfill_ate: number | null;
};

export function apelidoDaOferta(endereco: string, numero: number): string {
  return `oferta-${numero} (${endereco.slice(0, 6)}...${endereco.slice(-4)})`;
}

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
  // Teto de chamadas eth_getLogs por ciclo para o trabalho atrasado (varredura
  // do orquestrador e backfill de ofertas novas), para que o lote normal não
  // fique parado enquanto o atraso é recuperado.
  chunksAtrasoPorCiclo: Number(process.env.CHUNKS_ATRASO_POR_CICLO ?? 200),

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
