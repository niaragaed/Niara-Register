// SignatureRegistryV2 and TransferableRecordRegistry (niara-contracts-Register,
// script/DeployV2.s.sol), deployed per EVM network. Addresses are public
// information, so they live here like the v1 ones in register-contract.ts.
//
// Source: niara-contracts-Register, broadcast/DeployV2.s.sol/<chainId>/run-latest.json
// (deployed 2026-10-22). Base, Robinhood, HyperEVM and Tempo share addresses
// (same wallet, same nonce); Sepolia differs. A network not yet deployed stays
// null. For local testing, NEXT_PUBLIC_V2_<NETWORK>_REGISTRY / _ETR override
// them (e.g. NEXT_PUBLIC_V2_SEPOLIA_REGISTRY).
import type { EvmNetwork } from "./register-contract";

export type V2Deployment = {
  registry: `0x${string}` | null;
  etr: `0x${string}` | null;
};

// SignatureRegistryV2 with the public document type (DeploySignatureRegistryV2,
// 2026-10-23). The first v2 registry (0x6cf0a197… / Sepolia 0x03Ad59E1…, no
// type) is retired; the transferable-record registries did not change.
// Same addresses on Base, Robinhood, HyperEVM and Tempo (same wallet, same nonce).
const SHARED: V2Deployment = {
  registry: "0x0E20b7c965a772fECc1d3a1DF2B4a9CC39Fc7156",
  etr: "0x09081D02b06f10D87DE7c99E48F8f07505D25f26",
};

const DEPLOYED: Record<EvmNetwork, V2Deployment> = {
  sepolia: {
    registry: "0xAcC6BddCD560e4fd87F179d2bc6C1C518c50F514",
    etr: "0x764A5de7baF5B33444c271E230007b81755aD424",
  },
  "base-sepolia": SHARED,
  "robinhood-testnet": SHARED,
  "hyperevm-testnet": SHARED,
  "tempo-testnet": SHARED,
};

// Next.js inlines NEXT_PUBLIC_* only when written out literally.
const OVERRIDES: Record<EvmNetwork, { registry?: string; etr?: string }> = {
  sepolia: {
    registry: process.env.NEXT_PUBLIC_V2_SEPOLIA_REGISTRY,
    etr: process.env.NEXT_PUBLIC_V2_SEPOLIA_ETR,
  },
  "base-sepolia": {
    registry: process.env.NEXT_PUBLIC_V2_BASE_SEPOLIA_REGISTRY,
    etr: process.env.NEXT_PUBLIC_V2_BASE_SEPOLIA_ETR,
  },
  "robinhood-testnet": {
    registry: process.env.NEXT_PUBLIC_V2_ROBINHOOD_TESTNET_REGISTRY,
    etr: process.env.NEXT_PUBLIC_V2_ROBINHOOD_TESTNET_ETR,
  },
  "hyperevm-testnet": {
    registry: process.env.NEXT_PUBLIC_V2_HYPEREVM_TESTNET_REGISTRY,
    etr: process.env.NEXT_PUBLIC_V2_HYPEREVM_TESTNET_ETR,
  },
  "tempo-testnet": {
    registry: process.env.NEXT_PUBLIC_V2_TEMPO_TESTNET_REGISTRY,
    etr: process.env.NEXT_PUBLIC_V2_TEMPO_TESTNET_ETR,
  },
};

const isAddress = (v: string | undefined): v is `0x${string}` => Boolean(v && /^0x[0-9a-fA-F]{40}$/.test(v));

export function v2Deployment(network: EvmNetwork): V2Deployment {
  const o = OVERRIDES[network];
  return {
    registry: isAddress(o.registry) ? o.registry : DEPLOYED[network].registry,
    etr: isAddress(o.etr) ? o.etr : DEPLOYED[network].etr,
  };
}

// SignatureRegistryV3 (commit-reveal + ORB attestation; niara-contracts-Register
// script/DeploySignatureRegistryV3.s.sol). Not deployed yet: while a network's
// entry is null the site keeps registering on v2 there. v2 stays readable
// either way. Override for local testing with NEXT_PUBLIC_V3_<NETWORK>_REGISTRY.
const DEPLOYED_V3: Record<EvmNetwork, `0x${string}` | null> = {
  sepolia: null,
  "base-sepolia": null,
  "robinhood-testnet": null,
  "hyperevm-testnet": null,
  "tempo-testnet": null,
};

const OVERRIDES_V3: Record<EvmNetwork, string | undefined> = {
  sepolia: process.env.NEXT_PUBLIC_V3_SEPOLIA_REGISTRY,
  "base-sepolia": process.env.NEXT_PUBLIC_V3_BASE_SEPOLIA_REGISTRY,
  "robinhood-testnet": process.env.NEXT_PUBLIC_V3_ROBINHOOD_TESTNET_REGISTRY,
  "hyperevm-testnet": process.env.NEXT_PUBLIC_V3_HYPEREVM_TESTNET_REGISTRY,
  "tempo-testnet": process.env.NEXT_PUBLIC_V3_TEMPO_TESTNET_REGISTRY,
};

/**
 * When SignatureRegistryV2 stopped being Niara's registry on each network
 * (unix seconds: the timestamp of the v3 deploy block). v2 is ownerless and
 * cannot be paused, so anyone can still write to it; a v2 record made after
 * this moment did not come from the site and could be a copy of a v3
 * registration taken from the mempool. Readers flag those records and do not
 * count them. null = v2 is still the active registry there.
 */
export const V2_RETIRED_AT: Record<EvmNetwork, number | null> = {
  sepolia: null,
  "base-sepolia": null,
  "robinhood-testnet": null,
  "hyperevm-testnet": null,
  "tempo-testnet": null,
};

export function v3Registry(network: EvmNetwork): `0x${string}` | null {
  const o = OVERRIDES_V3[network];
  return isAddress(o) ? o : DEPLOYED_V3[network];
}

export const SIGNATURE_REGISTRY_V3_ABI = [
  "function commitmentOf(address signer, bytes32 recordHash, bytes32 nonce) view returns (bytes32)",
  "function commit(bytes32 commitment)",
  "function commitmentInfo(address signer, bytes32 commitment) view returns (uint256 blockNumber, uint256 timestamp)",
  "function recordIdOf(bytes32 recordHash, address signer) pure returns (bytes32)",
  "function signersOf(bytes32 recordHash) view returns (address[])",
  "function register(bytes32 recordHash, uint8 scheme, uint16 documentType, bytes32 metadataCommitment, bytes32 nonce, bytes32 orbReportHash, bytes orbSignature) returns (uint256 tokenId)",
  "function verify(bytes32 recordHash, address signer) view returns (bool exists, uint256 timestamp, uint8 scheme, uint16 documentType, bytes32 metadataCommitment, bytes32 orbReportHash, uint256 tokenId)",
  "function orbAttester() view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function locked(uint256 tokenId) view returns (bool)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "event Committed(address indexed signer, bytes32 indexed commitment, uint256 blockNumber)",
  "event DocumentRegistered(bytes32 indexed recordHash, address indexed signer, uint8 scheme, uint16 documentType, bytes32 metadataCommitment, bytes32 orbReportHash, uint256 tokenId, uint256 timestamp)",
  "event Locked(uint256 tokenId)",
  "error AlreadyRegistered(bytes32 recordHash)",
  "error InvalidHash()",
  "error UnknownScheme(uint8 scheme)",
  "error InvalidDocumentType()",
  "error Soulbound()",
  "error InvalidCommitment()",
  "error CommitmentPending(bytes32 commitment)",
  "error NoCommitment()",
  "error RevealTooEarly(uint256 revealableAtBlock)",
  "error CommitmentExpired()",
  "error OrbDisabled()",
  "error InvalidOrbAttestation()",
] as const;

export const SIGNATURE_REGISTRY_V2_ABI = [
  "function register(bytes32 recordHash, uint8 scheme, uint16 documentType, bytes32 metadataCommitment) returns (uint256 tokenId)",
  "function verify(bytes32 recordHash) view returns (bool exists, address signer, uint256 timestamp, uint8 scheme, uint16 documentType, bytes32 metadataCommitment)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function locked(uint256 tokenId) view returns (bool)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "event DocumentRegistered(bytes32 indexed recordHash, address indexed signer, uint8 scheme, uint16 documentType, bytes32 metadataCommitment, uint256 timestamp)",
  "event Locked(uint256 tokenId)",
  "error AlreadyRegistered(bytes32 recordHash)",
  "error InvalidHash()",
  "error UnknownScheme(uint8 scheme)",
  "error InvalidDocumentType()",
  "error Soulbound()",
] as const;

export const TRANSFERABLE_RECORD_ABI = [
  "function issue(bytes32 documentHash, bytes32 metadataCommitment, address holder) returns (uint256 tokenId)",
  "function proposeAmendment(uint256 tokenId, bytes32 newDocumentHash, bytes32 newMetadataCommitment)",
  "function cancelAmendment(uint256 tokenId)",
  "function acceptAmendment(uint256 tokenId, bytes32 expectedDocumentHash)",
  "function surrender(uint256 tokenId)",
  "function terminate(uint256 tokenId, uint8 reason)",
  "function transferFrom(address from, address to, uint256 tokenId)",
  "function getRecord(uint256 tokenId) view returns (tuple(address issuer, uint64 issuedAt, uint32 version, uint8 status, bytes32 documentHash, bytes32 metadataCommitment))",
  "function pendingAmendment(uint256 tokenId) view returns (tuple(bytes32 documentHash, bytes32 metadataCommitment))",
  "function controllerOf(uint256 tokenId) view returns (address)",
  "function hashUsed(bytes32) view returns (bool)",
  "event RecordIssued(uint256 indexed tokenId, address indexed issuer, address indexed holder, bytes32 documentHash, bytes32 metadataCommitment)",
  "event AmendmentProposed(uint256 indexed tokenId, bytes32 newDocumentHash, bytes32 newMetadataCommitment)",
  "event AmendmentCancelled(uint256 indexed tokenId)",
  "event RecordAmended(uint256 indexed tokenId, uint32 version, bytes32 documentHash, bytes32 metadataCommitment)",
  "event RecordSurrendered(uint256 indexed tokenId, address indexed by)",
  "event RecordTerminated(uint256 indexed tokenId, uint8 reason)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
  "error InvalidHash()",
  "error HashAlreadyUsed(bytes32 documentHash)",
  "error InvalidHolder()",
  "error NotIssuer()",
  "error NotController()",
  "error NotActive()",
  "error NotSurrendered()",
  "error NoPendingAmendment()",
  "error AmendmentMismatch()",
] as const;

export const ETR_STATUS = ["none", "active", "surrendered", "terminated"] as const;
export type EtrStatus = (typeof ETR_STATUS)[number];
