import { cookies } from "next/headers";
import { COOKIE_IDIOMA, normalizarLocale, type Locale } from "./locale";

/**
 * Idioma do visitante, lido do cookie. Só para server components — este módulo
 * importa `next/headers`. Tipo e constantes ficam em ./locale, que é seguro em
 * qualquer lugar; nada é reexportado daqui para não arrastar `next/headers`
 * para o cliente por engano.
 *
 * Regra deliberada: o padrão é inglês e o `Accept-Language` NÃO é consultado.
 * Um visitante brasileiro sem cookie também cai em inglês — a troca é sempre um
 * ato explícito, feito no seletor do cabeçalho.
 *
 * As rotas não mudam com o idioma: não há prefixo nem middleware, só o cookie.
 */
export async function getLocale(): Promise<Locale> {
  // No Next 16 cookies() é assíncrono.
  const store = await cookies();
  return normalizarLocale(store.get(COOKIE_IDIOMA)?.value);
}
