import "dotenv/config";

// Configuração do indexer — nada aqui é hardcoded de propósito. Os endereços de
// oferta reais só existem nas env vars do Vercel do projeto niara-PMEs
// (NEXT_PUBLIC_MOCKBRL_ADDRESS / NEXT_PUBLIC_OFERTAS_ONCHAIN) — copie os mesmos
// valores pra cá (ver .env.example) em vez de hardcodar endereço de contrato em
// código, mesmo princípio já usado em src/lib/web3/addresses.ts do niara-PMEs.

const HEX_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return value;
}

export type OfertaMonitorada = {
  endereco: `0x${string}`;
  token: `0x${string}` | null;
  apelido: string;
};

// Mesmo formato usado pelo niara-PMEs: "token1:oferta1;token2:oferta2;...".
// Aceita também só o endereço da oferta sozinho ("oferta1;oferta2"), caso você
// queira colar apenas os endereços de OfertaCaptacao sem o token junto.
function parseOfertas(value: string): OfertaMonitorada[] {
  return value
    .split(";")
    .map((par) => par.trim())
    .filter(Boolean)
    .map((par, i) => {
      const partes = par.split(":").map((p) => p?.trim());
      const oferta = partes.length === 2 ? partes[1] : partes[0];
      const token = partes.length === 2 ? partes[0] : null;

      if (!oferta || !HEX_ADDRESS_PATTERN.test(oferta)) {
        throw new Error(`Endereço de oferta inválido em OFERTAS_ONCHAIN: "${par}"`);
      }
      if (token && !HEX_ADDRESS_PATTERN.test(token)) {
        throw new Error(`Endereço de token inválido em OFERTAS_ONCHAIN: "${par}"`);
      }

      return {
        endereco: oferta as `0x${string}`,
        token: (token as `0x${string}`) ?? null,
        apelido: `oferta-${i + 1} (${oferta.slice(0, 6)}...${oferta.slice(-4)})`,
      };
    });
}

export const config = {
  rpcUrl: `https://eth-sepolia.g.alchemy.com/v2/${required("ALCHEMY_API_KEY")}`,
  supabaseUrl: required("SUPABASE_URL"),
  supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  ofertas: parseOfertas(required("OFERTAS_ONCHAIN")),
  // Bloco a partir do qual começar o backfill se não houver checkpoint salvo ainda.
  // Recomendado: o bloco do deploy da oferta mais antiga que você está monitorando
  // (ver Etherscan), pra não escanear a Sepolia inteira desde o genesis.
  startBlock: Number(process.env.START_BLOCK ?? 0),
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 15_000),
  // eth_getLogs tem limite de range em vários provedores (Alchemy free tier ~ 10 blocos
  // por vez em alguns planos, ou milhares em outros) — processamos em pedaços pra nunca
  // estourar o limite, independente do plano.
  blockRangeChunk: Number(process.env.BLOCK_RANGE_CHUNK ?? 500),
};

if (config.ofertas.length === 0) {
  throw new Error("OFERTAS_ONCHAIN está vazio — configure ao menos um endereço de oferta.");
}
