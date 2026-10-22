"use client";
// Checks the holder's files against an on-chain record, entirely in the browser.
import { useState } from "react";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import {
  SCHEME_SALTED,
  fromHex,
  metadataCommitment,
  saltedRecordHash,
  sha256,
  toHex,
} from "@/lib/commitments";
import { inspectPdfSignatures, type PadesSignatureReport } from "@/lib/pades/inspect";
import { isProofPackage, type ProofPackage } from "@/lib/proof-package";
import { verifyCredentialJwt } from "@/lib/vc/verify-credential";
import { verifyPresentation } from "@/lib/vc/presentation";
import { PadesReport } from "@/components/v2/pades-report";
import { Label, Notice, primaryButton, readFile, secondaryButton } from "@/components/v2/ui";
import { downloadBytes } from "@/lib/wallets";

type Line = { tone: "ok" | "bad" | "neutral"; text: string };

export function VerifyTool({
  record,
  network,
  t,
}: {
  record: { recordHash: string; scheme: number; metadataCommitment: string };
  network: string;
  t: Pick<Dictionary, "verify" | "pades">;
}) {
  const tv = t.verify;
  const [lines, setLines] = useState<Line[]>([]);
  const [reports, setReports] = useState<PadesSignatureReport[] | null>(null);
  // A v2 package without a credential (e.g. the issuer was down at registration
  // time) can get one here: the server re-checks everything against the chain.
  const [pending, setPending] = useState<ProofPackage | null>(null);
  const [updated, setUpdated] = useState<ProofPackage | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);

  async function issueForPackage() {
    if (!pending) return;
    setIssuing(true);
    setIssueError(null);
    try {
      const res = await fetch("/api/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          network,
          recordHash: pending.recordHash,
          fileSha256: pending.fileSha256,
          salt: pending.salt,
          metadata: pending.metadata ?? null,
        }),
      });
      const body = (await res.json()) as { jwt?: string; error?: string };
      if (!res.ok || !body.jwt) throw new Error(body.error ?? String(res.status));
      setUpdated({ ...pending, credential: body.jwt });
      setPending(null);
    } catch (e) {
      setIssueError(e instanceof Error ? e.message : String(e));
    } finally {
      setIssuing(false);
    }
  }

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setPending(null);
    setUpdated(null);
    setIssueError(null);
    const out: Line[] = [];
    let pkg: ProofPackage | null = null;
    let doc: { bytes: Uint8Array; isPdf: boolean } | null = null;

    for (const file of Array.from(files)) {
      const bytes = await readFile(file);
      if (file.name.toLowerCase().endsWith(".json")) {
        try {
          const parsed = JSON.parse(new TextDecoder().decode(bytes));
          if (isProofPackage(parsed)) {
            pkg = parsed;
            continue;
          }
        } catch {
          // not JSON: treat as the document itself
        }
      }
      doc = { bytes, isPdf: bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 };
    }

    // 1. The document against the record.
    if (doc) {
      const fileSha = toHex(await sha256(doc.bytes));
      if (record.scheme === SCHEME_SALTED) {
        if (!pkg) out.push({ tone: "neutral", text: tv.needSalt });
        else {
          const rh = await saltedRecordHash(fileSha, fromHex(pkg.salt));
          out.push(rh === record.recordHash ? { tone: "ok", text: tv.fileMatches } : { tone: "bad", text: tv.fileDoesNotMatch });
        }
      } else {
        out.push(fileSha === record.recordHash ? { tone: "ok", text: tv.fileMatches } : { tone: "bad", text: tv.fileDoesNotMatch });
      }
      setReports(doc.isPdf ? await inspectPdfSignatures(doc.bytes) : null);
    }

    // 2. The proof package: its own consistency, name/type, credential, presentation.
    if (pkg) {
      if (!doc && record.scheme === SCHEME_SALTED) {
        const rh = await saltedRecordHash(pkg.fileSha256, fromHex(pkg.salt));
        out.push(rh === record.recordHash ? { tone: "ok", text: tv.fileMatches } : { tone: "bad", text: tv.fileDoesNotMatch });
      }
      if (pkg.metadata) {
        const mc = await metadataCommitment(pkg.metadata, fromHex(pkg.salt));
        out.push(
          mc === record.metadataCommitment
            ? { tone: "ok", text: `${tv.metaMatches} ${pkg.metadata.name} · ${pkg.metadata.type}` }
            : { tone: "bad", text: tv.metaDoesNotMatch },
        );
      }
      if (pkg.credential) {
        const vc = await verifyCredentialJwt(pkg.credential);
        const subject = vc.credential?.credentialSubject;
        if (!vc.valid) out.push({ tone: "bad", text: `${tv.vcInvalid} ${vc.reason ?? ""}` });
        else if (subject?.document.recordHash !== record.recordHash || subject?.registration.network !== network) {
          out.push({ tone: "bad", text: tv.vcMismatch });
        } else {
          out.push({ tone: "ok", text: `${tv.vcValid} ${vc.issuer}` });
          if (vc.x5cPresent) out.push({ tone: "neutral", text: tv.x5c });
        }
      }
      if (!pkg.credential && pkg.recordHash === record.recordHash && pkg.network === network) {
        setPending(pkg);
      }
      if (pkg.presentation) {
        const vp = await verifyPresentation(pkg.presentation as string | Record<string, unknown>);
        if (vp.valid && vp.vcJwt === pkg.credential) {
          out.push({ tone: "ok", text: `${tv.vpValid} (${vp.format}): ${vp.holder}` });
        } else {
          out.push({ tone: "bad", text: `${tv.vpInvalid} ${vp.reason ?? "credential mismatch"}` });
        }
      }
    }
    setLines(out);
  }

  return (
    <div className="mt-10 border-t border-slate/15 pt-8">
      <h2 className="font-display text-xl text-ink">{tv.dropTitle}</h2>
      <p className="mt-2 max-w-xl font-body text-sm text-slate">{tv.dropLede}</p>
      <label className="mt-5 block cursor-pointer border border-dashed border-slate/40 px-6 py-10 text-center transition-colors hover:border-brass">
        <input type="file" multiple className="sr-only" onChange={(e) => onFiles(e.target.files)} />
        <span className="font-body text-sm text-slate">{tv.chooseFiles}</span>
      </label>
      {lines.map((l, i) => (
        <Notice key={i} tone={l.tone}>
          {l.text}
        </Notice>
      ))}
      {pending && (
        <div className="mt-4">
          <button className={secondaryButton} disabled={issuing} onClick={issueForPackage}>
            {issuing ? tv.issuingFromPackage : tv.issueFromPackage}
          </button>
          {issueError && <Notice tone="bad">{issueError}</Notice>}
        </div>
      )}
      {updated && (
        <div className="mt-4">
          <Notice tone="ok">{tv.issuedFromPackage}</Notice>
          <button
            className={`${primaryButton} mt-3`}
            onClick={() =>
              downloadBytes(
                JSON.stringify(updated, null, 2),
                `niara-proof-${updated.recordHash.slice(0, 12)}.json`,
                "application/json",
              )
            }
          >
            {tv.downloadUpdated}
          </button>
        </div>
      )}
      {reports && (
        <div className="mt-2">
          <Label>PAdES</Label>
          <PadesReport reports={reports} t={t.pades} />
        </div>
      )}
    </div>
  );
}
