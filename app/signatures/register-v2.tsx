"use client";
// v2 registration: (optionally) PAdES-sign a PDF with ICP-Brasil, commit the
// file privately, register it on one of the six networks with a soulbound
// receipt, then build the holder's proof package (W3C VC 2.0 + presentation).
import { useEffect, useState } from "react";
import Link from "next/link";
import { Contract } from "ethers";
import type { Signer } from "ethers";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/locale";
import { formatTimestamp } from "@/lib/i18n/format";
import {
  SCHEME_SALTED,
  SCHEME_SIGNED_PDF,
  metadataCommitment,
  newSalt,
  recordHashFor,
  sha256,
  toHex,
  type HashScheme,
} from "@/lib/commitments";
import { inspectPdfSignatures, type PadesSignatureReport } from "@/lib/pades/inspect";
import { EVM_NETWORKS, evmTxLink } from "@/lib/register-contract";
import { SIGNATURE_REGISTRY_V2_ABI, v2Deployment } from "@/lib/register-v2-evm";
import {
  computeBudgetIx,
  fetchReceiptConfig,
  fetchRecordV2,
  registerV2Instruction,
  solanaV2ErrorReason,
} from "@/lib/register-v2-solana";
import { fetchSolanaRecord, solanaExplorerLink } from "@/lib/register-solana";
import { didPkh, isEvm, type RegisterNetwork } from "@/lib/networks";
import {
  WalletMissing,
  WrongEvmNetwork,
  connectEvm,
  evmChainLabel,
  connectSolana,
  downloadBytes,
  isRejection,
  sendSolana,
  solanaConnection,
} from "@/lib/wallets";
import type { SolanaProvider } from "@/lib/solana";
import { createEvmPresentation, createSolanaPresentation } from "@/lib/vc/presentation";
import { PROOF_PACKAGE_FORMAT, type ProofPackage } from "@/lib/proof-package";
import { readLegacyRecord, readRecordV2 } from "@/lib/v2-reader";
import { DOCUMENT_TYPES, documentTypeBySlug } from "@/lib/document-types";
import { previousRegistrations, rememberRegistration, type LocalRegistration } from "@/lib/local-registrations";
import { PadesSigner } from "@/components/v2/pades-signer";
import { PadesReport } from "@/components/v2/pades-report";
import {
  Choice,
  Label,
  NetworkPicker,
  Notice,
  inputClass,
  linkClass,
  primaryButton,
  readFile,
  secondaryButton,
  short,
} from "@/components/v2/ui";

type Mode = "sign" | "signed" | "other";
type Wallet = { kind: "evm"; signer: Signer; address: string } | { kind: "solana"; provider: SolanaProvider; address: string };
type Existing = { version: 1 | 2; signer: string; timestamp: number } | null;
type Texts = Pick<Dictionary, "register" | "pades" | "proof">;

class ContractNotOnWallet extends Error {}

export function RegisterV2({ t, locale }: { t: Texts; locale: Locale }) {
  const tr = t.register;
  const [network, setNetwork] = useState<RegisterNetwork>("sepolia");
  const [mode, setMode] = useState<Mode>("sign");
  const [fileName, setFileName] = useState<string | null>(null);
  const [original, setOriginal] = useState<Uint8Array | null>(null);
  const [docBytes, setDocBytes] = useState<Uint8Array | null>(null); // the bytes that get registered
  const [reports, setReports] = useState<PadesSignatureReport[] | null>(null);
  const [fileSha, setFileSha] = useState<string | null>(null);
  const [salt, setSalt] = useState<Uint8Array>(() => newSalt());
  const [name, setName] = useState("");
  // Type slug from the fixed list (lib/document-types.ts); its code goes on-chain.
  const [type, setType] = useState("");
  const typeCode = documentTypeBySlug(type)?.code ?? 0;
  const nameAndTypeOk = name.trim() !== "" && typeCode > 0;
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [existing, setExisting] = useState<Existing>(null);
  const [status, setStatus] = useState<"idle" | "reading" | "connecting" | "checking" | "registering" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [recordHash, setRecordHash] = useState<string | null>(null);
  const [metaCommit, setMetaCommit] = useState<string | null>(null);
  const [credential, setCredential] = useState<string | null>(null);
  const [presentation, setPresentation] = useState<string | Record<string, unknown> | null>(null);
  const [proofBusy, setProofBusy] = useState<"issuing" | "presenting" | null>(null);
  const [proofError, setProofError] = useState<string | null>(null);
  const [seenHere, setSeenHere] = useState<LocalRegistration[]>([]);

  const scheme: HashScheme = mode === "other" ? SCHEME_SALTED : SCHEME_SIGNED_PDF;
  const registered = status === "done";
  const locked = status === "connecting" || status === "checking" || status === "registering" || registered;

  function resetAfterDocument() {
    setWallet(null);
    setExisting(null);
    setTxHash(null);
    setReceiptId(null);
    setCredential(null);
    setPresentation(null);
    setError(null);
    setProofError(null);
    setStatus("idle");
  }

  async function adoptDocument(bytes: Uint8Array) {
    setDocBytes(bytes);
    const sha = toHex(await sha256(bytes));
    setFileSha(sha);
    setSeenHere(previousRegistrations(sha));
    setSalt(newSalt());
    if (mode !== "other") setReports(await inspectPdfSignatures(bytes));
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    resetAfterDocument();
    setStatus("reading");
    setFileName(file.name);
    const bytes = await readFile(file);
    setOriginal(bytes);
    setReports(null);
    if (mode === "sign") {
      setDocBytes(null);
      setFileSha(null);
    } else {
      await adoptDocument(bytes);
    }
    setStatus("idle");
  }

  // Record hash and metadata commitment follow the document, salt, name and type.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!fileSha) {
        setRecordHash(null);
        setMetaCommit(null);
        return;
      }
      const rh = await recordHashFor(scheme, fileSha, salt);
      const mc = await metadataCommitment({ name, type }, salt);
      if (!cancelled) {
        setRecordHash(rh);
        setMetaCommit(mc);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fileSha, salt, name, type, scheme]);

  const deployment = isEvm(network) ? v2Deployment(network) : null;
  const evmUnavailable = isEvm(network) && !deployment?.registry;

  function explain(e: unknown): string {
    if (e instanceof WalletMissing) return isEvm(network) ? tr.noWallet : tr.noSolanaWallet;
    if (e instanceof WrongEvmNetwork && isEvm(network)) {
      return tr.wrongNetwork
        .replaceAll("{chain}", evmChainLabel(e.actualChainId))
        .replaceAll("{expected}", evmChainLabel(Number(EVM_NETWORKS[network].chainIdHex)));
    }
    if (e instanceof ContractNotOnWallet) return tr.contractNotOnWallet;
    if (isRejection(e)) return tr.rejected;
    const reason = !isEvm(network) ? solanaV2ErrorReason(e) : null;
    if (reason === "AlreadyRegistered") return tr.alreadyRecorded;
    if (reason === "AlreadyRegisteredV1") return tr.alreadyRecordedV1;
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes("AlreadyRegistered")) return tr.alreadyRecorded;
    return `${tr.error} ${message}`;
  }

  async function connectAndCheck() {
    if (!recordHash || !fileSha) return;
    setError(null);
    setExisting(null);
    try {
      setStatus("connecting");
      if (isEvm(network)) {
        const { signer, address } = await connectEvm(network);
        setWallet({ kind: "evm", signer, address });
        setStatus("checking");
        // Reads go through the site's RPC for the chosen network, not the wallet's.
        const rec = await readRecordV2(network, recordHash);
        if (rec) {
          setExisting({ version: 2, signer: rec.signer, timestamp: rec.timestamp });
        } else {
          const v1 = await readLegacyRecord(network, fileSha);
          if (v1) setExisting({ version: 1, signer: v1.signer, timestamp: v1.timestamp });
        }
      } else {
        const { provider, address } = await connectSolana();
        setWallet({ kind: "solana", provider, address });
        setStatus("checking");
        const conn = solanaConnection();
        const rec = await fetchRecordV2(conn, recordHash);
        if (rec) setExisting({ version: 2, signer: rec.signer, timestamp: rec.timestamp });
        else {
          const v1 = await fetchSolanaRecord(conn, fileSha);
          if (v1) setExisting({ version: 1, signer: v1.signer, timestamp: v1.timestamp });
        }
      }
      setStatus("idle");
    } catch (e) {
      console.error(e);
      setError(explain(e));
      setWallet(null);
      setStatus("idle");
    }
  }

  async function register() {
    if (!wallet || !recordHash || !metaCommit || !nameAndTypeOk) return;
    setError(null);
    setStatus("registering");
    try {
      if (wallet.kind === "evm" && isEvm(network)) {
        // The wallet may have changed network since it connected.
        const chainId = Number((await wallet.signer.provider!.getNetwork()).chainId);
        if (chainId !== Number(EVM_NETWORKS[network].chainIdHex)) throw new WrongEvmNetwork(chainId);
        if ((await wallet.signer.provider!.getCode(deployment!.registry!)) === "0x") throw new ContractNotOnWallet();
        const registry = new Contract(deployment!.registry!, SIGNATURE_REGISTRY_V2_ABI, wallet.signer);
        const tx = await registry.register(`0x${recordHash}`, scheme, typeCode, `0x${metaCommit}`);
        const receipt = await tx.wait();
        setTxHash(receipt?.hash ?? tx.hash);
        setReceiptId(BigInt(`0x${recordHash}`).toString());
      } else if (wallet.kind === "solana") {
        const conn = solanaConnection();
        const cfg = await fetchReceiptConfig(conn);
        if (!cfg) throw new Error(tr.noReceiptConfig);
        const sig = await sendSolana(
          wallet.provider,
          computeBudgetIx(),
          registerV2Instruction(wallet.provider.publicKey!, cfg, recordHash, scheme, typeCode, metaCommit),
        );
        setTxHash(sig);
        setReceiptId((await fetchRecordV2(conn, recordHash))?.receiptAssetId ?? null);
      }
      if (fileSha) {
        rememberRegistration(fileSha, { network, recordHash, at: new Date().toISOString() });
      }
      setStatus("done");
    } catch (e) {
      console.error(e);
      setError(explain(e));
      setStatus("idle");
    }
  }

  function proofPackage(): ProofPackage | null {
    if (!recordHash || !fileSha || !metaCommit) return null;
    const hasMeta = name.trim() !== "" || type !== "";
    return {
      format: PROOF_PACKAGE_FORMAT,
      network,
      recordHash,
      scheme,
      documentType: typeCode,
      fileName: fileName ?? undefined,
      fileSha256: fileSha,
      salt: toHex(salt),
      ...(hasMeta ? { metadata: { name: name.trim(), type } } : {}),
      metadataCommitment: metaCommit,
      txHash: txHash ?? undefined,
      receiptId: receiptId ?? undefined,
      credential: credential ?? undefined,
      presentation: presentation ?? undefined,
      createdAt: new Date().toISOString(),
    };
  }

  async function issueCredential() {
    const pkg = proofPackage();
    if (!pkg) return;
    setProofBusy("issuing");
    setProofError(null);
    try {
      const res = await fetch("/api/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          network,
          recordHash: pkg.recordHash,
          fileSha256: pkg.fileSha256,
          salt: pkg.salt,
          metadata: pkg.metadata ?? null,
        }),
      });
      const body = (await res.json()) as { jwt?: string; error?: string };
      if (!res.ok || !body.jwt) {
        throw new Error(body.error === "issuer_not_configured" ? t.proof.issuerDown : `${t.proof.issueError} (${body.error ?? res.status})`);
      }
      setCredential(body.jwt);
    } catch (e) {
      setProofError(e instanceof Error ? e.message : String(e));
    } finally {
      setProofBusy(null);
    }
  }

  async function signPresentation() {
    if (!credential || !wallet) return;
    setProofBusy("presenting");
    setProofError(null);
    try {
      const holder = didPkh(network, wallet.address);
      if (wallet.kind === "evm" && isEvm(network)) {
        setPresentation(
          await createEvmPresentation(wallet.signer, parseInt(EVM_NETWORKS[network].chainIdHex, 16), holder, credential),
        );
      } else if (wallet.kind === "solana") {
        const sm = wallet.provider.signMessage;
        if (!sm) throw new Error("This wallet cannot sign messages.");
        setPresentation(
          await createSolanaPresentation(async (m) => (await sm.call(wallet.provider, m, "utf8")).signature, holder, credential),
        );
      }
    } catch (e) {
      setProofError(isRejection(e) ? tr.rejected : e instanceof Error ? e.message : String(e));
    } finally {
      setProofBusy(null);
    }
  }

  const txLink = (tx: string) => (isEvm(network) ? evmTxLink(network, tx) : solanaExplorerLink("tx", tx));

  return (
    <div className="border border-slate/25 px-6 py-8">
      <Label>{tr.networkTitle}</Label>
      <NetworkPicker
        value={network}
        onChange={(n) => {
          setNetwork(n);
          resetAfterDocument();
        }}
        names={tr.networks}
        walletEvm={tr.walletEvm}
        walletSolana={tr.walletSolana}
        disabled={locked && !registered}
      />
      {evmUnavailable && <Notice tone="bad">{tr.notDeployed}</Notice>}

      <div className="mt-6">
        <Label>{tr.modeTitle}</Label>
        <Choice<Mode>
          value={mode}
          disabled={locked && !registered}
          onChange={(m) => {
            setMode(m);
            setFileName(null);
            setOriginal(null);
            setDocBytes(null);
            setFileSha(null);
            setReports(null);
            resetAfterDocument();
          }}
          options={[
            { id: "sign", title: tr.modeSign, hint: tr.modeSignHint },
            { id: "signed", title: tr.modeSigned, hint: tr.modeSignedHint },
            { id: "other", title: tr.modeOther, hint: tr.modeOtherHint },
          ]}
        />
      </div>

      <label className="mt-6 block cursor-pointer border border-dashed border-slate/40 px-6 py-10 text-center transition-colors hover:border-brass">
        <input
          type="file"
          className="sr-only"
          accept={mode === "other" ? undefined : "application/pdf,.pdf"}
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        <span className="font-body text-sm text-slate">
          {status === "reading"
            ? tr.computing
            : fileName
              ? `${tr.file} ${fileName}`
              : mode === "other"
                ? tr.chooseFile
                : tr.choosePdf}
        </span>
      </label>
      <p className="mt-3 max-w-xl font-body text-xs text-slate">{tr.privacyNote}</p>
      {mode === "other" && (
        <p className="mt-1 max-w-xl font-body text-xs text-slate">
          {tr.alreadyHint}{" "}
          <Link href="/verify" className={linkClass}>
            {tr.alreadyHintLink} →
          </Link>
        </p>
      )}
      {seenHere.length > 0 && !registered && (
        <Notice tone="neutral">
          {tr.seenHere}
          <ul className="mt-2 space-y-1">
            {seenHere.map((e) => (
              <li key={`${e.network}-${e.recordHash}`} className="font-mono text-xs">
                <a href={`/verify/${e.network}/0x${e.recordHash}`} className={linkClass}>
                  {tr.networks[e.network]} · 0x{e.recordHash.slice(0, 10)}… · {new Date(e.at).toLocaleString(locale === "pt" ? "pt-BR" : "en-US")}
                </a>
              </li>
            ))}
          </ul>
          {mode === "other" && <p className="mt-2">{tr.seenHereSalted}</p>}
        </Notice>
      )}

      {mode === "sign" && original && !docBytes && (
        <PadesSigner
          pdf={original}
          t={t.pades}
          onSigned={async (signed) => {
            await adoptDocument(signed);
          }}
        />
      )}

      {mode === "sign" && docBytes && (
        <Notice tone="ok">
          {t.pades.signed}{" "}
          <button
            className={linkClass}
            onClick={() => downloadBytes(docBytes, (fileName ?? "document.pdf").replace(/\.pdf$/i, "") + "-signed.pdf", "application/pdf")}
          >
            {t.pades.download}
          </button>
        </Notice>
      )}

      {reports && <PadesReport reports={reports} t={t.pades} />}

      {fileSha && recordHash && (
        <div className="mt-6 border-t border-slate/15 pt-6">
          <Label>{tr.metaTitle}</Label>
          <p className="mt-1 max-w-xl font-body text-xs text-slate">{tr.metaHint}</p>
          <div className="mt-3 space-y-3">
            <label className="block">
              <span className="block font-mono text-xs uppercase tracking-wide text-slate">{tr.nameField}</span>
              <input
                value={name}
                disabled={locked}
                onChange={(e) => setName(e.target.value)}
                placeholder={tr.namePlaceholder}
                maxLength={200}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="block font-mono text-xs uppercase tracking-wide text-slate">{tr.typeField}</span>
              <select
                value={type}
                disabled={locked}
                onChange={(e) => setType(e.target.value)}
                className={inputClass}
              >
                <option value="">{tr.typePlaceholder}</option>
                {DOCUMENT_TYPES.map((d) => (
                  <option key={d.slug} value={d.slug}>
                    {locale === "pt" ? d.pt : d.en}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-6">
            <Label>{tr.recordHashTitle}</Label>
            <p className="mt-2 break-all font-mono text-sm text-ink">{recordHash}</p>
            <p className="mt-2 max-w-xl font-body text-xs text-slate">
              {scheme === SCHEME_SIGNED_PDF ? tr.schemeSigned : tr.schemeSalted}
            </p>
          </div>

          {existing && (
            <Notice tone="neutral">
              {existing.version === 2 ? tr.alreadyRecorded : tr.alreadyRecordedV1} {short(existing.signer)} ·{" "}
              {formatTimestamp(existing.timestamp, locale)}
            </Notice>
          )}

          {!registered && (
            <div className="mt-5 flex flex-wrap items-center gap-3">
              {!wallet ? (
                <button className={primaryButton} disabled={evmUnavailable || locked} onClick={connectAndCheck}>
                  {status === "connecting" ? tr.connecting : status === "checking" ? tr.checking : tr.connect}
                </button>
              ) : (
                <button
                  className={primaryButton}
                  disabled={evmUnavailable || status === "registering" || existing?.version === 2 || !nameAndTypeOk}
                  onClick={register}
                >
                  {tr.register}
                </button>
              )}
              {wallet && !nameAndTypeOk && (
                <span className="font-body text-xs text-slate">{tr.nameTypeRequired}</span>
              )}
              {wallet && (
                <span className="font-mono text-xs text-slate">
                  {tr.connectedWallet} {short(wallet.address)}
                </span>
              )}
            </div>
          )}
          {status === "registering" && <p className="mt-3 font-body text-sm text-slate">{tr.waiting}</p>}
          {error && <Notice tone="bad">{error}</Notice>}

          {registered && txHash && (
            <div className="mt-5 border border-moss/40 bg-moss/5 px-5 py-4">
              <p className="font-mono text-xs uppercase tracking-wide text-moss">{tr.success}</p>
              {receiptId && (
                <p className="mt-2 break-all font-mono text-xs text-ink">
                  {isEvm(network) ? tr.receiptEvm : tr.receiptSolana}: {receiptId}
                </p>
              )}
              <p className="mt-1 max-w-xl font-body text-xs text-slate">{tr.receiptWalletNote}</p>
              <p className="mt-2 flex flex-wrap gap-4">
                <a href={txLink(txHash)} target="_blank" rel="noreferrer" className={linkClass}>
                  {tr.viewTx} ↗
                </a>
                <a href={`/verify/${network}/0x${recordHash}`} className={linkClass}>
                  {tr.verifyLink} →
                </a>
              </p>
            </div>
          )}

          {registered && (
            <div className="mt-6 border-t border-slate/15 pt-6">
              <h3 className="font-display text-lg text-ink">{t.proof.title}</h3>
              <p className="mt-2 max-w-xl font-body text-sm text-slate">{t.proof.lede}</p>
              {scheme === SCHEME_SALTED && <Notice tone="bad">{t.proof.saltWarning}</Notice>}
              <div className="mt-4 flex flex-wrap gap-3">
                <button className={secondaryButton} disabled={proofBusy !== null || Boolean(credential)} onClick={issueCredential}>
                  {proofBusy === "issuing" ? t.proof.issuing : t.proof.issue}
                </button>
                <button
                  className={secondaryButton}
                  disabled={!credential || proofBusy !== null || Boolean(presentation)}
                  onClick={signPresentation}
                >
                  {proofBusy === "presenting" ? t.proof.presenting : t.proof.present}
                </button>
                <button
                  className={primaryButton}
                  onClick={() => {
                    const pkg = proofPackage();
                    if (pkg)
                      downloadBytes(
                        JSON.stringify(pkg, null, 2),
                        `niara-proof-${recordHash.slice(0, 12)}.json`,
                        "application/json",
                      );
                  }}
                >
                  {t.proof.download}
                </button>
              </div>
              {credential && <Notice tone="ok">{t.proof.issued}</Notice>}
              {presentation && <Notice tone="ok">{t.proof.presented}</Notice>}
              {isEvm(network) && credential && !presentation && (
                <p className="mt-2 max-w-xl font-body text-xs text-slate">{t.proof.presentEvmNote}</p>
              )}
              {proofError && <Notice tone="bad">{proofError}</Notice>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
