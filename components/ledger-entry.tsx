import type { RegistroTransacao } from "@/lib/supabase";

function formatarData(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function truncarHash(hash: string) {
  if (hash.length <= 14) return hash;
  return `${hash.slice(0, 8)}...${hash.slice(-4)}`;
}

export function LedgerEntry({ registro }: { registro: RegistroTransacao }) {
  return (
    <div className="ledger-rule flex gap-5 py-5 pl-6">
      <div className="w-16 shrink-0 pt-0.5 font-mono text-xs text-slate">
        nº {String(registro.numero_sequencial).padStart(4, "0")}
      </div>
      <div className="flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="font-body text-[15px] text-ink">
            {registro.tipo_evento}
            <span className="text-slate"> · {registro.descricao}</span>
          </p>
          <time className="font-mono text-xs text-slate">
            {formatarData(registro.ocorrido_em)}
          </time>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          <span
            className={`font-mono text-xs ${
              registro.confirmado ? "text-moss" : "text-slate"
            }`}
          >
            {registro.confirmado ? "confirmado on-chain" : "aguardando confirmação"}
          </span>
          <a
            href={`https://sepolia.etherscan.io/tx/${registro.tx_hash}`}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs text-brass underline decoration-brass/40 underline-offset-2 hover:decoration-brass"
          >
            {truncarHash(registro.tx_hash)} ↗ ver na Sepolia
          </a>
        </div>
      </div>
    </div>
  );
}
