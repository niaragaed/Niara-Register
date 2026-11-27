/**
 * Regression: the CMS cut out of /Contents must keep trailing 0x00 bytes that
 * belong to the DER. Stripping the zero padding character by character
 * truncated it (an ASN.1 parse error in pkijs, about 1 run in 128 of the eIDAS
 * tests, whenever a signature happened to end in 0x00).
 */
import assert from "node:assert/strict";
import { derFromContents } from "./contents-der";

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const padding = "0".repeat(40);

// SEQUENCE { OCTET STRING { 0x12 0x00 } }: the element itself ends in 0x00.
assert.equal(hex(derFromContents("3004" + "0402" + "1200" + padding)), "300404021200", "a trailing 0x00 of the DER is kept");
// Same, with two zero bytes at the end.
assert.equal(hex(derFromContents("3004" + "0402" + "0000" + padding)), "300404020000", "two trailing 0x00 bytes are kept");
// Long-form length (0x81 nn).
const body = "04" + "81" + "80" + "ab".repeat(127) + "00";
assert.equal(hex(derFromContents("3081" + "83" + body + padding)), "3081" + "83" + body, "long-form length, ending in 0x00");
// Plain case and no padding.
assert.equal(hex(derFromContents("3003020105" + padding)), "3003020105", "padding after a normal element is cut");
assert.equal(hex(derFromContents("3003020105")), "3003020105", "no padding");
// Odd number of hex digits (a stripped nibble) does not throw.
assert.doesNotThrow(() => derFromContents("3003020105" + "000"));

console.log("ok - contents-der");
