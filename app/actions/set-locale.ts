"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  LOCALE_COOKIE,
  COOKIE_MAX_AGE,
  normalizeLocale,
} from "@/lib/i18n/locale";

/**
 * Stores the chosen language and forces the whole layout to render again, so
 * the header and the page switch together.
 *
 * Takes FormData because the selector is a <form> with two submit buttons: that
 * way it stays a server component and works even without JS on the client. The
 * route does not change: the server action answers on the same URL the visitor
 * is on.
 */
export async function switchLocale(formData: FormData) {
  const chosen = normalizeLocale(formData.get("locale")?.toString());

  const store = await cookies();
  store.set(LOCALE_COOKIE, chosen, {
    path: "/",
    maxAge: COOKIE_MAX_AGE,
    sameSite: "lax",
  });

  revalidatePath("/", "layout");
}
