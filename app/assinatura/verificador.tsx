"use client";

import { useState } from "react";

async function calcularSha256(arquivo: File): Promise<string> {
  const buffer = await arquivo.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const bytes = Array.from(new Uint8Array(hashBuffer));
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function VerificadorDeDocumento() {
  const [hash, setHash] = useState<string | null>(null);
  const [nomeArquivo, setNomeArquivo] = useState<string | null>(null);
  const [status, setStatus] = useState<
    "idle" | "calculando" | "pronto"
  >("idle");

  async function aoSelecionarArquivo(evento: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = evento.target.files?.[0];
    if (!arquivo) return;
    setStatus("calculando");
    setNomeArquivo(arquivo.name);
    const digest = await calcularSha256(arquivo);
    setHash(digest);
    setStatus("pronto");
  }

  return (
    <div className="border border-slate/25 px-6 py-8">
      <label className="block cursor-pointer border border-dashed border-slate/40 px-6 py-10 text-center transition-colors hover:border-brass">
        <input
          type="file"
          className="sr-only"
          onChange={aoSelecionarArquivo}
        />
        <span className="font-body text-sm text-slate">
          {status === "idle" && "Selecione um documento para calcular o hash"}
          {status === "calculando" && "Calculando hash..."}
          {status === "pronto" && `Arquivo: ${nomeArquivo}`}
        </span>
      </label>

      {hash && (
        <div className="mt-6 border-t border-slate/15 pt-6">
          <p className="font-mono text-xs uppercase tracking-wide text-slate">
            Hash SHA-256
          </p>
          <p className="mt-2 break-all font-mono text-sm text-ink">{hash}</p>
          <p className="mt-4 max-w-md font-body text-sm leading-relaxed text-slate">
            Este hash é calculado localmente, no seu navegador — o documento
            em si nunca é enviado. Para registrar esta prova on-chain, é
            preciso assinar com um endereço de carteira na próxima etapa.
          </p>
          <button
            disabled
            title="Registro on-chain ainda não conectado nesta instância"
            className="mt-5 border border-slate/40 px-5 py-2.5 font-body text-sm text-slate/60"
          >
            Assinar e registrar on-chain
          </button>
        </div>
      )}
    </div>
  );
}
