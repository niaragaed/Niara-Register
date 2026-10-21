import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/get-locale";
import { formatTimestamp } from "@/lib/i18n/format";
import { isHash32, ZERO_HASH } from "@/lib/commitments";
import { isEvm, isRegisterNetwork } from "@/lib/networks";
import { NotDeployed, readLegacyRecord, readRecordV2, type LegacyRecord, type OnChainRecord } from "@/lib/v2-reader";
import { evmAddressLink } from "@/lib/register-contract";
import { solanaExplorerLink } from "@/lib/register-solana";
import { VerifyTool } from "./verify-tool";

// Always read live from the chain: no database in the verification path.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ network: string; hash: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { hash } = await params;
  return { title: `Verify ${hash.slice(0, 10)}… · Niara Register` };
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-slate/10 py-3 sm:grid-cols-[12rem_1fr]">
      <dt className="font-mono text-xs uppercase tracking-wide text-slate">{label}</dt>
      <dd className="break-all font-body text-sm text-ink">{children}</dd>
    </div>
  );
}

export default async function VerifyRecordPage({ params }: Props) {
  const { network, hash } = await params;
  if (!isRegisterNetwork(network) || !isHash32(hash)) notFound();
  const hex = hash.replace(/^0x/, "").toLowerCase();

  const locale = await getLocale();
  const dict = dictionaries[locale];
  const t = dict.verify;

  let record: OnChainRecord | null = null;
  let legacy: LegacyRecord | null = null;
  let problem: "notDeployed" | "rpcDown" | null = null;
  try {
    record = await readRecordV2(network, hex);
  } catch (e) {
    problem = e instanceof NotDeployed ? "notDeployed" : "rpcDown";
  }
  if (!record) {
    legacy = await readLegacyRecord(network, hex).catch(() => null);
  }

  const signerLink = (address: string) =>
    isEvm(network) ? evmAddressLink(network, address) : solanaExplorerLink("address", address);

  return (
    <div className="mx-auto max-w-5xl px-6 py-14">
      <header className="border-b border-slate/15 pb-8">
        <p className="font-mono text-xs uppercase tracking-wide text-slate">{t.eyebrow}</p>
        <h1 className="mt-3 font-display text-3xl text-ink">{t.recordTitle}</h1>
        <p className="mt-3 break-all font-mono text-sm text-ink">0x{hex}</p>
        <p className="mt-1 font-mono text-xs text-slate">{dict.register.networks[network]}</p>
      </header>

      {record ? (
        <dl className="mt-8">
          <Row label={t.signer}>
            <a href={signerLink(record.signer)} target="_blank" rel="noreferrer" className="text-brass underline">
              {record.signer}
            </a>
          </Row>
          <Row label={t.registeredAt}>{formatTimestamp(record.timestamp, locale)}</Row>
          <Row label={t.scheme}>{record.scheme === 0 ? t.schemeSigned : t.schemeSalted}</Row>
          <Row label={t.metadata}>
            {record.metadataCommitment === ZERO_HASH ? t.metadataNone : t.metadataPrivate}
          </Row>
          <Row label={t.receipt}>
            {isEvm(network) ? "ERC-721 + ERC-5192 · token id " : "Bubblegum v2 cNFT · asset id "}
            <span className="font-mono text-xs">{record.receiptId}</span>
          </Row>
        </dl>
      ) : legacy ? (
        <div className="mt-8">
          <h2 className="font-display text-xl text-ink">{t.legacyTitle}</h2>
          <p className="mt-2 font-body text-sm text-slate">{t.legacyNote}</p>
          <dl className="mt-4">
            <Row label={t.signer}>{legacy.signer}</Row>
            <Row label={t.registeredAt}>{formatTimestamp(legacy.timestamp, locale)}</Row>
            <Row label={t.metadata}>
              {legacy.documentName} · {legacy.documentType}
            </Row>
          </dl>
        </div>
      ) : (
        <div className="mt-8 border border-dashed border-slate/30 px-6 py-8">
          <p className="font-body text-sm text-slate">
            {problem === "notDeployed" ? t.notDeployed : problem === "rpcDown" ? t.rpcDown : t.notFound}
          </p>
        </div>
      )}

      {(record || legacy) && (
        <VerifyTool
          network={network}
          record={
            record
              ? { recordHash: hex, scheme: record.scheme, metadataCommitment: record.metadataCommitment }
              : { recordHash: hex, scheme: 0, metadataCommitment: ZERO_HASH }
          }
          t={{ verify: dict.verify, pades: dict.pades }}
        />
      )}
    </div>
  );
}
