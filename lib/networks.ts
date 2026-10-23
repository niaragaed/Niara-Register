// The six networks of the Niara Register as one list, with the identifiers the
// credentials use (CAIP-2 chain ids and did:pkh prefixes).
import { EVM_NETWORKS, type EvmNetwork } from "./register-contract";

export type RegisterNetwork = EvmNetwork | "solana-devnet";

export const REGISTER_NETWORKS: RegisterNetwork[] = [
  "sepolia",
  "base-sepolia",
  "robinhood-testnet",
  "hyperevm-testnet",
  "tempo-testnet",
  "solana-devnet",
];

/** Solana devnet genesis hash prefix, as CAIP-2 defines it. */
export const SOLANA_DEVNET_CAIP2 = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

export function isRegisterNetwork(value: string): value is RegisterNetwork {
  return (REGISTER_NETWORKS as string[]).includes(value);
}

export function isEvm(network: RegisterNetwork): network is EvmNetwork {
  return network !== "solana-devnet";
}

export function caip2(network: RegisterNetwork): string {
  return isEvm(network) ? `eip155:${parseInt(EVM_NETWORKS[network].chainIdHex, 16)}` : SOLANA_DEVNET_CAIP2;
}

/** did:pkh for a wallet on a network (EVM addresses lowercased by convention here). */
export function didPkh(network: RegisterNetwork, account: string): string {
  return `did:pkh:${caip2(network)}:${isEvm(network) ? account.toLowerCase() : account}`;
}
