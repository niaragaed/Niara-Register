import Link from "next/link";

const areas = [
  { href: "/registro-pmes", label: "Registro PMEs" },
  { href: "/registro-global", label: "Registro Global" },
  { href: "/assinatura", label: "Assinatura" },
];

export function SiteHeader() {
  return (
    <header className="border-b border-slate/15 bg-bone">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="font-display text-lg text-ink">Niara</span>
          <span className="font-body text-sm text-slate">Register</span>
        </Link>
        <nav className="flex gap-6">
          {areas.map((area) => (
            <Link
              key={area.href}
              href={area.href}
              className="font-body text-sm text-slate transition-colors hover:text-ink"
            >
              {area.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
