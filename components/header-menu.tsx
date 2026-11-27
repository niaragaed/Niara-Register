"use client";

import { useRef, type ReactNode } from "react";

/**
 * The header's menu below lg: a native <details> disclosure, so it opens and
 * closes with no JavaScript at all. The only script closes it when one of its
 * links is followed, because the header stays mounted across client-side
 * navigation and would otherwise remain open over the next page.
 */
export function HeaderMenu({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  return (
    <details ref={ref} className="group relative lg:hidden">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 border border-slate/25 px-2.5 py-1 font-body text-xs text-ink hover:border-slate/50 [&::-webkit-details-marker]:hidden">
        <span>{label}</span>
        <span aria-hidden="true" className="font-mono text-[10px] text-slate transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div
        className="absolute right-0 top-full z-30 mt-2 w-64 max-w-[calc(100vw-2rem)] border border-slate/20 bg-bone py-2 shadow-sm"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("a") && ref.current) ref.current.open = false;
        }}
      >
        {children}
      </div>
    </details>
  );
}
