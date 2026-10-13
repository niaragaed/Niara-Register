import type { SignatureRow } from "@/lib/supabase";
import { evmTxLink } from "@/lib/register-contract";
import { dictionaries, documentTypeLabel } from "@/lib/i18n/dictionaries";
import { formatDate } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";

function truncateHash(hash: string) {
  if (hash.length <= 14) return hash;
  return `${hash.slice(0, 8)}...${hash.slice(-4)}`;
}

function truncateAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function SignatureEntry({
  record,
  locale,
}: {
  record: SignatureRow;
  locale: Locale;
}) {
  const t = dictionaries[locale];
  // Rows from before migration 005 have no `rede`: they were all Sepolia.
  const network = record.rede ?? "sepolia";
  const solana = network === "solana-devnet";
  const txLink = record.tx_hash
    ? solana
      ? `https://explorer.solana.com/tx/${record.tx_hash}?cluster=devnet`
      : evmTxLink(network, record.tx_hash)
    : null;
  const labels = {
    sepolia: [t.entry.networkSepolia, t.entry.viewOnSepolia],
    "base-sepolia": [t.entry.networkBase, t.entry.viewOnBase],
    "robinhood-testnet": [t.entry.networkRobinhood, t.entry.viewOnRobinhood],
    "hyperevm-testnet": [t.entry.networkHyperEvm, t.entry.viewOnHyperEvm],
    "tempo-testnet": [t.entry.networkTempo, t.entry.viewOnTempo],
    "solana-devnet": [t.entry.networkSolana, t.entry.viewOnSolana],
  } as const;
  const [networkName, viewOn] = labels[network];

  return (
    <div className="ledger-rule flex gap-5 py-5 pl-6">
      <div className="flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="font-body text-[15px] text-ink">
            {/* documento_nome is the data recorded on-chain: it shows exactly
                as it was recorded, in any language. */}
            {record.documento_nome}
            {record.tipo_documento && (
              <span className="text-slate">
                {" · "}
                {documentTypeLabel(t, record.tipo_documento)}
              </span>
            )}
          </p>
          {record.assinado_em && (
            <time className="font-mono text-xs text-slate">
              {formatDate(record.assinado_em, locale)}
            </time>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          <span className="border border-slate/30 px-1.5 py-px font-mono text-[11px] uppercase tracking-wide text-ink">
            {networkName}
          </span>
          <span className="font-mono text-xs text-slate">
            {t.entry.hash} {truncateHash(record.hash_sha256)}
          </span>
          <span className="font-mono text-xs text-slate">
            {t.entry.signer} {truncateAddress(record.assinante_endereco)}
          </span>
          <span
            className={`font-mono text-xs ${
              record.status === "assinado_onchain" ? "text-moss" : "text-slate"
            }`}
          >
            {record.status === "assinado_onchain"
              ? t.entry.signedOnchain
              : t.entry.pending}
          </span>
          {record.tx_hash && txLink && (
            <a
              href={txLink}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-xs text-brass underline decoration-brass/40 underline-offset-2 hover:decoration-brass"
            >
              {truncateHash(record.tx_hash)} ↗ {viewOn}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
