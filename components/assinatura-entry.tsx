import type { RegistroAssinatura } from "@/lib/supabase";

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

function truncarEndereco(endereco: string) {
  return `${endereco.slice(0, 6)}...${endereco.slice(-4)}`;
}

export function AssinaturaEntry({ registro }: { registro: RegistroAssinatura }) {
  return (
    <div className="ledger-rule flex gap-5 py-5 pl-6">
      <div className="flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="font-body text-[15px] text-ink">
            {registro.documento_nome}
            {registro.tipo_documento && (
              <span className="text-slate"> · {registro.tipo_documento}</span>
            )}
          </p>
          {registro.assinado_em && (
            <time className="font-mono text-xs text-slate">
              {formatarData(registro.assinado_em)}
            </time>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          <span className="font-mono text-xs text-slate">
            hash {truncarHash(registro.hash_sha256)}
          </span>
          <span className="font-mono text-xs text-slate">
            assinante {truncarEndereco(registro.assinante_endereco)}
          </span>
          <span
            className={`font-mono text-xs ${
              registro.status === "assinado_onchain" ? "text-moss" : "text-slate"
            }`}
          >
            {registro.status === "assinado_onchain"
              ? "confirmado on-chain"
              : "aguardando confirmação"}
          </span>
          {registro.tx_hash && (
            <a
              href={`https://sepolia.etherscan.io/tx/${registro.tx_hash}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-xs text-brass underline decoration-brass/40 underline-offset-2 hover:decoration-brass"
            >
              {truncarHash(registro.tx_hash)} ↗ ver na Sepolia
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
