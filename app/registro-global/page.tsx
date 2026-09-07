export default function RegistroGlobalPage() {
  // Área deliberadamente sem indexer ligado ainda: a Niara Exchange só tem
  // contratos deployados e testados localmente, sem transação real na
  // Sepolia. Mostrar qualquer dado aqui violaria a regra de honestidade do
  // grupo Niara. Esta página populará sozinha quando a Exchange operar de
  // verdade — não antes.
  return (
    <div className="mx-auto max-w-5xl px-6 py-14">
      <header className="border-b border-slate/15 pb-8">
        <p className="font-mono text-xs uppercase tracking-wide text-slate">
          Registro Global
        </p>
        <h1 className="mt-3 font-display text-3xl text-ink">
          Transações da Niara Exchange
        </h1>
        <p className="mt-3 max-w-xl font-body text-sm leading-relaxed text-slate">
          Espelho das transações da Niara Exchange, quando em operação.
        </p>
      </header>

      <div className="mt-10 border border-dashed border-slate/30 px-6 py-10">
        <p className="font-body text-sm text-ink">
          Nenhuma transação registrada.
        </p>
        <p className="mt-2 max-w-md font-body text-sm leading-relaxed text-slate">
          A Niara Exchange ainda não opera em produção — os contratos estão
          deployados e testados apenas localmente. Esta área será ligada ao
          indexador assim que houver transações reais na rede.
        </p>
      </div>
    </div>
  );
}
