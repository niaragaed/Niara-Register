"use client";
// Signs a PDF in the browser with an ICP-Brasil certificate (A1 file or A3/
// installed certificate through Web PKI) and hands back the signed bytes.
import { useState } from "react";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import {
  WebPkiNotInstalledError,
  WrongPasswordError,
  listWebPkiCertificates,
  openPfx,
  webPkiSigner,
  type BrowserSigner,
  type WebPkiCertificate,
} from "@/lib/pades/signers";
import { signPdf } from "@/lib/pades/sign";
import { Choice, Label, Notice, inputClass, primaryButton, readFile, secondaryButton } from "./ui";

type Source = "a1" | "a3";

export function PadesSigner({
  pdf,
  t,
  onSigned,
}: {
  pdf: Uint8Array;
  t: Dictionary["pades"];
  onSigned: (signed: Uint8Array) => void;
}) {
  const [source, setSource] = useState<Source>("a1");
  const [pfx, setPfx] = useState<Uint8Array | null>(null);
  const [password, setPassword] = useState("");
  const [signer, setSigner] = useState<BrowserSigner | null>(null);
  const [certs, setCerts] = useState<WebPkiCertificate[] | null>(null);
  const [install, setInstall] = useState<(() => void) | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"opening" | "listing" | "signing" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function openA1() {
    if (!pfx) return;
    setBusy("opening");
    setError(null);
    try {
      setSigner(await openPfx(pfx, password));
      setPassword("");
    } catch (e) {
      setError(e instanceof WrongPasswordError ? t.wrongPassword : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function listA3() {
    setBusy("listing");
    setError(null);
    try {
      setCerts(await listWebPkiCertificates());
    } catch (e) {
      if (e instanceof WebPkiNotInstalledError) {
        setError(t.webPkiMissing);
        setInstall(() => e.install);
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(null);
    }
  }

  async function pickA3(cert: WebPkiCertificate) {
    setError(null);
    try {
      setSigner(await webPkiSigner(cert));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function sign() {
    if (!signer) return;
    setBusy("signing");
    setError(null);
    try {
      const signed = await signPdf(pdf, signer, {
        signerName: signer.summary.subject,
        reason: reason.trim() || undefined,
      });
      onSigned(signed);
    } catch (e) {
      setError(`${t.signError} ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-5 border-t border-slate/15 pt-5">
      <Label>{t.sourceTitle}</Label>
      <Choice<Source>
        value={source}
        onChange={(s) => {
          setSource(s);
          setSigner(null);
          setError(null);
        }}
        disabled={busy !== null}
        options={[
          { id: "a1", title: t.sourceA1 },
          { id: "a3", title: t.sourceA3, hint: t.sourceA3Hint },
        ]}
      />

      {!signer && source === "a1" && (
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="block font-mono text-xs uppercase tracking-wide text-slate">{t.pfxFile}</span>
            <input
              type="file"
              accept=".pfx,.p12,application/x-pkcs12"
              className="mt-1 block font-body text-sm"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                setPfx(f ? await readFile(f) : null);
              }}
            />
          </label>
          <label className="block">
            <span className="block font-mono text-xs uppercase tracking-wide text-slate">{t.password}</span>
            <input
              type="password"
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
          </label>
          <button className={primaryButton} disabled={!pfx || busy !== null} onClick={openA1}>
            {busy === "opening" ? t.opening : t.open}
          </button>
        </div>
      )}

      {!signer && source === "a3" && (
        <div className="mt-4">
          <button className={secondaryButton} disabled={busy !== null} onClick={listA3}>
            {busy === "listing" ? t.listing : t.listA3}
          </button>
          {install && (
            <button className={`${secondaryButton} ml-2`} onClick={() => install()}>
              {t.installWebPki}
            </button>
          )}
          {certs && certs.length === 0 && <p className="mt-3 font-body text-sm text-slate">{t.noCertificates}</p>}
          {certs && certs.length > 0 && (
            <ul className="mt-3 space-y-2">
              {certs.map((c) => (
                <li key={c.thumbprint}>
                  <button className={`${secondaryButton} w-full max-w-md text-left`} onClick={() => pickA3(c)}>
                    <span className="block">{c.subjectName}</span>
                    <span className="block font-mono text-[11px] text-slate">
                      {c.isIcpBrasil && `${t.icpBadge} · `}
                      {c.issuerName} · {t.validUntil} {c.validityEnd.toLocaleDateString()}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {signer && (
        <div className="mt-4 space-y-3">
          <p className="font-body text-sm text-ink">
            {t.signerLabel} {signer.summary.subject}{" "}
            <span className="font-mono text-xs text-slate">
              ({signer.summary.issuer} · {t.validUntil} {signer.summary.validTo.toLocaleDateString()})
            </span>
          </p>
          <label className="block">
            <span className="block font-mono text-xs uppercase tracking-wide text-slate">{t.reason}</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} maxLength={120} />
          </label>
          <button className={primaryButton} disabled={busy !== null} onClick={sign}>
            {busy === "signing" ? t.signing : t.sign}
          </button>
        </div>
      )}

      <p className="mt-4 max-w-xl font-body text-xs text-slate">{t.keyNote}</p>
      <p className="mt-1 max-w-xl font-body text-xs text-slate">{t.policyNote}</p>
      {error && <Notice tone="bad">{error}</Notice>}
    </div>
  );
}
