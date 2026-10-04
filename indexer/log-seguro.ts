import { formatWithOptions } from "node:util";

/**
 * Nenhum log do indexer pode conter a chave da Alchemy.
 *
 * A chave vai dentro da URL do RPC (…/v2/<chave>), e o ethers copia essa URL
 * para todo erro que lança: no campo info.requestUrl e no próprio texto da
 * mensagem. Como o indexer imprime o objeto de erro inteiro, a chave saía nos
 * logs do Railway a cada falha de rede.
 *
 * Em vez de limpar erro por erro (fácil de esquecer um caminho), este módulo
 * envolve console.log/info/warn/error/debug: os argumentos são formatados
 * exatamente como o console faria e o texto final passa pela máscara antes de
 * ser escrito. Importar este arquivo ANTES de qualquer outro em cada ponto de
 * entrada (index.ts, scripts/*).
 */

const URL_COM_CHAVE = /\/v2\/[A-Za-z0-9_-]+/g;

export function mascararSegredos(texto: string): string {
  let mascarado = texto.replace(URL_COM_CHAVE, "/v2/***");
  // Também a chave sozinha, caso apareça fora de uma URL. Lida a cada chamada
  // porque o dotenv pode carregar depois deste módulo.
  const chave = process.env.ALCHEMY_API_KEY;
  if (chave && chave.length >= 8) mascarado = mascarado.split(chave).join("***");
  return mascarado;
}

const metodos = ["log", "info", "warn", "error", "debug"] as const;

for (const metodo of metodos) {
  const original = console[metodo].bind(console);
  console[metodo] = (...args: unknown[]) => {
    original(mascararSegredos(formatWithOptions({}, ...args)));
  };
}

// Erro não tratado: o handler padrão do Node escreve direto no stderr, sem
// passar pelo console. Registrando aqui, ele passa pela máscara. Promessa
// rejeitada sem catch vira uncaughtException no Node >= 15.
process.on("uncaughtException", (erro) => {
  console.error("[indexer] erro fatal não tratado:", erro);
  process.exit(1);
});
