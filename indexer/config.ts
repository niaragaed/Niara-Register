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
  /**
   * Número da oferta, vindo do mapa explícito abaixo — NÃO da posição em
   * OFERTAS_ONCHAIN. `null` para endereço fora do mapa.
   */
  numero: number | null;
  apelido: string;
};

/**
 * Número de cada oferta, fixado por endereço.
 *
 * Antes o número saía da posição em OFERTAS_ONCHAIN, o que tornava a numeração
 * refém da ordem de uma variável de ambiente: reordenar a env var renumeraria
 * ofertas já gravadas no ledger e faria as linhas antigas apontarem para a
 * oferta errada. Com o mapa explícito o número é uma propriedade do endereço.
 *
 * Os números aqui são exatamente os que já aparecem nas descrições gravadas
 * (oferta-1 … oferta-11), então nada muda no que já está no banco.
 *
 * Endereço novo que ainda não esteja aqui: `numero` fica null, `dados` grava
 * ofertaNumero null e a exibição lida com isso — nada quebra. Ao adicionar uma
 * oferta, acrescente a linha aqui também.
 */
const NUMERO_POR_OFERTA: Record<string, number> = {
  "0xd4ac69a4c7bfdc5e85c0e0da76ce12a1552b2704": 1,
  "0xcb5b8d945996114f781dd729f229638192d18258": 2,
  "0xdd9a14c221c6d9e2cf33c56d8a4bf7c8bdfaf938": 3,
  "0x29f10569644871bcd57e442e8802434d963688d9": 4,
  "0xfaa7946221f4a1d66c1b172bed79cf37ca003261": 5,
  "0xa60119428905fdf66bf967de90a2f892985d99b2": 6,
  "0xe4e7c347823f648abba73b31855e2fc1d7fe2fb1": 7,
  "0x4378e93588603385b1a51b74c06c0a9fcfc66a16": 8,
  "0xd720e3e0f53b7ba278a2bee99da7f0edd1f14b9c": 9,
  "0xaef8c045caabe0f283bd92893031f4f2644d534f": 10,
  "0x7ea155f38acb1b7c119769a21988feeb21388e57": 11,
};

export function numeroDaOferta(endereco: string): number | null {
  return NUMERO_POR_OFERTA[endereco.toLowerCase()] ?? null;
}

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

      // O apelido (que vai para a descricao) passa a seguir o mapa também, para
      // descricao e dados nunca divergirem. Hoje o mapa tem exatamente os mesmos
      // números das posições, então o texto gravado continua idêntico; a posição
      // só é usada como último recurso, para endereço fora do mapa.
      const numero = numeroDaOferta(oferta);
      const curto = `${oferta.slice(0, 6)}...${oferta.slice(-4)}`;

      return {
        endereco: oferta as `0x${string}`,
        token: (token as `0x${string}`) ?? null,
        numero,
        apelido: `oferta-${numero ?? i + 1} (${curto})`,
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

  // Contrato próprio do Register (não do PMEs) — endereço fixo, deployado em
  // niaragaed/niara-contracts-Register. Diferente de OFERTAS_ONCHAIN, este não
  // muda por configuração externa, então fica com valor padrão aqui; a env var
  // só existe para o caso raro de um redeploy do contrato.
  registroAssinaturasEndereco: (process.env.REGISTRO_ASSINATURAS_ENDERECO ??
    "0x5627857ee73f37d6da96530ed08c07339dd9d93a") as `0x${string}`,
  // Bloco do deploy do RegistroAssinaturas na Sepolia (ver
  // niara-contracts-Register/broadcast/DeployRegistro.s.sol/11155111/run-latest.json).
  startBlockAssinaturas: Number(process.env.START_BLOCK_ASSINATURAS ?? 11691290),
};

if (config.ofertas.length === 0) {
  throw new Error("OFERTAS_ONCHAIN está vazio — configure ao menos um endereço de oferta.");
}
