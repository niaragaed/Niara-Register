import Link from "next/link";
import type { ReactNode } from "react";
import { REDES_EVM, type RedeEvm } from "@/lib/registro-contract";
import type { Dictionary } from "@/lib/i18n/dictionaries";

/** Peças visuais compartilhadas pelas páginas /explorer/... */

const classeLink =
  "font-mono text-xs text-brass underline decoration-brass/40 underline-offset-2 hover:decoration-brass";

export function CabecalhoExplorador({
  t,
  rede,
  eyebrow,
  titulo,
}: {
  t: Dictionary["explorador"];
  rede: RedeEvm;
  eyebrow: string;
  titulo: string;
}) {
  const cfg = REDES_EVM[rede];
  return (
    <header className="border-b border-slate/15 pb-8">
      <p className="font-mono text-xs uppercase tracking-wide text-slate">
        {eyebrow} · {cfg.chainName}
      </p>
      <h1 className="mt-3 break-all font-mono text-lg text-ink sm:text-xl">{titulo}</h1>
      <p className="mt-3 max-w-2xl font-body text-sm leading-relaxed text-slate">
        {t.fontePrefixo}
        {cfg.chainName} (<span className="font-mono text-xs">{cfg.rpcUrl}</span>)
        {t.fonteSufixo}
      </p>
    </header>
  );
}

export function Campos({ children }: { children: ReactNode }) {
  return <dl className="divide-y divide-slate/10">{children}</dl>;
}

export function Campo({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[13rem_1fr] sm:gap-4">
      <dt className="font-mono text-xs uppercase tracking-wide text-slate">{rotulo}</dt>
      <dd className="min-w-0 [overflow-wrap:anywhere] font-body text-sm text-ink">{children}</dd>
    </div>
  );
}

export function LinkInterno({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={classeLink}>
      {children}
    </Link>
  );
}

export function Aviso({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div className="mt-8 border border-dashed border-slate/30 px-6 py-8">
      <p className="font-display text-lg text-ink">{titulo}</p>
      <p className="mt-2 max-w-xl font-body text-sm leading-relaxed text-slate">{texto}</p>
    </div>
  );
}

/** Comando curl que repete a consulta direto no RPC, sem nada da Niara no meio. */
export function ConfiraVoceMesmo({
  t,
  rpcUrl,
  chamadas,
}: {
  t: Dictionary["explorador"];
  rpcUrl: string;
  chamadas: { method: string; params: unknown[] }[];
}) {
  return (
    <section className="mt-12 border-t border-slate/15 pt-8">
      <h2 className="font-display text-xl text-ink">{t.confiraTitulo}</h2>
      <p className="mt-2 max-w-xl font-body text-sm leading-relaxed text-slate">{t.confiraTexto}</p>
      {chamadas.map((c) => (
        <pre
          key={c.method}
          className="mt-4 overflow-x-auto border border-slate/20 bg-ink/[0.03] px-4 py-3 font-mono text-[11px] leading-relaxed text-ink"
        >
          {`curl -s ${rpcUrl} \\\n  -H 'content-type: application/json' \\\n  -d '${JSON.stringify({ jsonrpc: "2.0", id: 1, method: c.method, params: c.params })}'`}
        </pre>
      ))}
    </section>
  );
}

export function Voltar({ t }: { t: Dictionary["explorador"] }) {
  return (
    <p className="mt-12">
      <LinkInterno href="/signatures">← {t.voltar}</LinkInterno>
    </p>
  );
}
