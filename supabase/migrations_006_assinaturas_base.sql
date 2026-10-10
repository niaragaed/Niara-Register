-- Migração 006: registro_assinaturas aceita a Base Sepolia.
--
-- Rodar UMA vez no SQL Editor do Supabase (niara-register-dev) ANTES de
-- publicar o indexer com a fonte base-sepolia. Idempotente.

alter table registro_assinaturas
  drop constraint if exists registro_assinaturas_rede_check;

alter table registro_assinaturas
  add constraint registro_assinaturas_rede_check
  check (rede in ('sepolia', 'base-sepolia', 'solana-devnet'));

-- registro_checkpoints ganha a fonte 'base-sepolia-assinaturas' (último bloco
-- da Base Sepolia processado). Sem mudança de schema.
