import { VerificadorDeDocumento } from "./verificador";

export default function AssinaturaPage() {
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

      <div className="mt-6 border border-dashed border-slate/30 px-6 py-6">
        <p className="font-body text-sm text-slate">
          O contrato de registro de assinaturas (
          <span className="font-mono text-xs">niara-contracts-Register</span>
          ) ainda está em desenvolvimento. O cálculo de hash acima já é real;
          o registro on-chain será habilitado quando o contrato estiver
          deployado na Sepolia.
        </p>
      </div>
    </div>
  );
}
