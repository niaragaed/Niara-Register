// Metadata of the soulbound receipts. On EVM it is generated on-chain by
// SignatureRegistryV2.tokenURI; on Solana the cNFT points to
// /api/receipts/solana/<hash>, which serves the same JSON shape. Nothing
// private goes in: hash, date, scheme and the verification link.

export function receiptSvg(hashHex: string): string {
  const h = `0x${hashHex}`;
  const short = `${h.slice(0, 10)}...${h.slice(-8)}`;
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">' +
    '<rect width="400" height="400" fill="#0f1720"/>' +
    '<rect x="24" y="24" width="352" height="352" fill="none" stroke="#b08d57" stroke-width="2"/>' +
    '<text x="200" y="150" fill="#f4f1ea" font-family="monospace" font-size="22" text-anchor="middle">NIARA REGISTER</text>' +
    '<text x="200" y="185" fill="#b08d57" font-family="monospace" font-size="14" text-anchor="middle">signature receipt</text>' +
    `<text x="200" y="250" fill="#f4f1ea" font-family="monospace" font-size="16" text-anchor="middle">${short}</text>` +
    '<text x="200" y="330" fill="#8a94a0" font-family="monospace" font-size="11" text-anchor="middle">non-transferable</text>' +
    "</svg>"
  );
}

export function receiptJson(opts: {
  hashHex: string;
  verifyUrl: string;
  imageUrl: string;
  scheme?: number;
  timestamp?: number;
}) {
  const attributes: { trait_type: string; value: string | number; display_type?: string }[] = [
    { trait_type: "Record hash", value: `0x${opts.hashHex}` },
  ];
  if (opts.scheme !== undefined) {
    attributes.push({
      trait_type: "Hash scheme",
      value: opts.scheme === 0 ? "Signed PDF (PAdES) SHA-256" : "Salted SHA-256",
    });
  }
  if (opts.timestamp) attributes.push({ display_type: "date", trait_type: "Registered at", value: opts.timestamp });
  return {
    name: "Niara Register receipt",
    symbol: "NIARA-R",
    description:
      "Proof that this wallet registered a document fingerprint on Niara Register. The document itself is not on-chain. Non-transferable.",
    image: opts.imageUrl,
    external_url: opts.verifyUrl,
    attributes,
    properties: { category: "image", files: [{ uri: opts.imageUrl, type: "image/svg+xml" }] },
  };
}
