"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  COOKIE_IDIOMA,
  COOKIE_MAX_AGE,
  normalizarLocale,
} from "@/lib/i18n/locale";

/**
 * Grava o idioma escolhido e força o layout inteiro a renderizar de novo, para
 * o cabeçalho e a página trocarem juntos.
 *
 * Recebe FormData porque o seletor é um <form> com dois botões submit: assim ele
 * continua sendo server component e funciona mesmo sem JS no cliente. A rota não
 * muda — o server action responde na própria URL em que o visitante está.
 */
export async function trocarIdioma(formData: FormData) {
  const escolhido = normalizarLocale(formData.get("locale")?.toString());

  const store = await cookies();
  store.set(COOKIE_IDIOMA, escolhido, {
    path: "/",
    maxAge: COOKIE_MAX_AGE,
    sameSite: "lax",
  });

  revalidatePath("/", "layout");
}
