import type { Locale } from "./locale";

/**
 * Datas sempre no fuso de São Paulo, independentemente de onde o visitante
 * esteja: o que está sendo mostrado é quando o evento ocorreu para a Niara, não
 * a hora local de quem lê. Em inglês o sufixo BRT deixa o fuso explícito, já que
 * para um leitor de fora o horário seria ambíguo.
 */
export function formatarData(iso: string, locale: Locale): string {
  const texto = new Intl.DateTimeFormat(locale === "pt" ? "pt-BR" : "en-US", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(iso));

  return locale === "en" ? `${texto} BRT` : texto;
}

/** Mesma regra, para um timestamp Unix em segundos (vem do contrato). */
export function formatarTimestamp(segundos: number, locale: Locale): string {
  return formatarData(new Date(segundos * 1000).toISOString(), locale);
}
