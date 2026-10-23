"use client";
import type { PadesSignatureReport } from "@/lib/pades/inspect";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { Label, linkClass } from "./ui";

export function PadesReport({ reports, t }: { reports: PadesSignatureReport[]; t: Dictionary["pades"] }) {
  return (
    <div className="mt-5">
      <Label>{t.reportTitle}</Label>
      {reports.length === 0 ? (
        <p className="mt-2 font-body text-sm text-slate">{t.noSignatures}</p>
      ) : (
        <ol className="mt-2 space-y-3">
          {reports.map((r, i) => {
            const ok = r.digestMatches && r.signatureValid;
            return (
              <li key={r.byteRange.join(",")} className="border border-slate/20 px-4 py-3">
                <p className="font-body text-sm text-ink">
                  {i + 1}. {r.signer?.commonName || "?"}
                  {r.signer?.cpfMasked && <span className="text-slate"> · CPF {r.signer.cpfMasked}</span>}
                  {r.signer?.cnpj && <span className="text-slate"> · CNPJ {r.signer.cnpj}</span>}
                </p>
                <p className="mt-1 font-mono text-xs">
                  <span className={ok ? "text-moss" : "text-red-700"}>{ok ? t.valid : t.invalid}</span>
                  <span className="text-slate"> · {r.coversWholeFile ? t.coversAll : t.modified}</span>
                  <span className="text-slate">
                    {" · "}
                    {r.chain.status === "icp-brasil"
                      ? `${t.chainIcp} ${r.chain.root}`
                      : r.chain.status === "incomplete"
                        ? t.chainIncomplete
                        : t.chainUntrusted}
                  </span>
                  <span className="text-slate">
                    {" · "}
                    {r.policyName ? `${t.policy} ${r.policyName}` : t.noPolicy}
                  </span>
                </p>
                {r.signer?.issuerCommonName && (
                  <p className="mt-1 font-mono text-[11px] text-slate">
                    {r.signer.issuerCommonName} · {r.pdfSigningTime ?? ""}
                  </p>
                )}
                {r.error && <p className="mt-1 font-mono text-[11px] text-red-700">{r.error}</p>}
              </li>
            );
          })}
        </ol>
      )}
      <p className="mt-3 max-w-xl font-body text-xs text-slate">
        {t.revocationNote}{" "}
        <a href="https://validar.iti.gov.br" target="_blank" rel="noreferrer" className={linkClass}>
          {t.itiLink} ↗
        </a>
      </p>
    </div>
  );
}
