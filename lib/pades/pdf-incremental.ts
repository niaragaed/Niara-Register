// Adds an empty PAdES signature field to a PDF as an INCREMENTAL UPDATE: the
// original bytes are kept untouched and the new objects are appended after
// them. That is what lets a contract be signed by several people one after
// the other without invalidating the earlier signatures.
//
// pdf-lib is only used to PARSE the document and to serialize individual
// dictionaries; it never rewrites the file (pdf-lib has no incremental save).
//
// The signature dictionary follows the ICP-Brasil PAdES policy
// PA_PAdES_AD_RB_v1_3, which requires /Type /Sig, /Filter /PBAD_PAdES,
// /SubFilter /PBAD.PAdES, /Contents and /ByteRange. Note: Adobe Acrobat does
// not know the PBAD_PAdES handler and will list the signature as "unknown";
// the ITI verifier (validar.iti.gov.br) is the reference for this policy.
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
  type PDFObject,
} from "pdf-lib";

/** Bytes reserved for the CMS signature; the hex placeholder is twice that. */
export const DEFAULT_SIGNATURE_SPACE = 24_576;

const BYTE_RANGE_PLACEHOLDER = "/ByteRange [0 0000000000 0000000000 0000000000]";

export type SignatureFieldOptions = {
  /** Shown by PDF readers; ends up inside the signed bytes. */
  signerName?: string;
  reason?: string;
  location?: string;
  signingDate?: Date;
  signatureSpace?: number;
  filter?: string;
  subFilter?: string;
};

export type PreparedPdf = {
  /** The PDF with the placeholder and the final /ByteRange filled in. */
  pdf: Uint8Array;
  byteRange: [number, number, number, number];
  /** Position of the first hex digit inside /Contents < ... >. */
  contentsHexStart: number;
  contentsHexLength: number;
};

const latin1 = (s: string) => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};

const asLatin1 = (bytes: Uint8Array, from = 0, to = bytes.length) => {
  let s = "";
  const chunk = 0x8000;
  for (let i = from; i < to; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, to)));
  }
  return s;
};

function pdfDate(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(
    d.getUTCMinutes(),
  )}${p(d.getUTCSeconds())}+00'00'`;
}

/** Offset of the last cross-reference section (the number after the last "startxref"). */
function lastStartXref(bytes: Uint8Array): number {
  const tail = asLatin1(bytes, Math.max(0, bytes.length - 2048));
  const idx = tail.lastIndexOf("startxref");
  if (idx < 0) throw new Error("Not a valid PDF: startxref not found.");
  const match = tail.slice(idx + 9).match(/\s*(\d+)/);
  if (!match) throw new Error("Not a valid PDF: startxref offset missing.");
  return Number(match[1]);
}

/** /Size of the cross-reference section at `offset` (table trailer or stream dictionary). */
function trailerSize(bytes: Uint8Array, offset: number): number {
  const text = asLatin1(bytes, offset, Math.min(bytes.length, offset + 8192));
  const match = text.match(/\/Size\s+(\d+)/);
  if (!match) throw new Error("Not a valid PDF: trailer /Size not found.");
  return Number(match[1]);
}

function previousXrefIsStream(bytes: Uint8Array, offset: number): boolean {
  const head = asLatin1(bytes, offset, Math.min(bytes.length, offset + 32)).trimStart();
  return !head.startsWith("xref");
}

function serializeObject(ref: PDFRef, obj: PDFObject): string {
  return `${ref.objectNumber} ${ref.generationNumber} obj\n${obj.toString()}\nendobj\n`;
}

/** Counts existing signature fields, to name the new one "Signature N". */
function countSignatureFields(fields: PDFArray | undefined, doc: PDFDocument): number {
  if (!fields) return 0;
  let n = 0;
  for (let i = 0; i < fields.size(); i++) {
    const f = doc.context.lookup(fields.get(i));
    if (f instanceof PDFDict && f.get(PDFName.of("FT"))?.toString() === "/Sig") n++;
  }
  return n;
}

export async function prepareSignatureField(
  original: Uint8Array,
  opts: SignatureFieldOptions = {},
): Promise<PreparedPdf> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(original, { updateMetadata: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/encrypted/i.test(message)) {
      throw new Error("Encrypted PDFs are not supported. Remove the password protection first.");
    }
    throw new Error(`Could not read the PDF: ${message}`);
  }
  const ctx = doc.context;
  if (ctx.trailerInfo.Encrypt) {
    throw new Error("Encrypted PDFs are not supported. Remove the password protection first.");
  }
  const rootRef = ctx.trailerInfo.Root;
  if (!(rootRef instanceof PDFRef)) throw new Error("Not a valid PDF: the catalog is not an indirect object.");
  const catalog = ctx.lookup(rootRef, PDFDict);
  const page = doc.getPages()[0];
  if (!page) throw new Error("The PDF has no pages.");

  // pdf-lib does not count the objects it consumes while parsing (object
  // streams, cross-reference streams), so the trailer's /Size is the real
  // floor for new object numbers. Reusing one of those numbers would replace
  // an object stream and silently drop every object inside it.
  const prev = lastStartXref(original);
  let nextObj = Math.max(ctx.largestObjectNumber + 1, trailerSize(original, prev));
  const newRef = () => PDFRef.of(nextObj++, 0);
  const changed = new Map<number, string>(); // objNum -> serialized object

  // 1. Signature dictionary, with fixed-width placeholders.
  const sigRef = newRef();
  const space = opts.signatureSpace ?? DEFAULT_SIGNATURE_SPACE;
  const contentsPlaceholder = "<" + "0".repeat(space * 2) + ">";
  const extra: string[] = [];
  if (opts.signerName) extra.push(`/Name ${PDFString.of(opts.signerName).toString()}`);
  if (opts.reason) extra.push(`/Reason ${PDFString.of(opts.reason).toString()}`);
  if (opts.location) extra.push(`/Location ${PDFString.of(opts.location).toString()}`);
  const sigDict =
    `<<\n/Type /Sig\n/Filter /${opts.filter ?? "PBAD_PAdES"}\n/SubFilter /${opts.subFilter ?? "PBAD.PAdES"}\n` +
    `${BYTE_RANGE_PLACEHOLDER}\n/Contents ${contentsPlaceholder}\n` +
    `/M ${PDFString.of(pdfDate(opts.signingDate ?? new Date())).toString()}\n` +
    (extra.length ? extra.join("\n") + "\n" : "") +
    ">>";
  changed.set(sigRef.objectNumber, `${sigRef.objectNumber} 0 obj\n${sigDict}\nendobj\n`);

  // 2. AcroForm (existing or new) and its /Fields.
  const acroFormEntry = catalog.get(PDFName.of("AcroForm"));
  let acroForm: PDFDict;
  let acroFormRef: PDFRef | null = null;
  if (acroFormEntry instanceof PDFRef) {
    acroFormRef = acroFormEntry;
    acroForm = ctx.lookup(acroFormEntry, PDFDict);
  } else if (acroFormEntry instanceof PDFDict) {
    acroForm = acroFormEntry;
  } else {
    acroForm = PDFDict.withContext(ctx);
    acroFormRef = newRef();
    catalog.set(PDFName.of("AcroForm"), acroFormRef);
    changed.set(rootRef.objectNumber, serializeObject(rootRef, catalog));
  }

  const fieldsEntry = acroForm.get(PDFName.of("Fields"));
  let fields: PDFArray;
  let fieldsRef: PDFRef | null = null;
  if (fieldsEntry instanceof PDFRef) {
    fieldsRef = fieldsEntry;
    fields = ctx.lookup(fieldsEntry, PDFArray);
  } else if (fieldsEntry instanceof PDFArray) {
    fields = fieldsEntry;
  } else {
    fields = PDFArray.withContext(ctx);
    acroForm.set(PDFName.of("Fields"), fields);
  }

  // 3. Widget annotation that is also the field (invisible: zero-size rect).
  const widgetRef = newRef();
  const sigIndex = countSignatureFields(fields, doc) + 1;
  const widget = PDFDict.withContext(ctx);
  widget.set(PDFName.of("Type"), PDFName.of("Annot"));
  widget.set(PDFName.of("Subtype"), PDFName.of("Widget"));
  widget.set(PDFName.of("FT"), PDFName.of("Sig"));
  widget.set(PDFName.of("Rect"), ctx.obj([0, 0, 0, 0]));
  widget.set(PDFName.of("V"), sigRef);
  widget.set(PDFName.of("T"), PDFString.of(`Signature ${sigIndex} (Niara Register)`));
  widget.set(PDFName.of("F"), PDFNumber.of(132)); // Print + Locked
  widget.set(PDFName.of("P"), page.ref);
  changed.set(widgetRef.objectNumber, serializeObject(widgetRef, widget));

  fields.push(widgetRef);
  acroForm.set(PDFName.of("SigFlags"), PDFNumber.of(3)); // SignaturesExist | AppendOnly
  if (fieldsRef) changed.set(fieldsRef.objectNumber, serializeObject(fieldsRef, fields));
  if (acroFormRef) {
    changed.set(acroFormRef.objectNumber, serializeObject(acroFormRef, acroForm));
  } else {
    changed.set(rootRef.objectNumber, serializeObject(rootRef, catalog));
  }

  // 4. Page /Annots.
  const annotsEntry = page.node.get(PDFName.of("Annots"));
  if (annotsEntry instanceof PDFRef) {
    const annots = ctx.lookup(annotsEntry, PDFArray);
    annots.push(widgetRef);
    changed.set(annotsEntry.objectNumber, serializeObject(annotsEntry, annots));
  } else {
    const annots = annotsEntry instanceof PDFArray ? annotsEntry : PDFArray.withContext(ctx);
    annots.push(widgetRef);
    page.node.set(PDFName.of("Annots"), annots);
    changed.set(page.ref.objectNumber, serializeObject(page.ref, page.node));
  }

  // 5. Append the objects and a new cross-reference section.
  const asStream = previousXrefIsStream(original, prev);
  const needsNewline = original[original.length - 1] !== 0x0a && original[original.length - 1] !== 0x0d;
  let body = needsNewline ? "\n" : "";
  const offsets = new Map<number, number>();
  const base = original.length;
  for (const [num, text] of [...changed.entries()].sort((a, b) => a[0] - b[0])) {
    offsets.set(num, base + body.length);
    body += text;
  }

  const trailerEntries: string[] = [`/Root ${rootRef.toString()}`];
  if (ctx.trailerInfo.Info) trailerEntries.push(`/Info ${ctx.trailerInfo.Info.toString()}`);
  if (ctx.trailerInfo.ID) trailerEntries.push(`/ID ${ctx.trailerInfo.ID.toString()}`);
  trailerEntries.push(`/Prev ${prev}`);

  let xrefSection: string;
  const xrefOffset = base + body.length;
  if (!asStream) {
    const size = nextObj;
    const nums = [...offsets.keys()].sort((a, b) => a - b);
    let table = "xref\n";
    for (let i = 0; i < nums.length; ) {
      let j = i;
      while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
      table += `${nums[i]} ${j - i + 1}\n`;
      for (let k = i; k <= j; k++) {
        table += `${String(offsets.get(nums[k])).padStart(10, "0")} 00000 n \n`;
      }
      i = j + 1;
    }
    xrefSection = `${table}trailer\n<<\n/Size ${size}\n${trailerEntries.join("\n")}\n>>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  } else {
    // Cross-reference stream (the original uses one): /W [1 4 2], uncompressed.
    const xrefRef = PDFRef.of(nextObj++, 0);
    offsets.set(xrefRef.objectNumber, xrefOffset);
    const nums = [...offsets.keys()].sort((a, b) => a - b);
    const index: number[] = [];
    const rows: number[] = [];
    for (let i = 0; i < nums.length; ) {
      let j = i;
      while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
      index.push(nums[i], j - i + 1);
      for (let k = i; k <= j; k++) {
        const off = offsets.get(nums[k])!;
        rows.push(1, (off >>> 24) & 0xff, (off >>> 16) & 0xff, (off >>> 8) & 0xff, off & 0xff, 0, 0);
      }
      i = j + 1;
    }
    const data = String.fromCharCode(...rows);
    xrefSection =
      `${xrefRef.objectNumber} 0 obj\n<<\n/Type /XRef\n/Size ${nextObj}\n/Index [${index.join(" ")}]\n/W [1 4 2]\n` +
      `${trailerEntries.join("\n")}\n/Length ${rows.length}\n>>\nstream\n${data}\nendstream\nendobj\n` +
      `startxref\n${xrefOffset}\n%%EOF\n`;
  }

  const appended = latin1(body + xrefSection);
  const pdf = new Uint8Array(original.length + appended.length);
  pdf.set(original, 0);
  pdf.set(appended, original.length);

  // 6. Locate our placeholders (inside the appended part only) and fill /ByteRange.
  const appendedText = asLatin1(pdf, base);
  const brPos = base + appendedText.indexOf(BYTE_RANGE_PLACEHOLDER);
  const contentsLt = base + appendedText.indexOf(contentsPlaceholder);
  if (brPos < base || contentsLt < base) throw new Error("Internal error: placeholder not found.");
  const contentsHexStart = contentsLt + 1;
  const contentsEnd = contentsLt + contentsPlaceholder.length; // after '>'
  const byteRange: [number, number, number, number] = [0, contentsLt, contentsEnd, pdf.length - contentsEnd];

  const inner = "0000000000 0000000000 0000000000";
  const filled = `${byteRange[1]} ${byteRange[2]} ${byteRange[3]}`;
  if (filled.length > inner.length) throw new Error("PDF too large for the /ByteRange placeholder.");
  const rangeText = `/ByteRange [0 ${filled.padEnd(inner.length, " ")}]`;
  pdf.set(latin1(rangeText), brPos);

  return { pdf, byteRange, contentsHexStart, contentsHexLength: space * 2 };
}

/** The bytes covered by a /ByteRange (everything except the /Contents value). */
export function signedBytes(pdf: Uint8Array, byteRange: readonly number[]): Uint8Array {
  const [a, b, c, d] = byteRange;
  const out = new Uint8Array(b + d);
  out.set(pdf.subarray(a, a + b), 0);
  out.set(pdf.subarray(c, c + d), b);
  return out;
}

/** Writes the DER signature into the reserved /Contents space (hex, zero padded). */
export function embedSignature(prepared: PreparedPdf, cmsDer: Uint8Array): Uint8Array {
  const hex = Array.from(cmsDer, (b) => b.toString(16).padStart(2, "0")).join("");
  if (hex.length > prepared.contentsHexLength) {
    throw new Error(
      `The signature (${cmsDer.length} bytes) does not fit in the reserved space ` +
        `(${prepared.contentsHexLength / 2} bytes).`,
    );
  }
  const out = prepared.pdf.slice();
  out.set(latin1(hex.toUpperCase()), prepared.contentsHexStart);
  return out;
}
