import type { SignatureV2Row } from "@/lib/supabase";
import { evmTxLink } from "@/lib/register-contract";
import { solanaExplorerLink } from "@/lib/register-solana";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { formatDate } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import { documentTypeName } from "@/lib/document-types";

const truncate = (v: string, head = 8, tail = 4) => (v.length <= head + tail + 3 ? v : `${v.slice(0, head)}...${v.slice(-tail)}`);

/** A v2 record in the public history: the public type, never the (private) name. */
export function SignatureV2Entry({ record, locale }: { record: SignatureV2Row; locale: Locale }) {
  const t = dictionaries[locale];
  const txLink =
    record.rede === "solana-devnet" ? solanaExplorerLink("tx", record.tx_hash) : evmTxLink(record.rede, record.tx_hash);
  return (
    <div className="ledger-rule flex gap-5 py-5 pl-6">
      <div className="flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="font-body text-[15px] text-ink">
            {record.tipo_documento ? documentTypeName(record.tipo_documento, locale) : t.signing.privateDocument}
            <span className="text-slate"> · {t.signing.privateName}</span>
            <span className="text-slate"> · {record.esquema_hash === 0 ? t.verify.schemeSigned : t.verify.schemeSalted}</span>
          </p>
          <time className="font-mono text-xs text-slate">{formatDate(record.assinado_em, locale)}</time>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          <span className="border border-slate/30 px-1.5 py-px font-mono text-[11px] uppercase tracking-wide text-ink">
            {t.register.networks[record.rede]}
          </span>
          <span className="font-mono text-xs text-slate">
            {t.entry.hash} {truncate(record.hash_registro)}
          </span>
          <span className="font-mono text-xs text-slate">
            {t.entry.signer} {truncate(record.assinante_endereco, 6)}
          </span>
          <span className="font-mono text-xs text-moss">
            {t.signing.receiptLabel} {truncate(record.recibo_id, 6)}
          </span>
          <a href={txLink} target="_blank" rel="noreferrer" className="font-mono text-xs text-brass underline decoration-brass/40 underline-offset-2 hover:decoration-brass">
            {truncate(record.tx_hash)} ↗
          </a>
          <a href={`/verify/${record.rede}/${record.hash_registro}`} className="font-mono text-xs text-brass underline decoration-brass/40 underline-offset-2 hover:decoration-brass">
            {t.signing.verifyLabel} →
          </a>
        </div>
      </div>
    </div>
  );
}
