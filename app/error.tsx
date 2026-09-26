"use client";

import { useEffect, useSyncExternalStore } from "react";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { normalizarLocale, COOKIE_IDIOMA, type Locale } from "@/lib/i18n/locale";

/**
 * Fronteira de erro. Precisa ser client component por exigência do Next, então é
 * o único lugar que não pode receber o idioma por props do servidor — lê o
 * cookie direto do documento. Um provider de contexto só por causa desta página
 * seria peso desproporcional.
 *
 * A leitura usa useSyncExternalStore em vez de useEffect + setState: o cookie é
 * um valor externo ao React, o hook já prevê um snapshot diferente no servidor
 * (inglês, o padrão do site) e não dispara a cascata de renders que o
 * react-hooks/set-state-in-effect acusa.
 */
function localeDoDocumento(): Locale {
  const match = new RegExp(`(?:^|;\\s*)${COOKIE_IDIOMA}=([^;]*)`).exec(
    document.cookie,
  );
  return normalizarLocale(match?.[1]);
}

/** O cookie não muda enquanto esta tela está aberta, então não há o que assinar. */
function assinar() {
  return () => {};
}

function snapshotNoServidor(): Locale {
  return "en";
}

export default function Erro({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const locale = useSyncExternalStore(
    assinar,
    localeDoDocumento,
    snapshotNoServidor,
  );

  useEffect(() => {
    console.error(error);
  }, [error]);

  const t = dictionaries[locale];

  return (
    <div className="mx-auto max-w-5xl px-6 py-24">
      <h1 className="font-display text-3xl text-ink">{t.erro.titulo}</h1>
      <p className="mt-3 max-w-md font-body text-sm leading-relaxed text-slate">
        {t.erro.texto}
      </p>
      <button
        onClick={reset}
        className="mt-8 border border-ink px-5 py-2.5 font-body text-sm text-ink transition-colors hover:bg-ink hover:text-bone"
      >
        {t.erro.tentar}
      </button>
    </div>
  );
}
