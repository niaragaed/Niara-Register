/**
 * Limite de taxa do RPC (HTTP 429 / "compute units per second" da Alchemy).
 *
 * O ethers repete 429 sozinho, em silêncio (até 12 tentativas), e só então
 * lança — o ciclo inteiro era abortado sem nenhum sinal claro no log. O
 * provider do indexer desliga esse retry interno (ver index.ts) e as chamadas
 * passam por `comBackoff`: espera exponencial com teto, com uma linha de log a
 * cada espera. Se as tentativas acabarem, o erro sobe para o chamador, que
 * desiste só daquela parte do ciclo.
 *
 * As mensagens saem pelo console, então passam pela máscara de log-seguro.ts.
 */

export function ehLimiteDeTaxa(erro: unknown): boolean {
  const e = erro as {
    info?: { responseStatus?: string };
    error?: { code?: number; message?: string };
    shortMessage?: string;
    message?: string;
  };
  if (e?.info?.responseStatus?.startsWith("429")) return true;
  // Alguns provedores respondem 200 com o erro no corpo JSON-RPC.
  if (e?.error?.code === 429 || e?.error?.code === -32005) return true;
  const texto = `${e?.shortMessage ?? ""} ${e?.message ?? ""} ${e?.error?.message ?? ""}`;
  return /\b429\b|too many requests|compute units|rate limit|exceeded its/i.test(texto);
}

export type OpcoesBackoff = {
  tentativas: number;
  baseMs: number;
  tetoMs: number;
  dormir: (ms: number) => Promise<void>;
};

export async function comBackoff<T>(
  fn: () => Promise<T>,
  contexto: string,
  opcoes: OpcoesBackoff,
): Promise<T> {
  for (let tentativa = 1; ; tentativa++) {
    try {
      return await fn();
    } catch (erro) {
      if (!ehLimiteDeTaxa(erro) || tentativa >= opcoes.tentativas) throw erro;
      const espera = Math.min(opcoes.baseMs * 2 ** (tentativa - 1), opcoes.tetoMs);
      console.warn(
        `[indexer] limite de taxa do RPC (429) em ${contexto} — tentativa ${tentativa}/${opcoes.tentativas}, nova tentativa em ${(espera / 1000).toFixed(1)}s:`,
        (erro as { shortMessage?: string; message?: string }).shortMessage ?? (erro as Error).message,
      );
      await opcoes.dormir(espera);
    }
  }
}
