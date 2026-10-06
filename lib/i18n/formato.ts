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

const localeIntl = (locale: Locale) => (locale === "pt" ? "pt-BR" : "en-US");

/** Separador decimal do idioma, perguntado ao próprio Intl. */
function separadorDecimal(locale: Locale): string {
  return (
    new Intl.NumberFormat(localeIntl(locale))
      .formatToParts(1.5)
      .find((p) => p.type === "decimal")?.value ?? "."
  );
}

// "123", "123.4", "-123.456789..." — o que o indexer grava em `dados`.
const VALOR = /^(-?)(\d+)(?:\.(\d*))?$/;

// Escritos como chamada, não como literal `100n`: o tsconfig do site tem
// target ES2017, que ainda não aceita a sintaxe de literal BigInt. O tipo
// bigint existe (lib inclui esnext), então a conta é a mesma.
const CEM = BigInt(100);
const UM = BigInt(1);

/**
 * Formata um valor monetário vindo de `dados` (string crua, com as casas do
 * token) para exibição: duas casas e separadores do idioma.
 *
 * O jsonb continua guardando a string original — só a tela muda.
 *
 * A conta é feita em BigInt, a partir dos dígitos da string, e NUNCA passa por
 * Number: os valores nascem de uint256 em wei e um `parseFloat` perderia
 * precisão silenciosamente bem antes do limite do uint256. O agrupamento de
 * milhar também sai do Intl aplicado a um BigInt, que ele aceita sem converter.
 *
 * Valor em formato inesperado volta como veio — melhor mostrar o dado cru do
 * que esconder que algo fugiu do padrão.
 */
export function formatarValor(valor: string, locale: Locale): string {
  const m = VALOR.exec(valor.trim());
  if (!m) return valor;

  const [, sinal, inteiro, fracao = ""] = m;

  // Precisa de 3 casas para decidir o arredondamento da segunda.
  const casas = fracao.padEnd(3, "0");
  const terceira = casas.charCodeAt(2) - 48;

  let centavos = BigInt(inteiro) * CEM + BigInt(casas.slice(0, 2));
  if (terceira >= 5) centavos += UM; // meio para cima, na magnitude

  const parteInteira = new Intl.NumberFormat(localeIntl(locale)).format(
    centavos / CEM,
  );
  const parteDecimal = (centavos % CEM).toString().padStart(2, "0");

  return `${sinal}${parteInteira}${separadorDecimal(locale)}${parteDecimal}`;
}

/**
 * Quantidade de cotas: inteira ("350") quando não há parte decimal — que é o
 * caso normal, já que cada cota é uma unidade inteira do token. Com fração,
 * cai no mesmo formato de duas casas dos valores, para não esconder a fração.
 */
export function formatarCotas(valor: string, locale: Locale): string {
  const m = VALOR.exec(valor.trim());
  if (!m) return valor;

  const [, sinal, inteiro, fracao = ""] = m;
  if (/^0*$/.test(fracao)) {
    return `${sinal}${new Intl.NumberFormat(localeIntl(locale)).format(BigInt(inteiro))}`;
  }
  return formatarValor(valor, locale);
}
