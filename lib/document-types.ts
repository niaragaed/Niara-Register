// Public document types: a FIXED list, never free text, so a document name can
// never leak through the type. The numeric codes are what goes on-chain and
// must match SignatureRegistryV2.sol (documentTypeLabel) and the Solana
// program's document_type. Never renumber; only append.
import type { Locale } from "./i18n/locale";

export type DocumentTypeSlug =
  | "contract"
  | "minutes"
  | "power-of-attorney"
  | "promissory-note"
  | "declaration"
  | "receipt"
  | "agreement"
  | "bylaws"
  | "cap-table"
  | "report"
  | "other";

export const DOCUMENT_TYPES: { code: number; slug: DocumentTypeSlug; en: string; pt: string }[] = [
  { code: 1, slug: "contract", en: "Contract", pt: "Contrato" },
  { code: 2, slug: "minutes", en: "Meeting minutes", pt: "Ata" },
  { code: 3, slug: "power-of-attorney", en: "Power of attorney", pt: "Procuração" },
  { code: 4, slug: "promissory-note", en: "Promissory note", pt: "Nota promissória" },
  { code: 5, slug: "declaration", en: "Declaration", pt: "Declaração" },
  { code: 6, slug: "receipt", en: "Receipt", pt: "Recibo" },
  { code: 7, slug: "agreement", en: "Agreement", pt: "Termo / acordo" },
  { code: 8, slug: "bylaws", en: "Articles of association / bylaws", pt: "Contrato social / estatuto" },
  { code: 9, slug: "cap-table", en: "Shareholder register / cap table", pt: "Livro de sócios / cap table" },
  { code: 10, slug: "report", en: "Report / appraisal", pt: "Laudo / relatório" },
  { code: 11, slug: "other", en: "Other", pt: "Outro" },
];

export function documentTypeByCode(code: number) {
  return DOCUMENT_TYPES.find((t) => t.code === code) ?? null;
}

export function documentTypeBySlug(slug: string) {
  return DOCUMENT_TYPES.find((t) => t.slug === slug) ?? null;
}

/** Label in the visitor's language; codes added after this list read "Other (code N)". */
export function documentTypeName(code: number, locale: Locale): string {
  const t = documentTypeByCode(code);
  if (t) return locale === "pt" ? t.pt : t.en;
  return locale === "pt" ? `Outro (código ${code})` : `Other (code ${code})`;
}
