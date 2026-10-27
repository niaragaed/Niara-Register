// PAdES signing in the browser: placeholder (incremental update) → SHA-256 of
// the /ByteRange bytes → CMS with the attributes of the chosen framework
// (ICP-Brasil AD-RB, or eIDAS PAdES baseline B-B) → embed.
// The PDF never leaves the user's machine.
import { buildPadesCms, type CmsSigner } from "./cms";
import { FRAMEWORKS, type FrameworkId } from "./frameworks";
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
  framework: FrameworkId = "br-icp",
): Promise<Uint8Array> {
  const f = FRAMEWORKS[framework];
  const prepared = await prepareSignatureField(pdf, { filter: f.filter, subFilter: f.subFilter, ...options });
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", signedBytes(prepared.pdf, prepared.byteRange) as BufferSource),
  );
  const cms = await buildPadesCms(digest, signer, f.policy);
  return embedSignature(prepared, cms);
}
