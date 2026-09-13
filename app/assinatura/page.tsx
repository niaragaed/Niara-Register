import { VerificadorDeDocumento } from "./verificador";
import { AssinaturaEntry } from "@/components/assinatura-entry";
import { supabase, supabaseConfigurado } from "@/lib/supabase";
import type { RegistroAssinatura } from "@/lib/supabase";

export default async function AssinaturaPage() {
  // Mesmo princípio do /registro-pmes: lê direto da tabela indexada, nunca
  // gera dado na hora. Se o Supabase não estiver configurado nesta instância,
  // cai no estado vazio abaixo em vez de mostrar erro cru.
  const { data, error } = supabaseConfigurado
    ? await supabase
        .from("registro_assinaturas")
        .select("*")
        .order("assinado_em", { ascending: false })
        .limit(50)
    : { data: null, error: null };

  const registros = (data ?? []) as RegistroAssinatura[];
  const indexadorDesconectado = !supabaseConfigurado || Boolean(error);

  return (
    <div className="mx-auto max-w-5xl px-6 py-14">
      <header className="border-b border-slate/15 pb-8">
        <p className="font-mono text-xs uppercase tracking-wide text-slate">
          Assinatura de documentos
        </p>
        <h1 className="mt-3 font-display text-3xl text-ink">
          Prove que um documento é original
        </h1>
        <p className="mt-3 max-w-xl font-body text-sm leading-relaxed text-slate">
          Calcule o hash SHA-256 de um documento e registre-o on-chain como
          prova de existência e autoria. O documento nunca sai do seu
          navegador — só o hash é registrado.
        </p>
      </header>

      <div className="mt-10">
        <VerificadorDeDocumento />
      </div>

      <div className="mt-6 border border-dashed border-moss/40 px-6 py-6">
        <p className="font-body text-sm text-slate">
          O contrato de registro de assinaturas (<a href="https://sepolia.etherscan.io/address/0x5627857ee73f37d6da96530ed08c07339dd9d93a" target="_blank" rel="noreferrer" className="font-mono text-xs text-brass underline decoration-brass/40 underline-offset-2 hover:decoration-brass">niara-contracts-Register</a>) está deployado e ativo na Sepolia. O hash é calculado no seu navegador e o registro on-chain acima é real — cada assinatura vira uma transação de verdade, verificável no Etherscan.
        </p>
      </div>

      <div className="mt-14 border-t border-slate/15 pt-8">
        <h2 className="font-display text-xl text-ink">
          Documentos já registrados
        </h2>
        <p className="mt-2 max-w-xl font-body text-sm leading-relaxed text-slate">
          Espelho de todos os documentos registrados via este contrato,
          mais recentes primeiro.
        </p>

        {registros.length > 0 ? (
          <div className="mt-6">
            {registros.map((registro) => (
              <AssinaturaEntry key={registro.id} registro={registro} />
            ))}
          </div>
        ) : (
          <div className="mt-6 border border-dashed border-slate/30 px-6 py-10">
            <p className="font-body text-sm text-slate">
              {indexadorDesconectado
                ? "O indexador ainda não está conectado a um Postgres nesta instância. Isto não significa ausência de documentos — significa que a leitura ainda não foi ligada."
                : "Nenhum documento registrado ainda."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
