/**
 * Fills the `dados` column of the registro_transacoes rows written before
 * migration 003.
 *
 * ALWAYS reads from the chain: for each row without `dados`, fetches the
 * receipt by tx_hash, finds the log at log_index and decodes it with the ABI.
 * Nothing is extracted from `descricao`: display text is not a data source.
 *
 * Idempotent: only touches rows with `dados is null` and identifies each row by
 * (tx_hash, log_index), the same uniqueness key the indexer uses. Running it
 * twice neither duplicates nor overwrites what was already filled.
 *
 * USAGE (from indexer/):
 *   npx tsx scripts/backfill-data.ts            # DRY-RUN, writes nothing
 *   npx tsx scripts/backfill-data.ts --write    # writes for real
 */
import "../safe-log";
import "dotenv/config";
import { ethers } from "ethers";
import { config, type TrackedOffering } from "../config";
import { OFERTA_CAPTACAO_ABI } from "../abi";
import { Tokens } from "../tokens";
import { buildEventData } from "../events";
import { loadOfferings, supabase } from "../db";

const WRITE = process.argv.includes("--write");
const SAMPLE_LIMIT = Number(
  process.argv.find((a) => a.startsWith("--sample="))?.split("=")[1] ?? 3,
);
// --numbers=12,8,7 shows exactly those rows in the sample, instead of the
// first ones. Useful for checking specific event types.
const REQUESTED_NUMBERS = process.argv
  .find((a) => a.startsWith("--numbers="))
  ?.split("=")[1]
  ?.split(",")
  .map((n) => Number(n.trim()))
  .filter((n) => Number.isFinite(n));

/** A registro_transacoes row (column names as in the database). */
type Row = {
  numero_sequencial: number;
  tipo_evento: string;
  descricao: string;
  tx_hash: string;
  log_index: number;
  endereco_contrato: string;
};

const provider = new ethers.JsonRpcProvider(config.rpcUrl);
const offeringInterface = new ethers.Interface(OFERTA_CAPTACAO_ABI);
const tokens = new Tokens(provider);

/**
 * The offering comes from registro_ofertas (migration 004), the same list the
 * indexer uses. A row from a contract outside the table is an error: the
 * offering number must not be made up here.
 */
let offerings: Map<string, TrackedOffering> | null = null;

async function offeringOfRow(row: Row): Promise<TrackedOffering> {
  offerings ??= new Map((await loadOfferings()).map((o) => [o.address, o]));
  const offering = offerings.get(row.endereco_contrato.toLowerCase());
  if (!offering) throw new Error(`${row.endereco_contrato} is not in registro_ofertas`);
  return offering;
}

async function dataForRow(row: Row) {
  const receipt = await provider.getTransactionReceipt(row.tx_hash);
  if (!receipt) throw new Error("receipt not found on the chain");

  const log = receipt.logs.find((l) => l.index === row.log_index);
  if (!log) throw new Error(`log_index ${row.log_index} missing from the receipt`);

  if (log.address.toLowerCase() !== row.endereco_contrato.toLowerCase()) {
    throw new Error(
      `log emitted by ${log.address}, but the row points to ${row.endereco_contrato}`,
    );
  }

  const parsed = offeringInterface.parseLog(log);
  if (!parsed) throw new Error("log does not match the OfertaCaptacao ABI");

  return buildEventData(parsed, await offeringOfRow(row), tokens);
}

async function main() {
  console.log(
    WRITE
      ? "[backfill] WRITE MODE — rows will be updated"
      : "[backfill] DRY-RUN — nothing will be written (use --write to apply)",
  );

  const { data, error } = await supabase
    .from("registro_transacoes")
    .select("numero_sequencial,tipo_evento,descricao,tx_hash,log_index,endereco_contrato")
    .is("dados", null)
    .eq("fonte", "pmes")
    .order("numero_sequencial", { ascending: true });

  if (error) throw new Error(`Failed to list rows: ${error.message}`);

  const rows = (data ?? []) as Row[];
  console.log(`[backfill] rows with null dados: ${rows.length}\n`);
  if (rows.length === 0) return;

  let ok = 0;
  let failures = 0;
  const sample: { row: Row; data: unknown }[] = [];

  for (const row of rows) {
    try {
      const rowData = await dataForRow(row);
      if (!rowData) {
        failures++;
        console.error(
          `  no. ${row.numero_sequencial}: event outside the minimal ABI (${row.tipo_evento}); skipped`,
        );
        continue;
      }

      const inSample = REQUESTED_NUMBERS
        ? REQUESTED_NUMBERS.includes(row.numero_sequencial)
        : sample.length < SAMPLE_LIMIT;
      if (inSample) sample.push({ row, data: rowData });

      if (WRITE) {
        const { error: updateError } = await supabase
          .from("registro_transacoes")
          .update({ dados: rowData })
          .eq("tx_hash", row.tx_hash)
          .eq("log_index", row.log_index)
          .is("dados", null); // idempotency: do not overwrite what was already filled
        if (updateError) throw new Error(updateError.message);
      }

      ok++;
    } catch (error) {
      failures++;
      console.error(
        `  no. ${row.numero_sequencial} (${row.tx_hash}#${row.log_index}): ${(error as Error).message}`,
      );
    }
  }

  const ordered = REQUESTED_NUMBERS
    ? [...sample].sort(
        (a, b) =>
          REQUESTED_NUMBERS.indexOf(a.row.numero_sequencial) -
          REQUESTED_NUMBERS.indexOf(b.row.numero_sequencial),
      )
    : sample;

  console.log(`\n[backfill] sample (${ordered.length} row(s)):\n`);
  for (const { row, data: rowData } of ordered) {
    console.log(`  ── no. ${String(row.numero_sequencial).padStart(4, "0")} — ${row.tipo_evento}`);
    console.log(`     tx        ${row.tx_hash}#${row.log_index}`);
    console.log(`     descricao ${row.descricao}`);
    console.log(`     dados     ${JSON.stringify(rowData, null, 2).replace(/\n/g, "\n               ")}`);
    console.log("");
  }

  console.log(
    `[backfill] processed ${ok} of ${rows.length} — failures: ${failures}` +
      (WRITE ? "" : "  (DRY-RUN: nothing written)"),
  );
}

main().catch((error) => {
  console.error("[backfill] fatal error:", error);
  process.exit(1);
});
