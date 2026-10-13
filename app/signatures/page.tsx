import { DocumentVerifier } from "./verifier";
import { SignatureEntry } from "@/components/signature-entry";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { SignatureRow } from "@/lib/supabase";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/get-locale";
import { SOLANA_PROGRAM_ID, solanaExplorerLink } from "@/lib/register-solana";
import { EVM_NETWORKS, evmAddressLink } from "@/lib/register-contract";
export const dynamic = "force-dynamic";
export default async function SignaturesPage() {
  const locale = await getLocale();
  const t = dictionaries[locale];

  // Same principle as /sme-registry: reads straight from the indexed table,
  // never generates data on the fly. If Supabase is not configured on this
  // instance, it falls into the empty state below instead of a raw error.
  const { data, error } = isSupabaseConfigured
    ? await supabase
        .from("registro_assinaturas")
        .select("*")
        .order("assinado_em", { ascending: false })
        .limit(50)
    : { data: null, error: null };

  const records = (data ?? []) as SignatureRow[];
  const indexerDisconnected = !isSupabaseConfigured || Boolean(error);

  return (
    <div className="mx-auto max-w-5xl px-6 py-14">
      <header className="border-b border-slate/15 pb-8">
        <p className="font-mono text-xs uppercase tracking-wide text-slate">
          {t.signing.eyebrow}
        </p>
        <h1 className="mt-3 font-display text-3xl text-ink">
          {t.signing.title}
        </h1>
        <p className="mt-3 max-w-xl font-body text-sm leading-relaxed text-slate">
          {t.signing.lede}
        </p>
      </header>

      <div className="mt-10">
        {/* The verifier is the only client component that needs text. It
            gets only its slice of the dictionary through props: with a
            single consumer, a context provider would be weight with no gain. */}
        <DocumentVerifier t={t.verifier} locale={locale} />
      </div>

      <div className="mt-6 border border-dashed border-moss/40 px-6 py-6">
        <p className="font-body text-sm text-slate">
          {t.signing.contractPrefix}
          <a
            href="https://github.com/niaragaed/niara-contracts-Register"
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs text-brass underline decoration-brass/40 underline-offset-2 hover:decoration-brass"
          >
            niara-contracts-Register
          </a>
          {t.signing.contractSuffix}
          <a
            href={evmAddressLink("sepolia", EVM_NETWORKS.sepolia.address)}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs text-brass underline decoration-brass/40 underline-offset-2 hover:decoration-brass"
          >
            Etherscan
          </a>
          {" · "}
          <a
            href={evmAddressLink("base-sepolia", EVM_NETWORKS["base-sepolia"].address)}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs text-brass underline decoration-brass/40 underline-offset-2 hover:decoration-brass"
          >
            BaseScan
          </a>
          {" · "}
          <a
            href={evmAddressLink("robinhood-testnet", EVM_NETWORKS["robinhood-testnet"].address)}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs text-brass underline decoration-brass/40 underline-offset-2 hover:decoration-brass"
          >
            Robinhood Explorer
          </a>
          {" · "}
          <a
            href={evmAddressLink("hyperevm-testnet", EVM_NETWORKS["hyperevm-testnet"].address)}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs text-brass underline decoration-brass/40 underline-offset-2 hover:decoration-brass"
          >
            {t.signing.hyperEvmReader}
          </a>
          {" · "}
          <a
            href={evmAddressLink("tempo-testnet", EVM_NETWORKS["tempo-testnet"].address)}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs text-brass underline decoration-brass/40 underline-offset-2 hover:decoration-brass"
          >
            Tempo Explorer
          </a>
          .
        </p>
        <p className="mt-3 font-body text-sm text-slate">
          {t.signing.solanaPrefix}
          <a
            href={solanaExplorerLink("address", SOLANA_PROGRAM_ID.toBase58())}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs text-brass underline decoration-brass/40 underline-offset-2 hover:decoration-brass"
          >
            niara-register-solana
          </a>
          {t.signing.solanaSuffix}
        </p>
      </div>

      <div className="mt-14 border-t border-slate/15 pt-8">
        <h2 className="font-display text-xl text-ink">
          {t.signing.historyTitle}
        </h2>
        <p className="mt-2 max-w-xl font-body text-sm leading-relaxed text-slate">
          {t.signing.historyLede}
        </p>

        {records.length > 0 ? (
          <div className="mt-6">
            {records.map((record) => (
              <SignatureEntry
                key={record.id}
                record={record}
                locale={locale}
              />
            ))}
          </div>
        ) : (
          <div className="mt-6 border border-dashed border-slate/30 px-6 py-10">
            <p className="font-body text-sm text-slate">
              {indexerDisconnected
                ? t.signing.disconnected
                : t.signing.empty}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
