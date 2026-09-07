import Link from "next/link";

export default function HomePage() {
  return (
    <div className="mx-auto max-w-5xl px-6">
      <section className="border-b border-slate/15 py-20">
        <p className="font-mono text-xs uppercase tracking-wide text-slate">
          Niara Register
        </p>
        <h1 className="mt-4 max-w-2xl font-display text-4xl leading-[1.15] text-ink sm:text-5xl">
          O livro de registros da Niara. Aberto, verificável, imutável.
        </h1>
        <p className="mt-5 max-w-xl font-body text-base leading-relaxed text-slate">
          Cada transação e cada assinatura de documento dos produtos Niara
          fica registrada na blockchain e espelhada aqui — com o hash e o
          link para conferência independente no explorador da rede.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/registro-pmes"
            className="border border-ink bg-ink px-5 py-2.5 font-body text-sm text-bone transition-opacity hover:opacity-85"
          >
            Consultar registro do Niara-PMEs
          </Link>
          <Link
            href="/assinatura"
            className="border border-ink px-5 py-2.5 font-body text-sm text-ink transition-colors hover:bg-ink hover:text-bone"
          >
            Verificar uma assinatura
          </Link>
        </div>
      </section>

      <section className="grid gap-px border-b border-slate/15 bg-slate/15 py-px sm:grid-cols-3">
        {[
          {
            href: "/registro-pmes",
            titulo: "Registro PMEs",
            texto:
              "Transações reais da captação de PMEs, indexadas diretamente dos contratos na Sepolia.",
          },
          {
            href: "/registro-global",
            titulo: "Registro Global",
            texto:
              "Transações da Niara Exchange. A Exchange ainda não opera em produção — esta área abre vazia.",
          },
          {
            href: "/assinatura",
            titulo: "Assinatura de documentos",
            texto:
              "Hash SHA-256 de documentos, ancorado on-chain como prova de autoria e integridade.",
          },
        ].map((area) => (
          <Link
            key={area.href}
            href={area.href}
            className="bg-bone px-6 py-8 transition-colors hover:bg-deep hover:text-bone"
          >
            <h2 className="font-display text-lg">{area.titulo}</h2>
            <p className="mt-2 font-body text-sm leading-relaxed opacity-80">
              {area.texto}
            </p>
          </Link>
        ))}
      </section>
    </div>
  );
}
