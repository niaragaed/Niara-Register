import type { LedgerTransaction } from "@/lib/supabase";
import { dictionaries, eventLabel } from "@/lib/i18n/dictionaries";
import { formatDate } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import { parseEventData } from "@/lib/event-data";
import { EventPhrase } from "@/components/event-phrase";

function truncateHash(hash: string) {
  if (hash.length <= 14) return hash;
  return `${hash.slice(0, 8)}...${hash.slice(-4)}`;
}

export function LedgerEntry({
  entry,
  locale,
  companies,
}: {
  entry: LedgerTransaction;
  locale: Locale;
  /** Company by offering address (lowercase), from registro_ofertas. */
  companies?: Map<string, string>;
}) {
  const t = dictionaries[locale];

  const label = eventLabel(t, entry.tipo_evento) ?? entry.tipo_evento;

  // Main path: the sentence is built from the `dados` column, in each
  // language, with amount, offering and addresses. Fallback for rows from
  // before migration 003, which still have a null `dados`: in Portuguese the
  // `descricao` written by the indexer is left; in English it is no use (it is
  // in Portuguese), so only the event label remains.
  const data = parseEventData(entry.dados);
  // Rows from before migration 010 have no `rede`: they were all Sepolia.
  const solana = entry.rede === "solana-devnet";
  const txLink = solana
    ? `https://explorer.solana.com/tx/${entry.tx_hash}?cluster=devnet`
    : `https://sepolia.etherscan.io/tx/${entry.tx_hash}`;
  const detail = data ? null : locale === "pt" ? entry.descricao : null;

  return (
    <div className="ledger-rule flex gap-5 py-5 pl-6">
      <div className="w-16 shrink-0 pt-0.5 font-mono text-xs text-slate">
        {t.entry.numberPrefix}{" "}
        {String(entry.numero_sequencial).padStart(4, "0")}
      </div>
      <div className="flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="font-body text-[15px] text-ink">
            {label}
            {data && (
              <span className="text-slate">
                {" · "}
                <EventPhrase
                  data={data}
                  locale={locale}
                  network={solana ? "solana-devnet" : "sepolia"}
                  company={companies?.get(data.ofertaEndereco.toLowerCase())}
                />
              </span>
            )}
            {detail && <span className="text-slate"> · {detail}</span>}
          </p>
          <time className="font-mono text-xs text-slate">
            {formatDate(entry.ocorrido_em, locale)}
          </time>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          <span className="border border-slate/30 px-1.5 py-px font-mono text-[11px] uppercase tracking-wide text-ink">
            {solana ? t.entry.networkSolana : t.entry.networkSepolia}
          </span>
          <span
            className={`font-mono text-xs ${
              entry.confirmado ? "text-moss" : "text-slate"
            }`}
          >
            {entry.confirmado
              ? t.entry.confirmed
              : t.entry.awaitingConfirmation}
          </span>
          <a
            href={txLink}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs text-brass underline decoration-brass/40 underline-offset-2 hover:decoration-brass"
          >
            {truncateHash(entry.tx_hash)} ↗ {solana ? t.entry.viewOnSolana : t.entry.viewOnSepolia}
          </a>
        </div>
      </div>
    </div>
  );
}
