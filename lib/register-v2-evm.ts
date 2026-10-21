// SignatureRegistryV2 and TransferableRecordRegistry (niara-contracts-Register,
// script/DeployV2.s.sol), deployed per EVM network. Addresses are public
// information, so they live here like the v1 ones in register-contract.ts.
//
// They are null until the contracts are deployed on that network: fill them
// from broadcast/DeployV2.s.sol/<chainId>/run-latest.json after each deploy.
// For local testing, NEXT_PUBLIC_V2_<NETWORK>_REGISTRY / _ETR override them
// (e.g. NEXT_PUBLIC_V2_SEPOLIA_REGISTRY).
import type { EvmNetwork } from "./register-contract";

export type V2Deployment = {
  registry: `0x${string}` | null;
  etr: `0x${string}` | null;
};

const DEPLOYED: Record<EvmNetwork, V2Deployment> = {
  sepolia: { registry: null, etr: null },
  "base-sepolia": { registry: null, etr: null },
  "robinhood-testnet": { registry: null, etr: null },
  "hyperevm-testnet": { registry: null, etr: null },
  "tempo-testnet": { registry: null, etr: null },
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

export const SIGNATURE_REGISTRY_V2_ABI = [
  "function register(bytes32 recordHash, uint8 scheme, bytes32 metadataCommitment) returns (uint256 tokenId)",
  "function verify(bytes32 recordHash) view returns (bool exists, address signer, uint256 timestamp, uint8 scheme, bytes32 metadataCommitment)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function locked(uint256 tokenId) view returns (bool)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "event DocumentRegistered(bytes32 indexed recordHash, address indexed signer, uint8 scheme, bytes32 metadataCommitment, uint256 timestamp)",
  "event Locked(uint256 tokenId)",
  "error AlreadyRegistered(bytes32 recordHash)",
  "error InvalidHash()",
  "error UnknownScheme(uint8 scheme)",
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
