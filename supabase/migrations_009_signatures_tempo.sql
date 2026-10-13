-- Migration 009: registro_assinaturas accepts Tempo Testnet (Moderato).
--
-- Run ONCE in the Supabase SQL Editor (niara-register-dev) BEFORE publishing
-- the indexer with the tempo-testnet source. Idempotent.

alter table registro_assinaturas
  drop constraint if exists registro_assinaturas_rede_check;

alter table registro_assinaturas
  add constraint registro_assinaturas_rede_check
  check (rede in ('sepolia', 'base-sepolia', 'robinhood-testnet', 'hyperevm-testnet', 'tempo-testnet', 'solana-devnet'));

-- registro_checkpoints gains the 'tempo-testnet-assinaturas' source (last processed block).
-- No schema change.
