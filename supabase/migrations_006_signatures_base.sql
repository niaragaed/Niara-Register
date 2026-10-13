-- Migration 006: registro_assinaturas accepts Base Sepolia.
--
-- Run ONCE in the Supabase SQL Editor (niara-register-dev) BEFORE publishing
-- the indexer with the base-sepolia source. Idempotent.

alter table registro_assinaturas
  drop constraint if exists registro_assinaturas_rede_check;

alter table registro_assinaturas
  add constraint registro_assinaturas_rede_check
  check (rede in ('sepolia', 'base-sepolia', 'solana-devnet'));

-- registro_checkpoints gains the 'base-sepolia-assinaturas' source (last processed block).
-- No schema change.
