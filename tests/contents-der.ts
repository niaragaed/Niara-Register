/**
 * The CMS inside a PDF signature's /Contents <hex>, as DER.
 *
 * /Contents is zero-padded to a reserved length. Cutting the padding by
 * stripping trailing "0" characters also eats real bytes when the DER itself
 * ends in 0x00 (the last byte of a signature is 0x00 about once in 256 times),
 * and pkijs then fails to parse the cut CMS. Cut by the outer element's own
 * length instead, as lib/pades/inspect.ts does.
 */
export function derFromContents(hex: string): Uint8Array {
  const clean = hex.length % 2 ? hex + "0" : hex;
  const bytes = Uint8Array.from(clean.match(/../g) ?? [], (h) => parseInt(h, 16));
  if (bytes.length < 2 || bytes[0] !== 0x30) return bytes;
  const first = bytes[1];
  if (first < 0x80) return bytes.slice(0, 2 + first);
  const n = first & 0x7f;
  let len = 0;
  for (let i = 0; i < n; i++) len = len * 256 + bytes[2 + i];
  return bytes.slice(0, 2 + n + len);
}
