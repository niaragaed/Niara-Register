// Signature frameworks the signer can pick ("country" selector). Each one
// fixes how the PAdES signature is written and which trust list a verifier
// should use. Add a country by adding an entry here, its trust anchors in
// inspect.ts, and its texts in the dictionaries.
import { ICP_BRASIL_PADES_AD_RB_V1_3 } from "./cms";
import { EU_DSS_VALIDATOR } from "./eu-trust";

export type FrameworkId = "br-icp" | "eu-eidas";

export type SignaturePolicyRef = { oid: string; uri: string; sha256Hex: string };

export type Framework = {
  id: FrameworkId;
  /** ISO 3166 code, or "EU" for the European Union. */
  region: string;
  /** /Filter and /SubFilter of the PDF signature dictionary. */
  filter: string;
  subFilter: string;
  /** Explicit signature policy (sigPolicyId), or null for none. */
  policy: SignaturePolicyRef | null;
  /** Official validator users should check the signature with. */
  validator: string;
};

export const FRAMEWORKS: Record<FrameworkId, Framework> = {
  // ICP-Brasil PA_PAdES_AD_RB_v1_3: /Filter /PBAD_PAdES, /SubFilter /PBAD.PAdES,
  // signed attributes contentType, messageDigest, signingCertificateV2, sigPolicyId.
  "br-icp": {
    id: "br-icp",
    region: "BR",
    filter: "PBAD_PAdES",
    subFilter: "PBAD.PAdES",
    policy: ICP_BRASIL_PADES_AD_RB_V1_3,
    validator: "https://validar.iti.gov.br",
  },
  // eIDAS: PAdES baseline B-B (ETSI EN 319 142-1). /SubFilter
  // /ETSI.CAdES.detached, signed attributes contentType, messageDigest,
  // signingCertificateV2; no signature policy and no signing-time attribute
  // (the claimed signing time is the /M entry of the signature dictionary).
  "eu-eidas": {
    id: "eu-eidas",
    region: "EU",
    filter: "Adobe.PPKLite",
    subFilter: "ETSI.CAdES.detached",
    policy: null,
    validator: EU_DSS_VALIDATOR,
  },
};

export const FRAMEWORK_IDS = Object.keys(FRAMEWORKS) as FrameworkId[];

export function frameworkOf(id: string | null | undefined): Framework {
  return FRAMEWORKS[(id ?? "") as FrameworkId] ?? FRAMEWORKS["br-icp"];
}
