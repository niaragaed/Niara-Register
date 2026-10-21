// PAdES signing in the browser: placeholder (incremental update) → SHA-256 of
// the /ByteRange bytes → CMS with ICP-Brasil AD-RB attributes → embed.
// The PDF never leaves the user's machine.
import { buildPadesCms, type CmsSigner } from "./cms";
import {
  embedSignature,
  prepareSignatureField,
  signedBytes,
  type SignatureFieldOptions,
} from "./pdf-incremental";

export async function signPdf(
  pdf: Uint8Array,
  signer: CmsSigner,
  options: SignatureFieldOptions = {},
): Promise<Uint8Array> {
  const prepared = await prepareSignatureField(pdf, options);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", signedBytes(prepared.pdf, prepared.byteRange) as BufferSource),
  );
  const cms = await buildPadesCms(digest, signer);
  return embedSignature(prepared, cms);
}
