import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ethers } from "ethers";
import {
  Notice,
  ExplorerHeader,
  Field,
  Fields,
  CheckYourself,
  InternalLink,
  Back,
} from "@/components/explorer";
import { EVM_NETWORKS, readerTxLink } from "@/lib/register-contract";
import { isEvmNetwork, readAddress, RpcUnavailable, type AddressReading } from "@/lib/evm-reader";
import { supabase, isSupabaseConfigured, type SignatureRow } from "@/lib/supabase";
import { dictionaries, documentTypeLabel } from "@/lib/i18n/dictionaries";
import { formatDate } from "@/lib/i18n/format";
import { getLocale } from "@/lib/i18n/get-locale";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ network: string; address: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { address } = await params;
  return { title: `${address.slice(0, 8)}…${address.slice(-4)} · Niara Register` };
}

export default async function AddressPage({ params }: Props) {
  const { network, address: raw } = await params;
  if (!isEvmNetwork(network) || !ethers.isAddress(raw)) notFound();
  const address = ethers.getAddress(raw);

  const locale = await getLocale();
  const dict = dictionaries[locale];
  const t = dict.explorer;
  const cfg = EVM_NETWORKS[network];
  const isNiara = address.toLowerCase() === cfg.address.toLowerCase();

  let reading: AddressReading | null = null;
  try {
    reading = await readAddress(network, address);
  } catch (error) {
    if (!(error instanceof RpcUnavailable)) throw error;
  }

  // Indexer list only for Niara's contract: it is the mirror of its events.
  const { data } =
    isNiara && isSupabaseConfigured
      ? await supabase
          .from("registro_assinaturas")
          .select("*")
          .eq("rede", network)
          .order("assinado_em", { ascending: false })
          .limit(50)
      : { data: null };
  const records = (data ?? []) as SignatureRow[];

  return (
    <div className="mx-auto max-w-5xl px-6 py-14">
      <ExplorerHeader t={t} network={network} eyebrow={t.eyebrowAddress} title={address} />

      {reading === null ? (
        <Notice title={t.rpcTitle} text={t.rpcText} />
      ) : (
        <div className="mt-6">
          <Fields>
            <Field label={t.accountType}>
              {reading.codeSize > 0 ? t.contractAccount : t.plainAccount}
              {isNiara && <span className="text-slate"> · {t.niaraContract} (RegistroAssinaturas)</span>}
            </Field>
            {reading.codeSize > 0 && (
              <Field label={t.codeSize}>
                <span className="font-mono text-xs">
                  {reading.codeSize.toLocaleString(locale === "pt" ? "pt-BR" : "en-US")}
                </span>{" "}
                {t.bytes}
              </Field>
            )}
            {/* On a contract the nonce only counts contracts it created (EIP-161), not transactions. */}
            {reading.codeSize === 0 && (
              <Field label={t.nonce}>
                <span className="font-mono text-xs">{reading.nonce}</span>
              </Field>
            )}
            {isNiara && cfg.deployTx && (
              <Field label={t.deployTx}>
                <InternalLink href={readerTxLink(network, cfg.deployTx)}>{cfg.deployTx}</InternalLink>
              </Field>
            )}
          </Fields>
        </div>
      )}

      {records.length > 0 && (
        <section className="mt-12 border-t border-slate/15 pt-8">
          <h2 className="font-display text-xl text-ink">{t.recordsTitle}</h2>
          <p className="mt-2 max-w-xl font-body text-sm leading-relaxed text-slate">{t.recordsLede}</p>
          <ul className="mt-4 divide-y divide-slate/10">
            {records.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
                <span className="font-body text-sm text-ink">
                  {r.documento_nome}
                  {r.tipo_documento && (
                    <span className="text-slate"> · {documentTypeLabel(dict, r.tipo_documento)}</span>
                  )}
                </span>
                <span className="flex flex-wrap items-baseline gap-3">
                  {r.assinado_em && (
                    <time className="font-mono text-xs text-slate">{formatDate(r.assinado_em, locale)}</time>
                  )}
                  {r.tx_hash && (
                    <InternalLink href={readerTxLink(network, r.tx_hash)}>
                      {r.tx_hash.slice(0, 10)}…{r.tx_hash.slice(-4)}
                    </InternalLink>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <CheckYourself
        t={t}
        rpcUrl={cfg.rpcUrl}
        calls={[{ method: "eth_getCode", params: [address, "latest"] }]}
      />
      <Back t={t} />
    </div>
  );
}
