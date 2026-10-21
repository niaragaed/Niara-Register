"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { isHash32 } from "@/lib/commitments";
import { isProofPackage } from "@/lib/proof-package";
import type { RegisterNetwork } from "@/lib/networks";
import { Label, NetworkPicker, Notice, inputClass, primaryButton, readFile } from "@/components/v2/ui";

export function LookupForm({ t }: { t: Pick<Dictionary, "verify" | "register"> }) {
  const router = useRouter();
  const [network, setNetwork] = useState<RegisterNetwork>("sepolia");
  const [hash, setHash] = useState("");
  const [error, setError] = useState<string | null>(null);

  function go(n: RegisterNetwork, h: string) {
    const clean = h.trim().replace(/^0x/, "").toLowerCase();
    if (!isHash32(clean)) {
      setError(t.verify.invalidHash);
      return;
    }
    router.push(`/verify/${n}/0x${clean}`);
  }

  return (
    <div className="mt-10 border border-slate/25 px-6 py-8">
      <Label>{t.verify.networkField}</Label>
      <NetworkPicker
        value={network}
        onChange={setNetwork}
        names={t.register.networks}
        walletEvm={t.register.walletEvm}
        walletSolana={t.register.walletSolana}
      />
      <label className="mt-6 block">
        <span className="block font-mono text-xs uppercase tracking-wide text-slate">{t.verify.hashField}</span>
        <input value={hash} onChange={(e) => setHash(e.target.value)} className={`${inputClass} font-mono`} placeholder="0x…" />
      </label>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <button className={primaryButton} onClick={() => go(network, hash)}>
          {t.verify.go}
        </button>
        <label className="cursor-pointer font-body text-sm text-brass underline decoration-brass/40 underline-offset-2">
          {t.verify.chooseFiles} (.json)
          <input
            type="file"
            accept=".json,application/json"
            className="sr-only"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                const pkg = JSON.parse(new TextDecoder().decode(await readFile(f)));
                if (isProofPackage(pkg)) go(pkg.network, pkg.recordHash);
                else setError(t.verify.invalidHash);
              } catch {
                setError(t.verify.invalidHash);
              }
            }}
          />
        </label>
      </div>
      {error && <Notice tone="bad">{error}</Notice>}
    </div>
  );
}
