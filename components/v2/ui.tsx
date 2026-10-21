"use client";
// Small building blocks shared by the v2 pages, in the site's existing style.
import type { ReactNode } from "react";
import { REGISTER_NETWORKS, type RegisterNetwork } from "@/lib/networks";

export const inputClass =
  "mt-1 w-full max-w-md border border-slate/30 bg-bone px-3 py-2 font-body text-sm text-ink outline-none focus:border-brass";
export const primaryButton =
  "border border-ink bg-ink px-5 py-2.5 font-body text-sm text-bone transition-opacity hover:opacity-85 disabled:opacity-40";
export const secondaryButton =
  "border border-slate/40 px-4 py-2 font-body text-sm text-ink transition-colors hover:border-brass disabled:opacity-40";
export const linkClass =
  "font-mono text-xs text-brass underline decoration-brass/40 underline-offset-2 hover:decoration-brass";

export function Label({ children }: { children: ReactNode }) {
  return <p className="font-mono text-xs uppercase tracking-wide text-slate">{children}</p>;
}

export function Notice({ tone = "neutral", children }: { tone?: "ok" | "bad" | "neutral"; children: ReactNode }) {
  const cls =
    tone === "ok"
      ? "border-moss/40 bg-moss/5 text-ink"
      : tone === "bad"
        ? "border-red-700/40 bg-red-700/5 text-red-800"
        : "border-slate/25 text-slate";
  return <div className={`mt-4 border px-4 py-3 font-body text-sm ${cls}`}>{children}</div>;
}

export function Choice<T extends string | number>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: { id: T; title: string; hint?: string }[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-2" role="radiogroup">
      {options.map((o) => (
        <button
          key={String(o.id)}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          disabled={disabled}
          onClick={() => onChange(o.id)}
          className={`border px-4 py-2 text-left transition-colors disabled:opacity-50 ${
            value === o.id ? "border-ink bg-ink text-bone" : "border-slate/30 text-ink hover:border-brass"
          }`}
        >
          <span className="block font-body text-sm">{o.title}</span>
          {o.hint && (
            <span className={`block max-w-[16rem] font-mono text-[11px] ${value === o.id ? "text-bone/70" : "text-slate"}`}>
              {o.hint}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export function NetworkPicker({
  value,
  onChange,
  names,
  walletEvm,
  walletSolana,
  disabled,
}: {
  value: RegisterNetwork;
  onChange: (n: RegisterNetwork) => void;
  names: Record<RegisterNetwork, string>;
  walletEvm: string;
  walletSolana: string;
  disabled?: boolean;
}) {
  return (
    <Choice
      value={value}
      onChange={onChange}
      disabled={disabled}
      options={REGISTER_NETWORKS.map((n) => ({
        id: n,
        title: names[n],
        hint: n === "solana-devnet" ? walletSolana : walletEvm,
      }))}
    />
  );
}

export function short(value: string, head = 6, tail = 4): string {
  return value.length <= head + tail + 3 ? value : `${value.slice(0, head)}...${value.slice(-tail)}`;
}

export async function readFile(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}
