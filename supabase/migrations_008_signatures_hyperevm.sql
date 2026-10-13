-- Migration 008: registro_assinaturas accepts HyperEVM Testnet.
--
-- Run ONCE in the Supabase SQL Editor (niara-register-dev) BEFORE publishing
-- the indexer with the hyperevm-testnet source. Idempotent.

alter table registro_assinaturas
  drop constraint if exists registro_assinaturas_rede_check;

alter table registro_assinaturas
  add constraint registro_assinaturas_rede_check
  check (rede in ('sepolia', 'base-sepolia', 'robinhood-testnet', 'hyperevm-testnet', 'solana-devnet'));

-- registro_checkpoints gains the 'hyperevm-testnet-assinaturas' source (last processed block).
-- No schema change.
