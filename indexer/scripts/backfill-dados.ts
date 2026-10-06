/**
 * Preenche a coluna `dados` das linhas de registro_transacoes gravadas antes da
 * migration 003.
 *
 * Lê SEMPRE da chain: para cada linha sem `dados`, busca o recibo pelo tx_hash,
 * localiza o log no log_index e decodifica com a ABI. Nada é extraído da
 * `descricao` — texto de exibição não é fonte de dado.
 *
 * Idempotente: só toca em linhas com `dados is null` e identifica cada linha por
 * (tx_hash, log_index), que é a mesma chave de unicidade usada pelo indexer.
 * Rodar duas vezes não duplica nem sobrescreve o que já foi preenchido.
 *
 * USO (a partir de indexer/):
 *   npx tsx scripts/backfill-dados.ts            # DRY-RUN, não grava nada
 *   npx tsx scripts/backfill-dados.ts --gravar   # grava de verdade
 */
import "../log-seguro";
import "dotenv/config";
import { ethers } from "ethers";
import { config, type OfertaMonitorada } from "../config";
import { OFERTA_CAPTACAO_ABI } from "../abi";
import { Tokens } from "../tokens";
import { montarDados } from "../eventos";
import { carregarOfertas, supabase } from "../db";

const GRAVAR = process.argv.includes("--gravar");
const LIMITE_AMOSTRA = Number(
  process.argv.find((a) => a.startsWith("--amostra="))?.split("=")[1] ?? 3,
);
// --numeros=12,8,7 mostra exatamente essas linhas na amostra, em vez das
// primeiras. Útil para conferir tipos de evento específicos.
const NUMEROS_PEDIDOS = process.argv
  .find((a) => a.startsWith("--numeros="))
  ?.split("=")[1]
  ?.split(",")
  .map((n) => Number(n.trim()))
  .filter((n) => Number.isFinite(n));

type Linha = {
  numero_sequencial: number;
  tipo_evento: string;
  descricao: string;
  tx_hash: string;
  log_index: number;
  endereco_contrato: string;
};

const provider = new ethers.JsonRpcProvider(config.rpcUrl);
const interfaceOferta = new ethers.Interface(OFERTA_CAPTACAO_ABI);
const tokens = new Tokens(provider);

/**
 * A oferta vem de registro_ofertas (migration 004), a mesma lista que o indexer
 * usa. Linha de um contrato fora da tabela é erro: o número da oferta não pode
 * ser inventado aqui.
 */
let ofertas: Map<string, OfertaMonitorada> | null = null;

async function ofertaDaLinha(linha: Linha): Promise<OfertaMonitorada> {
  ofertas ??= new Map((await carregarOfertas()).map((o) => [o.endereco, o]));
  const oferta = ofertas.get(linha.endereco_contrato.toLowerCase());
  if (!oferta) throw new Error(`${linha.endereco_contrato} não está em registro_ofertas`);
  return oferta;
}

async function dadosDaLinha(linha: Linha) {
  const recibo = await provider.getTransactionReceipt(linha.tx_hash);
  if (!recibo) throw new Error("recibo não encontrado na chain");

  const log = recibo.logs.find((l) => l.index === linha.log_index);
  if (!log) throw new Error(`log_index ${linha.log_index} ausente no recibo`);

  if (log.address.toLowerCase() !== linha.endereco_contrato.toLowerCase()) {
    throw new Error(
      `log emitido por ${log.address}, mas a linha aponta para ${linha.endereco_contrato}`,
    );
  }

  const parsed = interfaceOferta.parseLog(log);
  if (!parsed) throw new Error("log não casa com a ABI de OfertaCaptacao");

  return montarDados(parsed, await ofertaDaLinha(linha), tokens);
}

async function main() {
  console.log(
    GRAVAR
      ? "[backfill] MODO GRAVAÇÃO — as linhas serão atualizadas"
      : "[backfill] DRY-RUN — nada será gravado (use --gravar para valer)",
  );

  const { data, error } = await supabase
    .from("registro_transacoes")
    .select("numero_sequencial,tipo_evento,descricao,tx_hash,log_index,endereco_contrato")
    .is("dados", null)
    .eq("fonte", "pmes")
    .order("numero_sequencial", { ascending: true });

  if (error) throw new Error(`Falha ao listar linhas: ${error.message}`);

  const linhas = (data ?? []) as Linha[];
  console.log(`[backfill] linhas com dados nulo: ${linhas.length}\n`);
  if (linhas.length === 0) return;

  let ok = 0;
  let falhas = 0;
  const amostra: { linha: Linha; dados: unknown }[] = [];

  for (const linha of linhas) {
    try {
      const dados = await dadosDaLinha(linha);
      if (!dados) {
        falhas++;
        console.error(
          `  nº ${linha.numero_sequencial}: evento fora da ABI mínima (${linha.tipo_evento}) — pulada`,
        );
        continue;
      }

      const naAmostra = NUMEROS_PEDIDOS
        ? NUMEROS_PEDIDOS.includes(linha.numero_sequencial)
        : amostra.length < LIMITE_AMOSTRA;
      if (naAmostra) amostra.push({ linha, dados });

      if (GRAVAR) {
        const { error: erroUpdate } = await supabase
          .from("registro_transacoes")
          .update({ dados })
          .eq("tx_hash", linha.tx_hash)
          .eq("log_index", linha.log_index)
          .is("dados", null); // idempotência: não sobrescreve o que já foi preenchido
        if (erroUpdate) throw new Error(erroUpdate.message);
      }

      ok++;
    } catch (erro) {
      falhas++;
      console.error(
        `  nº ${linha.numero_sequencial} (${linha.tx_hash}#${linha.log_index}): ${(erro as Error).message}`,
      );
    }
  }

  const ordenada = NUMEROS_PEDIDOS
    ? [...amostra].sort(
        (a, b) =>
          NUMEROS_PEDIDOS.indexOf(a.linha.numero_sequencial) -
          NUMEROS_PEDIDOS.indexOf(b.linha.numero_sequencial),
      )
    : amostra;

  console.log(`\n[backfill] amostra (${ordenada.length} linha(s)):\n`);
  for (const { linha, dados } of ordenada) {
    console.log(`  ── nº ${String(linha.numero_sequencial).padStart(4, "0")} — ${linha.tipo_evento}`);
    console.log(`     tx        ${linha.tx_hash}#${linha.log_index}`);
    console.log(`     descricao ${linha.descricao}`);
    console.log(`     dados     ${JSON.stringify(dados, null, 2).replace(/\n/g, "\n               ")}`);
    console.log("");
  }

  console.log(
    `[backfill] processadas ${ok} de ${linhas.length} — falhas: ${falhas}` +
      (GRAVAR ? "" : "  (DRY-RUN: nada gravado)"),
  );
}

main().catch((erro) => {
  console.error("[backfill] erro fatal:", erro);
  process.exit(1);
});
