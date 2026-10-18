"use client";

import { useEffect, useSyncExternalStore } from "react";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { normalizeLocale, LOCALE_COOKIE, type Locale } from "@/lib/i18n/locale";

/**
 * Error boundary. Next requires it to be a client component, so it is the only
 * place that cannot receive the language through server props: it reads the
 * cookie straight from the document. A context provider just for this page
 * would be disproportionate weight.
 *
 * The read uses useSyncExternalStore instead of useEffect + setState: the
 * cookie is a value outside React, the hook already allows a different
 * snapshot on the server (English, the site default) and it does not trigger
 * the render cascade that react-hooks/set-state-in-effect flags.
 */
function documentLocale(): Locale {
  const match = new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=([^;]*)`).exec(
    document.cookie,
  );
  return normalizeLocale(match?.[1]);
}

/** The cookie does not change while this screen is open, so there is nothing to subscribe to. */
function subscribe() {
  return () => {};
}

function serverSnapshot(): Locale {
  return "en";
}

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const locale = useSyncExternalStore(
    subscribe,
    documentLocale,
    serverSnapshot,
  );

  useEffect(() => {
    console.error(error);
  }, [error]);

  const t = dictionaries[locale];

  return (
    <div className="mx-auto max-w-5xl px-6 py-24">
      <h1 className="font-display text-3xl text-ink">{t.error.title}</h1>
      <p className="mt-3 max-w-md font-body text-sm leading-relaxed text-slate">
        {t.error.text}
      </p>
      <button
        onClick={reset}
        className="mt-8 border border-ink px-5 py-2.5 font-body text-sm text-ink transition-colors hover:bg-ink hover:text-bone"
      >
        {t.error.retry}
      </button>
    </div>
  );
}
