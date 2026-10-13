import Link from "next/link";
import type { ReactNode } from "react";
import { EVM_NETWORKS, type EvmNetwork } from "@/lib/register-contract";
import type { Dictionary } from "@/lib/i18n/dictionaries";

/** Visual pieces shared by the /explorer/... pages. */

const linkClass =
  "font-mono text-xs text-brass underline decoration-brass/40 underline-offset-2 hover:decoration-brass";

export function ExplorerHeader({
  t,
  network,
  eyebrow,
  title,
}: {
  t: Dictionary["explorer"];
  network: EvmNetwork;
  eyebrow: string;
  title: string;
}) {
  const cfg = EVM_NETWORKS[network];
  return (
    <header className="border-b border-slate/15 pb-8">
      <p className="font-mono text-xs uppercase tracking-wide text-slate">
        {eyebrow} · {cfg.chainName}
      </p>
      <h1 className="mt-3 break-all font-mono text-lg text-ink sm:text-xl">{title}</h1>
      <p className="mt-3 max-w-2xl font-body text-sm leading-relaxed text-slate">
        {t.sourcePrefix}
        {cfg.chainName} (<span className="font-mono text-xs">{cfg.rpcUrl}</span>)
        {t.sourceSuffix}
      </p>
    </header>
  );
}

export function Fields({ children }: { children: ReactNode }) {
  return <dl className="divide-y divide-slate/10">{children}</dl>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[13rem_1fr] sm:gap-4">
      <dt className="font-mono text-xs uppercase tracking-wide text-slate">{label}</dt>
      <dd className="min-w-0 [overflow-wrap:anywhere] font-body text-sm text-ink">{children}</dd>
    </div>
  );
}

export function InternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={linkClass}>
      {children}
    </Link>
  );
}

export function Notice({ title, text }: { title: string; text: string }) {
  return (
    <div className="mt-8 border border-dashed border-slate/30 px-6 py-8">
      <p className="font-display text-lg text-ink">{title}</p>
      <p className="mt-2 max-w-xl font-body text-sm leading-relaxed text-slate">{text}</p>
    </div>
  );
}

/** curl command that repeats the query straight against the RPC, with nothing from Niara in between. */
export function CheckYourself({
  t,
  rpcUrl,
  calls,
}: {
  t: Dictionary["explorer"];
  rpcUrl: string;
  calls: { method: string; params: unknown[] }[];
}) {
  return (
    <section className="mt-12 border-t border-slate/15 pt-8">
      <h2 className="font-display text-xl text-ink">{t.checkYourselfTitle}</h2>
      <p className="mt-2 max-w-xl font-body text-sm leading-relaxed text-slate">{t.checkYourselfText}</p>
      {calls.map((c) => (
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

export function Back({ t }: { t: Dictionary["explorer"] }) {
  return (
    <p className="mt-12">
      <InternalLink href="/signatures">← {t.back}</InternalLink>
    </p>
  );
}
