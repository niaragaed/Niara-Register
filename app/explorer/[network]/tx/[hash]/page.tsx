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
import { EVM_NETWORKS, REGISTRO_ASSINATURAS_ABI, readerAddressLink } from "@/lib/register-contract";
import { isEvmNetwork, readTransaction, RpcUnavailable, type TxReading } from "@/lib/evm-reader";
import { dictionaries, documentTypeLabel } from "@/lib/i18n/dictionaries";
import { formatTimestamp } from "@/lib/i18n/format";
import { getLocale } from "@/lib/i18n/get-locale";

// Always read live: status and confirmations change every block.
export const dynamic = "force-dynamic";

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const iface = new ethers.Interface(REGISTRO_ASSINATURAS_ABI);

type Props = { params: Promise<{ network: string; hash: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { hash } = await params;
  return { title: `Tx ${hash.slice(0, 10)}…${hash.slice(-4)} · Niara Register` };
}

export default async function TransactionPage({ params }: Props) {
  const { network, hash } = await params;
  if (!isEvmNetwork(network) || !TX_HASH.test(hash)) notFound();

  const locale = await getLocale();
  const dict = dictionaries[locale];
  const t = dict.explorer;
  const cfg = EVM_NETWORKS[network];
  const contract = cfg.address.toLowerCase();

  let reading: TxReading | null = null;
  try {
    reading = await readTransaction(network, hash);
  } catch (error) {
    if (!(error instanceof RpcUnavailable)) throw error;
  }

  const isNiara = (address: string | null) => address?.toLowerCase() === contract;
  const linkedAddress = (address: string) => (
    <>
      <InternalLink href={readerAddressLink(network, address)}>{address}</InternalLink>
      {isNiara(address) && <span className="text-slate"> · {t.niaraContract}</span>}
    </>
  );

  const calls: { method: string; params: unknown[] }[] = [
    { method: "eth_getTransactionReceipt", params: [hash] },
  ];
  if (reading?.kind === "included" && reading.records[0]) {
    calls.push({
      method: "eth_call",
      params: [
        {
          to: cfg.address,
          data: iface.encodeFunctionData("verificar", [reading.records[0].documentHash]),
        },
        "latest",
      ],
    });
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-14">
      <ExplorerHeader t={t} network={network} eyebrow={t.eyebrowTx} title={hash.toLowerCase()} />

      {reading === null && <Notice title={t.rpcTitle} text={t.rpcText} />}
      {reading?.kind === "not-found" && (
        <Notice title={t.notFoundTitle} text={t.notFoundText} />
      )}

      {reading?.kind === "pending" && (
        <div className="mt-6">
          <Fields>
            <Field label={t.status}>
              <span className="text-slate">{t.pending}</span>
            </Field>
            <Field label={t.from}>{linkedAddress(reading.from)}</Field>
            {reading.to && <Field label={t.to}>{linkedAddress(reading.to)}</Field>}
          </Fields>
        </div>
      )}

      {reading?.kind === "included" && (
        <>
          <div className="mt-6">
            <Fields>
              <Field label={t.status}>
                {reading.success ? (
                  <span className="text-moss">{t.success}</span>
                ) : (
                  <span className="text-slate">{t.reverted}</span>
                )}
              </Field>
              <Field label={t.block}>
                <span className="font-mono text-xs">{reading.block}</span>
                <span className="text-slate">
                  {" · "}
                  {reading.confirmations.toLocaleString(locale === "pt" ? "pt-BR" : "en-US")}{" "}
                  {t.confirmations}
                </span>
              </Field>
              {reading.blockTime !== null && (
                <Field label={t.blockTime}>
                  <span className="font-mono text-xs">
                    {formatTimestamp(reading.blockTime, locale)}
                  </span>
                </Field>
              )}
              <Field label={t.from}>{linkedAddress(reading.from)}</Field>
              {reading.to && <Field label={t.to}>{linkedAddress(reading.to)}</Field>}
              {reading.createdContract && (
                <Field label={t.createdContract}>{linkedAddress(reading.createdContract)}</Field>
              )}
              <Field label={t.gasUsed}>
                <span className="font-mono text-xs">{reading.gasUsed}</span>
              </Field>
            </Fields>
          </div>

          {isNiara(reading.createdContract) && (
            <p className="mt-6 font-body text-sm text-slate">{t.deployText}</p>
          )}

          {reading.records.map((r) => (
            <section key={r.logIndex} className="mt-10 border border-moss/40 px-6 py-6">
              <h2 className="font-display text-lg text-ink">{t.recordTitle}</h2>
              <div className="mt-3">
                <Fields>
                  <Field label={t.document}>{r.documentName}</Field>
                  <Field label={t.type}>{documentTypeLabel(dict, r.documentType)}</Field>
                  <Field label={t.documentHash}>
                    <span className="font-mono text-xs">{r.documentHash}</span>
                  </Field>
                  <Field label={t.signer}>{linkedAddress(r.signer)}</Field>
                  <Field label={t.recordedAt}>
                    <span className="font-mono text-xs">{formatTimestamp(r.timestamp, locale)}</span>
                  </Field>
                </Fields>
              </div>

              <h3 className="mt-6 font-mono text-xs uppercase tracking-wide text-slate">
                {t.checkTitle}
              </h3>
              <p
                className={`mt-2 font-body text-sm leading-relaxed ${
                  r.matches ? "text-moss" : "text-slate"
                }`}
              >
                {r.onContract === null ? t.checkFailed : r.matches ? t.matches : t.mismatch}
              </p>
            </section>
          ))}

          {reading.success && reading.records.length === 0 && !isNiara(reading.createdContract) && (
            <p className="mt-8 font-body text-sm text-slate">{t.noRecord}</p>
          )}
        </>
      )}

      <CheckYourself t={t} rpcUrl={cfg.rpcUrl} calls={calls} />
      <Back t={t} />
    </div>
  );
}
